import { ApiError, h, ok } from '../utils/http';
import { ctx, isManagerial } from '../middleware/auth';
import { addMonths, monthStart } from '../utils/finance';
import * as loanService from '../services/loan.service';
import type { ApplyLoanInput } from '../services/loan.service';

export const list = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { scope, status, type } = req.query as unknown as { scope: 'me' | 'team' | 'company'; status?: string; type?: string };
  if (scope === 'team' && !isManagerial(auth.role)) throw ApiError.forbidden();
  if (scope === 'company' && !(auth.role === 'SUPER_ADMIN' || auth.role === 'ADMIN' || auth.role === 'HR' || auth.role === 'FINANCE')) throw ApiError.forbidden();
  ok(res, await loanService.list(tenantId, { scope, status, type, employeeId: auth.employeeId }));
});

/** EMI + projected schedule for the apply form (no persistence). */
export const emiPreview = h(async (req, res) => {
  const { principal, tenureMonths, interestRate } = req.query as unknown as { principal: number; tenureMonths: number; interestRate: number };
  const schedule = loanService.projectedSchedule(principal, interestRate, tenureMonths, addMonths(monthStart(), 1));
  const total = loanService.totalRepayable(principal, interestRate, tenureMonths);
  ok(res, {
    emi: loanService.computeEmi(principal, interestRate, tenureMonths),
    totalRepayable: total,
    totalInterest: total - principal,
    schedule,
  });
});

export const detail = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await loanService.detail(tenantId, req.params.id as string, auth));
});

export const apply = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await loanService.apply(tenantId, auth, req.body as ApplyLoanInput, req), 201);
});

export const cancel = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await loanService.cancel(tenantId, req.params.id as string, auth, req));
});

export const decide = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const body = req.body as { decision: 'APPROVED' | 'REJECTED'; remarks?: string; interestRate?: number; startMonth?: string };
  ok(res, await loanService.decide(tenantId, req.params.id as string, { ...body, actor: auth }, req));
});

export const foreclose = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { remarks } = req.body as { remarks: string };
  ok(res, await loanService.foreclose(tenantId, req.params.id as string, remarks, req));
});
