/**
 * Daily timesheets: one TimesheetDay per employee per calendar date, with any
 * number of project entries. Lifecycle:
 *
 *   DRAFT ──submit──▶ SUBMITTED (final — there is no approval step)
 *
 * Only past days and today (IST) can be filled; future dates are refused.
 */
import type { Role } from '@prisma/client';
import { openToEmployee } from './project.service';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { istNow } from '../lib/scheduler';
import { FILE_LINK_TTL_SECONDS, objectKey, presignedGetUrl, putObject, removeObject } from '../lib/storage';
import { ApiError } from '../utils/http';
import { addDays, isoDay, utcDay } from '../utils/people';
import { dispatchIntegrationEvent } from './integration.service';

export type DayStatus = 'DRAFT' | 'SUBMITTED';
const MAX_HOURS_PER_DAY = 24;
const OVERRIDE_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'HR'];
const MAX_ATTACHMENTS = 10;
/** Documents, images and PDFs — matched on extension, since browsers report office MIME types inconsistently. */
const ATTACHMENT_EXT = /\.(pdf|png|jpe?g|gif|webp|heic|heif|bmp|svg|docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|csv)$/i;

export interface EntryInput {
  /** Client-generated for new lines; existing ids keep the entry (and its attachments) across saves. */
  id?: string;
  projectId: string;
  hours: number;
  billable?: boolean;
  description?: string;
}

export interface Actor {
  role: Role;
  employeeId: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Today's date (midnight UTC) on the IST calendar. */
export const todayIst = () => utcDay(istNow());

function assertNotFuture(date: Date) {
  if (date > todayIst()) throw ApiError.badRequest('Timesheets can only be filled for today or past days');
}

const attachmentSelect = {
  // fileKey stays server-side; files are opened through the access-checked download route.
  select: { id: true, name: true, mimeType: true, size: true, uploadedOn: true },
  orderBy: [{ uploadedOn: 'asc' as const }],
};

const entriesInclude = {
  include: {
    project: { select: { id: true, name: true, code: true, client: true, isBillable: true, isActive: true } },
    attachments: attachmentSelect,
  },
  orderBy: [{ position: 'asc' as const }],
};

const dayInclude = {
  employee: { select: { id: true, name: true, employeeCode: true, department: true, managerId: true } },
  entries: entriesInclude,
};

// ---- Access ----

/** Owner, ADMIN/HR or the employee's manager may view a day. */
function assertCanView(day: { employeeId: string; employee: { managerId: string | null } }, actor: Actor) {
  if (actor.employeeId && actor.employeeId === day.employeeId) return;
  if (OVERRIDE_ROLES.includes(actor.role)) return;
  if (actor.employeeId && day.employee.managerId === actor.employeeId) return;
  throw ApiError.forbidden('You cannot view this timesheet');
}

/** Resolves whose day the actor may read (own by default; managers their reports; ADMIN/HR anyone). */
export async function resolveTarget(companyId: string, actor: Actor, requested?: string): Promise<string> {
  if (!requested || requested === actor.employeeId) {
    if (!actor.employeeId) throw ApiError.badRequest('employeeId required');
    return actor.employeeId;
  }
  const target = await prisma.employee.findFirst({ where: { id: requested, companyId }, select: { id: true, managerId: true } });
  if (!target) throw ApiError.notFound('Employee not found');
  if (OVERRIDE_ROLES.includes(actor.role)) return target.id;
  if (actor.role === 'MANAGER' && target.managerId === actor.employeeId) return target.id;
  throw ApiError.forbidden('You can only view your own or your direct reports\' timesheets');
}

// ---- Read ----

const withFlags = <T extends { status: string; date: Date }>(day: T) => ({
  ...day,
  editable: day.status === 'DRAFT' && day.date <= todayIst(),
});

/** The timesheet for `date` — a virtual empty DRAFT when nothing is saved yet. */
export async function getDay(companyId: string, employeeId: string, date: Date) {
  const d = utcDay(date);
  const day = await prisma.timesheetDay.findFirst({ where: { companyId, employeeId, date: d }, include: dayInclude });
  if (day) return withFlags(day);
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    select: { id: true, name: true, employeeCode: true, department: true, managerId: true },
  });
  if (!employee) throw ApiError.notFound('Employee not found');
  return withFlags({
    id: null as string | null,
    companyId,
    employeeId,
    employee,
    date: d,
    status: 'DRAFT' as DayStatus,
    submittedAt: null as Date | null,
    totalHours: 0,
    entries: [],
  });
}

