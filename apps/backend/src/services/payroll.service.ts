/**
 * Payroll engine: monthly runs (DRAFT → LOCKED → APPROVED → PUBLISHED, then paid), payslip
 * computation with Indian statutory deductions, payslip visibility and PDF.
 *
 * Per employee-month:
 *   earned component = fixed component ÷ working days × payable days
 *   earnings   = earned structure + the month's PayrollInputs (bonus, incentive,
 *                arrear, reimbursement, overtime, leave encashment, other)
 *   deductions = PF, ESI, Professional Tax, LWF, TDS (annual projection),
 *                DEDUCTION / LOAN_EMI inputs, EMIs of ACTIVE loans
 *   employer   = Employer PF (EPS / EPF), Employer ESI, Employer LWF
 *
 * Payslips of a non-published run are DRAFT and hidden from employees.
 * Publishing is final: published payslips are immutable — corrections go in
 * as PayrollInputs (ARREAR / DEDUCTION) of the next month. Publishing also
 * posts loan repayments and stamps the consumed PayrollInputs.
 *
 * Every line item carries a machine `code` (BASIC, HRA, PF, ESI, PT, TDS,
 * LOAN, EPS, ...) and statutory wage bases (`wages`) so exports (ECR, ESI
 * return, Form 16) can be produced from the stored payslips alone.
 */
import PDFDocument from 'pdfkit';
import { Prisma, type Loan, type PayrollInput } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';
import { workingDays as weekdaysBetween } from '../utils/geo';
import { decryptField } from '../utils/fieldCrypto';
import { presignedGetUrl, putObject, FILE_LINK_TTL_SECONDS } from '../lib/storage';
import { sendMail } from '../lib/mailer';
import { letterhead } from './company-profile.service';
import { payableDaysForMonth } from './attendance.service';
import {
  computeMonthlyStatutory, computePf, fyOf, fyMonthsRemaining, fyRange, loadStatutoryContext, stateFor,
  type StatutoryContext,
} from './statutory.service';
import {
  emptyFacts, loadTaxContext, payslipTaxFacts, priorFacts, projectTax, type TaxComputation, type TaxContext,
} from './tds.service';

const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

export interface PayItem {
  label: string;
  amount: number;
  /** Machine code: BASIC | HRA | CONVEYANCE | MEDICAL | SPECIAL | <input type> | PF | ESI | PT | LWF | TDS | LOAN | EPS | EPF | ESI_ER | LWF_ER. */
  code?: string;
  /** Earnings only; false = not taxable (e.g. reimbursements). */
  taxable?: boolean;
  /** Statutory wage base (PF: EPF wages, EPS: EPS wages, ESI: ESI wages). */
  wages?: number;
  /** PF line: EDLI wages. */
  edliWages?: number;
  /** PT line: state the slab came from. */
  state?: string;
  /** Source PayrollInput / Loan. */
  inputId?: string;
  loanId?: string;
}

export interface PayslipInput {
  employeeId: string;
  month: Date; // any day in the month; normalized to day 1
  earnings: PayItem[];
  deductions: PayItem[];
  workingDays: number;
  paidDays: number;
  paidOn: Date;
}

export const monthStart = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const monthEndDate = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
const nextMonth = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
const prevMonth = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
const monthLabel = (d: Date): string =>
  d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const items = (v: unknown): PayItem[] => (Array.isArray(v) ? (v as PayItem[]) : []);
const sum = (list: PayItem[]): number => list.reduce((s, i) => s + (typeof i.amount === 'number' ? i.amount : 0), 0);

/** PAN / bank numbers may be encrypted at rest. */
const revealPlain = (v: string | null | undefined): string => decryptField(v ?? '') ?? '';

/**
 * Attach gross / totalDeductions / net to a payslip row. Stored totals win;
 * legacy rows (stored 0) are summed from the line items.
 */
export function withTotals<T extends { earnings: unknown; deductions: unknown; gross?: number; totalDeductions?: number; netPay?: number }>(p: T) {
  const gross = p.gross || sum(items(p.earnings));
  const totalDeductions = p.totalDeductions || sum(items(p.deductions));
  const net = p.gross ? (p.netPay ?? gross - totalDeductions) : gross - totalDeductions;
  return { ...p, gross, totalDeductions, net, netPay: net };
}

/* ------------------------------ Payslip reads ------------------------------ */

export async function listPayslips(companyId: string, employeeId: string, opts: { includeDrafts?: boolean } = {}) {
  const payslips = await prisma.payslip.findMany({
    where: { companyId, employeeId, ...(opts.includeDrafts ? {} : { status: 'PUBLISHED' }) },
    orderBy: { month: 'desc' },
    take: 24,
  });
  return payslips.map(withTotals);
}

export async function getPayslip(companyId: string, id: string) {
  const payslip = await prisma.payslip.findFirst({
    where: { id, companyId },
    include: {
      employee: {
        select: {
          id: true, name: true, employeeCode: true, designation: true, department: true, pan: true, bankName: true,
          accountNumber: true, ifsc: true, uan: true, esiNumber: true, taxRegime: true, joiningDate: true,
        },
      },
      run: { select: { id: true, status: true } },
    },
  });
  if (!payslip) throw ApiError.notFound('Payslip not found');
  return {
    ...payslip,
    employee: {
      ...payslip.employee,
      pan: revealPlain(payslip.employee.pan),
      accountNumber: revealPlain(payslip.employee.accountNumber),
      uan: revealPlain(payslip.employee.uan),
    },
  };
}

/** Financial-year-to-date totals up to (and including) the payslip's month. */
export async function payslipYtd(companyId: string, employeeId: string, month: Date, includeId?: string) {
  const { start } = fyRange(fyOf(month));
  const slips = await prisma.payslip.findMany({
    where: {
      companyId,
      employeeId,
      month: { gte: start, lte: month },
      OR: [{ status: 'PUBLISHED' }, ...(includeId ? [{ id: includeId }] : [])],
    },
  });
  const t = slips.map(withTotals);
  const facts = t.reduce((acc, s) => {
    const f = payslipTaxFacts(s.earnings, s.deductions);
    return { pf: acc.pf + f.pf, tds: acc.tds + f.tds, pt: acc.pt + f.pt };
  }, { pf: 0, tds: 0, pt: 0 });
  return {
    fy: fyOf(month),
    months: t.length,
    gross: Math.round(t.reduce((s, p) => s + p.gross, 0)),
    deductions: Math.round(t.reduce((s, p) => s + p.totalDeductions, 0)),
    net: Math.round(t.reduce((s, p) => s + p.net, 0)),
    pf: Math.round(facts.pf),
    tds: Math.round(facts.tds),
    pt: Math.round(facts.pt),
  };
}

