/**
 * Employee-lifecycle jobs: onboarding task reminders, probation
 * confirmation requests, exit completion (separation, access revocation,
 * reporting-line hand-off, letters) and overdue F&F reminders.
 */
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { registerJob } from '../lib/scheduler';
import { notifyDueTasks } from '../services/onboarding.service';
import { raiseDueRequests } from '../services/confirmation.service';
import { completeDueExits } from '../services/exit.service';
import { notifyOverdueSettlements } from '../services/settlement.service';

/** Runs `fn` for every active company; one company's failure doesn't stop the rest. */
async function forEachCompany(job: string, fn: (companyId: string) => Promise<number>) {
  const companies = await prisma.company.findMany({ where: { isActive: true }, select: { id: true } });
  let total = 0;
  for (const c of companies) {
    try {
      total += await fn(c.id);
    } catch (err) {
      logger.error({ err, job, companyId: c.id }, 'lifecycle job failed for company');
    }
  }
  logger.info({ job, total }, 'lifecycle job done');
}

export function registerLifecycleJobs(): void {
  registerJob({
    name: 'lifecycle.onboardingReminders',
    period: 'daily',
    atHour: 9,
    run: () => forEachCompany('lifecycle.onboardingReminders', notifyDueTasks),
  });
  registerJob({
    name: 'lifecycle.probationConfirmations',
    period: 'daily',
    atHour: 6,
    run: () => forEachCompany('lifecycle.probationConfirmations', raiseDueRequests),
  });
  // After midnight IST: exits whose last working day was yesterday (or earlier) are closed.
  registerJob({
    name: 'lifecycle.completeExits',
    period: 'daily',
    atHour: 1,
    run: () => forEachCompany('lifecycle.completeExits', completeDueExits),
  });
  // Code on Wages: F&F is due 2 working days after separation — nudge HR when it slips.
  registerJob({
    name: 'lifecycle.fnfOverdue',
    period: 'daily',
    atHour: 10,
    run: () => forEachCompany('lifecycle.fnfOverdue', notifyOverdueSettlements),
  });
}
