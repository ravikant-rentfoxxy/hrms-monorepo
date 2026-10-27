/**
 * Employee / directory business logic, tenant-scoped.
 *
 * PAN / Aadhaar / bank account / UAN are encrypted at rest (utils/fieldCrypto):
 * every write here encrypts them, every read decrypts (or masks) them.
 */
import type { Request } from 'express';
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { ApiError } from '../utils/http';
import { hashPassword } from '../utils/crypto';
import {
  EMPLOYEE_SECRET_FIELDS, decryptField, encryptEmployeeSecrets, encryptField, isEncrypted, isMaskedValue,
  maskEmployeeSecrets, maskValue, revealEmployeeSecrets,
} from '../utils/fieldCrypto';
import { standardSalaryColumns } from './salary-revision.service';
import { assertSeatAvailable } from './billing.service';
import { startOnboarding } from './onboarding.service';
import { logger } from '../lib/logger';
import {
  EMPLOYMENT_STATUSES, type EmploymentStatus, type HistoryType, initialStatus, recordHistory, setEmploymentStatus,
} from './employee-history.service';

export interface EmployeeProfileInput {
  name?: string;
  designation?: string;
  department?: string;
  phone?: string;
  location?: string;
  joiningDate?: Date;
  leavingDate?: Date | null;
  dateOfBirth?: Date;
  managerId?: string | null;
  bloodGroup?: string;
  address?: string;
  emergencyContact?: string;
  bankName?: string;
  accountNumber?: string;
  ifsc?: string;
  pan?: string;
  pfNumber?: string;
  uan?: string;
  aadhaarNumber?: string;
  fatherName?: string;
  employmentType?: string;
  avatarColor?: string;
  salaryCtc?: number;
  salaryBasic?: number;
  salaryHra?: number;
  salaryConveyance?: number;
  salaryMedical?: number;
  salaryAllowance?: number;
  salaryPfEmployer?: number;
  salaryPfEmployee?: number;
  // Master links (the text department / designation follow the linked master).
  departmentId?: string | null;
  designationId?: string | null;
  gradeId?: string | null;
  officeId?: string | null;
  workMode?: 'OFFICE' | 'REMOTE' | 'FIELD';
  gender?: string;
  maritalStatus?: string;
  personalEmail?: string;
  probationEndDate?: Date | null;
  confirmedOn?: Date | null;
  noticePeriodDays?: number;
  esiNumber?: string;
  taxRegime?: 'NEW' | 'OLD';
}

/** `salaryCtc` (monthly) is an input convenience, not a column: expand it on the company standard structure. */
async function expandSalaryCtc<T extends { salaryCtc?: number }>(companyId: string, input: T): Promise<Omit<T, 'salaryCtc'>> {
  const { salaryCtc, ...rest } = input;
  if (salaryCtc === undefined || salaryCtc <= 0) return rest;
  return { ...rest, ...(await standardSalaryColumns(companyId, salaryCtc * 12)) };
}

export interface CreateEmployeeInput extends EmployeeProfileInput {
  name: string;
  email: string;
  password?: string;
  /** Auto-generated when omitted (the normal case — HR never types it). */
  employeeCode?: string;
  role: 'HR' | 'MANAGER' | 'EMPLOYEE' | 'FINANCE';
}

/**
 * Next employee ID for the company, e.g. "RF-011". Continues the pattern the
 * company already uses (most common "PREFIX-123" among existing codes); a new
 * company gets a prefix from its name's initials, falling back to "EMP".
 */
export async function nextEmployeeCode(companyId: string): Promise<string> {
  const employees = await prisma.employee.findMany({ where: { companyId }, select: { employeeCode: true } });
  const groups = new Map<string, { count: number; max: number; width: number }>();
  for (const e of employees) {
    const match = /^([A-Za-z]+)-(\d+)$/.exec(e.employeeCode);
    if (!match) continue;
    const prefix = (match[1] as string).toUpperCase();
    const num = match[2] as string;
    const g = groups.get(prefix) ?? { count: 0, max: 0, width: 3 };
    g.count += 1;
    g.max = Math.max(g.max, Number(num));
    g.width = Math.max(g.width, num.length);
    groups.set(prefix, g);
  }
  let prefix = '';
  let max = 0;
  let width = 3;
  let best = 0;
  for (const [p, g] of groups) {
    if (g.count > best) {
      best = g.count;
      prefix = p;
      max = g.max;
      width = g.width;
    }
  }
  if (!prefix) {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
    const initials = (company?.name ?? '')
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 3);
    prefix = initials.length >= 2 ? initials : 'EMP';
  }
  return `${prefix}-${String(max + 1).padStart(width, '0')}`;
}

/** Fields an employee may edit on their own profile. */
export const SELF_EDITABLE_FIELDS = [
  'phone', 'address', 'emergencyContact', 'bloodGroup', 'bankName', 'accountNumber', 'ifsc', 'pan', 'avatarColor',
  'personalEmail', 'maritalStatus',
] as const;

