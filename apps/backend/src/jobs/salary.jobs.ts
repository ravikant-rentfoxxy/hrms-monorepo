/** Salary jobs: applies approved salary revisions on their effective date. */
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { registerJob } from '../lib/scheduler';
import { applyDueRevisions } from '../services/salary-revision.service';

export function registerSalaryJobs(): void {
  registerJob({
    name: 'salary.applyRevisions',
    period: 'daily',
    atHour: 1,
    run: async () => {
      const companies = await prisma.company.findMany({ where: { isActive: true }, select: { id: true } });
      for (const c of companies) {
        try {
          const n = await applyDueRevisions(c.id);
          if (n > 0) logger.info({ companyId: c.id, applied: n }, 'salary revisions applied');
        } catch (err) {
          // One company's failure must not block the others; the next day's run retries.
          logger.error({ err, companyId: c.id }, 'salary.applyRevisions failed for company');
        }
      }
    },
  });
}
