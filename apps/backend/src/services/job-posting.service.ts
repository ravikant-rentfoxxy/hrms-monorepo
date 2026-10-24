/**
 * Job postings: where HR advertised a job (LinkedIn, Naukri, Indeed, careers
 * page, ...). One record per advert; applications can be linked to the posting
 * they came through, which gives applications / cost / hires per platform.
 *
 *   DRAFT → PUBLISHED → ACTIVE → EXPIRED | CLOSED   (renew re-activates with a new expiry)
 *
 * A job becomes OPEN once it has a live (PUBLISHED / ACTIVE) posting.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/http';
import { dateOnlyUTC } from '../utils/geo';
import { JOINED_STAGES, platformLabel } from './recruitment.helpers';
import { employeeNames } from './talent.helpers';

export const POSTING_STATUSES = ['DRAFT', 'PUBLISHED', 'ACTIVE', 'EXPIRED', 'CLOSED'] as const;
const LIVE = ['PUBLISHED', 'ACTIVE'];
/** Jobs that can still be advertised. */
const POSTABLE_JOB = ['APPROVED', 'OPEN', 'ON_HOLD', 'DRAFT'];

export interface PostingInput {
  platform: string;
  platformName?: string;
  url?: string;
  externalId?: string;
  postedOn?: Date | null;
  expiresOn?: Date | null;
  cost?: number;
  notes?: string;
  status?: 'DRAFT' | 'PUBLISHED';
}

async function getOrThrow(companyId: string, id: string) {
  const posting = await prisma.jobPosting.findFirst({ where: { id, companyId }, include: { job: true } });
  if (!posting) throw ApiError.notFound('Posting not found');
  return posting;
}

const dates = (input: Partial<PostingInput>) => ({
  ...(input.postedOn !== undefined ? { postedOn: input.postedOn ? dateOnlyUTC(input.postedOn) : null } : {}),
  ...(input.expiresOn !== undefined ? { expiresOn: input.expiresOn ? dateOnlyUTC(input.expiresOn) : null } : {}),
});

function assertDates(postedOn: Date | null | undefined, expiresOn: Date | null | undefined) {
  if (postedOn && expiresOn && dateOnlyUTC(expiresOn) < dateOnlyUTC(postedOn)) throw ApiError.badRequest('Expiry is before the posting date');
}

/** APPROVED → OPEN once the job has a live posting. */
export async function syncJobOpen(companyId: string, jobId: string) {
  const live = await prisma.jobPosting.count({ where: { companyId, jobId, status: { in: LIVE } } });
  if (live > 0) {
    await prisma.jobOpening.updateMany({ where: { id: jobId, companyId, status: { in: ['APPROVED', 'DRAFT'] } }, data: { status: 'OPEN' } });
  }
}

/** Application / hire counts and cost per application for postings. */
async function withStats<T extends { id: string; cost: number; postedById: string | null }>(companyId: string, postings: T[]) {
  const ids = postings.map((p) => p.id);
  const [apps, hires, people] = await Promise.all([
    prisma.application.groupBy({ by: ['postingId'], where: { companyId, postingId: { in: ids } }, _count: { _all: true } }),
    prisma.application.groupBy({
      by: ['postingId'],
      where: { companyId, postingId: { in: ids }, stage: { in: JOINED_STAGES } },
      _count: { _all: true },
    }),
    employeeNames(companyId, postings.map((p) => p.postedById)),
  ]);
  return postings.map((p) => {
    const applications = apps.find((a) => a.postingId === p.id)?._count._all ?? 0;
    const hired = hires.find((a) => a.postingId === p.id)?._count._all ?? 0;
    return {
      ...p,
      postedBy: p.postedById ? (people.get(p.postedById) ?? null) : null,
      applications,
      hires: hired,
      costPerApplication: applications ? Math.round(p.cost / applications) : null,
      costPerHire: hired ? Math.round(p.cost / hired) : null,
    };
  });
}

export async function listForJob(companyId: string, jobId: string) {
  const postings = await prisma.jobPosting.findMany({ where: { companyId, jobId }, orderBy: { createdAt: 'desc' } });
  return (await withStats(companyId, postings)).map((p) => ({ ...p, label: platformLabel(p) }));
}