/** Fields stripped from a colleague's profile (not self, not ADMIN/HR). */
const PRIVATE_FIELDS = [
  'bankName', 'ifsc', 'address', 'emergencyContact', 'personalEmail', 'maritalStatus', 'gender',
  'salaryBasic', 'salaryHra', 'salaryAllowance', 'salaryPfEmployer', 'salaryPfEmployee', 'salaryConveyance', 'salaryMedical',
  'pfNumber', 'fatherName', 'esiNumber', 'taxRegime', 'gradeId', 'gradeRef',
  'separationReason', 'rehireEligible', 'rehireNote', 'sourceApplication',
] as const;

/** Audit-relevant fields: everything a profile write can change. */
const AUDITED_FIELDS = [
  'name', 'employeeCode', 'designation', 'department', 'departmentId', 'designationId', 'gradeId', 'officeId', 'managerId',
  'phone', 'location', 'joiningDate', 'leavingDate', 'dateOfBirth', 'bloodGroup', 'address', 'emergencyContact',
  'bankName', 'accountNumber', 'ifsc', 'pan', 'pfNumber', 'uan', 'aadhaarNumber', 'fatherName', 'esiNumber',
  'employmentType', 'gender', 'maritalStatus', 'personalEmail', 'probationEndDate', 'confirmedOn', 'noticePeriodDays',
  'taxRegime', 'workMode', 'isActive', 'salaryBasic', 'salaryHra', 'salaryConveyance', 'salaryMedical', 'salaryAllowance',
  'salaryPfEmployer', 'salaryPfEmployee',
] as const;

/** Snapshot for the audit log: secrets masked (never plaintext or ciphertext in the trail). */
function auditSnapshot(emp: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (!(k in emp)) continue;
    const v = emp[k];
    out[k] = (EMPLOYEE_SECRET_FIELDS as readonly string[]).includes(k) && typeof v === 'string' ? maskValue(decryptField(v)) : v;
  }
  return out;
}

const directorySelect = {
  id: true,
  employeeCode: true,
  name: true,
  designation: true,
  department: true,
  departmentId: true,
  designationId: true,
  location: true,
  dateOfBirth: true,
  avatarColor: true,
  joiningDate: true,
  employmentStatus: true,
  probationEndDate: true,
  isActive: true,
  user: { select: { email: true } },
  manager: { select: { id: true, name: true } },
} as const;

/** Extra columns for the ADMIN/HR "Former employees" archive. */
const archiveSelect = {
  ...directorySelect,
  separatedOn: true,
  separationReason: true,
  rehireEligible: true,
  rehireNote: true,
  archivedAt: true,
  leavingDate: true,
} as const;

/**
 * Throws unless `managerId` is an employee of the company and — when
 * `employeeId` is given — making them the employee's manager would not create
 * a reporting loop. Shared with the transfer module.
 */
export async function assertManagerInCompany(companyId: string, managerId: string, employeeId?: string): Promise<void> {
  const mgr = await prisma.employee.findFirst({ where: { id: managerId, companyId } });
  if (!mgr) throw ApiError.badRequest('managerId does not belong to this company');
  if (!employeeId) return;
  if (managerId === employeeId) throw ApiError.badRequest('An employee cannot report to themself');
  // Walk up from the new manager: reaching the employee would create a reporting loop.
  const seen = new Set<string>();
  let cursor: string | null = mgr.managerId;
  while (cursor && !seen.has(cursor)) {
    if (cursor === employeeId) throw ApiError.badRequest(`${mgr.name} reports (directly or indirectly) to this employee — that would create a loop`);
    seen.add(cursor);
    const next: { managerId: string | null } | null = await prisma.employee.findUnique({ where: { id: cursor }, select: { managerId: true } });
    cursor = next?.managerId ?? null;
  }
}

/**
 * Validates master / office links and keeps the legacy text columns in sync:
 *  - departmentId / designationId set → `department` / `designation` = master name;
 *  - id cleared (null) → text cleared too;
 *  - only the text given (legacy clients) → linked to the master with that name, if any.
 */
