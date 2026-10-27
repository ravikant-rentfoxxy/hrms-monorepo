/**
 * Full & final settlement of an exit: compute (salary for the last month,
 * leave encashment, gratuity, unpaid reimbursements, pending bonuses /
 * incentives, notice recovery, loans, clearance dues) → HR edits the draft →
 * ADMIN approves → HR records the payment (mode + reference). The legal due
 * date defaults to 2 working days after the last working day (Code on Wages).
 * The paid statement is filed in the employee's documents.
 */
import PDFDocument from 'pdfkit';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { presignedGetUrl, putObject, FILE_LINK_TTL_SECONDS } from '../lib/storage';
import { ApiError } from '../utils/http';
import { workingDays } from '../utils/geo';
import { addDays, dateOnly, employeeIdsWithRoles, inr, isCompanyAdmin, longDate, monthlyGross, round2, todayUTC } from '../utils/lifecycle';
import * as leaveService from './leave.service';
import { LETTERS_FOLDER } from './letter.service';
import { type Actor, FNF_DUE_WORKING_DAYS, addWorkingDays, lastDayOf, settlementDone } from './exit.helpers';

const GRATUITY_CAP = 2_000_000;

export const PAYMENT_MODES = ['BANK_TRANSFER', 'NEFT', 'RTGS', 'IMPS', 'UPI', 'CHEQUE', 'CASH'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** Unpaid one-off payroll earnings settled in F&F instead of the next payroll run. */
const EARNING_INPUT_TYPES = ['BONUS', 'INCENTIVE', 'ARREAR', 'OVERTIME', 'LEAVE_ENCASHMENT', 'OTHER_EARNING'];

/**
 * Marker written to PayrollInput.payslipId for inputs paid in an F&F, so the
 * payroll run (which picks inputs with no payslip) does not pay them again.
 */
export const fnfMarker = (settlementId: string) => `FNF:${settlementId}`;

export interface SettlementItem {
  label: string;
  type: 'EARNING' | 'DEDUCTION';
  amount: number;
  /** SALARY | LEAVE_ENCASHMENT | GRATUITY | REIMBURSEMENT | BONUS | INCENTIVE | ARREAR | OVERTIME | NOTICE_RECOVERY | LOAN | CLEARANCE_DUES | TDS | DEDUCTION | OTHER */
  code?: string;
  note?: string;
  /** Source records (expense claims / payroll inputs) settled by this line. */
  refIds?: string[];
}

const monthLabel = (d: Date) => d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const humanize = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

/** Encashable leave balance per type: leave ledger sum, else the leave module's balance. */
async function encashableLeave(companyId: string, employeeId: string) {
  const types = await prisma.leaveType.findMany({ where: { companyId, isActive: true, encashable: true } });
  if (types.length === 0) return [];
  let fallback: { leaveTypeId: string; available: number }[] | null = null;
  const out: { name: string; days: number }[] = [];
  for (const t of types) {
    const agg = await prisma.leaveLedger.aggregate({
      where: { companyId, employeeId, leaveTypeId: t.id },
      _sum: { change: true },
      _count: { _all: true },
    });
    let days: number;
    if (agg._count._all > 0) {
      days = agg._sum.change ?? 0;
    } else {
      fallback ??= ((await leaveService.balances(companyId, employeeId)) as unknown as {
        leaveType?: { id: string };
        leaveTypeId?: string;
        available?: number;
      }[]).map((b) => ({ leaveTypeId: b.leaveType?.id ?? b.leaveTypeId ?? '', available: b.available ?? 0 }));
      days = fallback.find((b) => b.leaveTypeId === t.id)?.available ?? 0;
    }
    days = Math.max(0, days);
    if (t.maxEncashDays > 0) days = Math.min(days, t.maxEncashDays);
    if (days > 0) out.push({ name: t.name, days: round2(days) });
  }
  return out;
}

/** Completed years for gratuity: ≥ 6 months of a part year rounds up; null when under 5 years. */
export function gratuityYears(joining: Date, lastDay: Date): number | null {
  let months = (lastDay.getUTCFullYear() - joining.getUTCFullYear()) * 12 + (lastDay.getUTCMonth() - joining.getUTCMonth());
  if (lastDay.getUTCDate() < joining.getUTCDate()) months--;
  if (months < 60) return null;
  return Math.floor(months / 12) + (months % 12 >= 6 ? 1 : 0);
}

export const netOf = (items: SettlementItem[]) =>
  round2(items.reduce((s, i) => s + (i.type === 'EARNING' ? i.amount : -i.amount), 0));

/**
 * Overdue = not settled and the due date (stored, else last day + 2 weekdays)
 * has passed. Pure — used by lists.
 */
export function fnfOverdue(
  exit: { status: string; approvedLastDay: Date | null; requestedLastDay: Date; closedAt?: Date | null },
  s: { status: string; netAmount: number; dueDate: Date | null } | null,
  today = todayUTC()
): boolean {
  if (!['APPROVED', 'COMPLETED'].includes(exit.status) || exit.closedAt || settlementDone(s)) return false;
  let due = s?.dueDate ?? null;
  if (!due) {
    due = dateOnly(lastDayOf(exit));
    for (let left = FNF_DUE_WORKING_DAYS; left > 0;) {
      due = addDays(due, 1);
      if (due.getUTCDay() !== 0 && due.getUTCDay() !== 6) left--;
    }
  }
  return due < today;
}

export async function computeSettlement(companyId: string, id: string) {
  const r = await prisma.resignation.findFirst({
    where: { id, companyId },
    include: { employee: true, clearances: true, settlement: true },
  });
  if (!r) throw ApiError.notFound('Exit case not found');
  if (!['APPROVED', 'COMPLETED'].includes(r.status)) throw ApiError.badRequest('F&F can be computed only for an approved exit');
  if (r.closedAt) throw ApiError.badRequest('This exit case is closed');
  if (r.settlement && r.settlement.status !== 'DRAFT') {
    throw ApiError.conflict(`Settlement is already ${r.settlement.status.toLowerCase()} — it can no longer be recomputed`);
  }
  const e = r.employee;
  const lastDay = lastDayOf(r);
  const gross = monthlyGross(e);
  const items: SettlementItem[] = [];

  // 1. Salary for the final month's worked days, unless a payslip already covers it.
  const mStart = new Date(Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth(), 1));
  const mEnd = new Date(Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth() + 1, 0));
  const payslip = await prisma.payslip.findFirst({ where: { companyId, employeeId: e.id, month: mStart } });
  if (!payslip && gross > 0) {
    const from = e.joiningDate > mStart ? dateOnly(e.joiningDate) : mStart;
    const monthDays = workingDays(mStart, mEnd);
    const worked = workingDays(from, lastDay);
    if (monthDays > 0 && worked > 0) {
      items.push({
        label: `Salary for ${monthLabel(mStart)} (${worked} of ${monthDays} working days)`,
        type: 'EARNING',
        amount: round2((gross / monthDays) * worked),
        code: 'SALARY',
      });
    }
  }

  // 2. Leave encashment at basic / 26 per day.
  for (const l of await encashableLeave(companyId, e.id)) {
    items.push({
      label: `Leave encashment — ${l.name} (${l.days} days)`,
      type: 'EARNING',
      amount: round2((e.salaryBasic / 26) * l.days),
      code: 'LEAVE_ENCASHMENT',
    });
  }

  // 3. Gratuity (Payment of Gratuity Act): 15/26 × last basic × years, capped at Rs. 20 lakh.
  const years = gratuityYears(e.joiningDate, lastDay);
  if (years && e.salaryBasic > 0) {
    items.push({
      label: `Gratuity (${years} years of service)`,
      type: 'EARNING',
      amount: round2(Math.min(GRATUITY_CAP, (15 / 26) * e.salaryBasic * years)),
      code: 'GRATUITY',
    });
  }

  // 4. Approved expense claims not yet paid through payroll.
  const approved = await prisma.expenseClaim.findMany({ where: { companyId, employeeId: e.id, status: 'APPROVED' } });
  if (approved.length > 0) {
    const paid = await prisma.payrollInput.findMany({
      where: { companyId, employeeId: e.id, refId: { in: approved.map((x) => x.id) }, payslipId: { not: null } },
      select: { refId: true },
    });
    const paidIds = new Set(paid.map((p) => p.refId));
    const unpaid = approved.filter((x) => !paidIds.has(x.id));
    const total = unpaid.reduce((s, x) => s + x.amount, 0);
    if (total > 0) {
      items.push({
        label: `Expense reimbursements (${unpaid.length} claims)`,
        type: 'EARNING',
        amount: round2(total),
        code: 'REIMBURSEMENT',
        refIds: unpaid.map((x) => x.id),
      });
    }
  }

  // 5. Pending bonuses / incentives / arrears and one-off deductions not yet on a payslip.
  const inputs = await prisma.payrollInput.findMany({
    where: { companyId, employeeId: e.id, payslipId: null, type: { in: [...EARNING_INPUT_TYPES, 'DEDUCTION'] } },
    orderBy: { month: 'asc' },
  });
  for (const p of inputs) {
    if (p.amount <= 0) continue;
    items.push({
      label: `${humanize(p.type)} — ${p.label} (${monthLabel(p.month)})`,
      type: p.type === 'DEDUCTION' ? 'DEDUCTION' : 'EARNING',
      amount: round2(p.amount),
      code: p.type,
      refIds: [p.id],
    });
  }
  if (!inputs.some((p) => p.type === 'BONUS' || p.type === 'INCENTIVE')) {
    // Placeholder for HR to fill (pro-rata bonus as per policy).
    items.push({ label: 'Bonus / incentive (pro-rata)', type: 'EARNING', amount: 0, code: 'BONUS' });
  }

  // 6. Notice shortfall recovery at gross / 30 per day.
  if (r.shortfallDays > 0 && gross > 0) {
    items.push({
      label: `Notice period shortfall recovery (${r.shortfallDays} days)`,
      type: 'DEDUCTION',
      amount: round2((gross / 30) * r.shortfallDays),
      code: 'NOTICE_RECOVERY',
    });
  }

  // 7. Outstanding loans / salary advances.
  const loans = await prisma.loan.findMany({ where: { companyId, employeeId: e.id, status: 'ACTIVE', balance: { gt: 0 } } });
  for (const loan of loans) {
    items.push({
      label: `${loan.type === 'SALARY_ADVANCE' ? 'Salary advance' : 'Loan'} outstanding balance`,
      type: 'DEDUCTION',
      amount: round2(loan.balance),
      code: 'LOAN',
      note: loan.id,
    });
  }

  // 8. Clearance dues (e.g. unreturned assets).
  for (const c of r.clearances.filter((c) => c.dues > 0)) {
    items.push({ label: `${c.department} clearance dues`, type: 'DEDUCTION', amount: round2(c.dues), code: 'CLEARANCE_DUES', note: c.remarks });
  }

  // 9. TDS — placeholder for payroll to fill.
  items.push({ label: 'TDS on settlement', type: 'DEDUCTION', amount: 0, code: 'TDS' });

  // Due date: keep an edited one while the last working day is unchanged.
  const keepDue = r.settlement?.dueDate && r.settlement.lastWorkingDay.getTime() === lastDay.getTime();
  const dueDate = keepDue ? r.settlement!.dueDate! : await addWorkingDays(companyId, lastDay, FNF_DUE_WORKING_DAYS);

  const data = {
    lastWorkingDay: lastDay,
    items: items as unknown as Prisma.InputJsonValue,
    netAmount: netOf(items),
    dueDate,
  };
  return prisma.finalSettlement.upsert({
    where: { resignationId: r.id },
    create: { companyId, resignationId: r.id, employeeId: e.id, ...data },
    update: data,
  });
}