/** Payslip with totals + YTD (the detail view of the app / panel). */
export async function payslipDetail(companyId: string, id: string) {
  const p = await getPayslip(companyId, id);
  return { ...withTotals(p), ytd: await payslipYtd(companyId, p.employeeId, p.month, p.id) };
}

/* --------------------------- Manual payslip edits -------------------------- */

/** One-off manual payslip (no run for the month); published immediately. */
export async function createPayslip(companyId: string, input: PayslipInput) {
  const employee = await prisma.employee.findFirst({ where: { id: input.employeeId, companyId } });
  if (!employee) throw ApiError.badRequest('Employee not found in this company');
  const month = monthStart(input.month);
  const run = await prisma.payrollRun.findUnique({ where: { companyId_month: { companyId, month } } });
  if (run) {
    throw ApiError.conflict(`A payroll run exists for ${monthLabel(month)} — add a payroll input and recalculate instead`);
  }
  const existing = await prisma.payslip.findUnique({ where: { employeeId_month: { employeeId: input.employeeId, month } } });
  if (existing) throw ApiError.conflict('This employee already has a payslip for that month');
  const gross = sum(input.earnings);
  const totalDeductions = sum(input.deductions);
  const payslip = await prisma.payslip.create({
    data: {
      ...input,
      earnings: asJson(input.earnings),
      deductions: asJson(input.deductions),
      month,
      companyId,
      status: 'PUBLISHED',
      gross,
      totalDeductions,
      netPay: gross - totalDeductions,
      lopDays: Math.max(0, input.workingDays - input.paidDays),
    },
  });
  return withTotals(payslip);
}

/** Only DRAFT payslips of a DRAFT run (or run-less drafts) can be edited / deleted. */
async function editableDraft(companyId: string, id: string) {
  const payslip = await prisma.payslip.findFirst({ where: { id, companyId }, include: { run: true } });
  if (!payslip) throw ApiError.notFound('Payslip not found');
  if (payslip.status !== 'DRAFT') {
    throw ApiError.conflict('Published payslips are immutable — record a correction as a payroll input for the next month');
  }
  if (payslip.run && payslip.run.status !== 'DRAFT') throw ApiError.conflict('The payroll run is locked — unlock it first');
  return payslip;
}

/**
 * Manual edit of a draft payslip. Note: recalculating the run recomputes
 * the payslip and overwrites manual edits.
 */
export async function updatePayslip(companyId: string, id: string, input: Partial<Omit<PayslipInput, 'employeeId'>>) {
  const before = await editableDraft(companyId, id);
  const earnings = input.earnings ?? items(before.earnings);
  const deductions = input.deductions ?? items(before.deductions);
  const workingDays = input.workingDays ?? before.workingDays;
  const paidDays = input.paidDays ?? before.paidDays;
  const gross = sum(earnings);
  const totalDeductions = sum(deductions);
  const after = await prisma.payslip.update({
    where: { id },
    data: {
      earnings: asJson(earnings),
      deductions: asJson(deductions),
      workingDays,
      paidDays,
      ...(input.paidOn ? { paidOn: input.paidOn } : {}),
      gross,
      totalDeductions,
      netPay: gross - totalDeductions,
      lopDays: Math.max(0, workingDays - paidDays),
    },
  });
  if (before.runId) await refreshRunTotals(before.runId);
  return { before: withTotals(before), after: withTotals(after) };
}

export async function deletePayslip(companyId: string, id: string) {
  const before = await editableDraft(companyId, id);
  await prisma.payslip.delete({ where: { id } });
  if (before.runId) await refreshRunTotals(before.runId);
  return before;
}

/* ------------------------- Employee-month computation ---------------------- */

export const STRUCTURE_COMPONENTS = [
  { code: 'BASIC', label: 'Basic', field: 'salaryBasic' },
  { code: 'HRA', label: 'HRA', field: 'salaryHra' },
  { code: 'CONVEYANCE', label: 'Conveyance', field: 'salaryConveyance' },
  { code: 'MEDICAL', label: 'Medical Allowance', field: 'salaryMedical' },
  { code: 'SPECIAL', label: 'Special Allowance', field: 'salaryAllowance' },
] as const;

/** PayrollInput types paid as earnings; DEDUCTION / LOAN_EMI are deductions. */
export const EARNING_INPUT_TYPES = ['BONUS', 'INCENTIVE', 'ARREAR', 'REIMBURSEMENT', 'OVERTIME', 'LEAVE_ENCASHMENT', 'OTHER_EARNING'];
/** One-offs that are not ESI wages (annual bonus, reimbursements, leave encashment). */
const NON_ESI_INPUTS = new Set(['BONUS', 'REIMBURSEMENT', 'LEAVE_ENCASHMENT']);

const EMPLOYEE_SELECT = {
  id: true, name: true, employeeCode: true, department: true, joiningDate: true, leavingDate: true, isActive: true,
  gender: true, dateOfBirth: true, officeId: true, taxRegime: true,
  salaryBasic: true, salaryHra: true, salaryConveyance: true, salaryMedical: true, salaryAllowance: true,
  salaryPfEmployer: true, salaryPfEmployee: true,
} satisfies Prisma.EmployeeSelect;

export type PayrollEmployee = Prisma.EmployeeGetPayload<{ select: typeof EMPLOYEE_SELECT }>;

export interface ComputedPayslip {
  employeeId: string;
  earnings: PayItem[];
  deductions: PayItem[];
  employerContributions: PayItem[];
  gross: number;
  totalDeductions: number;
  netPay: number;
  workingDays: number;
  payableDays: number;
  lopDays: number;
  taxComputation: TaxComputation | null;
}

/**
 * Working days an employee could be paid for this month: the full norm, or a
 * weekday-proportional share for a mid-month joiner / leaver.
 */
