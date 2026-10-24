import type { RequestStatus } from '@prisma/client';
import { ApiError, h, ok } from '../utils/http';
import { audit } from '../lib/audit';
import { ctx, employeeIdOrThrow, isManagerial } from '../middleware/auth';
import * as expenseService from '../services/expense.service';
import type { ExpenseInput } from '../services/expense.service';

export const list = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { status, scope } = req.query as unknown as { status?: RequestStatus; scope: 'me' | 'company' };
  if (scope === 'company' && !isManagerial(auth.role)) throw ApiError.forbidden();
  ok(res, await expenseService.listExpenses(tenantId, { status, scope, employeeId: auth.employeeId }));
});

export const create = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const receipt = req.file
    ? { originalname: req.file.originalname, mimetype: req.file.mimetype, buffer: req.file.buffer }
    : undefined;
  ok(res, await expenseService.createExpense(tenantId, employeeIdOrThrow(req), req.body as ExpenseInput, receipt), 201);
});

export const receipt = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(
    res,
    await expenseService.receiptUrl(tenantId, req.params.id as string, {
      employeeId: auth.employeeId,
      canViewAll: isManagerial(auth.role),
    })
  );
});

export const decide = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { decision, remarks } = req.body as { decision: 'APPROVED' | 'REJECTED'; remarks?: string };
  const result = await expenseService.decideExpense(tenantId, req.params.id as string, { decision, remarks, actor: auth });
  await audit(req, {
    entity: 'ExpenseClaim',
    entityId: result.id,
    // APPROVE_LEVEL = one level approved, more levels to go.
    action: result.approvalOutcome === 'PENDING' ? 'APPROVE_LEVEL' : decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
    before: { status: 'PENDING' },
    after: { status: result.status, level: result.approvedLevel, amount: result.amount, remarks: remarks ?? null },
  });
  ok(res, result);
});

export const cancel = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await expenseService.cancelExpense(tenantId, employeeIdOrThrow(req), req.params.id as string));
});
