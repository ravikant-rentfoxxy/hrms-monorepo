import type { Request } from 'express';
import { h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow } from '../middleware/auth';
import { audit, diff } from '../lib/audit';
import * as reviewService from '../services/review.service';
import type { CycleInput, OutcomeInput, SubmitReviewInput } from '../services/review.service';
import type { Actor } from '../services/talent.helpers';

const actorOf = (req: Request): Actor => {
  const { auth } = ctx(req);
  return { role: auth.role, employeeId: auth.employeeId };
};
const id = (req: Request): string => req.params.id as string;

// ---- Cycles ----

export const listCycles = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await reviewService.listCycles(tenantId, actorOf(req)));
});

export const createCycle = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const cycle = await reviewService.createCycle(tenantId, req.body as CycleInput);
  await audit(req, { entity: 'ReviewCycle', entityId: cycle.id, action: 'CREATE', after: cycle });
  ok(res, cycle, 201);
});

export const getCycle = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await reviewService.cycleDetail(tenantId, id(req)));
});

export const updateCycle = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await reviewService.updateCycle(tenantId, id(req), req.body as Partial<CycleInput>);
  await audit(req, { entity: 'ReviewCycle', entityId: after.id, action: 'UPDATE', ...diff(before, after) });
  ok(res, after);
});

export const deleteCycle = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const cycle = await reviewService.deleteCycle(tenantId, id(req));
  await audit(req, { entity: 'ReviewCycle', entityId: cycle.id, action: 'DELETE', before: cycle });
  ok(res, { deleted: true });
});

export const launchCycle = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const result = await reviewService.launchCycle(tenantId, id(req));
  await audit(req, {
    entity: 'ReviewCycle',
    entityId: result.cycle.id,
    action: 'LAUNCH',
    before: { status: 'DRAFT' },
    after: { status: result.cycle.status, reviewsCreated: result.created },
  });
  ok(res, result);
});

export const advanceCycle = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await reviewService.advanceCycle(tenantId, id(req));
  await audit(req, { entity: 'ReviewCycle', entityId: after.id, action: 'STATUS', before: { status: before.status }, after: { status: after.status } });
  ok(res, after);
});

export const syncCycle = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await reviewService.syncCycle(tenantId, id(req)));
});

export const cycleReviews = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await reviewService.cycleReviews(tenantId, id(req), req.query as { type?: string; status?: string }));
});

export const addPeers = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await reviewService.addPeers(tenantId, id(req), actorOf(req), req.body as { employeeId: string; reviewerIds: string[] }), 201);
});

// ---- Reviews ----

export const myReviews = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await reviewService.myReviews(tenantId, employeeIdOrThrow(req)));
});

export const getReview = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await reviewService.getReview(tenantId, id(req), actorOf(req)));
});

export const submitReview = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await reviewService.submitReview(tenantId, id(req), actorOf(req), req.body as SubmitReviewInput));
});

export const removePeer = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const review = await reviewService.removePeer(tenantId, id(req), actorOf(req));
  await audit(req, { entity: 'Review', entityId: review.id, action: 'DELETE', before: { type: review.type, reviewerId: review.reviewerId } });
  ok(res, { deleted: true });
});

// ---- Calibration & outcomes ----

export const calibration = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await reviewService.calibration(tenantId, id(req)));
});

export const updateOutcome = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await reviewService.updateOutcome(tenantId, id(req), req.body as OutcomeInput);
  await audit(req, { entity: 'ReviewOutcome', entityId: after.id, action: 'UPDATE', ...diff(before, after) });
  ok(res, after);
});

export const approveOutcomes = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { ids } = req.body as { ids?: string[] };
  const result = await reviewService.approveOutcomes(tenantId, id(req), ids);
  for (const outcomeId of result.approvedIds) {
    await audit(req, { entity: 'ReviewOutcome', entityId: outcomeId, action: 'APPROVE', before: { status: 'PROPOSED' }, after: { status: 'APPROVED' } });
  }
  ok(res, { approved: result.approved, skipped: result.skipped });
});

export const applyOutcome = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { effectiveFrom } = req.body as { effectiveFrom?: Date };
  const result = await reviewService.applyOutcome(tenantId, id(req), actorOf(req), { effectiveFrom, req });
  await audit(req, {
    entity: 'ReviewOutcome',
    entityId: result.after.id,
    action: 'APPLY',
    before: { status: 'APPROVED', designation: result.designationChange?.before },
    after: {
      status: 'APPLIED',
      incrementPercent: result.after.incrementPercent,
      designation: result.designationChange?.after,
    },
  });
  ok(res, result.after);
});
