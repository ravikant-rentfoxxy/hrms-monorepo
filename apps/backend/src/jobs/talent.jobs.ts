/**
 * Talent jobs:
 *  - talent.reviewReminders (daily, 10:00 IST): nudge reviewers with pending
 *    self / manager / peer reviews when a due date is ≤ 3 days away (or up to a
 *    week overdue).
 *  - talent.training (daily, 02:00 IST): auto-assign mandatory courses to new
 *    joiners (idempotent — existing enrollments are skipped) and send due-soon /
 *    overdue course reminders.
 *  - talent.surveys (daily, 00:00 IST): close surveys past their closing date.
 */
import { logger } from '../lib/logger';
import { registerJob } from '../lib/scheduler';
import { activeCompanyIds } from '../services/talent.helpers';
import { sendReminders } from '../services/review.service';
import { autoAssignNewJoiners, sendDueReminders } from '../services/training.service';
import { closeExpired } from '../services/survey.service';

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

export function registerTalentJobs(): void {
  registerJob({
    name: 'talent.reviewReminders',
    period: 'daily',
    atHour: 10,
    run: () =>
      forEachCompany('talent.reviewReminders', async (companyId) => {
        const sent = await sendReminders(companyId);
        if (sent > 0) logger.info({ companyId, sent }, 'review reminders sent');
      }),
  });

  registerJob({
    name: 'talent.training',
    period: 'daily',
    atHour: 2,
    run: () =>
      forEachCompany('talent.training', async (companyId) => {
        const assigned = await autoAssignNewJoiners(companyId);
        const reminded = await sendDueReminders(companyId);
        if (assigned > 0 || reminded > 0) logger.info({ companyId, assigned, reminded }, 'training job');
      }),
  });

  registerJob({
    name: 'talent.surveys',
    period: 'daily',
    run: () =>
      forEachCompany('talent.surveys', async (companyId) => {
        const closed = await closeExpired(companyId);
        if (closed > 0) logger.info({ companyId, closed }, 'expired surveys closed');
      }),
  });
}
