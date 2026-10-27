/**
 * Career: employee history (read side), skills and certifications.
 *
 *   History        — EmployeeHistory rows written by every module through
 *                    employee-history.service (joined, confirmed, promoted, ...).
 *   Skills         — self-maintained (skill, level, years); the reporting
 *                    manager (or HR) endorses.
 *   Certifications — self / HR maintained, optional file (MinIO) + credential
 *                    link; HR verifies. Completed internal courses create a
 *                    verified certification automatically (training.service).
 *
 * Who may view an employee's career data: the employee, their reporting
 * manager, ADMIN/HR.
 */
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { objectKey, presignedGetUrl, putObject, removeObject } from '../lib/storage';
import { logger } from '../lib/logger';
import { ApiError } from '../utils/http';
import { addDays, isCompanyAdmin, longDate, todayUTC } from '../utils/lifecycle';
import { listHistory } from './employee-history.service';

export interface Actor {
  role: Role;
  employeeId: string | null;
}

export const SKILL_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

/** Days before expiry that holders are reminded. */
export const EXPIRY_REMINDER_DAYS = [30, 7] as const;
/** "Expiring soon" window for the lists. */
export const EXPIRING_WINDOW_DAYS = 30;

const employeeBrief = {
  id: true, name: true, employeeCode: true, designation: true, department: true, avatarColor: true, managerId: true,
  employmentStatus: true,
} satisfies Prisma.EmployeeSelect;

/** Loads the employee and checks the viewer is self, their manager or ADMIN/HR. */
export async function assertCanView(companyId: string, viewer: Actor, employeeId: string) {
  const emp = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: employeeBrief });
  if (!emp) throw ApiError.notFound('Employee not found');
  if (isCompanyAdmin(viewer.role)) return emp;
  if (viewer.employeeId && (viewer.employeeId === emp.id || viewer.employeeId === emp.managerId)) return emp;
  throw ApiError.forbidden("You can only view your own or your direct reports' career records");
}

const requireSelf = (actor: Actor): string => {
  if (!actor.employeeId) throw ApiError.forbidden('This account has no employee profile');
  return actor.employeeId;
};

// ---- History ----

/** Career history, newest first. Salary amounts are hidden from anyone but the employee and ADMIN/HR. */
export async function history(companyId: string, viewer: Actor, employeeId: string) {
  const employee = await assertCanView(companyId, viewer, employeeId);
  const rows = await listHistory(companyId, employeeId);
  const seesPay = isCompanyAdmin(viewer.role) || viewer.employeeId === employeeId;
  const actors = [...new Set(rows.map((r) => r.createdById).filter((v): v is string => !!v))];
  const names = new Map(
    (await prisma.employee.findMany({ where: { companyId, id: { in: actors } }, select: { id: true, name: true } })).map((e) => [e.id, e.name])
  );
  return {
    employee,
    items: rows.map((r) => {
      const hide = r.type === 'SALARY_REVISION' && !seesPay;
      return {
        ...r,
        title: hide ? 'Salary revised' : r.title,
        fromValue: hide ? null : r.fromValue,
        toValue: hide ? null : r.toValue,
        createdByName: r.createdById ? (names.get(r.createdById) ?? null) : null,
      };
    }),
  };
}

// ---- Skills ----

export interface SkillInput {
  skill: string;
  level: SkillLevel;
  years?: number;
}

/** Display form: trimmed, inner whitespace collapsed (uniqueness is per exact name, so normalise). */
const normSkill = (s: string): string => s.trim().replace(/\s+/g, ' ');

export async function listSkills(companyId: string, viewer: Actor, employeeId: string) {
  await assertCanView(companyId, viewer, employeeId);
  const rows = await prisma.employeeSkill.findMany({ where: { companyId, employeeId }, orderBy: [{ level: 'desc' }, { skill: 'asc' }] });
  return withEndorserNames(companyId, rows);
}

async function withEndorserNames<T extends { endorsedById: string | null }>(companyId: string, rows: T[]) {
  const ids = [...new Set(rows.map((r) => r.endorsedById).filter((v): v is string => !!v))];
  const names = new Map(
    (await prisma.employee.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, name: true } })).map((e) => [e.id, e.name])
  );
  return rows.map((r) => ({ ...r, endorsedByName: r.endorsedById ? (names.get(r.endorsedById) ?? null) : null }));
}