export function employedWorkingDays(emp: Pick<PayrollEmployee, 'joiningDate' | 'leavingDate'>, month: Date, workingDays: number): number {
  const start = month;
  const end = monthEndDate(month);
  const from = emp.joiningDate > start ? emp.joiningDate : start;
  const to = emp.leavingDate && emp.leavingDate < end ? emp.leavingDate : end;
  if (from > to) return 0;
  if (from.getTime() === start.getTime() && to.getTime() === end.getTime()) return workingDays;
  const share = weekdaysBetween(from, to) / Math.max(1, weekdaysBetween(start, end));
  return Math.min(workingDays, Math.round(workingDays * share * 2) / 2);
}

/** Months after `month` the employee is still expected to be paid in the FY. */
function futureMonthsInFy(emp: Pick<PayrollEmployee, 'leavingDate'>, month: Date): number {
  let months = fyMonthsRemaining(month) - 1;
  if (emp.leavingDate) {
    const lm = monthStart(emp.leavingDate);
    const diff = (lm.getUTCFullYear() - month.getUTCFullYear()) * 12 + lm.getUTCMonth() - month.getUTCMonth();
    months = Math.max(0, Math.min(months, diff));
  }
  return months;
}

/**
 * Pure computation of one employee's payslip for a month (no DB access).
 * `loans` = ACTIVE loans due this month; `inputs` = unconsumed PayrollInputs of the month.
 */
export function computeEmployeeMonth(args: {
  month: Date;
  workingDays: number;
  payableDays: number;
  employee: PayrollEmployee;
  office: { state: string; isMetro: boolean } | null;
  stat: StatutoryContext;
  tax: TaxContext | null;
  inputs: Pick<PayrollInput, 'id' | 'type' | 'label' | 'amount' | 'taxable' | 'refId'>[];
  loans: Pick<Loan, 'id' | 'type' | 'emi' | 'balance'>[];
}): ComputedPayslip {
  const { month, workingDays, employee: e, stat } = args;
  const payableDays = Math.max(0, Math.min(workingDays, args.payableDays));
  const ratio = workingDays > 0 ? payableDays / workingDays : 0;
  const earn = (fixed: number) => Math.round(fixed * ratio);

  // Earnings
  const earnings: PayItem[] = [];
  for (const c of STRUCTURE_COMPONENTS) {
    const fixed = e[c.field];
    if (fixed > 0) earnings.push({ label: c.label, amount: earn(fixed), code: c.code, taxable: true });
  }
  const monthlyRate = STRUCTURE_COMPONENTS.reduce((s, c) => s + e[c.field], 0);
  let esiWages = sum(earnings);
  for (const i of args.inputs) {
    if (!EARNING_INPUT_TYPES.includes(i.type) || i.amount <= 0) continue;
    earnings.push({ label: i.label, amount: Math.round(i.amount), code: i.type, taxable: i.taxable, inputId: i.id });
    if (!NON_ESI_INPUTS.has(i.type)) esiWages += Math.round(i.amount);
  }
  const gross = sum(earnings);
  const earnedBasic = earnings.find((x) => x.code === 'BASIC')?.amount ?? 0;
  const earnedHra = earnings.find((x) => x.code === 'HRA')?.amount ?? 0;
  const state = stateFor(args.office?.state, stat.config);

  const s = computeMonthlyStatutory(stat, {
    month,
    state,
    gender: e.gender,
    dateOfBirth: e.dateOfBirth,
    earnedBasic,
    ratio,
    monthlyRate,
    esiWages,
    gross,
    pfEmployeeOverride: e.salaryPfEmployee,
    pfEmployerOverride: e.salaryPfEmployer,
  });

  const deductions: PayItem[] = [];
  if (s.pf.employee > 0) {
    deductions.push({ label: 'Provident Fund', amount: s.pf.employee, code: 'PF', wages: s.pf.epfWages, edliWages: s.pf.edliWages });
  }
  if (s.esi.employee > 0) deductions.push({ label: 'ESI', amount: s.esi.employee, code: 'ESI', wages: s.esi.wages });
  if (s.pt > 0) deductions.push({ label: 'Professional Tax', amount: s.pt, code: 'PT', state });
  if (s.lwf.employee > 0) deductions.push({ label: 'Labour Welfare Fund', amount: s.lwf.employee, code: 'LWF', state });
  const inputDeductions: PayItem[] = args.inputs
    .filter((i) => (i.type === 'DEDUCTION' || i.type === 'LOAN_EMI') && i.amount > 0)
    .map((i) => ({ label: i.label, amount: Math.round(i.amount), code: i.type, inputId: i.id }));

  // TDS on the annual projection.
  let taxComputation: TaxComputation | null = null;
  if (stat.config.tdsEnabled && args.tax) {
    const regime = e.taxRegime === 'OLD' ? 'OLD' : 'NEW';
    const rule = args.tax.rules.get(regime) ?? args.tax.rules.get('NEW');
    if (rule) {
      const current = { ...emptyFacts(), taxable: sum(earnings.filter((x) => x.taxable !== false)), basic: earnedBasic, hra: earnedHra, pf: s.pf.employee, pt: s.pt };
      const fullPf = computePf(stat.config, {
        earnedBasic: e.salaryBasic, ratio: 1, employeeOverride: e.salaryPfEmployee, employerOverride: e.salaryPfEmployer,
      });
      const future = { ...emptyFacts(), taxable: monthlyRate, basic: e.salaryBasic, hra: e.salaryHra, pf: fullPf.employee, pt: s.pt };
      taxComputation = projectTax({
        fy: args.tax.fy,
        month,
        regime,
        rule,
        prior: priorFacts(args.tax, e.id),
        current,
        future,
        futureMonths: futureMonthsInFy(e, month),
        declaration: args.tax.declarations.get(e.id) ?? null,
        isMetro: !!args.office?.isMetro,
      });
    }
  }
  const beforeTds = gross - sum(deductions) - sum(inputDeductions);
  const tds = taxComputation ? Math.min(taxComputation.monthlyTds, Math.max(0, beforeTds)) : 0;
  if (tds > 0) deductions.push({ label: 'TDS', amount: tds, code: 'TDS' });
  deductions.push(...inputDeductions);

  // Loan EMIs last, never pushing net pay below zero (the shortfall stays on the balance).
  const loanInputRefs = new Set(args.inputs.filter((i) => i.type === 'LOAN_EMI' && i.refId).map((i) => i.refId));
  let room = Math.max(0, gross - sum(deductions));
  for (const loan of args.loans) {
    if (loanInputRefs.has(loan.id)) continue; // already deducted through a LOAN_EMI input
    const due = Math.round(Math.min(loan.emi, loan.balance));
    const amount = Math.min(due, room);
    if (amount <= 0) continue;
    room -= amount;
    deductions.push({
      label: loan.type === 'SALARY_ADVANCE' ? 'Salary Advance Recovery' : 'Loan EMI',
      amount,
      code: 'LOAN',
      loanId: loan.id,
    });
  }

  const employerContributions: PayItem[] = [];
  if (s.pf.eps > 0) employerContributions.push({ label: 'Employer PF (EPS)', amount: s.pf.eps, code: 'EPS', wages: s.pf.epsWages });
  if (s.pf.epf > 0) employerContributions.push({ label: 'Employer PF (EPF)', amount: s.pf.epf, code: 'EPF', wages: s.pf.epfWages });
  if (s.esi.employer > 0) employerContributions.push({ label: 'Employer ESI', amount: s.esi.employer, code: 'ESI_ER', wages: s.esi.wages });
  if (s.lwf.employer > 0) employerContributions.push({ label: 'Employer LWF', amount: s.lwf.employer, code: 'LWF_ER', state });

  const totalDeductions = sum(deductions);
  return {
    employeeId: e.id,
    earnings,
    deductions,
    employerContributions,
    gross,
    totalDeductions,
    netPay: gross - totalDeductions,
    workingDays,
    payableDays,
    lopDays: Math.max(0, workingDays - payableDays),
    taxComputation,
  };
}

