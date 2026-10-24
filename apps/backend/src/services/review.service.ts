/**
 * Performance review cycles: launch → self review → manager review →
 * calibration (bell curve, outcomes) → closed. Outcomes go PROPOSED →
 * APPROVED (ADMIN/HR) → APPLIED (increment via the salary-revision service,
 * promotion updates the employee's designation).
 */
import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';
import { dateOnlyUTC } from '../utils/geo';
import { applyIncrement } from './salary-revision.service';
import { recordHistory } from './employee-history.service';
import { type Actor, employeeNames, isHrAdmin, requireEmployee } from './talent.helpers';

export const PHASES = ['DRAFT', 'SELF_REVIEW', 'MANAGER_REVIEW', 'CALIBRATION', 'CLOSED'] as const;
const MAX_PEERS = 3;

/** Suggested increment % by (5-point) rating — editable during calibration. */
export const INCREMENT_MATRIX: Record<number, number> = { 5: 15, 4: 10, 3: 7, 2: 3, 1: 0 };

/** Target distribution (% of employees per rating, lowest → highest). */
export function targetDistribution(scale: number): number[] {
  if (scale === 5) return [10, 20, 40, 20, 10];
  // Binomial approximation of a bell curve for other scales.
  const n = scale - 1;
  const choose = (k: number) => {
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return r;
  };
  const raw = Array.from({ length: scale }, (_, k) => choose(k) / 2 ** n);
  return raw.map((p) => Math.round(p * 1000) / 10);
}

/** Rating on any scale → 1..5. */
const toFivePoint = (rating: number, scale: number) => (scale === 5 ? rating : 1 + ((rating - 1) * 4) / (scale - 1));

export function suggestedIncrement(rating: number | null | undefined, scale: number): number {
  if (rating === null || rating === undefined) return 0;
  const r = Math.min(5, Math.max(1, Math.round(toFivePoint(rating, scale))));
  return INCREMENT_MATRIX[r] ?? 0;
}

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

export interface CycleInput {
  name: string;
  periodStart: Date;
  periodEnd: Date;
  selfReviewDue?: Date | null;
  managerReviewDue?: Date | null;
  ratingScale?: number;
  includePeer?: boolean;
}

const normalizeDates = <T extends Partial<CycleInput>>(input: T): T => ({
  ...input,
  ...(input.periodStart ? { periodStart: dateOnlyUTC(input.periodStart) } : {}),
  ...(input.periodEnd ? { periodEnd: dateOnlyUTC(input.periodEnd) } : {}),
  ...(input.selfReviewDue ? { selfReviewDue: dateOnlyUTC(input.selfReviewDue) } : {}),
  ...(input.managerReviewDue ? { managerReviewDue: dateOnlyUTC(input.managerReviewDue) } : {}),
});

export async function getCycleOrThrow(companyId: string, id: string) {
  const cycle = await prisma.reviewCycle.findFirst({ where: { id, companyId } });
  if (!cycle) throw ApiError.notFound('Review cycle not found');
  return cycle;
}

export async function listCycles(companyId: string, actor: Actor) {
  const cycles = await prisma.reviewCycle.findMany({
    where: { companyId, ...(isHrAdmin(actor.role) ? {} : { status: { not: 'DRAFT' } }) },
    orderBy: { periodStart: 'desc' },
  });
  if (!isHrAdmin(actor.role)) return cycles;
  const counts = await prisma.review.groupBy({
    by: ['cycleId', 'type', 'status'],
    where: { companyId, cycleId: { in: cycles.map((c) => c.id) } },
    _count: { _all: true },
  });
  return cycles.map((c) => {
    const progress: Record<string, { total: number; submitted: number }> = {};
    for (const r of counts.filter((x) => x.cycleId === c.id)) {
      const p = progress[r.type] ?? { total: 0, submitted: 0 };
      p.total += r._count._all;
      if (r.status === 'SUBMITTED') p.submitted += r._count._all;
      progress[r.type] = p;
    }
    return { ...c, progress };
  });
}

export async function createCycle(companyId: string, input: CycleInput) {
  return prisma.reviewCycle.create({ data: { ...normalizeDates(input), companyId } });
}

