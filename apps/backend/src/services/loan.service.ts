/**
 * Employee loans and salary advances.
 *
 *   PENDING ──(approval chain LOAN)──▶ ACTIVE ──(EMIs via payroll / foreclose)──▶ CLOSED
 *      └──▶ REJECTED / CANCELLED
 *
 * EMI: flat principal ÷ tenure for 0% loans, otherwise the reducing-balance
 * formula P·r·(1+r)^n / ((1+r)^n − 1) with r = annual rate / 12. On approval
 * the loan becomes ACTIVE with `startMonth` (first EMI month) and `balance`
 * (principal, or EMI × tenure for interest-bearing loans). The payroll engine
 * deducts min(emi, balance) each month from startMonth, writes a LoanRepayment
 * row and reduces the balance.
 */
import type { Request } from 'express';
import type { Loan, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';
import { addMonths, monthStart, parseMonth } from '../utils/finance';
import * as approvalService from './approval.service';

export type LoanType = 'LOAN' | 'SALARY_ADVANCE';

export interface ApplyLoanInput {
  type: LoanType;
  principal: number;
  tenureMonths?: number;
  reason: string;
  /** ADMIN/HR applying on behalf of an employee. */
  employeeId?: string;
  interestRate?: number;
}

export interface Actor {
  role: Role;
  employeeId: string | null;
}

export const MAX_LOAN_TENURE = 60;
export const MAX_ADVANCE_TENURE = 3;
/** Principal cap as a multiple of monthly gross (ADMIN may exceed it). */
export const MAX_GROSS_MULTIPLE = 3;

/** Company-wide loan handling: HR and Finance (plus Admin). */
const isHr = (role: Role) => role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR' || role === 'FINANCE';

/** Monthly instalment, rounded up to the rupee for flat loans so the balance clears within the tenure. */
export function computeEmi(principal: number, annualRatePct: number, tenureMonths: number): number {
  if (principal <= 0 || tenureMonths <= 0) return 0;
  if (!annualRatePct) return Math.ceil(principal / tenureMonths);
  const r = annualRatePct / 12 / 100;
  const f = Math.pow(1 + r, tenureMonths);
  return Math.round((principal * r * f) / (f - 1));
}

/** Amount to be recovered in total (principal + interest). */
export function totalRepayable(principal: number, annualRatePct: number, tenureMonths: number): number {
  if (!annualRatePct) return principal;
  return computeEmi(principal, annualRatePct, tenureMonths) * tenureMonths;
}

export interface ScheduleRow {
  installment: number;
  month: Date;
  emi: number;
  interest: number;
  principal: number;
  closingBalance: number;
}

/** Projected amortisation (reducing balance; flat for 0%), last EMI adjusted to clear the loan. */
export function projectedSchedule(principal: number, annualRatePct: number, tenureMonths: number, startMonth: Date): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  const emi = computeEmi(principal, annualRatePct, tenureMonths);
  const r = annualRatePct / 12 / 100;
  let outstanding = principal;
  for (let i = 0; i < tenureMonths && outstanding > 0.5; i++) {
    const interest = Math.round(outstanding * r);
    let principalPart = emi - interest;
    if (i === tenureMonths - 1 || principalPart > outstanding) principalPart = outstanding;
    outstanding = Math.max(0, outstanding - principalPart);
    rows.push({
      installment: i + 1,
      month: addMonths(startMonth, i),
      emi: Math.round(principalPart + interest),
      interest,
      principal: Math.round(principalPart),
      closingBalance: Math.round(outstanding),
    });
  }
  return rows;
}

const employeeSelect = { id: true, name: true, employeeCode: true, department: true, managerId: true } as const;

async function monthlyGross(companyId: string, employeeId: string) {
  const e = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    select: { isActive: true, salaryBasic: true, salaryHra: true, salaryConveyance: true, salaryMedical: true, salaryAllowance: true },
  });
  if (!e) throw ApiError.notFound('Employee not found');
  if (!e.isActive) throw ApiError.badRequest('Employee is inactive');
  return e.salaryBasic + e.salaryHra + e.salaryConveyance + e.salaryMedical + e.salaryAllowance;
}

// ---- Queries ----