/* ------------------------------- Payroll runs ------------------------------ */

export interface RunTotals {
  employees: number;
  gross: number;
  deductions: number;
  net: number;
  employerContributions: number;
  employerCost: number;
  tds: number;
  lopDays: number;
  /** Eligible employees not paid this month (zero payable days). */
  zeroDays: number;
  /** Employees skipped: a published (manual / legacy) payslip exists, or their F&F settlement pays this month. */
  skipped: number;
}

async function refreshRunTotals(runId: string, extra: { zeroDays?: number; skipped?: number } = {}) {
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
  const slips = await prisma.payslip.findMany({ where: { runId } });
  const prev = (run.totals ?? {}) as Partial<RunTotals>;
  const totals: RunTotals = {
    employees: slips.length,
    gross: Math.round(slips.reduce((s, p) => s + p.gross, 0)),
    deductions: Math.round(slips.reduce((s, p) => s + p.totalDeductions, 0)),
    net: Math.round(slips.reduce((s, p) => s + p.netPay, 0)),
    employerContributions: Math.round(slips.reduce((s, p) => s + sum(items(p.employerContributions)), 0)),
    employerCost: 0,
    tds: Math.round(slips.reduce((s, p) => s + payslipTaxFacts(p.earnings, p.deductions).tds, 0)),
    lopDays: slips.reduce((s, p) => s + p.lopDays, 0),
    zeroDays: extra.zeroDays ?? prev.zeroDays ?? 0,
    skipped: extra.skipped ?? prev.skipped ?? 0,
  };
  totals.employerCost = totals.gross + totals.employerContributions;
  await prisma.payrollRun.update({ where: { id: runId }, data: { totals: asJson(totals) } });
  return totals;
}

/**
 * Creates (or refreshes) the month's DRAFT run and its DRAFT payslips for
 * every eligible employee: has a salary structure, joined on/before the
 * month end, not left before the month start. Employees with zero payable
 * days get no payslip. Refreshing replaces the run's draft payslips;
 * LOCKED / PUBLISHED runs cannot be refreshed.
 */
export async function generateRun(
  companyId: string,
  monthInput: Date,
  opts: { workingDays?: number; actorEmployeeId?: string | null } = {}
) {
  const month = monthStart(monthInput);
  const end = monthEndDate(month);
  const existingRun = await prisma.payrollRun.findUnique({ where: { companyId_month: { companyId, month } } });
  if (existingRun && existingRun.status !== 'DRAFT') {
    throw ApiError.conflict(`The ${monthLabel(month)} payroll is ${existingRun.status.toLowerCase()} — it can no longer be recalculated`);
  }

  const stat = await loadStatutoryContext(companyId);
  const [employees, offices, payable, existingSlips, inputs, loans] = await Promise.all([
    prisma.employee.findMany({
      where: {
        companyId,
        salaryBasic: { gt: 0 },
        joiningDate: { lte: end },
        AND: [
          { OR: [{ leavingDate: null }, { leavingDate: { gte: month } }] },
          { OR: [{ isActive: true }, { leavingDate: { gte: month } }] },
        ],
      },
      select: EMPLOYEE_SELECT,
      orderBy: { employeeCode: 'asc' },
    }),
    prisma.office.findMany({ where: { companyId }, select: { id: true, state: true, isMetro: true } }),
    payableDaysForMonth(companyId, month.getUTCFullYear(), month.getUTCMonth() + 1),
    prisma.payslip.findMany({ where: { companyId, month }, select: { id: true, employeeId: true, status: true, runId: true } }),
    prisma.payrollInput.findMany({ where: { companyId, month, payslipId: null } }),
    prisma.loan.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        balance: { gt: 0 },
        OR: [{ startMonth: null }, { startMonth: { lte: month } }],
        repayments: { none: { month } },
      },
      orderBy: { appliedOn: 'asc' },
    }),
  ]);
  if (employees.length === 0) {
    throw ApiError.badRequest('No eligible employees have a salary structure yet. Set salaries on their profiles first.');
  }

  const workingDays = opts.workingDays ?? existingRun?.workingDays ?? payable.workingDays;
  if (workingDays <= 0) throw ApiError.badRequest('Working days for the month must be at least 1');
  const payableBy = new Map(payable.items.map((i) => [i.employeeId, i.payable]));
  const officeBy = new Map(offices.map((o) => [o.id, o]));
  const published = new Set(existingSlips.filter((p) => p.status === 'PUBLISHED').map((p) => p.employeeId));
  // Leavers whose full & final settlement already pays this month's salary (item code SALARY) are not paid twice.
  const settlements = await prisma.finalSettlement.findMany({
    where: { companyId, employeeId: { in: employees.map((e) => e.id) }, lastWorkingDay: { gte: month, lte: end } },
    select: { employeeId: true, items: true },
  });
  const paidInFnf = new Set(
    settlements
      .filter((st) => Array.isArray(st.items) && (st.items as { code?: string }[]).some((i) => i?.code === 'SALARY'))
      .map((st) => st.employeeId)
  );
  const skippedIds = new Set([...published, ...paidInFnf]);
  const due = employees.filter((e) => !skippedIds.has(e.id));
  const tax = await loadTaxContext(companyId, fyOf(month), month, due.map((e) => e.id));

  const computed: ComputedPayslip[] = [];
  let zeroDays = 0;
  for (const e of due) {
    const cap = employedWorkingDays(e, month, workingDays);
    const days = Math.min(cap, payableBy.get(e.id) ?? 0);
    if (days <= 0) {
      zeroDays++;
      continue;
    }
    computed.push(
      computeEmployeeMonth({
        month,
        workingDays,
        payableDays: days,
        employee: e,
        office: e.officeId ? (officeBy.get(e.officeId) ?? null) : null,
        stat,
        tax,
        inputs: inputs.filter((i) => i.employeeId === e.id),
        loans: loans.filter((l) => l.employeeId === e.id),
      })
    );
  }

  const run = existingRun ?? (await prisma.payrollRun.create({
    data: { companyId, month, workingDays, status: 'DRAFT', createdById: opts.actorEmployeeId ?? null },
  }));
  const keep = new Set(computed.map((c) => c.employeeId));
  const paidOn = end;
  await prisma.$transaction([
    prisma.payrollRun.update({ where: { id: run.id }, data: { workingDays } }),
    // Drafts of employees no longer payable this month.
    prisma.payslip.deleteMany({ where: { companyId, month, status: 'DRAFT', employeeId: { notIn: [...keep] } } }),
    ...computed.map((c) => {
      const data = {
        earnings: asJson(c.earnings),
        deductions: asJson(c.deductions),
        employerContributions: asJson(c.employerContributions),
        workingDays: c.workingDays,
        paidDays: Math.round(c.payableDays),
        lopDays: c.lopDays,
        gross: c.gross,
        totalDeductions: c.totalDeductions,
        netPay: c.netPay,
        taxComputation: c.taxComputation ? asJson(c.taxComputation) : Prisma.DbNull,
        paidOn,
        runId: run.id,
        status: 'DRAFT',
      };
      return prisma.payslip.upsert({
        where: { employeeId_month: { employeeId: c.employeeId, month } },
        create: { ...data, companyId, employeeId: c.employeeId, month },
        update: data,
      });
    }),
  ]);
  const totals = await refreshRunTotals(run.id, { zeroDays, skipped: skippedIds.size });
  return { run: { ...run, workingDays, totals }, created: computed.length, zeroDays, skipped: skippedIds.size, eligible: employees.length };
}