export async function updateCycle(companyId: string, id: string, input: Partial<CycleInput>) {
  const before = await getCycleOrThrow(companyId, id);
  if (before.status === 'CLOSED') throw ApiError.badRequest('A closed cycle cannot be edited');
  if (before.status !== 'DRAFT' && (input.ratingScale !== undefined || input.periodStart || input.periodEnd)) {
    throw ApiError.badRequest('Period and rating scale are locked once the cycle is launched — only due dates can change');
  }
  const merged = { ...before, ...input };
  if (merged.periodEnd < merged.periodStart) throw ApiError.badRequest('Period end must be after the start');
  const after = await prisma.reviewCycle.update({ where: { id }, data: normalizeDates(input) });
  return { before, after };
}

export async function deleteCycle(companyId: string, id: string) {
  const cycle = await getCycleOrThrow(companyId, id);
  if (cycle.status !== 'DRAFT') throw ApiError.badRequest('Only a draft cycle can be deleted');
  await prisma.reviewCycle.delete({ where: { id } });
  return cycle;
}

/**
 * Creates the SELF review for every active employee who had joined by the
 * period end, plus a MANAGER review where they have a manager. Idempotent —
 * re-running only adds what is missing (new joiners, newly assigned managers).
 */
async function syncReviews(companyId: string, cycle: { id: string; periodEnd: Date }) {
  const [employees, existing] = await Promise.all([
    prisma.employee.findMany({
      where: { companyId, isActive: true, joiningDate: { lte: cycle.periodEnd } },
      select: { id: true, managerId: true },
    }),
    prisma.review.findMany({ where: { companyId, cycleId: cycle.id }, select: { employeeId: true, type: true, reviewerId: true } }),
  ]);
  const has = new Set(existing.map((r) => `${r.employeeId}:${r.type}:${r.reviewerId ?? ''}`));
  const hasManagerReview = new Set(existing.filter((r) => r.type === 'MANAGER').map((r) => r.employeeId));
  const rows: Prisma.ReviewCreateManyInput[] = [];
  for (const e of employees) {
    if (!has.has(`${e.id}:SELF:${e.id}`)) rows.push({ companyId, cycleId: cycle.id, employeeId: e.id, reviewerId: e.id, type: 'SELF' });
    if (e.managerId && !hasManagerReview.has(e.id)) {
      rows.push({ companyId, cycleId: cycle.id, employeeId: e.id, reviewerId: e.managerId, type: 'MANAGER' });
    }
  }
  if (rows.length) await prisma.review.createMany({ data: rows });
  return { created: rows.length, employees: employees.length };
}

/** One outcome per reviewee; finalRating defaults to the manager's rating (else self). Never overwrites decided rows. */
async function syncOutcomes(companyId: string, cycle: { id: string; ratingScale: number }) {
  const reviews = await prisma.review.findMany({
    where: { companyId, cycleId: cycle.id, type: { in: ['SELF', 'MANAGER'] } },
    select: { employeeId: true, type: true, status: true, rating: true },
  });
  const existing = await prisma.reviewOutcome.findMany({ where: { companyId, cycleId: cycle.id } });
  const byEmp = new Map(existing.map((o) => [o.employeeId, o]));
  const ratings = new Map<string, { self?: number; manager?: number }>();
  for (const r of reviews) {
    const entry = ratings.get(r.employeeId) ?? {};
    if (r.status === 'SUBMITTED' && r.rating !== null) entry[r.type === 'SELF' ? 'self' : 'manager'] = r.rating;
    ratings.set(r.employeeId, entry);
  }
  let created = 0;
  for (const [employeeId, r] of ratings) {
    const rating = r.manager ?? r.self ?? null;
    const outcome = byEmp.get(employeeId);
    if (!outcome) {
      await prisma.reviewOutcome.create({
        data: { companyId, cycleId: cycle.id, employeeId, finalRating: rating, incrementPercent: suggestedIncrement(rating, cycle.ratingScale) },
      });
      created++;
    } else if (outcome.status === 'PROPOSED' && outcome.finalRating === null && rating !== null) {
      await prisma.reviewOutcome.update({
        where: { id: outcome.id },
        data: { finalRating: rating, incrementPercent: suggestedIncrement(rating, cycle.ratingScale) },
      });
    }
  }
  return { created };
}