async function applyMasterLinks(companyId: string, data: Record<string, unknown>): Promise<void> {
  if (typeof data.departmentId === 'string') {
    const dept = await prisma.department.findFirst({ where: { id: data.departmentId, companyId } });
    if (!dept) throw ApiError.badRequest('departmentId does not belong to this company');
    data.department = dept.name;
  } else if (data.departmentId === null) {
    data.department = '';
  } else if (typeof data.department === 'string') {
    const name = data.department.trim();
    data.department = name;
    const dept = name
      ? await prisma.department.findFirst({ where: { companyId, name: { equals: name, mode: 'insensitive' } } })
      : null;
    data.departmentId = dept?.id ?? null;
    if (dept) data.department = dept.name;
  }

  if (typeof data.designationId === 'string') {
    const des = await prisma.designation.findFirst({ where: { id: data.designationId, companyId } });
    if (!des) throw ApiError.badRequest('designationId does not belong to this company');
    data.designation = des.name;
  } else if (data.designationId === null) {
    data.designation = '';
  } else if (typeof data.designation === 'string') {
    const name = data.designation.trim();
    data.designation = name;
    const des = name
      ? await prisma.designation.findFirst({ where: { companyId, name: { equals: name, mode: 'insensitive' } } })
      : null;
    data.designationId = des?.id ?? null;
    if (des) data.designation = des.name;
  }

  if (typeof data.gradeId === 'string') {
    const grade = await prisma.grade.findFirst({ where: { id: data.gradeId, companyId } });
    if (!grade) throw ApiError.badRequest('gradeId does not belong to this company');
  }
  if (typeof data.officeId === 'string') {
    const office = await prisma.office.findFirst({ where: { id: data.officeId, companyId } });
    if (!office) throw ApiError.badRequest('officeId does not belong to this company');
  }
}

/** Drops masked echoes (`XXXXXX1234`) so a round-tripped form never overwrites the real number. */
function dropMaskedSecrets(data: Record<string, unknown>): void {
  for (const f of EMPLOYEE_SECRET_FIELDS) if (isMaskedValue(data[f])) delete data[f];
}

export type DirectoryStatus = EmploymentStatus | 'CURRENT' | 'ALL';

export interface DirectoryQuery {
  q?: string;
  department?: string;
  departmentId?: string;
  /**
   * CURRENT (default) = everyone still employed (probation, active, serving
   * notice); a single status filters to it; SEPARATED = former employees;
   * ALL = both. SEPARATED / ALL are for ADMIN/HR only (enforced here).
   */
  status?: DirectoryStatus;
  /** Former employees: only those eligible (true) / not eligible (false) for rehire. */
  rehireEligible?: boolean;
  page: number;
  pageSize: number;
}

/** Former employee = marked SEPARATED, or deactivated before employment statuses existed. */
const formerWhere: Prisma.EmployeeWhereInput = { OR: [{ employmentStatus: 'SEPARATED' }, { isActive: false }] };
const currentWhere: Prisma.EmployeeWhereInput = { isActive: true, employmentStatus: { not: 'SEPARATED' } };

/**
 * Directory / employee list. Separated employees are excluded unless an
 * ADMIN/HR caller asks for them (status SEPARATED or ALL); their rows then
 * carry separatedOn / separationReason / rehireEligible for the archive view.
 */