export async function listRuns(companyId: string) {
  return prisma.payrollRun.findMany({ where: { companyId }, orderBy: { month: 'desc' }, take: 36 });
}

async function runOrThrow(companyId: string, id: string) {
  const run = await prisma.payrollRun.findFirst({ where: { id, companyId } });
  if (!run) throw ApiError.notFound('Payroll run not found');
  return run;
}

/** Run detail: totals, department split, employee lines with variance vs last month. */
export async function getRun(companyId: string, id: string) {
  const run = await runOrThrow(companyId, id);
  const [slips, previous] = await Promise.all([
    prisma.payslip.findMany({
      where: { runId: run.id },
      include: { employee: { select: { id: true, name: true, employeeCode: true, department: true, designation: true, bankName: true, accountNumber: true, ifsc: true } } },
      orderBy: { employee: { employeeCode: 'asc' } },
    }),
    prisma.payslip.findMany({
      where: { companyId, month: prevMonth(run.month), status: 'PUBLISHED' },
      select: { employeeId: true, gross: true, netPay: true, earnings: true, deductions: true, totalDeductions: true },
    }),
  ]);
  const prevBy = new Map(previous.map((p) => [p.employeeId, withTotals(p)]));
  const lines = slips.map((p) => {
    const prev = prevBy.get(p.employeeId);
    const facts = payslipTaxFacts(p.earnings, p.deductions);
    return {
      id: p.id,
      status: p.status,
      employee: {
        id: p.employee.id,
        name: p.employee.name,
        employeeCode: p.employee.employeeCode,
        department: p.employee.department,
        designation: p.employee.designation,
        hasBank: !!p.employee.accountNumber && !!p.employee.ifsc,
      },
      workingDays: p.workingDays,
      paidDays: p.paidDays,
      lopDays: p.lopDays,
      gross: p.gross,
      totalDeductions: p.totalDeductions,
      netPay: p.netPay,
      employerContributions: sum(items(p.employerContributions)),
      tds: facts.tds,
      pf: facts.pf,
      previousNet: prev ? prev.net : null,
      variance: prev ? Math.round(p.netPay - prev.net) : null,
    };
  });
  const byDepartment = new Map<string, { department: string; employees: number; gross: number; net: number; employerCost: number }>();
  for (const l of lines) {
    const key = l.employee.department || 'Unassigned';
    const d = byDepartment.get(key) ?? { department: key, employees: 0, gross: 0, net: 0, employerCost: 0 };
    d.employees++;
    d.gross += l.gross;
    d.net += l.netPay;
    d.employerCost += l.gross + l.employerContributions;
    byDepartment.set(key, d);
  }
  const prevTotals = previous.length
    ? { employees: previous.length, gross: Math.round(previous.reduce((s, p) => s + withTotals(p).gross, 0)), net: Math.round(previous.reduce((s, p) => s + withTotals(p).net, 0)) }
    : null;
  return {
    ...run,
    lines,
    byDepartment: [...byDepartment.values()].sort((a, b) => b.gross - a.gross),
    previous: prevTotals,
    missingBank: lines.filter((l) => !l.employee.hasBank).length,
  };
}

/** Recalculate a DRAFT run (optionally with new working days). */
export async function recalculateRun(companyId: string, id: string, workingDays?: number, actorEmployeeId?: string | null) {
  const run = await runOrThrow(companyId, id);
  if (run.status !== 'DRAFT') throw ApiError.conflict('Only a DRAFT run can be recalculated — unlock it first');
  return generateRun(companyId, run.month, { workingDays, actorEmployeeId });
}

export async function lockRun(companyId: string, id: string) {
  const run = await runOrThrow(companyId, id);
  if (run.status !== 'DRAFT') throw ApiError.conflict(`Run is already ${run.status.toLowerCase()}`);
  const count = await prisma.payslip.count({ where: { runId: id } });
  if (count === 0) throw ApiError.badRequest('The run has no payslips to lock');
  const after = await prisma.payrollRun.update({ where: { id }, data: { status: 'LOCKED', lockedAt: new Date() } });
  return { before: run, after };
}

