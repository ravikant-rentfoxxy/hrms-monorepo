/**
 * Attendance jobs (daily, 01:00 IST):
 *  - auto-mark the previous days: HOLIDAY / WEEKEND / LEAVE / ABSENT rows for
 *    employees without a record (never overwrites punched records). The last
 *    LOOKBACK_DAYS days are processed so a missed run (server down) catches up;
 *    re-processing a day only fills gaps.
 *  - close check-ins without a check-out once the shift has ended ("Missed check-out").
 */
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { registerJob } from '../lib/scheduler';
import { autoMarkDay, closeMissedCheckouts, companyTz } from '../services/attendance.service';
import { addDays, localDateOf } from '../utils/tz';

const LOOKBACK_DAYS = 3;

export function registerAttendanceJobs(): void {
  registerJob({
    name: 'attendance.dailyMark',
    period: 'daily',
    atHour: 1,
    run: async () => {
      const companies = await prisma.company.findMany({ where: { isActive: true }, select: { id: true } });
      const now = new Date();
      for (const c of companies) {
        try {
          // Close missed check-outs first so those days are not re-marked.
          const { closed } = await closeMissedCheckouts(c.id, now);
          const today = localDateOf(now, await companyTz(c.id));
          let created = 0;
          for (let i = LOOKBACK_DAYS; i >= 1; i--) created += (await autoMarkDay(c.id, addDays(today, -i))).created;
          if (created > 0 || closed > 0) logger.info({ companyId: c.id, created, closed }, 'attendance auto-marked');
        } catch (err) {
          // One company's failure must not block the others; the next day's run retries.
          logger.error({ err, companyId: c.id }, 'attendance.dailyMark failed for company');
        }
      }
    },
  });
}
