/**
 * Career history + employment status — the single place every module records
 * what happened to an employee (joined, confirmed, promoted, transferred,
 * resigned, separated, ...). Never throws for history writes outside a
 * transaction; inside a transaction the caller's rollback semantics apply.
 *
 *   await recordHistory(tx, { companyId, employeeId, type: 'PROMOTION', effectiveDate, title, from, to });
 *   await setEmploymentStatus(tx, companyId, employeeId, 'NOTICE_PERIOD', { effectiveDate, reason, refType: 'Resignation', refId });
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/http';

type Db = PrismaClient | Prisma.TransactionClient;

export const EMPLOYMENT_STATUSES = ['PROBATION', 'ACTIVE', 'NOTICE_PERIOD', 'SEPARATED'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const HISTORY_TYPES = [
  'JOINED', 'CONFIRMED', 'PROBATION_EXTENDED', 'PROMOTION', 'DESIGNATION_CHANGE', 'TRANSFER', 'MANAGER_CHANGE',
  'GRADE_CHANGE', 'LOCATION_CHANGE', 'SALARY_REVISION', 'STATUS_CHANGE', 'RESIGNED', 'NOTICE_PERIOD', 'SEPARATED', 'REHIRED',
] as const;
export type HistoryType = (typeof HISTORY_TYPES)[number];

export interface HistoryEntry {
  companyId: string;
  employeeId: string;
  type: HistoryType;
  effectiveDate: Date;
  title: string;
  from?: unknown;
  to?: unknown;
  reason?: string;
  refType?: string;
  refId?: string;
  createdById?: string | null;
}

const json = (v: unknown): Prisma.InputJsonValue | undefined =>
  v === undefined || v === null ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

const dateOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export async function recordHistory(db: Db, e: HistoryEntry) {
  return db.employeeHistory.create({
    data: {
      companyId: e.companyId,
      employeeId: e.employeeId,
      type: e.type,
      effectiveDate: dateOnly(e.effectiveDate),
      title: e.title,
      fromValue: json(e.from),
      toValue: json(e.to),
      reason: e.reason ?? '',
      refType: e.refType ?? null,
      refId: e.refId ?? null,
      createdById: e.createdById ?? null,
    },
  });
}

/** Status for a new / existing employee from their probation data. */
export function initialStatus(probationEndDate: Date | null | undefined, confirmedOn: Date | null | undefined, today = new Date()): EmploymentStatus {
  if (confirmedOn) return 'ACTIVE';
  return probationEndDate && probationEndDate.getTime() >= dateOnly(today).getTime() ? 'PROBATION' : 'ACTIVE';
}

/**
 * Moves an employee to a new employment status and writes a history row.
 * SEPARATED also stamps separatedOn; leaving SEPARATED (rehire) clears it.
 * Does NOT revoke access — deactivation stays with the exit flow.
 */
export async function setEmploymentStatus(
  db: Db,
  companyId: string,
  employeeId: string,
  status: EmploymentStatus,
  opts: { effectiveDate?: Date; reason?: string; refType?: string; refId?: string; createdById?: string | null; title?: string } = {}
) {
  const emp = await db.employee.findFirst({ where: { id: employeeId, companyId }, select: { employmentStatus: true } });
  if (!emp) throw ApiError.notFound('Employee not found');
  if (emp.employmentStatus === status) return;
  const effectiveDate = opts.effectiveDate ?? new Date();
  await db.employee.update({
    where: { id: employeeId },
    data: {
      employmentStatus: status,
      ...(status === 'SEPARATED' ? { separatedOn: dateOnly(effectiveDate), ...(opts.reason ? { separationReason: opts.reason } : {}) } : {}),
      ...(emp.employmentStatus === 'SEPARATED' ? { separatedOn: null, archivedAt: null } : {}),
    },
  });
  const type: HistoryType =
    status === 'SEPARATED' ? 'SEPARATED'
      : status === 'NOTICE_PERIOD' ? 'NOTICE_PERIOD'
        : emp.employmentStatus === 'SEPARATED' ? 'REHIRED'
          : emp.employmentStatus === 'PROBATION' && status === 'ACTIVE' ? 'CONFIRMED'
            : 'STATUS_CHANGE';
  await recordHistory(db, {
    companyId,
    employeeId,
    type,
    effectiveDate,
    title: opts.title ?? `Status: ${label(emp.employmentStatus)} → ${label(status)}`,
    from: { employmentStatus: emp.employmentStatus },
    to: { employmentStatus: status },
    reason: opts.reason,
    refType: opts.refType,
    refId: opts.refId,
    createdById: opts.createdById,
  });
}

export async function listHistory(companyId: string, employeeId: string) {
  return prisma.employeeHistory.findMany({
    where: { companyId, employeeId },
    orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
  });
}

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