export async function unlockRun(companyId: string, id: string) {
  const run = await runOrThrow(companyId, id);
  if (run.status !== 'LOCKED' && run.status !== 'APPROVED') {
    throw ApiError.conflict(run.status === 'PUBLISHED' ? 'A published run cannot be unlocked' : 'Run is not locked');
  }
  const after = await prisma.payrollRun.update({
    where: { id },
    data: { status: 'DRAFT', lockedAt: null, approvedAt: null, approvedById: null },
  });
  return { before: run, after };
}

/**
 * HR / Finance sign-off on a reviewed (LOCKED) run. Only ADMIN may approve
 * (route guard); the approver is recorded and publishing requires it.
 */
export async function approveRun(companyId: string, id: string, approverEmployeeId: string | null) {
  const run = await runOrThrow(companyId, id);
  if (run.status !== 'LOCKED') {
    throw ApiError.conflict(run.status === 'DRAFT' ? 'Lock the run for review before approving it' : `Run is already ${run.status.toLowerCase()}`);
  }
  const after = await prisma.payrollRun.update({
    where: { id },
    data: { status: 'APPROVED', approvedAt: new Date(), approvedById: approverEmployeeId },
  });
  return { before: run, after };
}

/** Records that salaries were credited (bank transfer done) for a published run. */
export async function markRunPaid(
  companyId: string,
  id: string,
  input: { paymentReference: string; paymentMode: string; paidAt?: Date }
) {
  const run = await runOrThrow(companyId, id);
  if (run.status !== 'PUBLISHED') throw ApiError.conflict('Publish the run before recording the salary payment');
  if (run.paidAt) throw ApiError.conflict('Salary payment is already recorded for this run');
  const after = await prisma.payrollRun.update({
    where: { id },
    data: { paidAt: input.paidAt ?? new Date(), paymentReference: input.paymentReference, paymentMode: input.paymentMode },
  });
  const slips = await prisma.payslip.findMany({ where: { runId: id, netPay: { gt: 0 } }, select: { employeeId: true } });
  await notify(companyId, slips.map((s) => s.employeeId), {
    event: 'salary.credited',
    title: 'Salary credited',
    body: `Your salary for ${monthLabel(run.month)} has been credited.`,
    link: '/payroll',
  });
  return { before: run, after };
}

/**
 * Publishes an APPROVED run: payslips become visible, loan EMIs
 * are posted as repayments (closing fully repaid loans) and the consumed
 * PayrollInputs are stamped with their payslip. Employees are notified.
 */
export async function publishRun(companyId: string, id: string) {
  const run = await runOrThrow(companyId, id);
  if (run.status === 'PUBLISHED') throw ApiError.conflict('Run is already published');
  if (run.status !== 'APPROVED') throw ApiError.conflict('The run must be reviewed (locked) and approved before publishing');
  const slips = await prisma.payslip.findMany({ where: { runId: id } });
  if (slips.length === 0) throw ApiError.badRequest('The run has no payslips to publish');

  const repayments: { loanId: string; amount: number; payslipId: string }[] = [];
  const stamps: { payslipId: string; inputIds: string[] }[] = [];
  for (const p of slips) {
    const lines = [...items(p.earnings), ...items(p.deductions)];
    const inputIds = lines.map((l) => l.inputId).filter((v): v is string => !!v);
    if (inputIds.length) stamps.push({ payslipId: p.id, inputIds });
    for (const l of items(p.deductions)) {
      if (l.code === 'LOAN' && l.loanId && l.amount > 0) repayments.push({ loanId: l.loanId, amount: l.amount, payslipId: p.id });
    }
  }

  await prisma.$transaction(async (tx) => {
    // Guard against a concurrent publish.
    const claimed = await tx.payrollRun.updateMany({
      where: { id, status: { not: 'PUBLISHED' } },
      data: { status: 'PUBLISHED', publishedAt: new Date(), lockedAt: run.lockedAt ?? new Date() },
    });
    if (claimed.count === 0) throw ApiError.conflict('Run is already published');
    await tx.payslip.updateMany({ where: { runId: id }, data: { status: 'PUBLISHED' } });
    for (const s of stamps) {
      await tx.payrollInput.updateMany({ where: { id: { in: s.inputIds }, companyId, payslipId: null }, data: { payslipId: s.payslipId } });
    }
    for (const r of repayments) {
      const loan = await tx.loan.findFirst({ where: { id: r.loanId, companyId } });
      if (!loan) continue;
      const exists = await tx.loanRepayment.findUnique({ where: { loanId_month: { loanId: r.loanId, month: run.month } } });
      if (exists) continue;
      await tx.loanRepayment.create({ data: { companyId, loanId: r.loanId, month: run.month, amount: r.amount, payslipId: r.payslipId } });
      const balance = Math.max(0, Math.round((loan.balance - r.amount) * 100) / 100);
      await tx.loan.update({
        where: { id: loan.id },
        data: { balance, ...(balance <= 0 ? { status: 'CLOSED' } : {}) },
      });
    }
  }, { timeout: 60000 });

  await refreshRunTotals(id);
  await notify(companyId, slips.map((s) => s.employeeId), {
    event: 'payslip.published',
    title: 'Payslip published',
    body: `Your payslip for ${monthLabel(run.month)} is now available.`,
    link: '/payroll',
  });
  const after = await prisma.payrollRun.findUniqueOrThrow({ where: { id } });
  return { before: run, after, payslips: slips.length, loanRepayments: repayments.length };
}

/**
 * Live annual tax projection for an employee (the app's "My tax"): computes
 * the current month as a full-attendance payslip without saving anything.
 * If the current month is already paid, projects from the next month.
 */