export async function launchCycle(companyId: string, id: string) {
  const cycle = await getCycleOrThrow(companyId, id);
  if (cycle.status !== 'DRAFT') throw ApiError.badRequest('This cycle has already been launched');
  const updated = await prisma.reviewCycle.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SELF_REVIEW' } });
  if (updated.count === 0) throw ApiError.conflict('This cycle has already been launched');
  const result = await syncReviews(companyId, cycle);
  const selfReviewers = await prisma.review.findMany({ where: { companyId, cycleId: id, type: 'SELF' }, select: { employeeId: true } });
  await notify(companyId, selfReviewers.map((r) => r.employeeId), {
    event: 'review.launched',
    title: `${cycle.name}: self review open`,
    body: `Your self review is open${cycle.selfReviewDue ? ` — due ${cycle.selfReviewDue.toISOString().slice(0, 10)}` : ''}.`,
    link: '/reviews',
  });
  return { cycle: await getCycleOrThrow(companyId, id), ...result };
}

/** Adds reviews for joiners / outcomes for late submissions while the cycle runs. */
export async function syncCycle(companyId: string, id: string) {
  const cycle = await getCycleOrThrow(companyId, id);
  if (cycle.status === 'DRAFT' || cycle.status === 'CLOSED') throw ApiError.badRequest('Only a running cycle can be synced');
  const reviews = await syncReviews(companyId, cycle);
  const outcomes = cycle.status === 'CALIBRATION' ? await syncOutcomes(companyId, cycle) : { created: 0 };
  return { reviewsCreated: reviews.created, outcomesCreated: outcomes.created };
}

export async function advanceCycle(companyId: string, id: string) {
  const cycle = await getCycleOrThrow(companyId, id);
  const idx = PHASES.indexOf(cycle.status as (typeof PHASES)[number]);
  if (cycle.status === 'DRAFT') throw ApiError.badRequest('Launch the cycle first');
  if (idx < 0 || cycle.status === 'CLOSED') throw ApiError.badRequest('This cycle is already closed');
  const next = PHASES[idx + 1]!;
  if (next === 'CLOSED') {
    const proposed = await prisma.reviewOutcome.count({ where: { companyId, cycleId: id, status: 'PROPOSED' } });
    if (proposed > 0) throw ApiError.badRequest(`${proposed} outcome(s) are still PROPOSED — approve them before closing the cycle`);
  }
  const updated = await prisma.reviewCycle.updateMany({ where: { id, status: cycle.status }, data: { status: next } });
  if (updated.count === 0) throw ApiError.conflict('The cycle changed in the meantime — reload and try again');
  if (next === 'CALIBRATION') await syncOutcomes(companyId, cycle);

  if (next === 'MANAGER_REVIEW') {
    const pending = await prisma.review.findMany({
      where: { companyId, cycleId: id, type: { in: ['MANAGER', 'PEER'] }, status: 'PENDING' },
      select: { reviewerId: true },
    });
    await notify(companyId, pending.map((r) => r.reviewerId), {
      event: 'review.manager_phase',
      title: `${cycle.name}: manager reviews open`,
      body: `Please complete the reviews assigned to you${cycle.managerReviewDue ? ` by ${cycle.managerReviewDue.toISOString().slice(0, 10)}` : ''}.`,
      link: '/reviews',
    });
  }
  if (next === 'CLOSED') {
    const outcomes = await prisma.reviewOutcome.findMany({
      where: { companyId, cycleId: id, status: { in: ['APPROVED', 'APPLIED'] } },
      select: { employeeId: true },
    });
    await notify(companyId, outcomes.map((o) => o.employeeId), {
      event: 'review.closed',
      title: `${cycle.name}: results are out`,
      body: 'Your final review outcome is now available.',
      link: '/reviews',
    });
  }
  return { before: cycle, after: await getCycleOrThrow(companyId, id) };
}

/** Phase progress for the cycle dashboard. */
export async function cycleDetail(companyId: string, id: string) {
  const cycle = await getCycleOrThrow(companyId, id);
  const [reviews, outcomes] = await Promise.all([
    prisma.review.groupBy({ by: ['type', 'status'], where: { companyId, cycleId: id }, _count: { _all: true } }),
    prisma.reviewOutcome.groupBy({ by: ['status'], where: { companyId, cycleId: id }, _count: { _all: true } }),
  ]);
  const progress: Record<string, { total: number; submitted: number }> = {
    SELF: { total: 0, submitted: 0 },
    MANAGER: { total: 0, submitted: 0 },
    PEER: { total: 0, submitted: 0 },
  };
  for (const r of reviews) {
    const p = progress[r.type] ?? { total: 0, submitted: 0 };
    p.total += r._count._all;
    if (r.status === 'SUBMITTED') p.submitted += r._count._all;
    progress[r.type] = p;
  }
  return {
    ...cycle,
    progress,
    outcomes: Object.fromEntries(outcomes.map((o) => [o.status, o._count._all])),
  };
}

