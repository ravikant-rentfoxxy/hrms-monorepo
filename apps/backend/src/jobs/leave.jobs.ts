/**
 * Leave engine jobs (all idempotent; see lib/scheduler.ts):
 *   leave.accrual        monthly  — posts missing policy credits (MONTHLY instalment for the month,
 *                                   YEARLY quota for new joiners) for every active employee
 *   leave.yearEnd        yearly   — carry-forward / lapse of last year, credits for the new year
 *   leave.compOffExpiry  daily    — EXPIRED debits for unused comp-off past its expiry
 */
import { registerJob } from '../lib/scheduler';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { forEachEmployee } from '../services/leave.service';
import { ensureYearCreditsTx, expireCompOffTx, todayIST, withLedgerLock, yearEndTx } from '../services/leave-ledger.service';

async function activeCompanies() {
  return prisma.company.findMany({ where: { isActive: true }, select: { id: true } });
}

/** Monthly accrual for `year` across all companies. */
export async function runAccrual(year = todayIST().getUTCFullYear()) {
  for (const c of await activeCompanies()) {
    const failed = await forEachEmployee(c.id, 'leave.accrual', (employeeId) =>
      withLedgerLock(employeeId, (tx) => ensureYearCreditsTx(tx, c.id, employeeId, year))
    );
    if (failed) logger.warn({ companyId: c.id, failed }, 'leave.accrual: some employees failed');
  }
}

/** Closes `prevYear` (carry-forward + lapse) and opens the next one. */
export async function runYearEnd(prevYear = todayIST().getUTCFullYear() - 1) {
  for (const c of await activeCompanies()) {
    const failed = await forEachEmployee(c.id, 'leave.yearEnd', (employeeId) =>
      withLedgerLock(employeeId, (tx) => yearEndTx(tx, c.id, employeeId, prevYear))
    );
    if (failed) logger.warn({ companyId: c.id, failed }, 'leave.yearEnd: some employees failed');
  }
}

/** Expires unused comp-off for employees who have an expired credit. */
export async function runCompOffExpiry() {
  const today = todayIST();
  for (const c of await activeCompanies()) {
    const due = await prisma.leaveLedger.findMany({
      where: { companyId: c.id, kind: 'COMP_OFF', expiresOn: { lt: today } },
      select: { employeeId: true },
      distinct: ['employeeId'],
    });
    for (const { employeeId } of due) {
      try {
        await withLedgerLock(employeeId, (tx) => expireCompOffTx(tx, c.id, employeeId));
      } catch (err) {
        logger.error({ err, companyId: c.id, employeeId }, 'leave.compOffExpiry: employee failed');
      }
    }
  }
}

export function registerLeaveJobs(): void {
  // Key "YYYY-MM" — accrue for that key's year.
  registerJob({ name: 'leave.accrual', period: 'monthly', atHour: 1, run: (key) => runAccrual(Number(key.slice(0, 4))) });
  // Key "YYYY" — close the previous year. Runs before accrual on 1 Jan (atHour 0).
  registerJob({ name: 'leave.yearEnd', period: 'yearly', atHour: 0, run: (key) => runYearEnd(Number(key) - 1) });
  registerJob({ name: 'leave.compOffExpiry', period: 'daily', atHour: 1, run: () => runCompOffExpiry() });
}