export async function taxProjection(companyId: string, employeeId: string) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: EMPLOYEE_SELECT });
  if (!employee) throw ApiError.notFound('Employee not found');
  let month = monthStart(new Date());
  const paid = await prisma.payslip.findUnique({ where: { employeeId_month: { employeeId, month } }, select: { status: true } });
  if (paid?.status === 'PUBLISHED' && fyOf(nextMonth(month)) === fyOf(month)) month = nextMonth(month);
  const [stat, office, inputs] = await Promise.all([
    loadStatutoryContext(companyId),
    employee.officeId ? prisma.office.findFirst({ where: { id: employee.officeId, companyId }, select: { state: true, isMetro: true } }) : null,
    prisma.payrollInput.findMany({ where: { companyId, employeeId, month, payslipId: null } }),
  ]);
  const tax = await loadTaxContext(companyId, fyOf(month), month, [employeeId]);
  const wd = 26;
  const computed = computeEmployeeMonth({
    month,
    workingDays: wd,
    payableDays: employedWorkingDays(employee, month, wd),
    employee,
    office,
    stat: { ...stat, config: { ...stat.config, tdsEnabled: true } },
    tax,
    inputs,
    loans: [],
  });
  return {
    employeeId,
    regime: employee.taxRegime === 'OLD' ? 'OLD' : 'NEW',
    tdsEnabled: stat.config.tdsEnabled,
    hasStructure: employee.salaryBasic > 0,
    projection: computed.taxComputation,
  };
}

/* ------------------------------- Payslip PDF ------------------------------- */

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const below100 = (n: number): string =>
  n < 20 ? (ONES[n] ?? '') : `${TENS[Math.floor(n / 10)] ?? ''}${n % 10 ? ' ' + (ONES[n % 10] ?? '') : ''}`;

/** Indian-system amount in words, e.g. 46400 → "Forty Six Thousand Four Hundred". */
export function amountInWords(amount: number): string {
  let n = Math.round(Math.abs(amount));
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const push = (value: number, label: string) => value > 0 && parts.push(`${below100(value)} ${label}`.trim());
  push(Math.floor(n / 1e7), 'Crore');
  n %= 1e7;
  push(Math.floor(n / 1e5), 'Lakh');
  n %= 1e5;
  push(Math.floor(n / 1e3), 'Thousand');
  n %= 1e3;
  push(Math.floor(n / 100), 'Hundred');
  n %= 100;
  if (n > 0) parts.push(below100(n));
  return parts.join(' ');
}