async function loadSettlement(companyId: string, id: string) {
  const s = await prisma.finalSettlement.findFirst({ where: { resignationId: id, companyId } });
  if (!s) throw ApiError.notFound('Compute the settlement first');
  return s;
}

export async function updateSettlement(companyId: string, id: string, items: SettlementItem[]) {
  const s = await loadSettlement(companyId, id);
  if (s.status !== 'DRAFT') throw ApiError.badRequest('Only a draft settlement can be edited');
  const clean = items.map((i) => ({ ...i, amount: round2(Math.max(0, i.amount)) }));
  const updated = await prisma.finalSettlement.update({
    where: { id: s.id },
    data: { items: clean as unknown as Prisma.InputJsonValue, netAmount: netOf(clean) },
  });
  return { before: s, after: updated };
}

/** HR may move the payment deadline (e.g. state rules, a holiday) until it is paid. */
export async function setDueDate(companyId: string, id: string, dueDate: Date) {
  const s = await loadSettlement(companyId, id);
  if (s.status === 'PAID') throw ApiError.badRequest('The settlement is already paid');
  const due = dateOnly(dueDate);
  if (due < dateOnly(s.lastWorkingDay)) throw ApiError.badRequest('The due date cannot be before the last working day');
  const updated = await prisma.finalSettlement.update({ where: { id: s.id }, data: { dueDate: due } });
  return { before: s, after: updated };
}

