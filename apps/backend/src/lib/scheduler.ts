/**
 * In-process scheduler for periodic HR jobs (absent marking, leave accrual,
 * carry-forward, probation reminders, exit deactivation, ...).
 *
 * Each job runs at most once per period key (e.g. "2026-10-19" for daily).
 * The key is claimed atomically in the JobRun table, so several API
 * instances can run the scheduler without double-running a job.
 *
 *   registerJob({ name: 'leave.accrual', period: 'monthly', run: async (key) => { ... } });
 */
import { prisma } from './prisma';
import { logger } from './logger';

export type JobPeriod = 'hourly' | 'daily' | 'monthly' | 'yearly';

export interface JobDefinition {
  name: string;
  period: JobPeriod;
  /** Only run once the IST hour is at least this (0–23). Default 0. */
  atHour?: number;
  /** Receives the period key, e.g. "2026-10-19" / "2026-10" / "2026". */
  run: (key: string) => Promise<void>;
}

const jobs = new Map<string, JobDefinition>();
const TZ_OFFSET_MIN = 330; // Asia/Kolkata — the companies' default timezone.
const TICK_MS = 5 * 60 * 1000;

export function registerJob(job: JobDefinition): void {
  jobs.set(job.name, job);
}

export function listJobs(): { name: string; period: JobPeriod; atHour: number }[] {
  return [...jobs.values()].map((j) => ({ name: j.name, period: j.period, atHour: j.atHour ?? 0 }));
}

/** Local (IST) wall-clock parts for `now`. */
export function istNow(now = new Date()): Date {
  return new Date(now.getTime() + TZ_OFFSET_MIN * 60 * 1000);
}

export function periodKey(period: JobPeriod, now = new Date()): string {
  const d = istNow(now).toISOString(); // shifted, so the UTC fields read as IST
  if (period === 'hourly') return d.slice(0, 13);
  if (period === 'daily') return d.slice(0, 10);
  if (period === 'monthly') return d.slice(0, 7);
  return d.slice(0, 4);
}

async function claim(name: string, key: string): Promise<boolean> {
  await prisma.jobRun.upsert({ where: { name }, create: { name, lastKey: '' }, update: {} });
  const res = await prisma.jobRun.updateMany({
    where: { name, NOT: { lastKey: key } },
    data: { lastKey: key, lastRunAt: new Date(), lastError: null },
  });
  return res.count === 1;
}

/** Runs one job immediately for the current period (admin "run now"), regardless of the claim. */
export async function runJobNow(name: string): Promise<void> {
  const job = jobs.get(name);
  if (!job) throw new Error(`Unknown job ${name}`);
  const key = periodKey(job.period);
  await job.run(key);
  await prisma.jobRun.upsert({
    where: { name },
    create: { name, lastKey: key },
    update: { lastKey: key, lastRunAt: new Date(), lastError: null },
  });
}

async function tick(): Promise<void> {
  const hour = istNow().getUTCHours();
  for (const job of jobs.values()) {
    if (hour < (job.atHour ?? 0)) continue;
    const key = periodKey(job.period);
    try {
      if (!(await claim(job.name, key))) continue;
      logger.info({ job: job.name, key }, 'scheduler: running job');
      await job.run(key);
    } catch (err) {
      logger.error({ err, job: job.name, key }, 'scheduler: job failed');
      await prisma.jobRun
        .update({ where: { name: job.name }, data: { lastError: String(err).slice(0, 500) } })
        .catch(() => undefined);
    }
  }
}

let timer: NodeJS.Timeout | null = null;

export function startScheduler(): void {
  if (timer) return;
  logger.info(`scheduler started (${jobs.size} jobs)`);
  void tick();
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