export const inr = (n: number): string => `Rs. ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const dateLabel = (d: Date): string =>
  d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtDays = (d: number): string => (Number.isInteger(d) ? String(d) : d.toFixed(1));

function buildPayslipPdf(input: {
  companyName: string;
  /** Letterhead logo (PNG / JPG) and address from the company profile; both optional. */
  logo: Buffer | null;
  companyAddress: string;
  month: Date;
  paidOn: Date;
  workingDays: number;
  paidDays: number;
  lopDays: number;
  draft: boolean;
  taxRegime: string;
  employee: { name: string; employeeCode: string; designation: string; pan: string; bankName: string; accountNumber: string; uan: string };
  earnings: PayItem[];
  deductions: PayItem[];
  employer: PayItem[];
  gross: number;
  totalDeductions: number;
  net: number;
  ytd: { gross: number; deductions: number; net: number; tds: number; pf: number; fy: string };
}): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const left = 48;
    const right = doc.page.width - 48;
    const { gross, totalDeductions, net } = input;

    const hr = (y: number) => doc.moveTo(left, y).lineTo(right, y).lineWidth(0.7).strokeColor('#CBD5E1').stroke();

    if (input.draft) {
      doc.save();
      doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.font('Helvetica-Bold').fontSize(90).fillColor('#F1F5F9')
        .text('DRAFT', 0, doc.page.height / 2 - 50, { width: doc.page.width, align: 'center' });
      doc.restore();
      doc.x = left;
      doc.y = 48;
    }

    // Header: a small company logo on the left of the title (name, address, month); an unreadable image is skipped.
    const headTop = doc.y;
    const LOGO_BOX: [number, number] = [84, 40];
    let textLeft = left;
    if (input.logo) {
      try {
        doc.image(input.logo, left, headTop, { fit: LOGO_BOX, valign: 'center' });
        textLeft = left + LOGO_BOX[0] + 12;
      } catch {
        textLeft = left;
      }
    }
    const textWidth = right - textLeft;
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#1E1B4B').text(input.companyName.toUpperCase(), textLeft, headTop, { width: textWidth });
    if (input.companyAddress) {
      doc.font('Helvetica').fontSize(8.5).fillColor('#64748B').text(input.companyAddress.replace(/\s*\n\s*/g, ', '), textLeft, doc.y + 1, { width: textWidth });
    }
    doc.font('Helvetica').fontSize(10.5).fillColor('#475569').text(`Payslip for ${monthLabel(input.month)}`, textLeft, doc.y + 2, { width: textWidth });
    doc.x = left;
    doc.y = Math.max(doc.y, headTop + LOGO_BOX[1]);
    doc.moveDown(0.8);
    hr(doc.y);
    doc.moveDown(0.8);

    // Employee details, two columns
    const info: [string, string][] = [
      ['Employee', `${input.employee.name} (${input.employee.employeeCode})`],
      ['Designation', input.employee.designation || '—'],
      ['PAN', input.employee.pan || '—'],
      ['UAN', input.employee.uan || '—'],
      ['Bank A/C', [input.employee.bankName, input.employee.accountNumber].filter(Boolean).join(' · ') || '—'],
      ['Tax regime', input.taxRegime === 'OLD' ? 'Old regime' : 'New regime'],
      ['Paid days', `${fmtDays(input.paidDays)} of ${input.workingDays}`],
      ['LOP days', fmtDays(input.lopDays)],
      ['Paid on', dateLabel(input.paidOn)],
    ];
    const colW = (right - left) / 3;
    const rowH = 32;
    const startY = doc.y;
    info.forEach(([label, value], i) => {
      const x = left + (i % 3) * colW;
      const y = startY + Math.floor(i / 3) * rowH;
      doc.font('Helvetica').fontSize(8.5).fillColor('#64748B').text(label.toUpperCase(), x, y);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#0F172A').text(value, x, y + 11, { width: colW - 12, ellipsis: true, height: 14 });
    });
    doc.y = startY + Math.ceil(info.length / 3) * rowH + 4;
    hr(doc.y);
    doc.moveDown(0.8);

    // Earnings / deductions tables
    const table = (title: string, rows: PayItem[], totalLabel: string, total: number) => {
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#1E1B4B').text(title, left, doc.y);
      doc.font('Helvetica').fontSize(8.5).fillColor('#64748B')
        .text('AMOUNT (INR)', left, doc.y - 12, { width: right - left, align: 'right' });
      doc.moveDown(0.4);
      for (const item of rows) {
        const y = doc.y;
        doc.font('Helvetica').fontSize(10).fillColor('#334155').text(item.label, left + 4, y);
        doc.text(inr(item.amount), left, y, { width: right - left, align: 'right' });
        doc.moveDown(0.35);
      }
      hr(doc.y + 2);
      doc.moveDown(0.4);
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#0F172A').text(totalLabel, left + 4, y);
      doc.text(inr(total), left, y, { width: right - left, align: 'right' });
      doc.moveDown(1);
    };
    table('Earnings', input.earnings, 'Gross earnings', gross);
    table('Deductions', input.deductions, 'Total deductions', totalDeductions);

    // Net pay box
    const boxY = doc.y;
    doc.roundedRect(left, boxY, right - left, 52, 8).fillColor('#EEF2FF').fill();
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#1E1B4B').text('NET PAY', left + 16, boxY + 10);
    doc.font('Helvetica').fontSize(9).fillColor('#475569')
      .text(`Rupees ${amountInWords(net)} Only`, left + 16, boxY + 28, { width: right - left - 180 });
    doc.font('Helvetica-Bold').fontSize(17).fillColor('#4338CA')
      .text(inr(net), left, boxY + 16, { width: right - left - 16, align: 'right' });
    doc.y = boxY + 66;

    // Employer contributions (part of CTC, not of take-home)
    if (input.employer.length) {
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#1E1B4B').text('Employer contributions (not part of net pay)', left, doc.y);
      doc.moveDown(0.3);
      for (const item of input.employer) {
        const y = doc.y;
        doc.font('Helvetica').fontSize(9.5).fillColor('#475569').text(item.label, left + 4, y);
        doc.text(inr(item.amount), left, y, { width: right - left, align: 'right' });
        doc.moveDown(0.3);
      }
      doc.moveDown(0.6);
    }

    // Year to date
    const y0 = doc.y;
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#1E1B4B').text(`Year to date (FY ${input.ytd.fy})`, left, y0);
    const ytd: [string, number][] = [
      ['Gross', input.ytd.gross], ['Deductions', input.ytd.deductions], ['Net pay', input.ytd.net],
      ['Income tax (TDS)', input.ytd.tds], ['Provident fund', input.ytd.pf],
    ];
    const w = (right - left) / ytd.length;
    ytd.forEach(([label, value], i) => {
      doc.font('Helvetica').fontSize(8).fillColor('#64748B').text(label.toUpperCase(), left + i * w, y0 + 16, { width: w - 6 });
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#0F172A').text(inr(value), left + i * w, y0 + 27, { width: w - 6 });
    });
    doc.y = y0 + 52;

    // Footer
    doc.font('Helvetica').fontSize(8.5).fillColor('#94A3B8')
      .text(
        input.draft
          ? 'DRAFT — this payslip is not final and may change before the payroll is published.'
          : 'This is a computer-generated payslip and does not require a signature.',
        left,
        doc.y + 6,
        { width: right - left, align: 'center' }
      );

    doc.end();
  });
}

/** Builds the payslip PDF (shared by the download link and the email). */
async function payslipPdf(companyId: string, payslipId: string) {
  const payslip = await getPayslip(companyId, payslipId); // includes the employee block
  const t = withTotals(payslip);
  const [head, ytd] = await Promise.all([
    letterhead(companyId), // same logo / address as the HR letters
    payslipYtd(companyId, payslip.employeeId, payslip.month, payslip.id),
  ]);
  const buffer = await buildPayslipPdf({
    companyName: head.name,
    logo: head.logo,
    companyAddress: head.address,
    month: payslip.month,
    paidOn: payslip.paidOn,
    workingDays: payslip.workingDays,
    paidDays: payslip.paidDays,
    lopDays: payslip.lopDays || Math.max(0, payslip.workingDays - payslip.paidDays),
    draft: payslip.status !== 'PUBLISHED',
    taxRegime: (payslip.taxComputation as { regime?: string } | null)?.regime ?? payslip.employee.taxRegime,
    employee: {
      name: payslip.employee.name,
      employeeCode: payslip.employee.employeeCode,
      designation: payslip.employee.designation,
      pan: revealPlain(payslip.employee.pan),
      bankName: payslip.employee.bankName,
      accountNumber: revealPlain(payslip.employee.accountNumber),
      uan: revealPlain(payslip.employee.uan),
    },
    earnings: items(payslip.earnings),
    deductions: items(payslip.deductions),
    employer: items(payslip.employerContributions),
    gross: t.gross,
    totalDeductions: t.totalDeductions,
    net: t.net,
    ytd,
  });
  const fileName = `Payslip_${payslip.employee.employeeCode}_${payslip.month.toISOString().slice(0, 7)}.pdf`;
  return { payslip, buffer, fileName, companyName: head.name };
}

/**
 * Generates the payslip PDF, stores it in the bucket (tenant-namespaced,
 * overwritten on regeneration) and returns a short-lived link.
 */
export async function payslipPdfUrl(companyId: string, payslipId: string, opts: { inline?: boolean } = {}) {
  const { payslip, buffer, fileName } = await payslipPdf(companyId, payslipId);
  const key = `${companyId}/payslips/${payslip.id}.pdf`;
  await putObject(key, buffer, 'application/pdf');
  return {
    url: await presignedGetUrl(key, fileName, opts.inline ? 'inline' : 'attachment'),
    fileName,
    expiresInSeconds: FILE_LINK_TTL_SECONDS,
  };
}

/**
 * Emails a published payslip PDF to the employee's login email. Drafts are
 * never sent (they can still change before the run is published).
 */
export async function emailPayslip(companyId: string, payslipId: string) {
  const { payslip, buffer, fileName, companyName } = await payslipPdf(companyId, payslipId);
  if (payslip.status !== 'PUBLISHED') throw ApiError.badRequest('Only a published payslip can be sent — publish the payroll run first');
  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: payslip.employeeId },
    select: { name: true, user: { select: { email: true } } },
  });
  const to = employee.user?.email;
  if (!to) throw ApiError.badRequest(`${employee.name} has no email address on file`);
  const month = payslip.month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  await sendMail({
    to,
    subject: `Payslip for ${month} — ${companyName}`,
    text: `Hi ${employee.name},\n\nPlease find attached your payslip for ${month}.\nYou can also view it any time in the HRMS app under Payroll → Payslips.\n\nRegards,\n${companyName} HR`,
    attachments: [{ filename: fileName, content: buffer, contentType: 'application/pdf' }],
  });
  return { sentTo: to, month };
}