export async function approveSettlement(companyId: string, id: string, actor: Actor) {
  const s = await loadSettlement(companyId, id);
  if (s.status !== 'DRAFT') throw ApiError.badRequest(`Settlement is already ${s.status.toLowerCase()}`);
  const updated = await prisma.finalSettlement.update({
    where: { id: s.id },
    data: { status: 'APPROVED', approvedById: actor.employeeId, approvedAt: new Date() },
  });
  await notify(companyId, [s.employeeId], {
    event: 'exit.settlement_approved',
    title: 'Your full & final settlement is approved',
    body: `Net amount: ${inr(s.netAmount)}.${s.dueDate ? ` It will be paid by ${longDate(s.dueDate)}.` : ''}`,
    link: '/exits',
    email: true,
  });
  return updated;
}

export interface PaymentInput {
  paymentMode: PaymentMode;
  paymentReference?: string;
  paidOn?: Date;
}

/**
 * Records the F&F payment: loans recovered in it are closed, the payroll
 * inputs / reimbursements it settled are stamped so payroll does not pay them
 * again, and the statement is filed in the employee's documents.
 */
export async function markSettlementPaid(companyId: string, id: string, actor: Actor, input: PaymentInput) {
  const s = await loadSettlement(companyId, id);
  if (s.status !== 'APPROVED') throw ApiError.badRequest(s.status === 'PAID' ? 'The settlement is already paid' : 'Approve the settlement before marking it paid');
  const reference = input.paymentReference?.trim() ?? '';
  if (!reference && input.paymentMode !== 'CASH' && Math.abs(s.netAmount) >= 0.005) {
    throw ApiError.badRequest('Enter the payment reference (UTR / cheque number)');
  }
  const paidOn = input.paidOn ? new Date(input.paidOn) : new Date();
  if (dateOnly(paidOn) > todayUTC()) throw ApiError.badRequest('The payment date cannot be in the future');

  const items = (s.items as unknown as SettlementItem[]) ?? [];
  const loanIds = items.filter((i) => i.code === 'LOAN' && i.note && i.amount > 0).map((i) => i.note as string);
  const inputIds = items.filter((i) => i.code !== 'REIMBURSEMENT' && i.amount > 0).flatMap((i) => i.refIds ?? []);
  const claimIds = items.filter((i) => i.code === 'REIMBURSEMENT' && i.amount > 0).flatMap((i) => i.refIds ?? []);

  const [updated] = await prisma.$transaction([
    prisma.finalSettlement.update({
      where: { id: s.id },
      data: { status: 'PAID', paidOn, paymentMode: input.paymentMode, paymentReference: reference },
    }),
    prisma.loan.updateMany({
      where: { companyId, employeeId: s.employeeId, id: { in: loanIds }, status: 'ACTIVE' },
      data: { status: 'CLOSED', balance: 0, remarks: 'Recovered in full & final settlement' },
    }),
    prisma.payrollInput.updateMany({
      where: {
        companyId,
        employeeId: s.employeeId,
        payslipId: null,
        OR: [{ id: { in: inputIds } }, { type: 'REIMBURSEMENT', refId: { in: claimIds } }],
      },
      data: { payslipId: fnfMarker(s.id) },
    }),
  ]);
  await fileStatement(companyId, id, actor.employeeId).catch(() => undefined);
  await notify(companyId, [s.employeeId], {
    event: 'exit.settlement_paid',
    title: 'Full & final settlement paid',
    body: `${inr(Math.abs(s.netAmount))} ${s.netAmount >= 0 ? 'has been released' : 'recovery recorded'} (${humanize(input.paymentMode)}${reference ? `, ref ${reference}` : ''}).`,
    link: '/exits',
    email: true,
  });
  return updated;
}

