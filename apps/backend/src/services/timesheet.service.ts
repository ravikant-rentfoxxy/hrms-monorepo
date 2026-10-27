/**
 * Weekly timesheets: one TimesheetWeek per employee per Monday, with
 * project × day entries. Lifecycle:
 *
 *   DRAFT ──submit──▶ SUBMITTED ──(approval engine, module TIMESHEET)──▶ APPROVED
 *     ▲                   │ recall                                      └─▶ REJECTED ──edit + resubmit──▶ SUBMITTED
 *     └───────────────────┘
 *
 * Only DRAFT / REJECTED weeks are editable. A resubmission cancels whatever
 * is left of the previous chain and starts a fresh one.
 */
import type { Role } from '@prisma/client';
import { openToEmployee } from './project.service';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';
import { addDays, isoDay, mondayOf, utcDay } from '../utils/people';
import * as approvalService from './approval.service';
import { dispatchIntegrationEvent } from './integration.service';

export type WeekStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
const EDITABLE: WeekStatus[] = ['DRAFT', 'REJECTED'];
const MAX_HOURS_PER_DAY = 24;
const OVERRIDE_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'HR'];

export interface EntryInput {
  projectId: string;
  date: Date;
  hours: number;
  billable?: boolean;
  description?: string;
}

export interface Actor {
  role: Role;
  employeeId: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const weekInclude = {
  employee: { select: { id: true, name: true, employeeCode: true, department: true, managerId: true } },
  entries: {
    include: { project: { select: { id: true, name: true, code: true, client: true, isBillable: true, isActive: true } } },
    orderBy: [{ date: 'asc' as const }],
  },
};

// ---- Access ----

/** Owner, ADMIN/HR, the employee's manager, or anyone named on the approval chain may view a week. */
async function assertCanView(companyId: string, week: { id: string; employeeId: string; employee: { managerId: string | null } }, actor: Actor) {
  if (actor.employeeId && actor.employeeId === week.employeeId) return;
  if (OVERRIDE_ROLES.includes(actor.role)) return;
  if (actor.employeeId && week.employee.managerId === actor.employeeId) return;
  if (actor.employeeId) {
    const named = await prisma.approvalStep.count({
      where: { companyId, module: 'TIMESHEET', requestId: week.id, approverEmployeeId: actor.employeeId },
    });
    if (named > 0) return;
  }
  throw ApiError.forbidden('You cannot view this timesheet');
}

/** Resolves whose week the actor may read (own by default; managers their reports; ADMIN/HR anyone). */
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

/** The week starting on the Monday of `weekStart` — a virtual empty DRAFT when nothing is saved yet. */
export async function getWeek(companyId: string, employeeId: string, weekStart: Date) {
  const ws = mondayOf(weekStart);
  const week = await prisma.timesheetWeek.findFirst({
    where: { companyId, employeeId, weekStart: ws },
    include: weekInclude,
  });
  if (!week) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true, name: true, employeeCode: true, department: true, managerId: true },
    });
    if (!employee) throw ApiError.notFound('Employee not found');
    return {
      id: null,
      companyId,
      employeeId,
      employee,
      weekStart: ws,
      weekEnd: addDays(ws, 6),
      status: 'DRAFT' as WeekStatus,
      approverId: null,
      remarks: null,
      submittedAt: null,
      totalHours: 0,
      entries: [],
      editable: true,
      trail: [],
    };
  }
  return {
    ...week,
    weekEnd: addDays(week.weekStart, 6),
    editable: EDITABLE.includes(week.status as WeekStatus),
    trail: await approvalService.trail(companyId, 'TIMESHEET', week.id),
  };
}

export async function getById(companyId: string, id: string, actor: Actor) {
  const week = await prisma.timesheetWeek.findFirst({ where: { id, companyId }, include: weekInclude });
  if (!week) throw ApiError.notFound('Timesheet not found');
  await assertCanView(companyId, week, actor);
  return {
    ...week,
    weekEnd: addDays(week.weekStart, 6),
    editable: EDITABLE.includes(week.status as WeekStatus),
    trail: await approvalService.trail(companyId, 'TIMESHEET', week.id),
  };
}

