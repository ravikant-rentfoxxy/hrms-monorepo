import type { RequestStatus } from '@prisma/client';
import { ApiError, h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow } from '../middleware/auth';
import { audit, diff } from '../lib/audit';
import * as leaveService from '../services/leave.service';
import * as ledgerService from '../services/leave-ledger.service';
import * as compOffService from '../services/leave-compoff.service';
import * as encashmentService from '../services/leave-encashment.service';
import type { ApplyLeaveInput, LeaveTypeInput } from '../services/leave.service';
import type { AdjustInput, OpeningInput } from '../services/leave-ledger.service';

type Scope = 'me' | 'team' | 'company' | 'approvals';
type Decision = { decision: 'APPROVED' | 'REJECTED'; remarks?: string };

const isCompanyAdmin = (role: string) => role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR';

/** Scope guard shared by the request lists. */
function checkScope(role: string, scope: Scope) {
  if (scope === 'team' && !(isCompanyAdmin(role) || role === 'MANAGER')) throw ApiError.forbidden();
  if (scope === 'company' && !isCompanyAdmin(role)) throw ApiError.forbidden();
}

// ---- Types ----

export const listTypes = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const all = req.query.all === 'true' || req.query.all === '1';
  ok(res, await leaveService.listTypes(tenantId, all && isCompanyAdmin(auth.role)));
});

export const createType = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const type = await leaveService.createType(tenantId, req.body as LeaveTypeInput);
  await audit(req, { entity: 'LeaveType', entityId: type.id, action: 'CREATE', after: type });
  ok(res, type, 201);
});

export const updateType = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await leaveService.updateType(tenantId, req.params.id as string, req.body as Partial<LeaveTypeInput>);
  await audit(req, { entity: 'LeaveType', entityId: after.id, action: 'UPDATE', ...diff(before, after) });
  ok(res, after);
});

// ---- Balances & ledger ----

/** Own data, or another employee's when the actor manages them / is HR. */
async function targetEmployee(req: Parameters<Parameters<typeof h>[0]>[0], requested: unknown) {
  const { auth, tenantId } = ctx(req);
  if (typeof requested === 'string' && requested !== auth.employeeId) {
    await leaveService.assertCanView(tenantId, auth, requested);
    return requested;
  }
  if (!auth.employeeId) throw ApiError.badRequest('employeeId required');
  return auth.employeeId;
}

export const balance = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { employeeId, year } = req.query as unknown as { employeeId?: string; year?: number };
  ok(res, await ledgerService.balances(tenantId, await targetEmployee(req, employeeId), year));
});

export const ledger = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const q = req.query as unknown as { employeeId?: string; year?: number; leaveTypeId?: string };
  ok(res, await ledgerService.ledger(tenantId, await targetEmployee(req, q.employeeId), { year: q.year, leaveTypeId: q.leaveTypeId }));
});

export const employees = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await leaveService.viewableEmployees(tenantId, auth));
});

export const adjust = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const input = req.body as AdjustInput;
  const result = await ledgerService.adjust(tenantId, auth.employeeId, input);
  await audit(req, { entity: 'LeaveLedger', entityId: result.entry.id, action: 'ADJUST', after: result.entry });
  ok(res, result, 201);
});

export const opening = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const result = await ledgerService.setOpening(tenantId, auth.employeeId, req.body as OpeningInput);
  await audit(req, { entity: 'LeaveLedger', entityId: result.entry.id, action: 'OPENING', before: result.replaced, after: result.entry });
  ok(res, result.entry, 201);
});

export const liability = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await ledgerService.leaveLiability(tenantId));
});

// ---- Requests ----

export const list = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { status, scope, year } = req.query as unknown as { status?: RequestStatus; scope: Scope; year?: number };
  checkScope(auth.role, scope);
  ok(res, await leaveService.listRequests(tenantId, { status, scope, year, employeeId: auth.employeeId, role: auth.role }));
});

export const get = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await leaveService.getRequest(tenantId, auth, req.params.id as string));
});

export const preview = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await leaveService.previewLeave(tenantId, employeeIdOrThrow(req), req.body as ApplyLeaveInput));
});

export const apply = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await leaveService.applyLeave(tenantId, employeeIdOrThrow(req), req.body as ApplyLeaveInput), 201);
});

export const cancel = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const result = await leaveService.cancelRequest(tenantId, auth, req.params.id as string);
  if (result && result.employeeId !== auth.employeeId) {
    await audit(req, { entity: 'LeaveRequest', entityId: result.id, action: 'CANCEL', after: { status: result.status } });
  }
  ok(res, result);
});

export const decide = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { decision, remarks } = req.body as Decision;
  const result = await leaveService.decideRequest(tenantId, req.params.id as string, { decision, remarks, actor: auth });
  await audit(req, {
    entity: 'LeaveRequest', entityId: req.params.id as string, action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
    after: { outcome: result.outcome, remarks },
  });
  ok(res, result);
});

export const calendar = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const q = req.query as unknown as { year: number; month: number; scope: 'team' | 'company' };
  ok(res, await leaveService.calendar(tenantId, auth, q));
});

// ---- Comp-off ----

export const listCompOff = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { status, scope } = req.query as unknown as { status?: RequestStatus; scope: Scope };
  checkScope(auth.role, scope);
  ok(res, await compOffService.listCompOff(tenantId, { scope, status, actor: auth }));
});

export const requestCompOff = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await compOffService.requestCompOff(tenantId, employeeIdOrThrow(req), req.body as compOffService.CompOffInput), 201);
});

export const decideCompOff = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { decision, remarks } = req.body as Decision;
  const result = await compOffService.decideCompOff(tenantId, req.params.id as string, { decision, remarks, actor: auth });
  await audit(req, {
    entity: 'CompOffRequest', entityId: req.params.id as string, action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
    after: { outcome: result.outcome, remarks },
  });
  ok(res, result);
});

export const cancelCompOff = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const result = await compOffService.cancelCompOff(tenantId, auth, req.params.id as string);
  if (result && result.employeeId !== auth.employeeId) {
    await audit(req, { entity: 'CompOffRequest', entityId: result.id, action: 'CANCEL', after: { status: result.status } });
  }
  ok(res, result);
});

// ---- Encashment ----

export const listEncashments = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { status, scope } = req.query as unknown as { status?: RequestStatus; scope: Scope };
  checkScope(auth.role, scope);
  ok(res, await encashmentService.listEncashments(tenantId, { scope, status, actor: auth }));
});

export const requestEncashment = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const body = req.body as { leaveTypeId: string; days: number; reason?: string };
  ok(res, await encashmentService.requestEncashment(tenantId, employeeIdOrThrow(req), body), 201);
});

export const decideEncashment = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { decision, remarks } = req.body as Decision;
  const result = await encashmentService.decideEncashment(tenantId, req.params.id as string, { decision, remarks, actor: auth });
  await audit(req, {
    entity: 'LeaveEncashment', entityId: req.params.id as string, action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
    after: { outcome: result.outcome, amount: result.amount, remarks },
  });
  ok(res, result);
});

export const cancelEncashment = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const result = await encashmentService.cancelEncashment(tenantId, auth, req.params.id as string);
  await audit(req, { entity: 'LeaveEncashment', entityId: req.params.id as string, action: 'CANCEL', after: { status: result?.status } });
  ok(res, result);
});