function buildSettlementPdf(input: {
  companyName: string;
  employee: { name: string; employeeCode: string; designation: string; department: string; joiningDate: Date };
  lastWorkingDay: Date;
  exitType: string;
  code: string | null;
  status: string;
  items: SettlementItem[];
  net: number;
  dueDate: Date | null;
  payment: { paidOn: Date; mode: string; reference: string } | null;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const left = 48;
    const right = doc.page.width - 48;
    const hr = (y: number) => doc.moveTo(left, y).lineTo(right, y).lineWidth(0.7).strokeColor('#CBD5E1').stroke();

    doc.font('Helvetica-Bold').fontSize(19).fillColor('#1E1B4B').text(input.companyName.toUpperCase(), { align: 'center' });
    doc.font('Helvetica').fontSize(11).fillColor('#475569').text('Full & Final Settlement Statement', { align: 'center' });
    doc.moveDown(0.8);
    hr(doc.y);
    doc.moveDown(0.8);

    const info: [string, string][] = [
      ['Employee', `${input.employee.name} (${input.employee.employeeCode})`],
      ['Designation', [input.employee.designation, input.employee.department].filter(Boolean).join(' · ') || '—'],
      ['Date of joining', longDate(input.employee.joiningDate)],
      ['Last working day', longDate(input.lastWorkingDay)],
      ['Exit type', `${input.exitType.replace(/_/g, ' ')}${input.code ? ` · ${input.code}` : ''}`],
      ['Status', input.status],
      ...(input.dueDate ? ([['Payment due by', longDate(input.dueDate)]] as [string, string][]) : []),
      ...(input.payment
        ? ([['Paid', `${longDate(input.payment.paidOn)} · ${input.payment.mode.replace(/_/g, ' ')}${input.payment.reference ? ` · ${input.payment.reference}` : ''}`]] as [string, string][])
        : []),
    ];
    const colW = (right - left) / 2;
    const startY = doc.y;
    info.forEach(([label, value], i) => {
      const x = left + (i % 2) * colW;
      const y = startY + Math.floor(i / 2) * 32;
      doc.font('Helvetica').fontSize(8.5).fillColor('#64748B').text(label.toUpperCase(), x, y);
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#0F172A').text(value, x, y + 11, { width: colW - 12 });
    });
    doc.y = startY + Math.ceil(info.length / 2) * 32 + 6;
    hr(doc.y);
    doc.moveDown(1);

    const table = (title: string, rows: SettlementItem[], totalLabel: string) => {
      const total = rows.reduce((s, i) => s + i.amount, 0);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#1E1B4B').text(title, left, doc.y);
      doc.moveDown(0.5);
      if (rows.length === 0) {
        doc.font('Helvetica').fontSize(10).fillColor('#94A3B8').text('None', left + 4, doc.y);
        doc.moveDown(0.45);
      }
      for (const item of rows) {
        const y = doc.y;
        doc.font('Helvetica').fontSize(10.5).fillColor('#334155').text(item.label, left + 4, y, { width: right - left - 140 });
        const after = doc.y;
        doc.text(inr(item.amount), left, y, { width: right - left, align: 'right' });
        doc.y = Math.max(after, doc.y);
        doc.moveDown(0.35);
      }
      hr(doc.y + 2);
      doc.moveDown(0.4);
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#0F172A').text(totalLabel, left + 4, y);
      doc.text(inr(round2(total)), left, y, { width: right - left, align: 'right' });
      doc.moveDown(1.2);
    };
    table('Earnings', input.items.filter((i) => i.type === 'EARNING' && i.amount > 0), 'Total earnings');
    table('Deductions', input.items.filter((i) => i.type === 'DEDUCTION' && i.amount > 0), 'Total deductions');

    const boxY = doc.y;
    doc.roundedRect(left, boxY, right - left, 46, 8).fillColor('#EEF2FF').fill();
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#1E1B4B')
      .text(input.net >= 0 ? 'NET PAYABLE' : 'NET RECOVERABLE', left + 16, boxY + 16);
    doc.font('Helvetica-Bold').fontSize(17).fillColor('#4338CA')
      .text(inr(Math.abs(input.net)), left, boxY + 14, { width: right - left - 16, align: 'right' });

    doc.font('Helvetica').fontSize(10).fillColor('#334155');
    doc.text('Employee signature', left, boxY + 120);
    doc.text('Authorised signatory (HR)', left, boxY + 120, { width: right - left, align: 'right' });
    doc.font('Helvetica').fontSize(8.5).fillColor('#94A3B8')
      .text('This is a computer-generated statement.', left, boxY + 160, { width: right - left, align: 'center' });
    doc.end();
  });
}

