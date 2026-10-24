/**
 * One-off payroll lines for a month (PayrollInput): bonus, incentive,
 * reimbursement, other earnings and deductions entered by HR, plus
 * system-generated lines (ARREAR from salary revisions, OVERTIME,
 * LEAVE_ENCASHMENT, LOAN_EMI) that are shown read-only.
 *
 * The payroll engine picks up every input of the month and links it to the
 * payslip (payslipId); a linked input is frozen. Inputs cannot be added to a
 * month whose payroll run is LOCKED or PUBLISHED.
 */
import type { Request } from 'express';
import type { PayrollInput, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { ApiError } from '../utils/http';
import { parseCsvObjects } from '../utils/csv';
import { monthEnd, monthStart } from '../utils/finance';

export const MANUAL_INPUT_TYPES = ['BONUS', 'INCENTIVE', 'REIMBURSEMENT', 'OTHER_EARNING', 'DEDUCTION'] as const;
export const SYSTEM_INPUT_TYPES = ['ARREAR', 'OVERTIME', 'LEAVE_ENCASHMENT', 'LOAN_EMI'] as const;
export type ManualInputType = (typeof MANUAL_INPUT_TYPES)[number];

export interface InputData {
  employeeId: string;
  month: Date;
  type: ManualInputType;
  label: string;
  amount: number;
  taxable: boolean;
  note?: string;
}

const DEFAULT_TAXABLE: Record<ManualInputType, boolean> = {
  BONUS: true,
  INCENTIVE: true,
  REIMBURSEMENT: false,
  OTHER_EARNING: true,
  DEDUCTION: false,
};

const isSystem = (type: string) => (SYSTEM_INPUT_TYPES as readonly string[]).includes(type);

/** Throws when the month's payroll run is already locked or published. */
export async function assertMonthOpen(companyId: string, month: Date) {
  const run = await prisma.payrollRun.findUnique({ where: { companyId_month: { companyId, month: monthStart(month) } } });
  if (run && run.status !== 'DRAFT') {
    throw ApiError.conflict(`Payroll for ${month.toISOString().slice(0, 7)} is ${run.status.toLowerCase()} — inputs can no longer change`);
  }
}

function assertEditable(input: PayrollInput) {
  if (input.payslipId) throw ApiError.conflict('This input is already on a payslip and cannot be changed');
  if (isSystem(input.type)) throw ApiError.badRequest(`${input.type} inputs are system-generated and read-only`);
}

export async function list(companyId: string, filter: { month: Date; employeeId?: string; type?: string }) {
  const month = monthStart(filter.month);
  const [rows, run] = await Promise.all([
    prisma.payrollInput.findMany({
      where: {
        companyId,
        month,
        ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
        ...(filter.type ? { type: filter.type } : {}),
      },
      include: { employee: { select: { id: true, name: true, employeeCode: true, department: true } } },
      orderBy: [{ employee: { name: 'asc' } }, { createdAt: 'asc' }],
    }),
    prisma.payrollRun.findUnique({ where: { companyId_month: { companyId, month } }, select: { status: true } }),
  ]);
  const earnings = rows.filter((r) => r.type !== 'DEDUCTION' && r.type !== 'LOAN_EMI').reduce((s, r) => s + r.amount, 0);
  const deductions = rows.filter((r) => r.type === 'DEDUCTION' || r.type === 'LOAN_EMI').reduce((s, r) => s + r.amount, 0);
  return {
    month,
    runStatus: run?.status ?? null,
    locked: !!run && run.status !== 'DRAFT',
    totals: { earnings, deductions, count: rows.length },
    items: rows.map((r) => ({ ...r, system: isSystem(r.type), editable: !r.payslipId && !isSystem(r.type) })),
  };
}

async function assertEmployee(companyId: string, employeeId: string) {
  const e = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { id: true } });
  if (!e) throw ApiError.badRequest('Employee not found in this company');
}

export async function create(companyId: string, data: InputData, createdById: string | null, req: Request) {
  const month = monthStart(data.month);
  await assertMonthOpen(companyId, month);
  await assertEmployee(companyId, data.employeeId);
  const created = await prisma.payrollInput.create({
    data: { ...data, companyId, month, note: data.note ?? '', createdById },
  });
  await audit(req, { entity: 'PayrollInput', entityId: created.id, action: 'CREATE', after: created });
  return created;
}

export async function update(
  companyId: string,
  id: string,
  data: Partial<Omit<InputData, 'employeeId' | 'month'>>,
  req: Request
) {
  const before = await prisma.payrollInput.findFirst({ where: { id, companyId } });
  if (!before) throw ApiError.notFound('Payroll input not found');
  assertEditable(before);
  await assertMonthOpen(companyId, before.month);
  const after = await prisma.payrollInput.update({ where: { id }, data });
  await audit(req, { entity: 'PayrollInput', entityId: id, action: 'UPDATE', before, after });
  return after;
}

export async function remove(companyId: string, id: string, req: Request) {
  const before = await prisma.payrollInput.findFirst({ where: { id, companyId } });
  if (!before) throw ApiError.notFound('Payroll input not found');
  assertEditable(before);
  await assertMonthOpen(companyId, before.month);
  await prisma.payrollInput.delete({ where: { id } });
  await audit(req, { entity: 'PayrollInput', entityId: id, action: 'DELETE', before });
}

// ---- CSV bulk upload ----

export const CSV_HEADERS = ['employeeCode', 'type', 'label', 'amount', 'taxable'];

export interface CsvRowResult {
  row: number;
  employeeCode: string;
  type: string;
  amount: number | null;
  ok: boolean;
  error?: string;
}