export async function listDirectory(companyId: string, opts: DirectoryQuery, viewer: { isPrivileged: boolean } = { isPrivileged: false }) {
  const { q, department, departmentId, page, pageSize } = opts;
  const status: DirectoryStatus = opts.status ?? 'CURRENT';
  if ((status === 'SEPARATED' || status === 'ALL') && !viewer.isPrivileged) {
    throw ApiError.forbidden('Only ADMIN/HR can view former employees');
  }
  const statusWhere: Prisma.EmployeeWhereInput =
    status === 'ALL' ? {}
      : status === 'CURRENT' ? currentWhere
        : status === 'SEPARATED' ? formerWhere
          : { ...currentWhere, employmentStatus: status };
  const where: Prisma.EmployeeWhereInput = {
    companyId,
    AND: [
      statusWhere,
      ...(status === 'SEPARATED' && opts.rehireEligible !== undefined ? [{ rehireEligible: opts.rehireEligible }] : []),
      ...(q
        ? [{
            OR: [
              { name: { contains: q, mode: 'insensitive' as const } },
              { employeeCode: { contains: q, mode: 'insensitive' as const } },
              { designation: { contains: q, mode: 'insensitive' as const } },
              { department: { contains: q, mode: 'insensitive' as const } },
              ...(status === 'SEPARATED' || status === 'ALL'
                ? [{ separationReason: { contains: q, mode: 'insensitive' as const } }]
                : []),
            ],
          }]
        : []),
    ],
    ...(departmentId ? { departmentId } : department ? { department } : {}),
  };
  const former = status === 'SEPARATED' || status === 'ALL';
  const [items, total, counts] = await Promise.all([
    prisma.employee.findMany({
      where,
      select: former ? archiveSelect : directorySelect,
      orderBy: status === 'SEPARATED' ? [{ separatedOn: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }] : { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.employee.count({ where }),
    viewer.isPrivileged ? statusCounts(companyId) : Promise.resolve(undefined),
  ]);
  return { items, total, page, pageSize, ...(counts ? { counts } : {}) };
}

/** Head-count per employment status (status tabs). Deactivated legacy rows count as SEPARATED. */
export async function statusCounts(companyId: string): Promise<Record<EmploymentStatus, number>> {
  const [byStatus, inactive] = await Promise.all([
    prisma.employee.groupBy({ by: ['employmentStatus'], where: { companyId, isActive: true }, _count: { _all: true } }),
    prisma.employee.count({ where: { companyId, isActive: false } }),
  ]);
  const out = Object.fromEntries(EMPLOYMENT_STATUSES.map((st) => [st, 0])) as Record<EmploymentStatus, number>;
  for (const row of byStatus) {
    const st = row.employmentStatus as EmploymentStatus;
    if (st in out) out[st] += row._count._all;
  }
  out.SEPARATED += inactive;
  return out;
}

/** Birthdays in the next 30 days. */
export async function upcomingBirthdays(companyId: string) {
  const employees = await prisma.employee.findMany({
    where: { companyId, isActive: true, employmentStatus: { not: 'SEPARATED' }, dateOfBirth: { not: null } },
    select: { id: true, name: true, designation: true, dateOfBirth: true, avatarColor: true },
  });
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return employees
    .map((e) => {
      const dob = e.dateOfBirth as Date;
      let next = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
      if (next < startOfToday) next = new Date(today.getFullYear() + 1, dob.getMonth(), dob.getDate());
      return { ...e, nextBirthday: next };
    })
    .filter((e) => (e.nextBirthday.getTime() - startOfToday.getTime()) / 86400000 <= 30)
    .sort((a, b) => a.nextBirthday.getTime() - b.nextBirthday.getTime());
}

export interface ProfileViewer {
  isSelf: boolean;
  isPrivileged: boolean;
  /** Viewer's company role — managers see colleagues' identity numbers masked. */
  role?: Role;
}

/** Company roles an Admin can assign to an employee (Admin itself is granted from the platform). */
export const ASSIGNABLE_ROLES = ['EMPLOYEE', 'MANAGER', 'HR', 'FINANCE'] as const;

/**
 * Changes an employee's role in this company. ADMIN only (route); an Admin's
 * own role and other Admins are left alone. Takes effect on the employee's
 * next token refresh (within minutes) — the session re-reads the membership.
 */
export async function setEmployeeRole(companyId: string, employeeId: string, role: (typeof ASSIGNABLE_ROLES)[number], actor: { userId: string }) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { userId: true, name: true } });
  if (!employee) throw ApiError.notFound('Employee not found');
  if (!employee.userId) throw ApiError.badRequest(`${employee.name} has no login account`);
  if (employee.userId === actor.userId) throw ApiError.badRequest('You cannot change your own role');
  const membership = await prisma.membership.findUnique({ where: { userId_companyId: { userId: employee.userId, companyId } } });
  if (!membership) throw ApiError.badRequest(`${employee.name} has no access to this company`);
  if (membership.role === 'ADMIN' || membership.role === 'SUPER_ADMIN') throw ApiError.forbidden('An Admin’s role cannot be changed here');
  const after = await prisma.membership.update({ where: { id: membership.id }, data: { role } });
  return { before: membership.role, after: after.role };
}

/**
 * Full profile. The employee themself and ADMIN/HR see everything (identity
 * numbers decrypted). Other viewers lose bank / salary / personal fields;
 * managerial viewers keep PAN / Aadhaar / account / UAN as `XXXXXX1234`,
 * plain employees don't get them at all.
 */
export async function getEmployee(companyId: string, employeeId: string, opts: ProfileViewer) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    include: {
      user: { select: { email: true, role: true, isActive: true, lastLoginAt: true } },
      manager: { select: { id: true, name: true, designation: true } },
      departmentRef: { select: { id: true, name: true, code: true, headId: true } },
      designationRef: { select: { id: true, name: true, level: true } },
      gradeRef: { select: { id: true, code: true, name: true, minCtc: true, maxCtc: true } },
      // Source of hire (traceability back to the job / platform) — ADMIN/HR and self only.
      sourceApplication: {
        select: {
          id: true, code: true, source: true,
          job: { select: { id: true, code: true, title: true } },
          posting: { select: { id: true, platform: true, platformName: true, externalId: true } },
        },
      },
    },
  });
  if (!employee) throw ApiError.notFound('Employee not found');
  if (opts.isSelf || opts.isPrivileged) {
    // The company role (membership), so ADMIN/HR can see and change it.
    const membership = employee.userId
      ? await prisma.membership.findUnique({ where: { userId_companyId: { userId: employee.userId, companyId } }, select: { role: true } })
      : null;
    return { ...revealEmployeeSecrets(employee), secretsMasked: false, companyRole: membership?.role ?? null };
  }

  const pub: Record<string, unknown> = { ...employee };
  for (const f of PRIVATE_FIELDS) delete pub[f];
  const managerial = opts.role === 'MANAGER' || opts.role === 'ADMIN' || opts.role === 'HR' || opts.role === 'SUPER_ADMIN';
  if (managerial) return { ...maskEmployeeSecrets(pub), secretsMasked: true };
  for (const f of EMPLOYEE_SECRET_FIELDS) delete pub[f];
  return pub;
}