/**
 * Adds (or updates, matched case-insensitively) one of the caller's own
 * skills. ADMIN/HR may maintain anyone's via `employeeId`. A changed level
 * clears the manager's endorsement.
 */
export async function upsertSkill(companyId: string, actor: Actor, input: SkillInput & { employeeId?: string }) {
  const employeeId = input.employeeId ?? requireSelf(actor);
  if (employeeId !== actor.employeeId && !isCompanyAdmin(actor.role)) throw ApiError.forbidden('You can only edit your own skills');
  const emp = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { id: true } });
  if (!emp) throw ApiError.notFound('Employee not found');
  const skill = normSkill(input.skill);
  if (!skill) throw ApiError.badRequest('Skill name is required');
  const existing = await prisma.employeeSkill.findFirst({
    where: { companyId, employeeId, skill: { equals: skill, mode: 'insensitive' } },
  });
  if (existing) {
    return prisma.employeeSkill.update({
      where: { id: existing.id },
      data: {
        skill,
        level: input.level,
        years: input.years ?? existing.years,
        ...(input.level !== existing.level ? { endorsedById: null } : {}),
      },
    });
  }
  const count = await prisma.employeeSkill.count({ where: { companyId, employeeId } });
  if (count >= 100) throw ApiError.badRequest('A profile can list at most 100 skills');
  return prisma.employeeSkill.create({ data: { companyId, employeeId, skill, level: input.level, years: input.years ?? 0 } });
}

async function skillOrThrow(companyId: string, id: string) {
  const row = await prisma.employeeSkill.findFirst({ where: { id, companyId } });
  if (!row) throw ApiError.notFound('Skill not found');
  return row;
}

export async function updateSkill(companyId: string, actor: Actor, id: string, input: Partial<SkillInput>) {
  const row = await skillOrThrow(companyId, id);
  if (row.employeeId !== actor.employeeId && !isCompanyAdmin(actor.role)) throw ApiError.forbidden('You can only edit your own skills');
  const skill = input.skill !== undefined ? normSkill(input.skill) : undefined;
  if (skill !== undefined && !skill) throw ApiError.badRequest('Skill name is required');
  if (skill && skill.toLowerCase() !== row.skill.toLowerCase()) {
    const clash = await prisma.employeeSkill.findFirst({
      where: { companyId, employeeId: row.employeeId, id: { not: id }, skill: { equals: skill, mode: 'insensitive' } },
    });
    if (clash) throw ApiError.conflict(`"${clash.skill}" is already on the profile`);
  }
  const levelChanged = input.level !== undefined && input.level !== row.level;
  return prisma.employeeSkill.update({
    where: { id },
    data: {
      ...(skill !== undefined ? { skill } : {}),
      ...(input.level !== undefined ? { level: input.level } : {}),
      ...(input.years !== undefined ? { years: input.years } : {}),
      ...(levelChanged || (skill && skill.toLowerCase() !== row.skill.toLowerCase()) ? { endorsedById: null } : {}),
    },
  });
}

export async function deleteSkill(companyId: string, actor: Actor, id: string) {
  const row = await skillOrThrow(companyId, id);
  if (row.employeeId !== actor.employeeId && !isCompanyAdmin(actor.role)) throw ApiError.forbidden('You can only remove your own skills');
  await prisma.employeeSkill.delete({ where: { id } });
  return row;
}

/** The reporting manager (or ADMIN/HR) endorses / withdraws an endorsement. Nobody endorses their own skill. */
export async function endorseSkill(companyId: string, actor: Actor, id: string, endorse: boolean) {
  const row = await skillOrThrow(companyId, id);
  const owner = await prisma.employee.findUniqueOrThrow({ where: { id: row.employeeId }, select: { name: true, managerId: true } });
  if (row.employeeId === actor.employeeId) throw ApiError.forbidden('You cannot endorse your own skill');
  const isManager = !!actor.employeeId && owner.managerId === actor.employeeId;
  if (!isManager && !isCompanyAdmin(actor.role)) throw ApiError.forbidden("Only the employee's manager or HR can endorse skills");
  const updated = await prisma.employeeSkill.update({ where: { id }, data: { endorsedById: endorse ? requireSelf(actor) : null } });
  if (endorse && !row.endorsedById) {
    await notify(companyId, [row.employeeId], {
      event: 'career.skill_endorsed',
      title: 'Skill endorsed',
      body: `Your manager endorsed your skill "${row.skill}".`,
      link: '/career',
    });
  }
  return updated;
}