export async function list(
  companyId: string,
  filter: { scope: 'me' | 'team' | 'company'; status?: string; type?: string; employeeId: string | null }
) {
  let who: object = { employeeId: filter.employeeId ?? '' };
  if (filter.scope === 'team') who = { employee: { managerId: filter.employeeId ?? '' } };
  else if (filter.scope === 'company') who = {};
  const loans = await prisma.loan.findMany({
    where: {
      companyId,
      ...who,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.type ? { type: filter.type } : {}),
    },
    include: { employee: { select: employeeSelect }, _count: { select: { repayments: true } } },
    orderBy: { appliedOn: 'desc' },
    take: 500,
  });
  // The current approval step, so the UI can show "awaiting <who>".
  const pending = loans.filter((l) => l.status === 'PENDING').map((l) => l.id);
  const steps = pending.length
    ? await prisma.approvalStep.findMany({ where: { companyId, module: 'LOAN', requestId: { in: pending }, status: 'PENDING' }, orderBy: { level: 'asc' } })
    : [];
  return loans.map((l) => {
    const step = steps.find((s) => s.requestId === l.id);
    return { ...l, currentStep: step ? { level: step.level, approverRole: step.approverRole, approverEmployeeId: step.approverEmployeeId } : null };
  });
}

/** Loan + projected schedule vs actual repayments + approval trail. */
export async function detail(companyId: string, id: string, actor: Actor) {
  const loan = await prisma.loan.findFirst({
    where: { id, companyId },
    include: { employee: { select: employeeSelect }, repayments: { orderBy: { month: 'asc' } } },
  });
  if (!loan) throw ApiError.notFound('Loan not found');
  if (!isHr(actor.role) && loan.employeeId !== actor.employeeId) {
    let allowed = actor.role === 'MANAGER' && loan.employee.managerId === actor.employeeId;
    if (!allowed && loan.status === 'PENDING') {
      const step = await approvalService.currentStep(companyId, 'LOAN', id);
      allowed = !!step && approvalService.canAct(step, actor);
    }
    if (!allowed) throw ApiError.forbidden();
  }
  const start = loan.startMonth ?? addMonths(monthStart(), 1);
  const projected = projectedSchedule(loan.principal, loan.interestRate, loan.tenureMonths, start);
  const paid = loan.repayments.reduce((s, r) => s + r.amount, 0);
  const schedule = projected.map((p) => {
    const actual = loan.repayments.find((r) => r.month.getTime() === p.month.getTime());
    return { ...p, paid: actual?.amount ?? null, payslipId: actual?.payslipId ?? null };
  });
  // Repayments outside the projection (e.g. a skipped month pushed the schedule) are listed too.
  const extra = loan.repayments.filter((r) => !projected.some((p) => p.month.getTime() === r.month.getTime()));
  return {
    ...loan,
    totalRepayable: totalRepayable(loan.principal, loan.interestRate, loan.tenureMonths),
    totalInterest: totalRepayable(loan.principal, loan.interestRate, loan.tenureMonths) - loan.principal,
    paid,
    schedule,
    extraRepayments: extra,
    trail: await approvalService.trail(companyId, 'LOAN', id),
  };
}

// ---- Apply / cancel ----

