import { ApiError, h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow, isManagerial } from '../middleware/auth';
import { audit } from '../lib/audit';
import * as travelService from '../services/travel.service';
import type { ListFilter, TravelInput } from '../services/travel.service';

export const list = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const filter = req.query as unknown as ListFilter;
  const companyWide = auth.role === 'SUPER_ADMIN' || auth.role === 'ADMIN' || auth.role === 'HR';
  if (filter.scope === 'team' && !isManagerial(auth.role)) throw ApiError.forbidden();
  if ((filter.scope === 'company' || filter.advancesDue) && !companyWide) throw ApiError.forbidden();
  if ((filter.scope === 'me' || filter.scope === 'team') && !auth.employeeId) {
    throw ApiError.forbidden('This account has no employee profile');
  }
  ok(res, await travelService.listRequests(tenantId, auth, filter));
});

export const get = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await travelService.getRequest(tenantId, req.params.id as string, auth));
});

export const apply = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const request = await travelService.applyTravel(tenantId, employeeIdOrThrow(req), req.body as TravelInput);
  await audit(req, { entity: 'TravelRequest', entityId: request.id, action: 'CREATE', after: request });
  ok(res, request, 201);
});

export const cancel = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const request = await travelService.cancelRequest(tenantId, employeeIdOrThrow(req), req.params.id as string);
  await audit(req, { entity: 'TravelRequest', entityId: request.id, action: 'CANCEL', before: { status: 'PENDING' }, after: { status: request.status } });
  ok(res, request);
});

export const decide = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { decision, remarks } = req.body as { decision: 'APPROVED' | 'REJECTED'; remarks?: string };
  const result = await travelService.decideRequest(tenantId, req.params.id as string, { decision, remarks, actor: auth });
  await audit(req, {
    entity: 'TravelRequest',
    entityId: result.request.id,
    action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
    after: { outcome: result.outcome, status: result.request.status, remarks: remarks ?? null },
  });
  ok(res, result);
});

export const settlementPreview = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await travelService.settlementPreview(tenantId, req.params.id as string));
});

export const settle = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { claimIds } = req.body as { claimIds?: string[] };
  const result = await travelService.settle(tenantId, req.params.id as string, claimIds);
  await audit(req, {
    entity: 'TravelRequest',
    entityId: result.request.id,
    action: 'SETTLE',
    after: { claimIds: result.claimIds, claimsTotal: result.claimsTotal, advance: result.advance, settledAmount: result.settledAmount },
  });
  ok(res, result);
});