export interface SkillSearch {
  q?: string;
  level?: SkillLevel;
  department?: string;
  endorsed?: boolean;
}

const LEVEL_RANK: Record<string, number> = { BEGINNER: 1, INTERMEDIATE: 2, ADVANCED: 3, EXPERT: 4 };

/**
 * Skills matrix search ("who knows React?") across current employees.
 * `level` is a minimum (ADVANCED also returns EXPERT). Grouped per skill.
 */
export async function searchSkills(companyId: string, filter: SkillSearch) {
  const minRank = filter.level ? LEVEL_RANK[filter.level] ?? 0 : 0;
  const rows = await prisma.employeeSkill.findMany({
    where: {
      companyId,
      ...(filter.q ? { skill: { contains: filter.q.trim(), mode: 'insensitive' } } : {}),
      ...(filter.level ? { level: { in: SKILL_LEVELS.filter((l) => LEVEL_RANK[l]! >= minRank) } } : {}),
      ...(filter.endorsed === undefined ? {} : filter.endorsed ? { endorsedById: { not: null } } : { endorsedById: null }),
      employee: {
        isActive: true,
        employmentStatus: { not: 'SEPARATED' },
        ...(filter.department ? { department: filter.department } : {}),
      },
    },
    include: { employee: { select: employeeBrief } },
    orderBy: [{ skill: 'asc' }],
    take: 2000,
  });
  const withNames = await withEndorserNames(companyId, rows);
  withNames.sort((a, b) => a.skill.localeCompare(b.skill) || (LEVEL_RANK[b.level] ?? 0) - (LEVEL_RANK[a.level] ?? 0) || b.years - a.years);
  // Summary per skill (case-insensitive) for the matrix header.
  const bySkill = new Map<string, { skill: string; people: number; experts: number; endorsed: number }>();
  for (const r of withNames) {
    const k = r.skill.toLowerCase();
    const g = bySkill.get(k) ?? { skill: r.skill, people: 0, experts: 0, endorsed: 0 };
    g.people += 1;
    if (r.level === 'EXPERT' || r.level === 'ADVANCED') g.experts += 1;
    if (r.endorsedById) g.endorsed += 1;
    bySkill.set(k, g);
  }
  return { items: withNames, skills: [...bySkill.values()].sort((a, b) => b.people - a.people || a.skill.localeCompare(b.skill)) };
}

/** Distinct skill names in use (autocomplete). */
export async function skillNames(companyId: string) {
  const rows = await prisma.employeeSkill.groupBy({ by: ['skill'], where: { companyId }, _count: { _all: true } });
  return rows.map((r) => ({ skill: r.skill, count: r._count._all })).sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill));
}

// ---- Certifications ----

export interface CertificationInput {
  name: string;
  issuer?: string;
  credentialId?: string;
  credentialUrl?: string;
  issuedOn?: Date | null;
  expiresOn?: Date | null;
}

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

/** Status for display: EXPIRED / EXPIRING (within 30 days) / VALID / NO_EXPIRY. */
function certStatus(c: { expiresOn: Date | null }, today = todayUTC()): string {
  if (!c.expiresOn) return 'NO_EXPIRY';
  if (c.expiresOn < today) return 'EXPIRED';
  if (c.expiresOn <= addDays(today, EXPIRING_WINDOW_DAYS)) return 'EXPIRING';
  return 'VALID';
}

function decorate<T extends { expiresOn: Date | null; fileKey: string | null }>(rows: T[]) {
  const today = todayUTC();
  return rows.map(({ fileKey, ...r }) => ({ ...r, hasFile: !!fileKey, status: certStatus(r, today) }));
}

function assertDates(issuedOn: Date | null | undefined, expiresOn: Date | null | undefined) {
  if (issuedOn && expiresOn && expiresOn < issuedOn) throw ApiError.badRequest('Expiry date cannot be before the issue date');
}