export async function cycleReviews(companyId: string, id: string, filter: { type?: string; status?: string }) {
  await getCycleOrThrow(companyId, id);
  const rows = await prisma.review.findMany({
    where: { companyId, cycleId: id, ...(filter.type ? { type: filter.type } : {}), ...(filter.status ? { status: filter.status } : {}) },
    include: { employee: { select: { id: true, name: true, department: true, designation: true } } },
    orderBy: [{ employee: { name: 'asc' } }, { type: 'asc' }],
  });
  const reviewers = await employeeNames(companyId, rows.map((r) => r.reviewerId));
  return rows.map((r) => ({ ...r, reviewer: r.reviewerId ? (reviewers.get(r.reviewerId) ?? null) : null }));
}

// ---------------------------------------------------------------------------
// Reviews (writing)
// ---------------------------------------------------------------------------

/** Which review types may be written in each phase. */
const WRITABLE: Record<string, string[]> = {
  SELF_REVIEW: ['SELF', 'MANAGER', 'PEER'],
  MANAGER_REVIEW: ['SELF', 'MANAGER', 'PEER'],
};

async function goalsInPeriod(companyId: string, employeeId: string, cycle: { periodStart: Date; periodEnd: Date }) {
  return prisma.goal.findMany({
    where: { companyId, employeeId, dueDate: { gte: cycle.periodStart, lte: cycle.periodEnd } },
    orderBy: { dueDate: 'asc' },
  });
}

/** Reviews I must write, my own (self) reviews and my published outcomes. */
export async function myReviews(companyId: string, employeeId: string) {
  const [toWrite, outcomes] = await Promise.all([
    prisma.review.findMany({
      where: { companyId, reviewerId: employeeId, cycle: { status: { in: ['SELF_REVIEW', 'MANAGER_REVIEW', 'CALIBRATION', 'CLOSED'] } } },
      include: {
        cycle: true,
        employee: { select: { id: true, name: true, designation: true, department: true, avatarColor: true } },
      },
      orderBy: [{ cycle: { periodStart: 'desc' } }, { type: 'asc' }],
    }),
    prisma.reviewOutcome.findMany({
      where: { companyId, employeeId, status: { in: ['APPROVED', 'APPLIED'] }, cycle: { status: 'CLOSED' } },
      include: { cycle: { select: { id: true, name: true, periodStart: true, periodEnd: true, ratingScale: true } } },
      orderBy: { cycle: { periodStart: 'desc' } },
    }),
  ]);
  return {
    self: toWrite.filter((r) => r.type === 'SELF'),
    team: toWrite.filter((r) => r.type === 'MANAGER'),
    peer: toWrite.filter((r) => r.type === 'PEER'),
    outcomes: outcomes.map(({ remarks, normalizedRating, ...o }) => ({
      ...o,
      // The calibrated rating is the one that counts.
      finalRating: normalizedRating ?? o.finalRating,
      remarks,
    })),
  };
}