/**
 * Create employee + company access. If the email already belongs to a user
 * (e.g. someone in another company), that account is granted a membership
 * here instead of creating a duplicate; password is then ignored.
 * Sets the initial employment status (PROBATION / ACTIVE) and records the
 * JOINED career-history row (skipped when one exists or opts.recordJoined=false).
 */
export async function createEmployee(
  companyId: string,
  input: CreateEmployeeInput,
  req: Request | null = null,
  /** recordJoined=false: the caller (recruitment hire flow) writes its own JOINED history row. */
  opts: { recordJoined?: boolean } = {}
) {
  const { email, password, role, employeeCode, ...rest } = await expandSalaryCtc(companyId, input);
  await assertSeatAvailable(companyId);
  if (rest.managerId) await assertManagerInCompany(companyId, rest.managerId);
  const linked: Record<string, unknown> = { ...rest };
  dropMaskedSecrets(linked);
  await applyMasterLinks(companyId, linked);
  const profile = encryptEmployeeSecrets(linked) as Prisma.EmployeeUncheckedCreateInput;

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    if (!password) throw ApiError.badRequest('password is required for a new user');
    user = await prisma.user.create({ data: { email, passwordHash: await hashPassword(password), role } });
  } else if (user.role === 'SUPER_ADMIN') {
    throw ApiError.badRequest('This email belongs to the platform super admin');
  }

  const existingProfile = await prisma.employee.findUnique({
    where: { userId_companyId: { userId: user.id, companyId } },
  });
  if (existingProfile) throw ApiError.conflict('This user already has an employee profile in this company');

  // Employee ID is auto-generated; retry on a concurrent-create collision.
  const autoCode = !employeeCode?.trim();
  for (let attempt = 0; ; attempt++) {
    const code = employeeCode?.trim() || (await nextEmployeeCode(companyId));
    try {
      const [, employee] = await prisma.$transaction([
        prisma.membership.upsert({
          where: { userId_companyId: { userId: user.id, companyId } },
          create: { userId: user.id, companyId, role },
          update: { role, isActive: true },
        }),
        prisma.employee.create({
          data: {
            ...profile,
            employeeCode: code,
            companyId,
            userId: user.id,
            employmentStatus: initialStatus(profile.probationEndDate as Date | null | undefined, profile.confirmedOn as Date | null | undefined),
          },
        }),
      ]);
      await audit(req, {
        entity: 'Employee',
        entityId: employee.id,
        action: 'CREATE',
        after: { ...auditSnapshot(employee, AUDITED_FIELDS), email: user.email, role },
      });
      if (opts.recordJoined !== false) await recordJoined(companyId, employee, req?.auth?.employeeId ?? null);
      // A joiner gets the default onboarding checklist; failing to start it must not fail the hire.
      await startOnboarding(companyId, employee.id).catch((err: unknown) =>
        logger.warn({ err, employeeId: employee.id }, 'could not start onboarding')
      );
      return { user: { id: user.id, email: user.email }, role, employee: revealEmployeeSecrets(employee) };
    } catch (err) {
      const isCodeClash = (err as { code?: string }).code === 'P2002';
      if (!isCodeClash || !autoCode || attempt >= 3) {
        if (isCodeClash) throw ApiError.conflict(`Employee ID "${code}" is already taken in this company`);
        throw err;
      }
    }
  }
}

/**
 * JOINED history row for a new employee — skipped when one already exists
 * (the recruitment hire flow records its own, with the application reference).
 */
async function recordJoined(
  companyId: string,
  employee: { id: string; joiningDate: Date; designation: string; department: string; employmentStatus: string },
  createdById: string | null
): Promise<void> {
  const existing = await prisma.employeeHistory.findFirst({ where: { companyId, employeeId: employee.id, type: 'JOINED' } });
  if (existing) return;
  await recordHistory(prisma, {
    companyId,
    employeeId: employee.id,
    type: 'JOINED',
    effectiveDate: employee.joiningDate,
    title: `Joined${employee.designation ? ` as ${employee.designation}` : ''}${employee.department ? ` — ${employee.department}` : ''}`,
    to: { designation: employee.designation, department: employee.department, employmentStatus: employee.employmentStatus },
    refType: 'Employee',
    refId: employee.id,
    createdById,
  }).catch((err: unknown) => logger.warn({ err, employeeId: employee.id }, 'could not record JOINED history'));
}

