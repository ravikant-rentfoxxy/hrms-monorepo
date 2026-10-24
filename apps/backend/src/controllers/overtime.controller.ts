import type { RequestStatus } from '@prisma/client';
import { ApiError, h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow, isManagerial } from '../middleware/auth';
import { audit } from '../lib/audit';
import * as overtimeService from '../services/overtime.service';
import type { OvertimeInput } from '../services/overtime.service';

export const list = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const q = req.query as unknown as { scope: 'me' | 'team' | 'company'; status?: RequestStatus; from?: Date; to?: Date };
  if (q.scope === 'team' && !isManagerial(auth.role)) throw ApiError.forbidden();
  if (q.scope === 'company' && !(auth.role === 'SUPER_ADMIN' || auth.role === 'ADMIN' || auth.role === 'HR')) {
    throw ApiError.forbidden();
  }
  ok(res, await overtimeService.listRequests(tenantId, { ...q, employeeId: auth.employeeId }));
});

export const get = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await overtimeService.getRequest(tenantId, req.params.id as string, auth));
});

export const create = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await overtimeService.createRequest(tenantId, employeeIdOrThrow(req), req.body as OvertimeInput), 201);
});

export const cancel = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await overtimeService.cancelRequest(tenantId, employeeIdOrThrow(req), req.params.id as string));
});

/** Any role may call; the approval engine decides whether this actor can act on the current level. */
export const decide = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { decision, remarks } = req.body as { decision: 'APPROVED' | 'REJECTED'; remarks?: string };
  const result = await overtimeService.decideRequest(tenantId, req.params.id as string, { decision, remarks, actor: auth });
  await audit(req, {
    entity: 'OvertimeRequest',
    entityId: result.request.id,
    action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
    after: { status: result.request.status, outcome: result.outcome, remarks, payrollInput: result.payrollInput },
  });
  ok(res, result);
});