/** A review with what the writer needs: the reviewee's goals for the period and (for managers) the self review. */
export async function getReview(companyId: string, id: string, actor: Actor) {
  const review = await prisma.review.findFirst({
    where: { id, companyId },
    include: {
      cycle: true,
      employee: { select: { id: true, name: true, designation: true, department: true, managerId: true, avatarColor: true } },
    },
  });
  if (!review) throw ApiError.notFound('Review not found');
  const hr = isHrAdmin(actor.role);
  const isReviewer = review.reviewerId === actor.employeeId;
  const isReviewee = review.employeeId === actor.employeeId;
  const isManager = review.employee.managerId === actor.employeeId;
  const closed = review.cycle.status === 'CLOSED';
  if (!(hr || isReviewer || isManager || (isReviewee && (review.type === 'SELF' || closed)))) {
    throw ApiError.forbidden('You do not have access to this review');
  }
  const goals = await goalsInPeriod(companyId, review.employeeId, review.cycle);
  let selfReview = null;
  if (review.type !== 'SELF' && (hr || isManager)) {
    selfReview = await prisma.review.findFirst({
      where: { companyId, cycleId: review.cycleId, employeeId: review.employeeId, type: 'SELF', status: 'SUBMITTED' },
    });
  }
  const names = await employeeNames(companyId, [review.reviewerId]);
  // Peer reviewers stay anonymous to the reviewee.
  const showReviewer = !(isReviewee && review.type === 'PEER' && !hr);
  return {
    ...review,
    reviewerId: showReviewer ? review.reviewerId : null,
    reviewer: showReviewer && review.reviewerId ? (names.get(review.reviewerId) ?? null) : null,
    goals,
    selfReview,
    canEdit: isReviewer && (WRITABLE[review.cycle.status] ?? []).includes(review.type),
  };
}

export interface SubmitReviewInput {
  rating?: number;
  strengths: string;
  improvements: string;
  comments: string;
  goalRatings: { goalId: string; rating: number; comment?: string }[];
  draft: boolean;
}

export async function submitReview(companyId: string, id: string, actor: Actor, input: SubmitReviewInput) {
  const me = requireEmployee(actor);
  const review = await prisma.review.findFirst({ where: { id, companyId }, include: { cycle: true, employee: { select: { name: true, managerId: true } } } });
  if (!review) throw ApiError.notFound('Review not found');
  if (review.reviewerId !== me) throw ApiError.forbidden('Only the assigned reviewer can write this review');
  if (!(WRITABLE[review.cycle.status] ?? []).includes(review.type)) {
    throw ApiError.badRequest(`This cycle is in ${review.cycle.status.replace('_', ' ').toLowerCase()} — reviews are locked`);
  }
  const scale = review.cycle.ratingScale;
  if (!input.draft && input.rating === undefined) throw ApiError.badRequest('An overall rating is required to submit');
  if (input.rating !== undefined && input.rating > scale) throw ApiError.badRequest(`Ratings are on a 1–${scale} scale`);

  const goals = await goalsInPeriod(companyId, review.employeeId, review.cycle);
  const goalMap = new Map(goals.map((g) => [g.id, g]));
  const goalRatings = input.goalRatings.map((gr) => {
    const goal = goalMap.get(gr.goalId);
    if (!goal) throw ApiError.badRequest('A goal rating refers to a goal outside this review period');
    if (gr.rating > scale) throw ApiError.badRequest(`Ratings are on a 1–${scale} scale`);
    return { goalId: gr.goalId, title: goal.title, rating: gr.rating, ...(gr.comment ? { comment: gr.comment } : {}) };
  });

  const wasSubmitted = review.status === 'SUBMITTED';
  const after = await prisma.review.update({
    where: { id },
    data: {
      rating: input.rating ?? null,
      strengths: input.strengths,
      improvements: input.improvements,
      comments: input.comments,
      goalRatings,
      // A submitted review stays submitted while the phase is open (edits allowed).
      status: input.draft && !wasSubmitted ? 'PENDING' : 'SUBMITTED',
      submittedAt: input.draft && !wasSubmitted ? null : (review.submittedAt ?? new Date()),
    },
  });
  if (!input.draft && !wasSubmitted) {
    if (review.type === 'SELF' && review.employee.managerId) {
      await notify(companyId, [review.employee.managerId], {
        event: 'review.self_submitted',
        title: 'Self review submitted',
        body: `${review.employee.name} submitted their self review for ${review.cycle.name}.`,
        link: '/reviews',
      });
    }
  }
  return after;
}