/** Renders the statement for the current state and stores it under a stable key. */
async function renderStatement(companyId: string, id: string) {
  const r = await prisma.resignation.findFirst({ where: { id, companyId }, include: { employee: true, settlement: true } });
  if (!r || !r.settlement) throw ApiError.notFound('Settlement not found');
  const s = r.settlement;
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } });
  const buffer = await buildSettlementPdf({
    companyName: company.name,
    employee: r.employee,
    lastWorkingDay: s.lastWorkingDay,
    exitType: r.exitType,
    code: r.code,
    status: s.status,
    items: (s.items as unknown as SettlementItem[]) ?? [],
    net: s.netAmount,
    dueDate: s.dueDate,
    payment: s.status === 'PAID' && s.paidOn ? { paidOn: s.paidOn, mode: s.paymentMode, reference: s.paymentReference } : null,
  });
  const key = `${companyId}/settlements/${s.id}.pdf`;
  await putObject(key, buffer, 'application/pdf');
  return { r, s, key, size: buffer.length, fileName: `FnF_${r.employee.employeeCode}.pdf` };
}

/** Files the (paid) statement as a Document of the employee — once. */
async function fileStatement(companyId: string, id: string, uploadedById: string | null) {
  const { r, key, size } = await renderStatement(companyId, id);
  const existing = await prisma.document.findUnique({ where: { fileKey: key } });
  if (existing) {
    await prisma.document.update({ where: { id: existing.id }, data: { size, uploadedOn: new Date() } });
    return existing;
  }
  return prisma.document.create({
    data: {
      companyId,
      employeeId: r.employeeId,
      name: 'Full & Final Settlement Statement.pdf',
      category: LETTERS_FOLDER,
      fileKey: key,
      mimeType: 'application/pdf',
      size,
      uploadedById,
    },
  });
}

