import type { Role } from '@prisma/client';
import { h, ok } from '../utils/http';
import { ctx } from '../middleware/auth';
import { audit } from '../lib/audit';
import * as approvalService from '../services/approval.service';
import * as inboxService from '../services/approval-inbox.service';
import type { ApprovalModule, FlowStep } from '../services/approval.service';

const actorOf = (auth: { role: Role; employeeId: string | null }) => ({
  role: auth.role,
  employeeId: auth.employeeId,
});

export const listFlows = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await inboxService.flowsWithNames(tenantId));
});

export const saveFlow = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const module = req.params.module as ApprovalModule;
  const before = (await approvalService.listFlows(tenantId)).find((f) => f.module === module);
  const { steps } = req.body as { steps: FlowStep[] };
  const flow = await inboxService.saveFlowChecked(tenantId, module, steps);
  await audit(req, { entity: 'ApprovalFlow', entityId: module, action: 'UPDATE', before: before?.steps, after: flow.steps });
  ok(res, flow);
});

export const resetFlow = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const module = req.params.module as ApprovalModule;
  const before = (await approvalService.listFlows(tenantId)).find((f) => f.module === module);
  await approvalService.resetFlow(tenantId, module);
  if (before?.isCustom) {
    await audit(req, { entity: 'ApprovalFlow', entityId: module, action: 'RESET', before: before.steps, after: [{ type: 'MANAGER' }] });
  }
  ok(res, { reset: true });
});

/** Requests waiting on the caller (any role — named approvers can be plain employees). */
export const inbox = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { module, all } = req.query as unknown as { module?: ApprovalModule; all: boolean };
  ok(res, await inboxService.inbox(tenantId, actorOf(auth), { module, all }));
});

export const inboxCounts = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await inboxService.inboxCounts(tenantId, actorOf(auth)));
});

export const trail = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const module = req.params.module as ApprovalModule;
  ok(res, await inboxService.trailFor(tenantId, module, req.params.requestId as string, actorOf(auth)));
});
