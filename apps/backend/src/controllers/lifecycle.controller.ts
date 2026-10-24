import { h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow } from '../middleware/auth';
import * as lifecycleService from '../services/lifecycle.service';
import type { LifecycleStage } from '../services/lifecycle.service';

/** Stage counts; `?stage=` returns that stage's drill-down list instead. */
export const pipeline = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { stage } = req.query as { stage?: LifecycleStage };
  ok(res, stage ? await lifecycleService.stageItems(tenantId, stage) : await lifecycleService.pipeline(tenantId));
});

export const myTimeline = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await lifecycleService.timeline(tenantId, auth, employeeIdOrThrow(req)));
});

export const timeline = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await lifecycleService.timeline(tenantId, auth, req.params.id as string));
});