export interface ListFilter {
  scope: 'me' | 'team' | 'approvals' | 'company';
  status?: WeekStatus;
  from?: Date;
  to?: Date;
}

export async function listWeeks(companyId: string, actor: Actor, filter: ListFilter) {
  let where: object;
  if (filter.scope === 'me') where = { employeeId: actor.employeeId ?? '' };
  else if (filter.scope === 'team') where = { employee: { managerId: actor.employeeId ?? '' } };
  else if (filter.scope === 'approvals') {
    const steps = await approvalService.pendingFor(companyId, actor, 'TIMESHEET');
    where = { id: { in: steps.map((s) => s.requestId) }, status: 'SUBMITTED' };
  } else where = {};
  const range =
    filter.from || filter.to
      ? { weekStart: { ...(filter.from ? { gte: mondayOf(filter.from) } : {}), ...(filter.to ? { lte: utcDay(filter.to) } : {}) } }
      : {};
  const weeks = await prisma.timesheetWeek.findMany({
    where: { companyId, ...where, ...range, ...(filter.status ? { status: filter.status } : {}) },
    include: {
      employee: { select: { id: true, name: true, employeeCode: true, department: true } },
      entries: { select: { hours: true, billable: true } },
    },
    orderBy: [{ weekStart: 'desc' }, { submittedAt: 'desc' }],
    take: 300,
  });
  return weeks.map(({ entries, ...w }) => ({
    ...w,
    weekEnd: addDays(w.weekStart, 6),
    billableHours: round2(entries.filter((e) => e.billable).reduce((s, e) => s + e.hours, 0)),
    nonBillableHours: round2(entries.filter((e) => !e.billable).reduce((s, e) => s + e.hours, 0)),
    entryCount: entries.length,
  }));
}

// ---- Write ----

/**
 * Replaces the week's entries (the client sends the whole grid). Rows with
 * 0 hours are dropped. Validates dates inside the week, active projects
 * (projects already on the week may stay even if since deactivated), no
 * duplicate project/day lines and at most 24h per day.
 */
export async function saveWeek(companyId: string, employeeId: string, weekStart: Date, entries: EntryInput[]) {
  const ws = mondayOf(weekStart);
  const we = addDays(ws, 6);
  const existing = await prisma.timesheetWeek.findFirst({
    where: { companyId, employeeId, weekStart: ws },
    include: { entries: { select: { projectId: true } } },
  });
  if (existing && !EDITABLE.includes(existing.status as WeekStatus)) {
    throw ApiError.badRequest(
      existing.status === 'SUBMITTED'
        ? 'This week is submitted for approval — recall it before editing'
        : 'This week is approved and can no longer be edited'
    );
  }

  const rows = entries.filter((e) => e.hours > 0);
  const projectIds = [...new Set(rows.map((e) => e.projectId))];
  const projects = await prisma.project.findMany({ where: { companyId, id: { in: projectIds } } });
  const alreadyOnWeek = new Set(existing?.entries.map((e) => e.projectId) ?? []);
  // Projects with members are bookable by those members only (hours already on the week stay editable).
  const allowed = new Set(
    (await prisma.project.findMany({ where: { companyId, id: { in: projectIds }, ...openToEmployee(employeeId) }, select: { id: true } })).map((p) => p.id)
  );
  const blocked = projects.find((p) => !allowed.has(p.id) && !alreadyOnWeek.has(p.id));
  if (blocked) throw ApiError.forbidden(`You are not a member of project ${blocked.code} — ask HR or your manager for access`);

  // Several entries per project and day are fine (one per task, each with its own description).
  const perDay = new Map<string, number>();
  const data = rows.map((e) => {
    const project = projects.find((p) => p.id === e.projectId);
    if (!project) throw ApiError.badRequest('Unknown project in the timesheet');
    if (!project.isActive && !alreadyOnWeek.has(project.id)) {
      throw ApiError.badRequest(`Project ${project.code} is inactive`);
    }
    const date = utcDay(e.date);
    if (date < ws || date > we) {
      throw ApiError.badRequest(`${isoDay(date)} is outside the week ${isoDay(ws)} – ${isoDay(we)}`);
    }
    const hours = round2(e.hours);
    const dayTotal = round2((perDay.get(isoDay(date)) ?? 0) + hours);
    if (dayTotal > MAX_HOURS_PER_DAY) {
      throw ApiError.badRequest(`${isoDay(date)} has ${dayTotal}h booked — at most ${MAX_HOURS_PER_DAY}h per day`);
    }
    perDay.set(isoDay(date), dayTotal);
    return {
      companyId,
      projectId: project.id,
      date,
      hours,
      billable: e.billable ?? project.isBillable,
      description: (e.description ?? '').trim(),
    };
  });
  const totalHours = round2(data.reduce((s, e) => s + e.hours, 0));

  const weekId = await prisma.$transaction(async (tx) => {
    const week =
      existing ??
      (await tx.timesheetWeek.create({ data: { companyId, employeeId, weekStart: ws, status: 'DRAFT' } }));
    await tx.timesheetEntry.deleteMany({ where: { weekId: week.id } });
    if (data.length > 0) await tx.timesheetEntry.createMany({ data: data.map((e) => ({ ...e, weekId: week.id })) });
    await tx.timesheetWeek.update({ where: { id: week.id }, data: { totalHours } });
    return week.id;
  });
  return getWeek(companyId, employeeId, ws).then((w) => ({ ...w, id: weekId }));
}