export async function getById(companyId: string, id: string, actor: Actor) {
  const day = await prisma.timesheetDay.findFirst({ where: { id, companyId }, include: dayInclude });
  if (!day) throw ApiError.notFound('Timesheet not found');
  assertCanView(day, actor);
  return withFlags(day);
}

export interface ListFilter {
  /** me = own, team = direct reports, company = everyone (ADMIN/HR). */
  scope: 'me' | 'team' | 'company';
  status?: DayStatus;
  from?: Date;
  to?: Date;
  employeeId?: string;
}

/** Days with their entries (newest first) — the submitted-timesheets tables. Defaults to the last 30 days. */
export async function listDays(companyId: string, actor: Actor, filter: ListFilter) {
  const to = utcDay(filter.to ?? todayIst());
  const from = utcDay(filter.from ?? addDays(to, -29));
  let who: object;
  if (filter.scope === 'me') who = { employeeId: actor.employeeId ?? '' };
  else if (filter.scope === 'team') who = { employee: { managerId: actor.employeeId ?? '' } };
  else who = {};
  const days = await prisma.timesheetDay.findMany({
    where: {
      companyId,
      ...who,
      ...(filter.employeeId && filter.scope !== 'me' ? { employeeId: filter.employeeId } : {}),
      date: { gte: from, lte: to },
      ...(filter.status ? { status: filter.status } : {}),
    },
    include: {
      employee: { select: { id: true, name: true, employeeCode: true, department: true } },
      entries: entriesInclude,
    },
    orderBy: [{ date: 'desc' }, { submittedAt: 'desc' }],
    take: 500,
  });
  return { from, to, days: days.map(withFlags) };
}

// ---- Write ----

/**
 * Syncs the day's entries to the lines the client sends: known ids are
 * updated, new ids are created, everything else is deleted (with its
 * attachments). Lines with 0 hours are dropped. Several lines per project
 * are fine (one per task); the day may total at most 24h.
 */