/** HR or the employee's manager nominates up to 3 peer reviewers. */
export async function addPeers(companyId: string, cycleId: string, actor: Actor, input: { employeeId: string; reviewerIds: string[] }) {
  const cycle = await getCycleOrThrow(companyId, cycleId);
  if (!cycle.includePeer) throw ApiError.badRequest('Peer reviews are not enabled for this cycle');
  if (!['SELF_REVIEW', 'MANAGER_REVIEW'].includes(cycle.status)) throw ApiError.badRequest('Peers can only be added while reviews are open');
  const employee = await prisma.employee.findFirst({ where: { id: input.employeeId, companyId, isActive: true } });
  if (!employee) throw ApiError.badRequest('Employee not found in this company');
  if (!isHrAdmin(actor.role) && employee.managerId !== actor.employeeId) {
    throw ApiError.forbidden('Only HR or the employee’s manager can add peer reviewers');
  }
  const reviewerIds = [...new Set(input.reviewerIds)];
  if (reviewerIds.includes(input.employeeId)) throw ApiError.badRequest('An employee cannot peer-review themselves');
  const valid = await prisma.employee.count({ where: { companyId, isActive: true, id: { in: reviewerIds } } });
  if (valid !== reviewerIds.length) throw ApiError.badRequest('One or more reviewers were not found in this company');
  const existing = await prisma.review.findMany({ where: { companyId, cycleId, employeeId: input.employeeId, type: 'PEER' } });
  const fresh = reviewerIds.filter((r) => !existing.some((e) => e.reviewerId === r));
  if (existing.length + fresh.length > MAX_PEERS) {
    throw ApiError.badRequest(`At most ${MAX_PEERS} peer reviewers per employee (${existing.length} already assigned)`);
  }
  if (fresh.length) {
    await prisma.review.createMany({
      data: fresh.map((reviewerId) => ({ companyId, cycleId, employeeId: input.employeeId, reviewerId, type: 'PEER' })),
    });
    await notify(companyId, fresh, {
      event: 'review.peer_requested',
      title: 'Peer review requested',
      body: `Please share a peer review for ${employee.name} (${cycle.name}).`,
      link: '/reviews',
    });
  }
  return prisma.review.findMany({ where: { companyId, cycleId, employeeId: input.employeeId, type: 'PEER' } });
}

export async function removePeer(companyId: string, id: string, actor: Actor) {
  const review = await prisma.review.findFirst({ where: { id, companyId }, include: { employee: { select: { managerId: true } } } });
  if (!review) throw ApiError.notFound('Review not found');
  if (review.type !== 'PEER') throw ApiError.badRequest('Only peer reviews can be removed');
  if (review.status === 'SUBMITTED') throw ApiError.badRequest('This peer review has already been submitted');
  if (!isHrAdmin(actor.role) && review.employee.managerId !== actor.employeeId) throw ApiError.forbidden();
  await prisma.review.delete({ where: { id } });
  return review;
}

// ---------------------------------------------------------------------------
// Calibration & outcomes
// ---------------------------------------------------------------------------

export async function calibration(companyId: string, cycleId: string) {
  const cycle = await getCycleOrThrow(companyId, cycleId);
  const [reviews, outcomes] = await Promise.all([
    prisma.review.findMany({
      where: { companyId, cycleId, status: 'SUBMITTED' },
      select: { employeeId: true, type: true, rating: true },
    }),
    prisma.reviewOutcome.findMany({
      where: { companyId, cycleId },
      include: { employee: { select: { id: true, name: true, employeeCode: true, department: true, designation: true, managerId: true } } },
      orderBy: { employee: { name: 'asc' } },
    }),
  ]);
  const managers = await employeeNames(companyId, outcomes.map((o) => o.employee.managerId));
  const rows = outcomes.map((o) => {
    const mine = reviews.filter((r) => r.employeeId === o.employeeId && r.rating !== null);
    const peers = mine.filter((r) => r.type === 'PEER').map((r) => r.rating as number);
    const effective = o.normalizedRating ?? o.finalRating;
    return {
      ...o,
      manager: o.employee.managerId ? (managers.get(o.employee.managerId) ?? null) : null,
      selfRating: mine.find((r) => r.type === 'SELF')?.rating ?? null,
      managerRating: mine.find((r) => r.type === 'MANAGER')?.rating ?? null,
      peerRating: peers.length ? Math.round((peers.reduce((s, x) => s + x, 0) / peers.length) * 10) / 10 : null,
      effectiveRating: effective,
      suggestedIncrement: suggestedIncrement(effective, cycle.ratingScale),
    };
  });

  const target = targetDistribution(cycle.ratingScale);
  const rated = rows.filter((r) => r.effectiveRating !== null);
  const distribution = target.map((pct, i) => {
    const rating = i + 1;
    const count = rated.filter((r) => Math.min(cycle.ratingScale, Math.max(1, Math.round(r.effectiveRating as number))) === rating).length;
    return {
      rating,
      count,
      actualPercent: rated.length ? Math.round((count / rated.length) * 1000) / 10 : 0,
      targetPercent: pct,
      targetCount: Math.round((pct / 100) * rated.length),
    };
  });
  return { cycle, rows, distribution, rated: rated.length, total: rows.length, incrementMatrix: INCREMENT_MATRIX };
}