export async function list(companyId: string, filter: { jobId?: string; status?: string; platform?: string }) {
  const where: Prisma.JobPostingWhereInput = { companyId };
  if (filter.jobId) where.jobId = filter.jobId;
  if (filter.status) where.status = filter.status;
  if (filter.platform) where.platform = filter.platform;
  const postings = await prisma.jobPosting.findMany({
    where,
    include: { job: { select: { id: true, code: true, title: true, status: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  return (await withStats(companyId, postings)).map((p) => ({ ...p, label: platformLabel(p) }));
}

export async function create(companyId: string, jobId: string, postedById: string | null, input: PostingInput) {
  const job = await prisma.jobOpening.findFirst({ where: { id: jobId, companyId } });
  if (!job) throw ApiError.notFound('Job not found');
  if (!POSTABLE_JOB.includes(job.status)) throw ApiError.badRequest(`A ${job.status.toLowerCase()} job cannot be posted`);
  if (input.platform === 'OTHER' && !input.platformName?.trim()) throw ApiError.badRequest('Name the platform');
  assertDates(input.postedOn, input.expiresOn);
  const publishing = input.status === 'PUBLISHED';
  // TODO(job-boards): push to LinkedIn/Naukri APIs
  const posting = await prisma.jobPosting.create({
    data: {
      companyId,
      jobId,
      platform: input.platform,
      platformName: input.platformName ?? '',
      url: input.url ?? '',
      externalId: input.externalId ?? '',
      cost: input.cost ?? 0,
      notes: input.notes ?? '',
      postedById,
      status: input.status ?? 'DRAFT',
      ...dates(input),
      ...(publishing && !input.postedOn ? { postedOn: dateOnlyUTC() } : {}),
    },
  });
  if (publishing) await syncJobOpen(companyId, jobId);
  return posting;
}

export async function update(companyId: string, id: string, input: Partial<Omit<PostingInput, 'status'>>) {
  const before = await getOrThrow(companyId, id);
  assertDates(input.postedOn !== undefined ? input.postedOn : before.postedOn, input.expiresOn !== undefined ? input.expiresOn : before.expiresOn);
  const { job: _job, ...plain } = before;
  const after = await prisma.jobPosting.update({
    where: { id },
    data: {
      ...(input.platform !== undefined ? { platform: input.platform } : {}),
      ...(input.platformName !== undefined ? { platformName: input.platformName } : {}),
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.externalId !== undefined ? { externalId: input.externalId } : {}),
      ...(input.cost !== undefined ? { cost: input.cost } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...dates(input),
    },
  });
  return { before: plain, after };
}

const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PUBLISHED', 'CLOSED'],
  PUBLISHED: ['ACTIVE', 'CLOSED', 'EXPIRED'],
  ACTIVE: ['CLOSED', 'EXPIRED'],
  EXPIRED: ['CLOSED'],
  CLOSED: [],
};

export async function setStatus(companyId: string, id: string, status: string) {
  const before = await getOrThrow(companyId, id);
  if (!(TRANSITIONS[before.status] ?? []).includes(status)) {
    throw ApiError.badRequest(
      before.status === 'EXPIRED' || before.status === 'CLOSED'
        ? 'Renew the posting to make it live again'
        : `A posting cannot go from ${before.status} to ${status}`
    );
  }
  if (LIVE.includes(status) && !POSTABLE_JOB.includes(before.job.status)) throw ApiError.badRequest(`The job is ${before.job.status.toLowerCase()}`);
  const after = await prisma.jobPosting.update({
    where: { id },
    data: { status, ...(status === 'PUBLISHED' && !before.postedOn ? { postedOn: dateOnlyUTC() } : {}) },
  });
  if (LIVE.includes(status)) await syncJobOpen(companyId, before.jobId);
  const { job: _job, ...plain } = before;
  return { before: plain, after };
}

/** Extends the expiry and (re)activates the posting — also reopens an expired / closed one. */
export async function renew(companyId: string, id: string, expiresOn: Date) {
  const before = await getOrThrow(companyId, id);
  if (!POSTABLE_JOB.includes(before.job.status)) throw ApiError.badRequest(`The job is ${before.job.status.toLowerCase()} — reopen it first`);
  const expiry = dateOnlyUTC(expiresOn);
  if (expiry < dateOnlyUTC()) throw ApiError.badRequest('The new expiry date is in the past');
  const after = await prisma.jobPosting.update({
    where: { id },
    data: { status: 'ACTIVE', expiresOn: expiry, ...(before.postedOn ? {} : { postedOn: dateOnlyUTC() }) },
  });
  await syncJobOpen(companyId, before.jobId);
  const { job: _job, ...plain } = before;
  return { before: plain, after };
}

export async function remove(companyId: string, id: string) {
  const posting = await getOrThrow(companyId, id);
  const apps = await prisma.application.count({ where: { companyId, postingId: id } });
  if (apps > 0) throw ApiError.conflict('Applications came through this posting — close it instead of deleting');
  await prisma.jobPosting.delete({ where: { id } });
  return posting;
}

/** Closes every live / draft posting of a job (job closed, filled or cancelled). */
export async function closeAllForJob(companyId: string, jobId: string) {
  await prisma.jobPosting.updateMany({ where: { companyId, jobId, status: { in: ['DRAFT', ...LIVE] } }, data: { status: 'CLOSED' } });
}

/** Daily: postings past their expiry date → EXPIRED. */
export async function expirePostings(companyId: string, today = dateOnlyUTC()): Promise<number> {
  const r = await prisma.jobPosting.updateMany({
    where: { companyId, status: { in: LIVE }, expiresOn: { lt: today } },
    data: { status: 'EXPIRED' },
  });
  return r.count;
}

/** Per-platform effectiveness: postings, spend, applications, hires, cost per application / hire. */
export async function platformStats(companyId: string, filter: { from?: Date; to?: Date }) {
  const where: Prisma.JobPostingWhereInput = { companyId };
  if (filter.from || filter.to) {
    where.createdAt = { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) };
  }
  const postings = await prisma.jobPosting.findMany({ where, select: { id: true, platform: true, platformName: true, cost: true, postedById: true } });
  const rows = await withStats(companyId, postings);
  const map = new Map<string, { platform: string; postings: number; cost: number; applications: number; hires: number }>();
  for (const p of rows) {
    const key = platformLabel(p);
    const s = map.get(key) ?? { platform: key, postings: 0, cost: 0, applications: 0, hires: 0 };
    s.postings += 1;
    s.cost += p.cost;
    s.applications += p.applications;
    s.hires += p.hires;
    map.set(key, s);
  }
  return [...map.values()]
    .map((s) => ({
      ...s,
      costPerApplication: s.applications ? Math.round(s.cost / s.applications) : null,
      costPerHire: s.hires ? Math.round(s.cost / s.hires) : null,
    }))
    .sort((a, b) => b.applications - a.applications);
}
