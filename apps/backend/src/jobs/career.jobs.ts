/**
 * Career jobs:
 *  - career.transfers (daily, 00:00 IST): apply approved transfers /
 *    promotions whose effective date has arrived (idempotent — APPLIED
 *    requests are skipped).
 *  - career.certificationExpiry (daily, 09:00 IST): remind holders 30 and 7
 *    days before a certification expires (exact-day match → once per date).
 */
import { logger } from '../lib/logger';
import { registerJob } from '../lib/scheduler';
import { activeCompanyIds } from '../services/talent.helpers';
import { applyDueTransfers } from '../services/transfer.service';
import { sendExpiryReminders } from '../services/career.service';

/** Runs `fn` for every active company; one company's failure never blocks the others. */
async function forEachCompany(job: string, fn: (companyId: string) => Promise<unknown>): Promise<void> {
  for (const companyId of await activeCompanyIds()) {
    try {
      await fn(companyId);
    } catch (err) {
      logger.error({ err, companyId }, `${job} failed for company`);
    }
  }
}

export function registerCareerJobs(): void {
  registerJob({
    name: 'career.transfers',
    period: 'daily',
    atHour: 0,
    run: () =>
      forEachCompany('career.transfers', async (companyId) => {
        const applied = await applyDueTransfers(companyId);
        if (applied > 0) logger.info({ companyId, applied }, 'transfers applied');
      }),
  });

  registerJob({
    name: 'career.certificationExpiry',
    period: 'daily',
    atHour: 9,
    run: () =>
      forEachCompany('career.certificationExpiry', async (companyId) => {
        const sent = await sendExpiryReminders(companyId);
        if (sent > 0) logger.info({ companyId, sent }, 'certification expiry reminders sent');
      }),
  });
}