export async function listCertifications(companyId: string, viewer: Actor, employeeId: string) {
  await assertCanView(companyId, viewer, employeeId);
  const rows = await prisma.employeeCertification.findMany({
    where: { companyId, employeeId },
    orderBy: [{ issuedOn: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
  });
  return decorate(rows);
}

async function certOrThrow(companyId: string, id: string) {
  const row = await prisma.employeeCertification.findFirst({ where: { id, companyId } });
  if (!row) throw ApiError.notFound('Certification not found');
  return row;
}

/** Owner may edit / delete their own until HR verifies it; ADMIN/HR always. */
function assertCanEditCert(actor: Actor, row: { employeeId: string; verified: boolean }) {
  if (isCompanyAdmin(actor.role)) return;
  if (row.employeeId !== actor.employeeId) throw ApiError.forbidden('You can only change your own certifications');
  if (row.verified) throw ApiError.badRequest('This certification is verified — ask HR to change it');
}

export async function createCertification(
  companyId: string,
  actor: Actor,
  input: CertificationInput & { employeeId?: string },
  file?: UploadedFile
) {
  const employeeId = input.employeeId ?? requireSelf(actor);
  if (employeeId !== actor.employeeId && !isCompanyAdmin(actor.role)) throw ApiError.forbidden('You can only add your own certifications');
  const emp = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { id: true } });
  if (!emp) throw ApiError.notFound('Employee not found');
  assertDates(input.issuedOn, input.expiresOn);
  let fileKey: string | null = null;
  if (file) {
    fileKey = objectKey(companyId, 'certifications', file.originalname);
    await putObject(fileKey, file.buffer, file.mimetype || 'application/octet-stream');
  }
  // HR adding a record on someone's behalf vouches for it.
  const byHr = isCompanyAdmin(actor.role) && employeeId !== actor.employeeId;
  return prisma.employeeCertification.create({
    data: {
      companyId,
      employeeId,
      name: input.name.trim(),
      issuer: input.issuer?.trim() ?? '',
      credentialId: input.credentialId?.trim() ?? '',
      credentialUrl: input.credentialUrl?.trim() ?? '',
      issuedOn: input.issuedOn ?? null,
      expiresOn: input.expiresOn ?? null,
      fileKey,
      fileName: file?.originalname ?? '',
      verified: byHr,
      verifiedById: byHr ? actor.employeeId : null,
    },
  });
}

/** Edits details and / or replaces the file. A self-edit of an unverified record keeps it unverified. */
export async function updateCertification(companyId: string, actor: Actor, id: string, input: Partial<CertificationInput>, file?: UploadedFile) {
  const row = await certOrThrow(companyId, id);
  assertCanEditCert(actor, row);
  assertDates(input.issuedOn === undefined ? row.issuedOn : input.issuedOn, input.expiresOn === undefined ? row.expiresOn : input.expiresOn);
  let fileKey: string | undefined;
  if (file) {
    fileKey = objectKey(companyId, 'certifications', file.originalname);
    await putObject(fileKey, file.buffer, file.mimetype || 'application/octet-stream');
  }
  const updated = await prisma.employeeCertification.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.issuer !== undefined ? { issuer: input.issuer.trim() } : {}),
      ...(input.credentialId !== undefined ? { credentialId: input.credentialId.trim() } : {}),
      ...(input.credentialUrl !== undefined ? { credentialUrl: input.credentialUrl.trim() } : {}),
      ...(input.issuedOn !== undefined ? { issuedOn: input.issuedOn } : {}),
      ...(input.expiresOn !== undefined ? { expiresOn: input.expiresOn } : {}),
      ...(fileKey ? { fileKey, fileName: file?.originalname ?? '' } : {}),
    },
  });
  if (fileKey && row.fileKey) {
    await removeObject(row.fileKey).catch((err: unknown) => logger.warn({ err, key: row.fileKey }, 'could not remove replaced certificate file'));
  }
  return updated;
}

export async function deleteCertification(companyId: string, actor: Actor, id: string) {
  const row = await certOrThrow(companyId, id);
  assertCanEditCert(actor, row);
  await prisma.employeeCertification.delete({ where: { id } });
  if (row.fileKey) {
    await removeObject(row.fileKey).catch((err: unknown) => logger.warn({ err, key: row.fileKey }, 'could not remove certificate file'));
  }
  return row;
}

/** HR verifies (or un-verifies) a certification. */
export async function verifyCertification(companyId: string, actor: Actor, id: string, verified: boolean) {
  const row = await certOrThrow(companyId, id);
  if (row.employeeId === actor.employeeId) throw ApiError.forbidden('You cannot verify your own certification');
  const updated = await prisma.employeeCertification.update({
    where: { id },
    data: { verified, verifiedById: verified ? actor.employeeId : null },
  });
  if (verified && !row.verified) {
    await notify(companyId, [row.employeeId], {
      event: 'career.certification_verified',
      title: 'Certification verified',
      body: `HR verified your certification "${row.name}".`,
      link: '/career',
    });
  }
  return { before: row, after: updated };
}