/** Career-history fields: a change to any of them writes an EmployeeHistory row. */
const CAREER_FIELDS: { type: HistoryType; keys: string[]; label: string }[] = [
  { type: 'TRANSFER', keys: ['departmentId', 'department'], label: 'Department' },
  { type: 'DESIGNATION_CHANGE', keys: ['designationId', 'designation'], label: 'Designation' },
  { type: 'GRADE_CHANGE', keys: ['gradeId'], label: 'Grade' },
  { type: 'MANAGER_CHANGE', keys: ['managerId'], label: 'Reporting manager' },
  { type: 'LOCATION_CHANGE', keys: ['officeId', 'location'], label: 'Location' },
];

type CareerSnapshot = {
  departmentId: string | null; department: string; designationId: string | null; designation: string;
  gradeId: string | null; managerId: string | null; officeId: string | null; location: string;
};

/** Human-readable names for the master ids in two snapshots (one query per master). */
async function careerNames(companyId: string, snaps: CareerSnapshot[]) {
  const ids = (k: keyof CareerSnapshot) => [...new Set(snaps.map((x) => x[k]).filter((v): v is string => !!v))];
  const [grades, managers, offices] = await Promise.all([
    prisma.grade.findMany({ where: { companyId, id: { in: ids('gradeId') } }, select: { id: true, code: true, name: true } }),
    prisma.employee.findMany({ where: { companyId, id: { in: ids('managerId') } }, select: { id: true, name: true } }),
    prisma.office.findMany({ where: { companyId, id: { in: ids('officeId') } }, select: { id: true, name: true } }),
  ]);
  return {
    grade: (id: string | null) => {
      const g = grades.find((x) => x.id === id);
      return g ? `${g.name} (${g.code})` : '';
    },
    manager: (id: string | null) => managers.find((x) => x.id === id)?.name ?? '',
    office: (id: string | null) => offices.find((x) => x.id === id)?.name ?? '',
  };
}

/**
 * Writes career-history rows for department / designation / grade / manager /
 * location changes between two employee snapshots. Used by profile edits
 * (one row per kind of change). Returns the rows written.
 */
export async function recordCareerChanges(
  db: Prisma.TransactionClient | typeof prisma,
  companyId: string,
  employeeId: string,
  before: CareerSnapshot,
  after: CareerSnapshot,
  opts: { effectiveDate?: Date; reason?: string; createdById?: string | null; refType?: string; refId?: string } = {}
): Promise<number> {
  const changed = CAREER_FIELDS.filter((f) =>
    f.keys.some((k) => (before[k as keyof CareerSnapshot] ?? null) !== (after[k as keyof CareerSnapshot] ?? null))
  );
  if (changed.length === 0) return 0;
  const names = await careerNames(companyId, [before, after]);
  const describe = (type: HistoryType, x: CareerSnapshot) => {
    switch (type) {
      case 'TRANSFER': return { id: x.departmentId, name: x.department };
      case 'DESIGNATION_CHANGE': return { id: x.designationId, name: x.designation };
      case 'GRADE_CHANGE': return { id: x.gradeId, name: names.grade(x.gradeId) };
      case 'MANAGER_CHANGE': return { id: x.managerId, name: names.manager(x.managerId) };
      default: return { id: x.officeId, name: (x.officeId ? names.office(x.officeId) : '') || x.location };
    }
  };
  for (const f of changed) {
    const from = describe(f.type, before);
    const to = describe(f.type, after);
    if (from.id === to.id && from.name === to.name) continue;
    await recordHistory(db, {
      companyId,
      employeeId,
      type: f.type,
      effectiveDate: opts.effectiveDate ?? new Date(),
      title: `${f.label}: ${from.name || '—'} → ${to.name || '—'}`,
      from,
      to,
      reason: opts.reason,
      refType: opts.refType,
      refId: opts.refId,
      createdById: opts.createdById,
    });
  }
  return changed.length;
}

const careerSnapshot = (e: CareerSnapshot): CareerSnapshot => ({
  departmentId: e.departmentId, department: e.department, designationId: e.designationId, designation: e.designation,
  gradeId: e.gradeId, managerId: e.managerId, officeId: e.officeId, location: e.location,
});

/**
 * Update profile; non-privileged callers are limited to SELF_EDITABLE_FIELDS.
 * Only changed fields land in the audit trail (identity numbers masked).
 */
