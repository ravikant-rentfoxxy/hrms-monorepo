import { h, ok } from '../utils/http';
import { ctx } from '../middleware/auth';
import { audit } from '../lib/audit';
import * as confirmationService from '../services/confirmation.service';
import type { Recommendation } from '../services/confirmation.service';

export const list = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await confirmationService.list(tenantId, auth, req.query as { status?: string }));
});

export const detail = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await confirmationService.detail(tenantId, req.params.id as string, auth));
});

export const create = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { employeeId, dueDate } = req.body as { employeeId: string; dueDate?: Date };
  const created = await confirmationService.createRequest(tenantId, employeeId, dueDate);
  await audit(req, { entity: 'ConfirmationRequest', entityId: created.id, action: 'CREATE', after: created });
  ok(res, created, 201);
});

export const recommend = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const body = req.body as { recommendation: Recommendation; extendByDays?: number; comments: string };
  const updated = await confirmationService.recommend(tenantId, req.params.id as string, auth, body);
  await audit(req, { entity: 'ConfirmationRequest', entityId: updated.id, action: 'RECOMMEND', after: body });
  ok(res, updated);
});

export const decide = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { decision, remarks } = req.body as { decision: 'APPROVED' | 'REJECTED'; remarks?: string };
  const updated = await confirmationService.decide(tenantId, req.params.id as string, auth, decision, remarks);
  await audit(req, {
    entity: 'ConfirmationRequest',
    entityId: updated.id,
    action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
    after: { status: updated.status, recommendation: updated.recommendation, remarks },
  });
  ok(res, updated);
});