export interface OutcomeInput {
  finalRating?: number | null;
  normalizedRating?: number | null;
  incrementPercent?: number;
  promotion?: boolean;
  newDesignation?: string;
  remarks?: string;
}

async function getOutcomeOrThrow(companyId: string, id: string) {
  const outcome = await prisma.reviewOutcome.findFirst({ where: { id, companyId }, include: { cycle: true } });
  if (!outcome) throw ApiError.notFound('Outcome not found');
  return outcome;
}

export async function updateOutcome(companyId: string, id: string, input: OutcomeInput) {
  const before = await getOutcomeOrThrow(companyId, id);
  if (before.cycle.status !== 'CALIBRATION') throw ApiError.badRequest('Outcomes can only be edited during calibration');
  if (before.status !== 'PROPOSED') throw ApiError.badRequest(`This outcome is already ${before.status.toLowerCase()}`);
  const scale = before.cycle.ratingScale;
  for (const r of [input.finalRating, input.normalizedRating]) {
    if (r !== undefined && r !== null && r > scale) throw ApiError.badRequest(`Ratings are on a 1–${scale} scale`);
  }
  const promotion = input.promotion ?? before.promotion;
  const newDesignation = input.newDesignation ?? before.newDesignation;
  if (promotion && !newDesignation.trim()) throw ApiError.badRequest('Enter the new designation for a promotion');

  const data: Prisma.ReviewOutcomeUpdateInput = { ...input, newDesignation: promotion ? newDesignation : '' };
  // Re-suggest the increment when the rating moves and HR didn't set one explicitly.
  const ratingChanged = input.finalRating !== undefined || input.normalizedRating !== undefined;
  if (ratingChanged && input.incrementPercent === undefined) {
    const effective = (input.normalizedRating !== undefined ? input.normalizedRating : before.normalizedRating) ??
      (input.finalRating !== undefined ? input.finalRating : before.finalRating);
    data.incrementPercent = suggestedIncrement(effective, scale);
  }
  const { cycle: _c, ...plain } = before;
  const after = await prisma.reviewOutcome.update({ where: { id }, data });
  return { before: plain, after };
}

export async function approveOutcomes(companyId: string, cycleId: string, ids?: string[]) {
  const cycle = await getCycleOrThrow(companyId, cycleId);
  if (!['CALIBRATION', 'CLOSED'].includes(cycle.status)) throw ApiError.badRequest('Outcomes are approved during calibration');
  const where: Prisma.ReviewOutcomeWhereInput = {
    companyId,
    cycleId,
    status: 'PROPOSED',
    OR: [{ finalRating: { not: null } }, { normalizedRating: { not: null } }],
    ...(ids?.length ? { id: { in: ids } } : {}),
  };
  const toApprove = await prisma.reviewOutcome.findMany({ where, select: { id: true } });
  const result = await prisma.reviewOutcome.updateMany({ where: { id: { in: toApprove.map((o) => o.id) } }, data: { status: 'APPROVED' } });
  const skipped = ids?.length ? ids.length - result.count : await prisma.reviewOutcome.count({ where: { companyId, cycleId, status: 'PROPOSED' } });
  return { approved: result.count, approvedIds: toApprove.map((o) => o.id), skipped };
}

/**
 * APPROVED → APPLIED: increments go through the salary-revision service
 * (`applyIncrement`), a promotion updates the employee's designation.
 */