export async function saveDay(companyId: string, employeeId: string, date: Date, entries: EntryInput[]) {
  const d = utcDay(date);
  assertNotFuture(d);
  const existing = await prisma.timesheetDay.findFirst({
    where: { companyId, employeeId, date: d },
    include: { entries: { select: { id: true, projectId: true } } },
  });
  if (existing && existing.status !== 'DRAFT') throw ApiError.badRequest('This day is already submitted and can no longer be edited');

  const rows = entries.filter((e) => e.hours > 0);
  const projectIds = [...new Set(rows.map((e) => e.projectId))];
  const projects = await prisma.project.findMany({ where: { companyId, id: { in: projectIds } } });
  const alreadyOnDay = new Set(existing?.entries.map((e) => e.projectId) ?? []);
  // Projects with members are bookable by those members only (hours already on the day stay editable).
  const allowed = new Set(
    (await prisma.project.findMany({ where: { companyId, id: { in: projectIds }, ...openToEmployee(employeeId) }, select: { id: true } })).map((p) => p.id)
  );
  const blocked = projects.find((p) => !allowed.has(p.id) && !alreadyOnDay.has(p.id));
  if (blocked) throw ApiError.forbidden(`You are not a member of project ${blocked.code} — ask HR or your manager for access`);

  const data = rows.map((e, position) => {
    const project = projects.find((p) => p.id === e.projectId);
    if (!project) throw ApiError.badRequest('Unknown project in the timesheet');
    if (!project.isActive && !alreadyOnDay.has(project.id)) throw ApiError.badRequest(`Project ${project.code} is inactive`);
    return {
      id: e.id,
      companyId,
      projectId: project.id,
      date: d,
      hours: round2(e.hours),
      billable: e.billable ?? project.isBillable,
      description: (e.description ?? '').trim(),
      position,
    };
  });
  const totalHours = round2(data.reduce((s, e) => s + e.hours, 0));
  if (totalHours > MAX_HOURS_PER_DAY) throw ApiError.badRequest(`${totalHours}h booked — at most ${MAX_HOURS_PER_DAY}h per day`);

  const ownIds = new Set(existing?.entries.map((e) => e.id) ?? []);
  const sentIds = data.map((e) => e.id).filter((id): id is string => !!id);
  if (new Set(sentIds).size !== sentIds.length) throw ApiError.badRequest('Duplicate entry id in the timesheet');
  const foreignIds = sentIds.filter((id) => !ownIds.has(id));
  if (foreignIds.length > 0 && (await prisma.timesheetEntry.count({ where: { id: { in: foreignIds } } })) > 0) {
    throw ApiError.badRequest('Entry id belongs to another timesheet');
  }
  const kept = new Set(sentIds.filter((id) => ownIds.has(id)));
  const removedIds = [...ownIds].filter((id) => !kept.has(id));
  const orphanKeys = removedIds.length
    ? (await prisma.timesheetAttachment.findMany({ where: { entryId: { in: removedIds } }, select: { fileKey: true } })).map((a) => a.fileKey)
    : [];

  await prisma.$transaction(async (tx) => {
    const day = existing ?? (await tx.timesheetDay.create({ data: { companyId, employeeId, date: d, status: 'DRAFT' } }));
    if (removedIds.length > 0) await tx.timesheetEntry.deleteMany({ where: { dayId: day.id, id: { in: removedIds } } });
    for (const { id, companyId: _c, ...fields } of data.filter((e) => e.id && kept.has(e.id))) {
      await tx.timesheetEntry.update({ where: { id }, data: fields });
    }
    const fresh = data.filter((e) => !e.id || !kept.has(e.id));
    if (fresh.length > 0) await tx.timesheetEntry.createMany({ data: fresh.map((e) => ({ ...e, dayId: day.id })) });
    await tx.timesheetDay.update({ where: { id: day.id }, data: { totalHours } });
  });
  for (const key of orphanKeys) {
    await removeObject(key).catch((err: unknown) => logger.warn({ err, key }, 'timesheet attachment object not removed'));
  }
  return getDay(companyId, employeeId, d);
}

/** Copies the lines of the most recent earlier day with entries into an empty draft day. */
export async function copyPreviousDay(companyId: string, employeeId: string, date: Date) {
  const d = utcDay(date);
  const current = await prisma.timesheetDay.findFirst({
    where: { companyId, employeeId, date: d },
    include: { _count: { select: { entries: true } } },
  });
  if (current && current._count.entries > 0) throw ApiError.badRequest('This day already has entries — clear them before copying');
  const previous = await prisma.timesheetDay.findFirst({
    where: { companyId, employeeId, date: { lt: d }, entries: { some: {} } },
    orderBy: { date: 'desc' },
    include: { entries: { include: { project: { select: { isActive: true } } }, orderBy: { position: 'asc' } } },
  });
  const lines = (previous?.entries ?? []).filter((e) => e.project.isActive);
  if (lines.length === 0) throw ApiError.badRequest('Nothing to copy — no earlier day has entries on active projects');
  return saveDay(
    companyId,
    employeeId,
    d,
    lines.map((e) => ({ projectId: e.projectId, hours: e.hours, billable: e.billable, description: e.description }))
  );
}

