import type { Request } from 'express';
import { h, ok } from '../utils/http';
import { ctx } from '../middleware/auth';
import { audit, diff } from '../lib/audit';
import * as requisitionService from '../services/requisition.service';
import type { RequisitionInput } from '../services/requisition.service';
import type { Actor } from '../services/talent.helpers';

const actorOf = (req: Request): Actor => {
  const { auth } = ctx(req);
  return { role: auth.role, employeeId: auth.employeeId };
};
const id = (req: Request): string => req.params.id as string;

export const list = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await requisitionService.list(tenantId, actorOf(req), req.query as { status?: string; scope?: 'mine' | 'all' }));
});

export const get = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await requisitionService.get(tenantId, id(req), actorOf(req)));
});

export const create = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const r = await requisitionService.create(tenantId, actorOf(req), req.body as RequisitionInput & { submit?: boolean });
  await audit(req, { entity: 'JobRequisition', entityId: r.id, action: 'CREATE', after: r });
  ok(res, r, 201);
});

export const update = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await requisitionService.update(tenantId, id(req), actorOf(req), req.body as Partial<RequisitionInput>);
  await audit(req, { entity: 'JobRequisition', entityId: after.id, action: 'UPDATE', ...diff(before, after) });
  ok(res, after);
});

export const submit = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const r = await requisitionService.submitRequisition(tenantId, id(req), actorOf(req));
  await audit(req, { entity: 'JobRequisition', entityId: r.id, action: 'SUBMIT', after: { status: r.status } });
  ok(res, r);
});

export const review = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await requisitionService.review(tenantId, id(req), actorOf(req), req.body as { note: string; sendBack?: boolean });
  await audit(req, {
    entity: 'JobRequisition',
    entityId: after.id,
    action: (req.body as { sendBack?: boolean }).sendBack ? 'SEND_BACK' : 'REVIEW_NOTE',
    before: { status: before.status, hrReviewNote: before.hrReviewNote },
    after: { status: after.status, hrReviewNote: after.hrReviewNote },
  });
  ok(res, after);
});

/** Approvals-inbox decide endpoint (no requireRole — the approval engine decides who may act). */
export const decide = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { decision, remarks } = req.body as { decision: 'APPROVED' | 'REJECTED'; remarks?: string };
  const result = await requisitionService.decide(tenantId, id(req), actorOf(req), decision, remarks);
  await audit(req, {
    entity: 'JobRequisition',
    entityId: id(req),
    action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
    after: { outcome: result.outcome, remarks, jobId: result.job?.id, jobCode: result.job?.code },
  });
  ok(res, result);
});

export const cancel = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await requisitionService.cancel(tenantId, id(req), actorOf(req), (req.body as { reason?: string }).reason);
  await audit(req, { entity: 'JobRequisition', entityId: after.id, action: 'CANCEL', before: { status: before.status }, after: { status: after.status } });
  ok(res, after);
});