export async function apply(companyId: string, actor: Actor, input: ApplyLoanInput, req: Request) {
  const onBehalf = !!input.employeeId && input.employeeId !== actor.employeeId;
  if (onBehalf && !isHr(actor.role)) throw ApiError.forbidden('Only ADMIN/HR can apply on behalf of an employee');
  const employeeId = input.employeeId ?? actor.employeeId;
  if (!employeeId) throw ApiError.forbidden('This account has no employee profile');

  const tenure = input.tenureMonths ?? (input.type === 'SALARY_ADVANCE' ? 1 : 12);
  const maxTenure = input.type === 'SALARY_ADVANCE' ? MAX_ADVANCE_TENURE : MAX_LOAN_TENURE;
  if (tenure < 1 || tenure > maxTenure) {
    throw ApiError.badRequest(`${input.type === 'SALARY_ADVANCE' ? 'Salary advance' : 'Loan'} tenure must be 1–${maxTenure} months`);
  }
  const interestRate = isHr(actor.role) ? (input.interestRate ?? 0) : 0; // employees can't set the rate
  if (input.type === 'SALARY_ADVANCE' && interestRate > 0) throw ApiError.badRequest('Salary advances are interest-free');

  const gross = await monthlyGross(companyId, employeeId);
  const isAdmin = actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN';
  if (!isAdmin) {
    if (gross <= 0) throw ApiError.badRequest('No salary structure on file — contact HR');
    const cap = MAX_GROSS_MULTIPLE * gross;
    if (input.principal > cap) {
      throw ApiError.badRequest(`Maximum amount is ${MAX_GROSS_MULTIPLE}× monthly gross (₹${Math.floor(cap).toLocaleString('en-IN')})`);
    }
  }
  const open = await prisma.loan.findFirst({ where: { companyId, employeeId, type: input.type, status: 'PENDING' } });
  if (open) throw ApiError.conflict(`There is already a pending ${input.type === 'SALARY_ADVANCE' ? 'salary advance' : 'loan'} request`);
  if (input.type === 'SALARY_ADVANCE') {
    const active = await prisma.loan.findFirst({ where: { companyId, employeeId, type: 'SALARY_ADVANCE', status: 'ACTIVE' } });
    if (active) throw ApiError.conflict('An earlier salary advance is still being recovered');
  }

  const emi = computeEmi(input.principal, interestRate, tenure);
  const loan = await prisma.loan.create({
    data: {
      companyId,
      employeeId,
      type: input.type,
      principal: input.principal,
      interestRate,
      tenureMonths: tenure,
      emi,
      balance: input.principal,
      reason: input.reason,
      status: 'PENDING',
    },
  });
  await approvalService.start(companyId, 'LOAN', loan.id, employeeId);
  await audit(req, { entity: 'Loan', entityId: loan.id, action: 'CREATE', after: loan });
  return loan;
}

export async function cancel(companyId: string, id: string, actor: Actor, req: Request) {
  const loan = await prisma.loan.findFirst({ where: { id, companyId } });
  if (!loan) throw ApiError.notFound('Loan not found');
  if (loan.employeeId !== actor.employeeId && !isHr(actor.role)) throw ApiError.forbidden();
  if (loan.status !== 'PENDING') throw ApiError.badRequest('Only pending requests can be cancelled');
  await approvalService.cancel(companyId, 'LOAN', id);
  const updated = await prisma.loan.update({ where: { id }, data: { status: 'CANCELLED' } });
  await audit(req, { entity: 'Loan', entityId: id, action: 'CANCEL', before: { status: loan.status }, after: { status: 'CANCELLED' } });
  return updated;
}

// ---- Decide ----

export interface DecideLoanInput {
  decision: 'APPROVED' | 'REJECTED';
  remarks?: string;
  /** ADMIN/HR only: interest rate (% p.a.) and first EMI month ("2026-11"). */
  interestRate?: number;
  startMonth?: string;
  actor: Actor;
}