/** Submits a draft day. Submitted days are final. */
export async function submitDay(companyId: string, employeeId: string, dayId: string) {
  const day = await prisma.timesheetDay.findFirst({
    where: { id: dayId, companyId, employeeId },
    include: { _count: { select: { entries: true } } },
  });
  if (!day) throw ApiError.notFound('Timesheet not found');
  if (day.status !== 'DRAFT') throw ApiError.badRequest('This day is already submitted');
  assertNotFuture(day.date);
  if (day._count.entries === 0 || day.totalHours <= 0) throw ApiError.badRequest('Add hours before submitting');
  const updated = await prisma.timesheetDay.update({ where: { id: day.id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
  await dispatchIntegrationEvent(companyId, 'timesheet.submitted', {
    title: `Timesheet for ${isoDay(day.date)} submitted`,
    body: `${day.totalHours}h`,
    employeeId,
    date: isoDay(day.date),
  });
  return updated;
}

// ---- Attachments ----

export interface AttachmentFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

/** The owner's own day, still a draft. */
async function loadEditableOwn(companyId: string, employeeId: string, dayId: string) {
  const day = await prisma.timesheetDay.findFirst({ where: { id: dayId, companyId, employeeId } });
  if (!day) throw ApiError.notFound('Timesheet not found');
  if (day.status !== 'DRAFT') throw ApiError.badRequest('This day is already submitted and can no longer be edited');
  return day;
}

/** Deletes one entry (and its files) from a draft day right away, without resaving the other lines. */
export async function deleteEntry(companyId: string, employeeId: string, dayId: string, entryId: string) {
  const day = await loadEditableOwn(companyId, employeeId, dayId);
  const entry = await prisma.timesheetEntry.findFirst({
    where: { id: entryId, dayId: day.id, companyId },
    include: { attachments: { select: { fileKey: true } } },
  });
  if (!entry) throw ApiError.notFound('Entry not found');
  const totalHours = await prisma.$transaction(async (tx) => {
    await tx.timesheetEntry.delete({ where: { id: entry.id } });
    const sum = await tx.timesheetEntry.aggregate({ where: { dayId: day.id }, _sum: { hours: true } });
    const total = round2(sum._sum.hours ?? 0);
    await tx.timesheetDay.update({ where: { id: day.id }, data: { totalHours: total } });
    return total;
  });
  for (const { fileKey } of entry.attachments) {
    await removeObject(fileKey).catch((err: unknown) => logger.warn({ err, key: fileKey }, 'timesheet attachment object not removed'));
  }
  return { deleted: true, totalHours };
}

export async function addAttachment(companyId: string, employeeId: string, dayId: string, entryId: string, file: AttachmentFile) {
  const day = await loadEditableOwn(companyId, employeeId, dayId);
  const entry = await prisma.timesheetEntry.findFirst({
    where: { id: entryId, dayId: day.id, companyId },
    include: { _count: { select: { attachments: true } } },
  });
  if (!entry) throw ApiError.notFound('Entry not found — save the timesheet first');
  if (!ATTACHMENT_EXT.test(file.originalname)) {
    throw ApiError.badRequest('Only documents (Word, Excel, PowerPoint, text, CSV), images and PDFs can be attached');
  }
  if (entry._count.attachments >= MAX_ATTACHMENTS) throw ApiError.badRequest(`At most ${MAX_ATTACHMENTS} attachments per entry`);
  const key = objectKey(companyId, 'timesheets', file.originalname);
  const mimeType = file.mimetype || 'application/octet-stream';
  await putObject(key, file.buffer, mimeType);
  const { fileKey: _k, ...rest } = await prisma.timesheetAttachment.create({
    data: { companyId, dayId: day.id, entryId: entry.id, name: file.originalname, fileKey: key, mimeType, size: file.size, uploadedById: employeeId },
  });
  return rest;
}

export async function deleteAttachment(companyId: string, employeeId: string, dayId: string, attachmentId: string) {
  const day = await loadEditableOwn(companyId, employeeId, dayId);
  const att = await prisma.timesheetAttachment.findFirst({ where: { id: attachmentId, dayId: day.id, companyId } });
  if (!att) throw ApiError.notFound('Attachment not found');
  await prisma.timesheetAttachment.delete({ where: { id: att.id } });
  await removeObject(att.fileKey).catch((err: unknown) => logger.warn({ err, key: att.fileKey }, 'timesheet attachment object not removed'));
}

/** Signed link for anyone who may view the day (owner, manager, ADMIN/HR). */
export async function attachmentUrl(companyId: string, dayId: string, attachmentId: string, actor: Actor, inline: boolean) {
  const day = await prisma.timesheetDay.findFirst({
    where: { id: dayId, companyId },
    select: { id: true, employeeId: true, employee: { select: { managerId: true } } },
  });
  if (!day) throw ApiError.notFound('Timesheet not found');
  assertCanView(day, actor);
  const att = await prisma.timesheetAttachment.findFirst({ where: { id: attachmentId, dayId: day.id, companyId } });
  if (!att) throw ApiError.notFound('Attachment not found');
  return {
    url: await presignedGetUrl(att.fileKey, att.name, inline ? 'inline' : 'attachment'),
    mimeType: att.mimeType,
    expiresInSeconds: FILE_LINK_TTL_SECONDS,
  };
}

// ---- Reports ----

export interface UtilisationFilter {
  from: Date;
  to: Date;
  projectId?: string;
}

/**
 * Billable vs non-billable hours per project and per employee for a date
 * range. Counts SUBMITTED days only.
 */
export async function utilisation(companyId: string, filter: UtilisationFilter) {
  const entries = await prisma.timesheetEntry.findMany({
    where: {
      companyId,
      date: { gte: utcDay(filter.from), lte: utcDay(filter.to) },
      ...(filter.projectId ? { projectId: filter.projectId } : {}),
      day: { status: 'SUBMITTED' },
    },
    include: {
      project: { select: { id: true, code: true, name: true, client: true } },
      day: { select: { employee: { select: { id: true, name: true, employeeCode: true, department: true } } } },
    },
  });

  type Bucket = { billable: number; nonBillable: number };
  const add = (b: Bucket, e: { hours: number; billable: boolean }) => {
    if (e.billable) b.billable += e.hours;
    else b.nonBillable += e.hours;
  };
  const byProject = new Map<string, Bucket & { project: (typeof entries)[number]['project']; people: Set<string> }>();
  const byEmployee = new Map<string, Bucket & { employee: (typeof entries)[number]['day']['employee'] }>();
  const rows = new Map<string, Bucket & { project: (typeof entries)[number]['project']; employee: (typeof entries)[number]['day']['employee'] }>();
  const totals: Bucket = { billable: 0, nonBillable: 0 };

  for (const e of entries) {
    const emp = e.day.employee;
    const p = byProject.get(e.projectId) ?? { project: e.project, billable: 0, nonBillable: 0, people: new Set<string>() };
    add(p, e);
    p.people.add(emp.id);
    byProject.set(e.projectId, p);
    const m = byEmployee.get(emp.id) ?? { employee: emp, billable: 0, nonBillable: 0 };
    add(m, e);
    byEmployee.set(emp.id, m);
    const key = `${e.projectId}|${emp.id}`;
    const r = rows.get(key) ?? { project: e.project, employee: emp, billable: 0, nonBillable: 0 };
    add(r, e);
    rows.set(key, r);
    add(totals, e);
  }

  const finish = (b: Bucket) => {
    const total = round2(b.billable + b.nonBillable);
    return {
      billable: round2(b.billable),
      nonBillable: round2(b.nonBillable),
      total,
      billablePct: total > 0 ? Math.round((b.billable / total) * 1000) / 10 : 0,
    };
  };
  return {
    from: utcDay(filter.from),
    to: utcDay(filter.to),
    totals: finish(totals),
    byProject: [...byProject.values()]
      .map(({ people, ...p }) => ({ project: p.project, employees: people.size, ...finish(p) }))
      .sort((a, b) => b.total - a.total),
    byEmployee: [...byEmployee.values()].map((m) => ({ employee: m.employee, ...finish(m) })).sort((a, b) => b.total - a.total),
    rows: [...rows.values()]
      .map((r) => ({ project: r.project, employee: r.employee, ...finish(r) }))
      .sort((a, b) => a.project.code.localeCompare(b.project.code) || b.total - a.total),
  };
}