export async function updateEmployee(
  companyId: string,
  employeeId: string,
  input: Record<string, unknown>,
  opts: { isPrivileged: boolean },
  req: Request | null = null
) {
  const before = await prisma.employee.findFirst({ where: { id: employeeId, companyId } });
  if (!before) throw ApiError.notFound('Employee not found');
  // Not columns: the reason / date written on career-history rows.
  const { changeReason, effectiveDate, ...fields } = input as Record<string, unknown> & { changeReason?: string; effectiveDate?: Date };
  const data: Record<string, unknown> = opts.isPrivileged
    ? await expandSalaryCtc(companyId, fields as Record<string, unknown> & { salaryCtc?: number })
    : Object.fromEntries(Object.entries(fields).filter(([k]) => (SELF_EDITABLE_FIELDS as readonly string[]).includes(k)));
  dropMaskedSecrets(data);
  if (data.managerId) await assertManagerInCompany(companyId, data.managerId as string, employeeId);
  await applyMasterLinks(companyId, data);
  const encrypted = encryptEmployeeSecrets(data);
  // Unchanged secrets keep their stored ciphertext (a fresh IV would show up as a change).
  for (const f of EMPLOYEE_SECRET_FIELDS) {
    if (typeof data[f] === 'string' && decryptField(before[f]) === (data[f] as string).trim()) {
      delete (encrypted as Record<string, unknown>)[f];
    }
  }
  if (Object.keys(encrypted).length === 0) return revealEmployeeSecrets(before);

  const after = await prisma.employee.update({ where: { id: before.id }, data: encrypted as Prisma.EmployeeUncheckedUpdateInput });
  const keys = Object.keys(encrypted).filter((k) => (AUDITED_FIELDS as readonly string[]).includes(k));
  const changes = diffSnapshots(auditSnapshot(before, keys), auditSnapshot(after, keys));
  if (Object.keys(changes.after).length > 0) {
    await audit(req, { entity: 'Employee', entityId: before.id, action: 'UPDATE', before: changes.before, after: changes.after });
  }
  const actorId = req?.auth?.employeeId ?? null;
  await recordCareerChanges(prisma, companyId, before.id, careerSnapshot(before), careerSnapshot(after), {
    effectiveDate, reason: changeReason, createdById: actorId,
  });
  const final = await syncProbationStatus(companyId, before, after, actorId);
  return revealEmployeeSecrets(final ?? after);
}

/**
 * Probation / confirmation dates edited by HR move the employee between
 * PROBATION and ACTIVE (never touches NOTICE_PERIOD / SEPARATED, which belong
 * to the exit flow). Returns the reloaded employee when the status changed.
 */
async function syncProbationStatus(
  companyId: string,
  before: { probationEndDate: Date | null; confirmedOn: Date | null },
  after: { id: string; employmentStatus: string; probationEndDate: Date | null; confirmedOn: Date | null },
  actorId: string | null
) {
  const same = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
  if (same(before.probationEndDate, after.probationEndDate) && same(before.confirmedOn, after.confirmedOn)) return null;
  if (after.employmentStatus !== 'PROBATION' && after.employmentStatus !== 'ACTIVE') return null;
  const next = initialStatus(after.probationEndDate, after.confirmedOn);
  if (next === after.employmentStatus) return null;
  await setEmploymentStatus(prisma, companyId, after.id, next, {
    effectiveDate: next === 'ACTIVE' && after.confirmedOn ? after.confirmedOn : new Date(),
    reason: next === 'ACTIVE' ? (after.confirmedOn ? 'Confirmed by HR' : 'Probation end date passed') : 'Probation end date updated',
    refType: 'Employee',
    refId: after.id,
    createdById: actorId,
  });
  return prisma.employee.findUniqueOrThrow({ where: { id: after.id } });
}

/** Changed keys only (dates compared by value). */
function diffSnapshots(before: Record<string, unknown>, after: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  const norm = (v: unknown) => JSON.stringify(v instanceof Date ? v.toISOString() : v ?? null);
  for (const key of Object.keys(after)) {
    if (norm(before[key]) !== norm(after[key])) {
      b[key] = before[key] ?? null;
      a[key] = after[key] ?? null;
    }
  }
  return { before: b, after: a };
}

/**
 * Soft delete: revokes this company's membership only; the user's accounts
 * in other companies keep working.
 */
export async function deactivateEmployee(companyId: string, employeeId: string, req: Request | null = null): Promise<void> {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId } });
  if (!employee) throw ApiError.notFound('Employee not found');
  await prisma.$transaction([
    prisma.employee.update({ where: { id: employee.id }, data: { isActive: false } }),
    prisma.membership.updateMany({ where: { userId: employee.userId, companyId }, data: { isActive: false } }),
    // Force re-login; tokens for other companies are restored on next login.
    prisma.user.update({ where: { id: employee.userId }, data: { refreshTokenHash: null } }),
  ]);
  if (!employee.isActive) return; // re-run: access already revoked above, nothing new to audit
  await audit(req, {
    entity: 'Employee',
    entityId: employee.id,
    action: 'DEACTIVATE',
    before: { isActive: true },
    after: { isActive: false },
  });
}

/**
 * One-off migration: encrypts identity numbers still stored as plaintext.
 * Idempotent — already-encrypted values are skipped.
 */