/** Copies the previous week's project/day lines (shifted by 7 days) into an empty editable week. */
export async function copyLastWeek(companyId: string, employeeId: string, weekStart: Date) {
  const ws = mondayOf(weekStart);
  const current = await prisma.timesheetWeek.findFirst({
    where: { companyId, employeeId, weekStart: ws },
    include: { _count: { select: { entries: true } } },
  });
  if (current && current._count.entries > 0) {
    throw ApiError.badRequest('This week already has entries — clear them before copying last week');
  }
  const previous = await prisma.timesheetWeek.findFirst({
    where: { companyId, employeeId, weekStart: addDays(ws, -7) },
    include: { entries: { include: { project: { select: { isActive: true } } } } },
  });
  const lines = (previous?.entries ?? []).filter((e) => e.project.isActive);
  if (lines.length === 0) throw ApiError.badRequest('Nothing to copy — last week has no entries on active projects');
  return saveWeek(
    companyId,
    employeeId,
    ws,
    lines.map((e) => ({
      projectId: e.projectId,
      date: addDays(e.date, 7),
      hours: e.hours,
      billable: e.billable,
      description: e.description,
    }))
  );
}

/** Submits the week for approval (DRAFT or REJECTED → SUBMITTED) and (re)starts the TIMESHEET chain. */
export async function submitWeek(companyId: string, employeeId: string, weekId: string) {
  const week = await prisma.timesheetWeek.findFirst({
    where: { id: weekId, companyId, employeeId },
    include: { _count: { select: { entries: true } } },
  });
  if (!week) throw ApiError.notFound('Timesheet not found');
  if (!EDITABLE.includes(week.status as WeekStatus)) {
    throw ApiError.badRequest(`A ${week.status.toLowerCase()} timesheet cannot be submitted again`);
  }
  if (week._count.entries === 0 || week.totalHours <= 0) throw ApiError.badRequest('Add hours before submitting');

  // Resubmission: whatever is left of an earlier chain must not linger in approvers' inboxes.
  await approvalService.cancel(companyId, 'TIMESHEET', week.id);
  const updated = await prisma.timesheetWeek.update({
    where: { id: week.id },
    data: { status: 'SUBMITTED', submittedAt: new Date(), approverId: null, remarks: null },
  });
  await approvalService.start(companyId, 'TIMESHEET', week.id, employeeId);
  return updated;
}

/** Pulls a SUBMITTED week back to DRAFT (before anyone finished approving it). */
export async function recallWeek(companyId: string, employeeId: string, weekId: string) {
  const week = await prisma.timesheetWeek.findFirst({ where: { id: weekId, companyId, employeeId } });
  if (!week) throw ApiError.notFound('Timesheet not found');
  if (week.status !== 'SUBMITTED') throw ApiError.badRequest('Only a submitted timesheet can be recalled');
  await approvalService.cancel(companyId, 'TIMESHEET', week.id);
  return prisma.timesheetWeek.update({ where: { id: week.id }, data: { status: 'DRAFT', submittedAt: null } });
}

