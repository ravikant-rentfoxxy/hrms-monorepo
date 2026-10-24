/** Scheduler visibility for admins: registered jobs with their JobRun bookkeeping, and "run now". */
import { prisma } from '../lib/prisma';
import { listJobs, runJobNow } from '../lib/scheduler';
import { ApiError } from '../utils/http';

/** Jobs that touch platform data (billing) — only SUPER_ADMIN may trigger them. */
export const isPlatformJob = (name: string) => name.startsWith('platform.');

export async function jobs() {
  const registered = listJobs();
  const runs = await prisma.jobRun.findMany({ where: { name: { in: registered.map((j) => j.name) } } });
  return registered
    .map((j) => {
      const run = runs.find((r) => r.name === j.name);
      return {
        ...j,
        lastKey: run?.lastKey || null,
        lastRunAt: run?.lastKey ? run.lastRunAt : null,
        lastError: run?.lastError ?? null,
        platform: isPlatformJob(j.name),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Runs a job immediately; a failure is recorded on its JobRun row and reported back. */
export async function runNow(name: string) {
  if (!listJobs().some((j) => j.name === name)) throw ApiError.notFound(`Unknown job ${name}`);
  const started = Date.now();
  try {
    await runJobNow(name);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.jobRun
      .upsert({ where: { name }, create: { name, lastKey: '', lastError: message.slice(0, 500) }, update: { lastError: message.slice(0, 500) } })
      .catch(() => undefined);
    throw ApiError.badRequest(`Job ${name} failed: ${message}`);
  }
  const run = await prisma.jobRun.findUnique({ where: { name } });
  return { name, durationMs: Date.now() - started, lastKey: run?.lastKey ?? null, lastRunAt: run?.lastRunAt ?? null };
}