export async function decide(companyId: string, id: string, input: DecideLoanInput, req: Request) {
  const loan = await prisma.loan.findFirst({ where: { id, companyId } });
  if (!loan) throw ApiError.notFound('Loan not found');
  if (loan.status !== 'PENDING') throw ApiError.badRequest(`Request is already ${loan.status.toLowerCase()}`);
  const hr = isHr(input.actor.role);
  if (!hr && (input.interestRate !== undefined || input.startMonth !== undefined)) {
    throw ApiError.forbidden('Only ADMIN/HR can set the interest rate or start month');
  }
  if (loan.type === 'SALARY_ADVANCE' && (input.interestRate ?? 0) > 0) throw ApiError.badRequest('Salary advances are interest-free');
  let startOverride: Date | null = null;
  if (input.startMonth) {
    startOverride = parseMonth(input.startMonth);
    if (startOverride < monthStart()) throw ApiError.badRequest('Start month cannot be in the past');
  }

  const r = await approvalService.act(companyId, 'LOAN', loan.id, loan.employeeId, input.actor, input.decision, input.remarks);
  const rate = input.interestRate ?? loan.interestRate;

  if (r.outcome === 'PENDING') {
    // HR may set terms at an intermediate level; they carry to the final approval.
    const updated = await prisma.loan.update({
      where: { id },
      data: { interestRate: rate, emi: computeEmi(loan.principal, rate, loan.tenureMonths) },
    });
    await audit(req, { entity: 'Loan', entityId: id, action: 'APPROVE_STEP', after: { level: r.step.level, interestRate: rate } });
    return { ...updated, outcome: r.outcome };
  }
  if (r.outcome === 'REJECTED') {
    const updated = await prisma.loan.update({
      where: { id },
      data: { status: 'REJECTED', approverId: input.actor.employeeId, remarks: input.remarks ?? null },
    });
    await audit(req, { entity: 'Loan', entityId: id, action: 'REJECT', before: { status: 'PENDING' }, after: { status: 'REJECTED', remarks: input.remarks } });
    await notify(companyId, [loan.employeeId], {
      event: 'loan.rejected',
      title: `${loan.type === 'SALARY_ADVANCE' ? 'Salary advance' : 'Loan'} request rejected`,
      body: input.remarks ? `Remarks: ${input.remarks}` : 'Your request was rejected.',
      link: '/loans',
    });
    return { ...updated, outcome: r.outcome };
  }

  const startMonth = startOverride ?? addMonths(monthStart(), 1);
  const emi = computeEmi(loan.principal, rate, loan.tenureMonths);
  const updated = await prisma.loan.update({
    where: { id },
    data: {
      status: 'ACTIVE',
      interestRate: rate,
      emi,
      startMonth,
      balance: totalRepayable(loan.principal, rate, loan.tenureMonths),
      approverId: input.actor.employeeId,
      remarks: input.remarks ?? null,
    },
  });
  await audit(req, { entity: 'Loan', entityId: id, action: 'APPROVE', before: loan, after: updated });
  await notify(companyId, [loan.employeeId], {
    event: 'loan.approved',
    title: `${loan.type === 'SALARY_ADVANCE' ? 'Salary advance' : 'Loan'} approved`,
    body: `₹${loan.principal.toLocaleString('en-IN')} approved. EMI ₹${emi.toLocaleString('en-IN')} × ${loan.tenureMonths} from ${startMonth.toISOString().slice(0, 7)}.`,
    link: '/loans',
  });
  return { ...updated, outcome: r.outcome };
}

// ---- Foreclosure ----

/** HR closes an ACTIVE loan early (repaid outside payroll / written off); EMIs stop. */
export async function foreclose(companyId: string, id: string, remarks: string, req: Request): Promise<Loan> {
  const loan = await prisma.loan.findFirst({ where: { id, companyId } });
  if (!loan) throw ApiError.notFound('Loan not found');
  if (loan.status !== 'ACTIVE') throw ApiError.badRequest('Only active loans can be closed');
  // Refuse while an unpublished payslip already carries this loan's EMI (the run would double-count).
  const inFlight = await prisma.loanRepayment.findFirst({
    where: { loanId: id, payslipId: { not: null } },
    orderBy: { month: 'desc' },
  });
  if (inFlight?.payslipId) {
    const slip = await prisma.payslip.findUnique({ where: { id: inFlight.payslipId }, select: { status: true } });
    if (slip && slip.status !== 'PUBLISHED') throw ApiError.conflict('A payroll run in progress includes this EMI — publish or discard it first');
  }
  const updated = await prisma.loan.update({
    where: { id },
    data: {
      status: 'CLOSED',
      balance: 0,
      remarks: `Foreclosed with ₹${Math.round(loan.balance).toLocaleString('en-IN')} outstanding: ${remarks}`,
    },
  });
  await audit(req, { entity: 'Loan', entityId: id, action: 'FORECLOSE', before: { status: loan.status, balance: loan.balance }, after: { status: 'CLOSED', balance: 0, remarks } });
  await notify(companyId, [loan.employeeId], {
    event: 'loan.closed',
    title: 'Loan closed',
    body: `Your ${loan.type === 'SALARY_ADVANCE' ? 'salary advance' : 'loan'} was closed. ${remarks}`,
    link: '/loans',
  });
  return updated;
}
