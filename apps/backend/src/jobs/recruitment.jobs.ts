/**
 * Recruitment jobs (daily):
 *  - recruitment.postings (00:00 IST): job-board postings past their expiry → EXPIRED.
 *  - recruitment.offers (00:00 IST): sent / negotiating offers past validUntil → EXPIRED.
 *  - recruitment.interviewReminders (09:00 IST): remind the panel and candidates of tomorrow's interviews.
 *  - recruitment.portalTokens (03:00 IST): clear expired candidate-portal tokens.
 */
import { logger } from '../lib/logger';
import { registerJob } from '../lib/scheduler';
import { activeCompanyIds } from '../services/talent.helpers';
import { expirePostings } from '../services/job-posting.service';
import { expireOffers } from '../services/offer.service';
import { sendReminders } from '../services/interview.service';
import { cleanupExpiredTokens } from '../services/candidate-portal.service';

/** Runs `fn` for every active company; one company's failure never blocks the others. */
async function forEachCompany(job: string, fn: (companyId: string) => Promise<number>): Promise<void> {
  for (const companyId of await activeCompanyIds()) {
    try {
      const count = await fn(companyId);
      if (count > 0) logger.info({ companyId, count }, job);
    } catch (err) {
      logger.error({ err, companyId }, `${job} failed for company`);
    }
  }
}

export function registerRecruitmentJobs(): void {
  registerJob({ name: 'recruitment.postings', period: 'daily', run: () => forEachCompany('recruitment.postings', (c) => expirePostings(c)) });
  registerJob({ name: 'recruitment.offers', period: 'daily', run: () => forEachCompany('recruitment.offers', (c) => expireOffers(c)) });
  registerJob({
    name: 'recruitment.interviewReminders',
    period: 'daily',
    atHour: 9,
    run: () => forEachCompany('recruitment.interviewReminders', (c) => sendReminders(c)),
  });
  registerJob({
    name: 'recruitment.portalTokens',
    period: 'daily',
    atHour: 3,
    run: () => forEachCompany('recruitment.portalTokens', (c) => cleanupExpiredTokens(c)),
  });
}