/** Records a decision on the current approval level; finalises on the last level or a rejection. */
export async function decideWeek(
  companyId: string,
  weekId: string,
  input: { decision: 'APPROVED' | 'REJECTED'; remarks?: string; actor: Actor }
) {
  const week = await prisma.timesheetWeek.findFirst({ where: { id: weekId, companyId } });
  if (!week) throw ApiError.notFound('Timesheet not found');
  if (week.status !== 'SUBMITTED') throw ApiError.badRequest(`Timesheet is ${week.status.toLowerCase()}, not awaiting approval`);
  if (input.decision === 'REJECTED' && !input.remarks?.trim()) {
    throw ApiError.badRequest('Add a remark so the employee knows what to fix');
  }

  const r = await approvalService.act(
    companyId,
    'TIMESHEET',
    week.id,
    week.employeeId,
    { role: input.actor.role, employeeId: input.actor.employeeId },
    input.decision,
    input.remarks
  );
  if (r.outcome === 'PENDING') return { outcome: r.outcome, week };

  const updated = await prisma.timesheetWeek.update({
    where: { id: week.id },
    data: { status: r.outcome, approverId: input.actor.employeeId, remarks: input.remarks ?? null },
  });
  const label = `Timesheet for the week of ${isoDay(week.weekStart)}`;
  await notify(companyId, [week.employeeId], {
    event: r.outcome === 'APPROVED' ? 'timesheet.approved' : 'timesheet.rejected',
    title: `${label} ${r.outcome === 'APPROVED' ? 'approved' : 'rejected'}`,
    body: r.outcome === 'APPROVED' ? `${week.totalHours}h approved.` : `Please correct and resubmit. ${input.remarks ?? ''}`.trim(),
    link: '/timesheets',
  });
  await dispatchIntegrationEvent(companyId, `timesheet.${r.outcome.toLowerCase()}`, {
    title: `${label} ${r.outcome.toLowerCase()}`,
    body: `${week.totalHours}h`,
    employeeId: week.employeeId,
    weekStart: isoDay(week.weekStart),
  });
  return { outcome: r.outcome, week: updated };
}

// ---- Reports ----

export interface UtilisationFilter {
  from: Date;
  to: Date;
  projectId?: string;
  approvedOnly: boolean;
}

/**
 * Billable vs non-billable hours per project and per employee for a date
 * range (entry dates). Counts SUBMITTED + APPROVED weeks by default.
 */
export async function utilisation(companyId: string, filter: UtilisationFilter) {
  const entries = await prisma.timesheetEntry.findMany({
    where: {
      companyId,
      date: { gte: utcDay(filter.from), lte: utcDay(filter.to) },
      ...(filter.projectId ? { projectId: filter.projectId } : {}),
      week: { status: { in: filter.approvedOnly ? ['APPROVED'] : ['SUBMITTED', 'APPROVED'] } },
    },
    include: {
      project: { select: { id: true, code: true, name: true, client: true } },
      week: { select: { employee: { select: { id: true, name: true, employeeCode: true, department: true } } } },
    },
  });

  type Bucket = { billable: number; nonBillable: number };
  const add = (b: Bucket, e: { hours: number; billable: boolean }) => {
    if (e.billable) b.billable += e.hours;
    else b.nonBillable += e.hours;
  };
  const byProject = new Map<string, Bucket & { project: (typeof entries)[number]['project']; people: Set<string> }>();
  const byEmployee = new Map<string, Bucket & { employee: (typeof entries)[number]['week']['employee'] }>();
  const rows = new Map<string, Bucket & { project: (typeof entries)[number]['project']; employee: (typeof entries)[number]['week']['employee'] }>();
  const totals: Bucket = { billable: 0, nonBillable: 0 };

  for (const e of entries) {
    const emp = e.week.employee;
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