export async function applyOutcome(
  companyId: string,
  id: string,
  actor: Actor,
  opts: { effectiveFrom?: Date; req?: Request | null }
) {
  const outcome = await getOutcomeOrThrow(companyId, id);
  if (outcome.status !== 'APPROVED') throw ApiError.badRequest('Only an approved outcome can be applied');
  const claimed = await prisma.reviewOutcome.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'APPLIED' } });
  if (claimed.count === 0) throw ApiError.conflict('This outcome is already being applied');
  const effectiveFrom = dateOnlyUTC(opts.effectiveFrom ?? new Date());
  const reason = `${outcome.cycle.name} review outcome`;
  let designationChange: { before: string; after: string } | null = null;
  try {
    // Promotion first: it is idempotent, so a failed increment can simply be retried.
    if (outcome.promotion && outcome.newDesignation) {
      const employee = await prisma.employee.findFirst({ where: { id: outcome.employeeId, companyId } });
      if (employee) {
        const master = await prisma.designation.findFirst({ where: { companyId, name: outcome.newDesignation } });
        await prisma.employee.update({
          where: { id: employee.id },
          data: { designation: outcome.newDesignation, ...(master ? { designationId: master.id } : {}) },
        });
        designationChange = { before: employee.designation, after: outcome.newDesignation };
        // Career history (skipped on a retry, when the designation is already the new one).
        if (employee.designation !== outcome.newDesignation) {
          await recordHistory(prisma, {
            companyId,
            employeeId: employee.id,
            type: 'PROMOTION',
            effectiveDate: effectiveFrom,
            title: `Promotion: ${employee.designation || '—'} → ${outcome.newDesignation}`,
            from: { designation: employee.designation, designationId: employee.designationId },
            to: { designation: outcome.newDesignation, designationId: master?.id ?? employee.designationId },
            reason,
            refType: 'ReviewOutcome',
            refId: outcome.id,
            createdById: actor.employeeId,
          });
        }
      }
    }
    if (outcome.incrementPercent > 0) {
      await applyIncrement(companyId, outcome.employeeId, outcome.incrementPercent, effectiveFrom, reason, {
        employeeId: actor.employeeId,
        req: opts.req ?? null,
      });
    }
  } catch (err) {
    await prisma.reviewOutcome.update({ where: { id }, data: { status: 'APPROVED' } });
    throw err;
  }
  await notify(companyId, [outcome.employeeId], {
    event: 'review.outcome_applied',
    title: 'Your review outcome has been applied',
    body: [
      outcome.incrementPercent > 0 ? `${outcome.incrementPercent}% increment effective ${effectiveFrom.toISOString().slice(0, 10)}` : '',
      designationChange ? `promotion to ${designationChange.after}` : '',
    ].filter(Boolean).join(' and ') || 'Your review cycle outcome is final.',
    link: '/reviews',
  });
  const { cycle: _c, ...plain } = outcome;
  return { before: plain, after: { ...plain, status: 'APPLIED' }, designationChange };
}

// ---------------------------------------------------------------------------
// Reminders (daily job)
// ---------------------------------------------------------------------------

/** Nudges reviewers with pending reviews when a due date is ≤ 3 days away (or up to a week overdue). */
export async function sendReminders(companyId: string, today = dateOnlyUTC()): Promise<number> {
  const cycles = await prisma.reviewCycle.findMany({ where: { companyId, status: { in: ['SELF_REVIEW', 'MANAGER_REVIEW'] } } });
  let sent = 0;
  const near = (due: Date | null) => {
    if (!due) return false;
    const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
    return days <= 3 && days >= -7;
  };
  for (const cycle of cycles) {
    const types: string[] = [];
    if (cycle.status === 'SELF_REVIEW' && near(cycle.selfReviewDue)) types.push('SELF');
    if (near(cycle.managerReviewDue)) types.push('MANAGER', 'PEER');
    if (cycle.status === 'MANAGER_REVIEW' && near(cycle.selfReviewDue) && !types.includes('SELF')) types.push('SELF');
    if (!types.length) continue;
    const pending = await prisma.review.findMany({
      where: { companyId, cycleId: cycle.id, status: 'PENDING', type: { in: types } },
      select: { reviewerId: true, type: true },
    });
    for (const type of types) {
      const recipients = pending.filter((p) => p.type === type).map((p) => p.reviewerId);
      if (!recipients.length) continue;
      const due = type === 'SELF' ? cycle.selfReviewDue : cycle.managerReviewDue;
      await notify(companyId, recipients, {
        event: 'review.reminder',
        title: `${cycle.name}: ${type.toLowerCase()} review pending`,
        body: `Please complete your pending ${type.toLowerCase()} review${due ? ` (due ${due.toISOString().slice(0, 10)})` : ''}.`,
        link: '/reviews',
      });
      sent += new Set(recipients).size;
    }
  }
  return sent;
}