export async function encryptExisting(companyId: string, req: Request | null = null) {
  const rows = await prisma.employee.findMany({
    where: { companyId },
    select: { id: true, pan: true, aadhaarNumber: true, accountNumber: true, uan: true },
  });
  let updated = 0;
  for (const row of rows) {
    const data: Record<string, string> = {};
    for (const f of EMPLOYEE_SECRET_FIELDS) {
      const v = row[f];
      if (v && !isEncrypted(v)) data[f] = encryptField(v.trim());
    }
    if (Object.keys(data).length === 0) continue;
    await prisma.employee.update({ where: { id: row.id }, data });
    updated += 1;
  }
  await audit(req, { entity: 'Employee', entityId: companyId, action: 'ENCRYPT_EXISTING', after: { scanned: rows.length, updated } });
  return { scanned: rows.length, updated };
}

export interface OrgNode {
  id: string;
  name: string;
  employeeCode: string;
  designation: string;
  department: string;
  avatarColor: string;
  managerId: string | null;
  level: number;
  reports: OrgNode[];
}

/**
 * Reporting tree (manager → reports) of active employees. Employees without a
 * manager (or whose manager left / sits in a reporting loop) are roots.
 * `rootId` returns only that employee's subtree.
 */
export async function orgChart(companyId: string, rootId?: string) {
  const rows = await prisma.employee.findMany({
    where: { companyId, isActive: true, employmentStatus: { not: 'SEPARATED' } },
    select: {
      id: true, name: true, employeeCode: true, designation: true, department: true, avatarColor: true, managerId: true,
      designationRef: { select: { level: true } },
    },
    orderBy: { name: 'asc' },
  });
  const nodes = new Map<string, OrgNode>(
    rows.map((r) => [r.id, {
      id: r.id, name: r.name, employeeCode: r.employeeCode, designation: r.designation, department: r.department,
      avatarColor: r.avatarColor, managerId: r.managerId, level: r.designationRef?.level ?? 0, reports: [],
    }])
  );
  // Break loops: a node whose manager chain returns to itself becomes a root.
  const inLoop = (id: string) => {
    const seen = new Set<string>([id]);
    let cursor = nodes.get(id)?.managerId ?? null;
    while (cursor && nodes.has(cursor)) {
      if (seen.has(cursor)) return cursor === id;
      seen.add(cursor);
      cursor = nodes.get(cursor)?.managerId ?? null;
    }
    return false;
  };
  const roots: OrgNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.managerId ? nodes.get(node.managerId) : undefined;
    if (parent && !inLoop(node.id)) parent.reports.push(node);
    else roots.push(node);
  }
  const sort = (list: OrgNode[]) => {
    list.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
    for (const n of list) sort(n.reports);
  };
  sort(roots);
  if (rootId) {
    const root = nodes.get(rootId);
    if (!root) throw ApiError.notFound('Employee not found');
    return { roots: [root], total: rows.length };
  }
  return { roots, total: rows.length };
}

/** Manager chain from the top down to (and including) the employee — for "where am I" views. */
export async function reportingChain(companyId: string, employeeId: string) {
  const chain: { id: string; name: string; designation: string; avatarColor: string }[] = [];
  const seen = new Set<string>();
  let cursor: string | null = employeeId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const emp: { id: string; name: string; designation: string; avatarColor: string; managerId: string | null } | null =
      await prisma.employee.findFirst({
        where: { id: cursor, companyId },
        select: { id: true, name: true, designation: true, avatarColor: true, managerId: true },
      });
    if (!emp) break;
    chain.unshift({ id: emp.id, name: emp.name, designation: emp.designation, avatarColor: emp.avatarColor });
    cursor = emp.managerId;
  }
  return chain;
}

/**
 * HR / Admin sets an employee's login password — e.g. a joiner created from
 * hiring (random password) while email delivery is not set up. Signs the user
 * out everywhere. HR cannot change an Admin's password, and a login shared
 * with another company is left to its owner.
 */
export async function setEmployeePassword(
  companyId: string,
  employeeId: string,
  password: string,
  actor: { userId: string; role: Role }
) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { userId: true, name: true } });
  if (!employee) throw ApiError.notFound('Employee not found');
  if (!employee.userId) throw ApiError.badRequest(`${employee.name} has no login account`);
  if (employee.userId === actor.userId) throw ApiError.badRequest('Change your own password from My profile');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: employee.userId }, select: { id: true, role: true } });
  const memberships = await prisma.membership.findMany({ where: { userId: user.id }, select: { companyId: true, role: true } });
  const here = memberships.find((m) => m.companyId === companyId);
  if (user.role === 'SUPER_ADMIN') throw ApiError.forbidden('The platform owner password cannot be changed here');
  if (actor.role === 'HR' && here?.role === 'ADMIN') throw ApiError.forbidden('Only an Admin can change an Admin’s password');
  if (memberships.some((m) => m.companyId !== companyId)) {
    throw ApiError.badRequest('This login is also used in another company — the employee must change it from My profile');
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), refreshTokenHash: null } });
  return { ok: true };
}