export async function settlementPdfUrl(companyId: string, id: string, viewer: Actor, opts: { inline?: boolean } = {}) {
  const r = await prisma.resignation.findFirst({ where: { id, companyId }, select: { employeeId: true } });
  if (!r) throw ApiError.notFound('Settlement not found');
  if (!isCompanyAdmin(viewer.role) && viewer.employeeId !== r.employeeId) throw ApiError.forbidden();
  const { key, fileName } = await renderStatement(companyId, id);
  return { url: await presignedGetUrl(key, fileName, opts.inline ? 'inline' : 'attachment'), fileName, expiresInSeconds: FILE_LINK_TTL_SECONDS };
}

// ---- Daily job ----

/** Reminds HR / ADMIN of exits whose F&F is past its due date and not yet paid. */
export async function notifyOverdueSettlements(companyId: string): Promise<number> {
  const today = todayUTC();
  const exits = await prisma.resignation.findMany({
    where: { companyId, status: { in: ['APPROVED', 'COMPLETED'] }, closedAt: null, approvedLastDay: { lt: today } },
    select: {
      id: true, code: true, status: true, approvedLastDay: true, requestedLastDay: true, closedAt: true,
      employee: { select: { name: true } },
      settlement: { select: { status: true, netAmount: true, dueDate: true } },
    },
  });
  const overdue = exits.filter((r) => fnfOverdue(r, r.settlement, today));
  if (overdue.length === 0) return 0;
  await notify(companyId, await employeeIdsWithRoles(companyId), {
    event: 'exit.settlement_overdue',
    title: `${overdue.length} full & final settlement(s) overdue`,
    body: overdue.slice(0, 5).map((r) => `${r.employee.name}${r.code ? ` (${r.code})` : ''}`).join(', ') + (overdue.length > 5 ? ', …' : ''),
    link: '/exits',
    email: true,
  });
  return overdue.length;
}