const truthy = (v: string) => ['true', 'yes', 'y', '1'].includes(v.toLowerCase());
const falsy = (v: string) => ['false', 'no', 'n', '0'].includes(v.toLowerCase());

/**
 * Validates every row; unless `dryRun`, creates the valid ones in one batch
 * (invalid rows are reported and skipped).
 */
export async function importCsv(
  companyId: string,
  input: { month: Date; csv: string; dryRun: boolean },
  createdById: string | null,
  req: Request
) {
  const month = monthStart(input.month);
  await assertMonthOpen(companyId, month);
  const rows = parseCsvObjects(input.csv);
  if (rows.length === 0) throw ApiError.badRequest('The CSV has no data rows');
  if (rows.length > 5000) throw ApiError.badRequest('Upload at most 5000 rows at a time');
  const missing = CSV_HEADERS.slice(0, 4).filter((h) => !(h in (rows[0] ?? {})));
  if (missing.length > 0) throw ApiError.badRequest(`Missing column(s): ${missing.join(', ')} — expected ${CSV_HEADERS.join(',')}`);

  const employees = await prisma.employee.findMany({ where: { companyId }, select: { id: true, employeeCode: true, isActive: true } });
  const byCode = new Map(employees.map((e) => [e.employeeCode.toLowerCase(), e]));
  const results: CsvRowResult[] = [];
  const toCreate: Prisma.PayrollInputCreateManyInput[] = [];

  rows.forEach((r, i) => {
    const rowNo = i + 2; // header is row 1
    const code = r.employeeCode ?? '';
    const type = (r.type ?? '').toUpperCase().replace(/[\s-]+/g, '_');
    const amount = Number((r.amount ?? '').replace(/[,₹\s]/g, ''));
    const fail = (error: string) => results.push({ row: rowNo, employeeCode: code, type, amount: Number.isFinite(amount) ? amount : null, ok: false, error });
    const emp = byCode.get(code.toLowerCase());
    if (!code) return fail('employeeCode is empty');
    if (!emp) return fail(`Unknown employee code "${code}"`);
    if (!emp.isActive) return fail('Employee is inactive');
    if (!(MANUAL_INPUT_TYPES as readonly string[]).includes(type)) {
      return fail(isSystem(type) ? `${type} is system-generated` : `Type must be one of ${MANUAL_INPUT_TYPES.join(', ')}`);
    }
    if (!Number.isFinite(amount) || amount <= 0) return fail('Amount must be a positive number');
    if (amount > 10_000_000) return fail('Amount is too large');
    const taxableRaw = (r.taxable ?? '').trim();
    if (taxableRaw && !truthy(taxableRaw) && !falsy(taxableRaw)) return fail('taxable must be true/false');
    const taxable = taxableRaw ? truthy(taxableRaw) : DEFAULT_TAXABLE[type as ManualInputType];
    const label = (r.label ?? '').trim() || type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' ');
    if (label.length > 120) return fail('Label is too long (max 120)');
    results.push({ row: rowNo, employeeCode: code, type, amount, ok: true });
    toCreate.push({ companyId, employeeId: emp.id, month, type, label, amount, taxable, createdById, note: 'CSV upload' });
  });

  if (!input.dryRun && toCreate.length > 0) {
    await prisma.payrollInput.createMany({ data: toCreate });
    await audit(req, {
      entity: 'PayrollInput',
      entityId: month.toISOString().slice(0, 7),
      action: 'BULK_CREATE',
      after: { count: toCreate.length, total: toCreate.reduce((s, r) => s + r.amount, 0) },
    });
  }
  return {
    dryRun: input.dryRun,
    total: rows.length,
    valid: toCreate.length,
    invalid: results.filter((r) => !r.ok).length,
    created: input.dryRun ? 0 : toCreate.length,
    results,
  };
}

// ---- Expense claims → reimbursements ----

/**
 * One REIMBURSEMENT input (non-taxable) per APPROVED expense claim dated up to
 * the month's end that has not been imported before (refId = claim id).
 * Safe to run repeatedly.
 */
export async function importExpenses(companyId: string, monthInput: Date, createdById: string | null, req: Request) {
  const month = monthStart(monthInput);
  await assertMonthOpen(companyId, month);
  const claims = await prisma.expenseClaim.findMany({
    where: { companyId, status: 'APPROVED', date: { lte: monthEnd(month) }, employee: { isActive: true } },
    orderBy: { date: 'asc' },
  });
  if (claims.length === 0) return { created: 0, skipped: 0, total: 0 };
  const imported = await prisma.payrollInput.findMany({
    where: { companyId, type: 'REIMBURSEMENT', refId: { in: claims.map((c) => c.id) } },
    select: { refId: true },
  });
  const done = new Set(imported.map((i) => i.refId));
  const fresh = claims.filter((c) => !done.has(c.id));
  if (fresh.length > 0) {
    await prisma.payrollInput.createMany({
      data: fresh.map((c) => ({
        companyId,
        employeeId: c.employeeId,
        month,
        type: 'REIMBURSEMENT',
        label: `Reimbursement — ${c.category}`.slice(0, 120),
        amount: c.amount,
        taxable: false,
        refId: c.id,
        note: `${c.description} (${c.date.toISOString().slice(0, 10)})`.slice(0, 300),
        createdById,
      })),
    });
    await audit(req, {
      entity: 'PayrollInput',
      entityId: month.toISOString().slice(0, 7),
      action: 'IMPORT_EXPENSES',
      after: { count: fresh.length, total: fresh.reduce((s, c) => s + c.amount, 0), claimIds: fresh.map((c) => c.id) },
    });
  }
  return {
    created: fresh.length,
    skipped: claims.length - fresh.length,
    total: fresh.reduce((s, c) => s + c.amount, 0),
  };
}
