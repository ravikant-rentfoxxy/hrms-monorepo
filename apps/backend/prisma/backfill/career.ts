/**
 * Career backfill (idempotent, never deletes):
 *  1. employmentStatus for every employee — the one place that decides it for
 *     existing data:
 *       isActive = false                                   → SEPARATED (separatedOn = leavingDate ?? updatedAt)
 *       APPROVED resignation whose last day is today/later → NOTICE_PERIOD
 *       probation end in the future and not confirmed      → PROBATION
 *       otherwise                                          → ACTIVE
 *     Only employees still on the column default (ACTIVE) are moved, plus any
 *     deactivated employee not yet SEPARATED — statuses already set by the live
 *     flows are left alone, so re-runs are safe.
 *  2. A JOINED history row (effectiveDate = joiningDate) for employees without one.
 *  3. CONFIRMED rows for confirmedOn, SALARY_REVISION rows for APPLIED revisions,
 *     NOTICE_PERIOD / SEPARATED rows for the statuses set in step 1 — each only
 *     when no matching row exists.
 */
import type { PrismaClient } from '@prisma/client';
import { recordHistory, type EmploymentStatus } from '../../src/services/employee-history.service';
import { ctcAnnualOf, type MonthlyStructure } from '../../src/services/salary-revision.service';

const dateOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const fmt = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export async function backfillCareer(prisma: PrismaClient): Promise<string[]> {
  const log: string[] = [];
  const today = dateOnly(new Date());

  const employees = await prisma.employee.findMany({
    select: {
      id: true, companyId: true, name: true, isActive: true, employmentStatus: true, joiningDate: true, leavingDate: true,
      updatedAt: true, probationEndDate: true, confirmedOn: true, designation: true, department: true, separatedOn: true,
    },
  });
  const noticeResignations = await prisma.resignation.findMany({
    where: { status: 'APPROVED' },
    select: { id: true, employeeId: true, approvedLastDay: true, requestedLastDay: true, reason: true },
  });
  const noticeByEmployee = new Map(
    noticeResignations
      .filter((r) => (r.approvedLastDay ?? r.requestedLastDay).getTime() >= today.getTime())
      .map((r) => [r.employeeId, r])
  );

  // ---- 1. Employment status ----
  const moved: Record<EmploymentStatus, number> = { PROBATION: 0, ACTIVE: 0, NOTICE_PERIOD: 0, SEPARATED: 0 };
  for (const e of employees) {
    let target: EmploymentStatus;
    if (!e.isActive) target = 'SEPARATED';
    else if (noticeByEmployee.has(e.id)) target = 'NOTICE_PERIOD';
    else if (!e.confirmedOn && e.probationEndDate && e.probationEndDate.getTime() >= today.getTime()) target = 'PROBATION';
    else target = 'ACTIVE';

    // Respect statuses the live flows already set; only the column default (or a deactivated employee) is decided here.
    const decidable = e.employmentStatus === 'ACTIVE' || (target === 'SEPARATED' && e.employmentStatus !== 'SEPARATED');
    if (!decidable || target === e.employmentStatus) continue;

    if (target === 'SEPARATED') {
      const separatedOn = dateOnly(e.leavingDate ?? e.updatedAt);
      await prisma.employee.update({ where: { id: e.id }, data: { employmentStatus: 'SEPARATED', separatedOn: e.separatedOn ?? separatedOn } });
      const has = await prisma.employeeHistory.findFirst({ where: { employeeId: e.id, type: 'SEPARATED' } });
      if (!has) {
        await recordHistory(prisma, {
          companyId: e.companyId, employeeId: e.id, type: 'SEPARATED', effectiveDate: separatedOn,
          title: 'Separated', from: { employmentStatus: e.employmentStatus }, to: { employmentStatus: 'SEPARATED' },
          reason: 'Backfilled from deactivated profile',
        });
      }
    } else if (target === 'NOTICE_PERIOD') {
      const r = noticeByEmployee.get(e.id);
      await prisma.employee.update({ where: { id: e.id }, data: { employmentStatus: 'NOTICE_PERIOD' } });
      const has = await prisma.employeeHistory.findFirst({ where: { employeeId: e.id, type: 'NOTICE_PERIOD' } });
      if (!has && r) {
        await recordHistory(prisma, {
          companyId: e.companyId, employeeId: e.id, type: 'NOTICE_PERIOD', effectiveDate: today,
          title: `Serving notice — last day ${fmt(r.approvedLastDay ?? r.requestedLastDay)}`,
          from: { employmentStatus: e.employmentStatus }, to: { employmentStatus: 'NOTICE_PERIOD' },
          reason: r.reason, refType: 'Resignation', refId: r.id,
        });
      }
    } else {
      // PROBATION (from the default ACTIVE): the initial state, no history row needed.
      await prisma.employee.update({ where: { id: e.id }, data: { employmentStatus: target } });
    }
    moved[target] += 1;
  }
  log.push(`career: employment status set — ${Object.entries(moved).map(([k, v]) => `${k} ${v}`).join(', ')} (of ${employees.length} employees)`);

  // ---- 2. JOINED rows ----
  const joinedIds = new Set(
    (await prisma.employeeHistory.findMany({ where: { type: 'JOINED' }, select: { employeeId: true } })).map((h) => h.employeeId)
  );
  let joined = 0;
  for (const e of employees) {
    if (joinedIds.has(e.id)) continue;
    await recordHistory(prisma, {
      companyId: e.companyId, employeeId: e.id, type: 'JOINED', effectiveDate: e.joiningDate,
      title: `Joined${e.designation ? ` as ${e.designation}` : ''}${e.department ? ` — ${e.department}` : ''}`,
      to: { designation: e.designation, department: e.department }, refType: 'Employee', refId: e.id,
    });
    joined += 1;
  }
  log.push(`career: JOINED history rows created: ${joined}`);

  // ---- 3a. CONFIRMED rows ----
  const confirmedIds = new Set(
    (await prisma.employeeHistory.findMany({ where: { type: 'CONFIRMED' }, select: { employeeId: true } })).map((h) => h.employeeId)
  );
  let confirmed = 0;
  for (const e of employees) {
    if (!e.confirmedOn || confirmedIds.has(e.id)) continue;
    await recordHistory(prisma, {
      companyId: e.companyId, employeeId: e.id, type: 'CONFIRMED', effectiveDate: e.confirmedOn,
      title: 'Confirmed — probation completed', from: { employmentStatus: 'PROBATION' }, to: { employmentStatus: 'ACTIVE' },
    });
    confirmed += 1;
  }
  log.push(`career: CONFIRMED history rows created: ${confirmed}`);

  // ---- 3b. SALARY_REVISION rows ----
  const revisions = await prisma.salaryRevision.findMany({ where: { status: 'APPLIED' }, orderBy: { effectiveFrom: 'asc' } });
  const recorded = new Set(
    (await prisma.employeeHistory.findMany({ where: { type: 'SALARY_REVISION', refId: { not: null } }, select: { refId: true } }))
      .map((h) => h.refId as string)
  );
  let salary = 0;
  for (const r of revisions) {
    if (recorded.has(r.id)) continue;
    const prev = r.previous as unknown as MonthlyStructure | null;
    const oldCtc = prev && typeof prev.basic === 'number' ? ctcAnnualOf(prev) : null;
    await recordHistory(prisma, {
      companyId: r.companyId, employeeId: r.employeeId, type: 'SALARY_REVISION', effectiveDate: r.effectiveFrom,
      title: oldCtc !== null ? `Salary revised: CTC ${inr(oldCtc)} → ${inr(r.ctcAnnual)}` : `Salary revised: CTC ${inr(r.ctcAnnual)}`,
      from: oldCtc !== null ? { ctcAnnual: oldCtc, monthly: prev } : undefined,
      to: { ctcAnnual: r.ctcAnnual, monthly: r.monthly },
      reason: r.reason, refType: 'SalaryRevision', refId: r.id, createdById: r.createdById,
    });
    salary += 1;
  }
  log.push(`career: SALARY_REVISION history rows created: ${salary}`);
  return log;
}