/** Presigned download URL for the certificate file (same viewers as the record). */
export async function certificationFileUrl(companyId: string, viewer: Actor, id: string) {
  const row = await certOrThrow(companyId, id);
  await assertCanView(companyId, viewer, row.employeeId);
  if (!row.fileKey) throw ApiError.notFound('No file was uploaded for this certification');
  return { url: await presignedGetUrl(row.fileKey, row.fileName || `${row.name}.pdf`), fileName: row.fileName };
}

export interface CertificationFilter {
  q?: string;
  employeeId?: string;
  department?: string;
  verified?: boolean;
  /** VALID | EXPIRING | EXPIRED | NO_EXPIRY */
  status?: string;
  /** Internal-course certificates only (true) / external only (false). */
  internal?: boolean;
}

/** Company-wide certification list for ADMIN/HR. */
export async function companyCertifications(companyId: string, filter: CertificationFilter) {
  const today = todayUTC();
  const soon = addDays(today, EXPIRING_WINDOW_DAYS);
  const statusWhere: Prisma.EmployeeCertificationWhereInput =
    filter.status === 'EXPIRED' ? { expiresOn: { lt: today } }
      : filter.status === 'EXPIRING' ? { expiresOn: { gte: today, lte: soon } }
        : filter.status === 'VALID' ? { expiresOn: { gt: soon } }
          : filter.status === 'NO_EXPIRY' ? { expiresOn: null }
            : {};
  const rows = await prisma.employeeCertification.findMany({
    where: {
      companyId,
      ...statusWhere,
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      ...(filter.verified !== undefined ? { verified: filter.verified } : {}),
      ...(filter.internal !== undefined ? { courseId: filter.internal ? { not: null } : null } : {}),
      ...(filter.q
        ? {
            OR: [
              { name: { contains: filter.q, mode: 'insensitive' } },
              { issuer: { contains: filter.q, mode: 'insensitive' } },
              { employee: { name: { contains: filter.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
      ...(filter.department ? { employee: { department: filter.department } } : {}),
    },
    include: { employee: { select: employeeBrief } },
    orderBy: [{ expiresOn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: 2000,
  });
  return decorate(rows);
}

/** Certifications expiring within the window (current employees). Managers see their reports', HR everyone's, others their own. */
export async function expiringCertifications(companyId: string, viewer: Actor, days = EXPIRING_WINDOW_DAYS) {
  const today = todayUTC();
  const scope: Prisma.EmployeeCertificationWhereInput = isCompanyAdmin(viewer.role)
    ? {}
    : { OR: [{ employeeId: viewer.employeeId ?? '-' }, { employee: { managerId: viewer.employeeId ?? '-' } }] };
  const rows = await prisma.employeeCertification.findMany({
    where: {
      companyId,
      ...scope,
      expiresOn: { gte: today, lte: addDays(today, days) },
      employee: { isActive: true, employmentStatus: { not: 'SEPARATED' } },
    },
    include: { employee: { select: employeeBrief } },
    orderBy: { expiresOn: 'asc' },
  });
  return decorate(rows).map((r) => ({ ...r, daysLeft: Math.round(((r.expiresOn as Date).getTime() - today.getTime()) / 86_400_000) }));
}

/** Daily job: remind holders (and their manager) 30 and 7 days before a certification expires. */
export async function sendExpiryReminders(companyId: string): Promise<number> {
  const today = todayUTC();
  const targets = EXPIRY_REMINDER_DAYS.map((d) => addDays(today, d));
  const rows = await prisma.employeeCertification.findMany({
    where: { companyId, expiresOn: { in: targets }, employee: { isActive: true, employmentStatus: { not: 'SEPARATED' } } },
    include: { employee: { select: { managerId: true } } },
  });
  for (const r of rows) {
    const days = Math.round(((r.expiresOn as Date).getTime() - today.getTime()) / 86_400_000);
    await notify(companyId, [r.employeeId, days <= 7 ? r.employee.managerId : null], {
      event: 'career.certification_expiring',
      title: `Certification expires in ${days} days`,
      body: `"${r.name}"${r.issuer ? ` (${r.issuer})` : ''} expires on ${longDate(r.expiresOn)} — renew it and upload the new certificate.`,
      link: '/career',
    });
  }
  return rows.length;
}
