/**
 * Payroll output files, all built from the stored payslips of a run:
 *   - bank transfer file (CSV)
 *   - EPFO ECR 2.0 text file (#~# separated)
 *   - ESI monthly contribution CSV
 *   - Professional Tax summary by state (CSV)
 *   - payroll register (every component as a column, CSV)
 *   - Form 16 Part B (PDF, per employee per financial year)
 */
import PDFDocument from 'pdfkit';
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/http';
import { toCsv } from '../utils/csv';
import { decryptField } from '../utils/fieldCrypto';
import { presignedGetUrl, putObject } from '../lib/storage';
import { amountInWords, inr, withTotals, type PayItem } from './payroll.service';
import { fyOf, fyRange, loadStatutoryContext } from './statutory.service';
import { emptyFacts, loadTaxContext, payslipTaxFacts, projectTax } from './tds.service';

const items = (v: unknown): PayItem[] => (Array.isArray(v) ? (v as PayItem[]) : []);
const reveal = (v: string | null | undefined): string => decryptField(v ?? '') ?? '';
const ym = (d: Date): string => d.toISOString().slice(0, 7);

async function runWithSlips(companyId: string, runId: string) {
  const run = await prisma.payrollRun.findFirst({ where: { id: runId, companyId } });
  if (!run) throw ApiError.notFound('Payroll run not found');
  const slips = await prisma.payslip.findMany({
    where: { runId },
    include: {
      employee: {
        select: {
          id: true, name: true, employeeCode: true, department: true, designation: true, bankName: true, accountNumber: true,
          ifsc: true, uan: true, esiNumber: true, pan: true, leavingDate: true,
        },
      },
    },
    orderBy: { employee: { employeeCode: 'asc' } },
  });
  return { run, slips };
}

const line = (list: PayItem[], code: string): PayItem | undefined => list.find((l) => l.code === code);

/** Bank transfer file — only for a LOCKED or PUBLISHED run (figures must be final). */
export async function bankFile(companyId: string, runId: string) {
  const { run, slips } = await runWithSlips(companyId, runId);
  if (run.status === 'DRAFT') throw ApiError.conflict('Lock the run before generating the bank transfer file');
  const rows = slips
    .filter((p) => p.netPay > 0)
    .map((p) => [
      p.employee.employeeCode,
      p.employee.name,
      reveal(p.employee.accountNumber),
      p.employee.ifsc.toUpperCase(),
      p.employee.bankName,
      Math.round(p.netPay),
      `Salary ${ym(run.month)}`,
    ]);
  return {
    fileName: `bank-transfer-${ym(run.month)}.csv`,
    csv: toCsv(['Employee Code', 'Beneficiary Name', 'Account Number', 'IFSC', 'Bank', 'Amount', 'Narration'], rows),
  };
}

/**
 * EPFO ECR 2.0: one line per member —
 * UAN#~#Name#~#Gross wages#~#EPF wages#~#EPS wages#~#EDLI wages#~#EPF contribution (employee)
 * #~#EPS contribution#~#EPF-EPS difference (employer share)#~#NCP days#~#Refund of advances
 */
export async function ecrFile(companyId: string, runId: string) {
  const { run, slips } = await runWithSlips(companyId, runId);
  const lines: string[] = [];
  const missingUan: string[] = [];
  for (const p of slips) {
    const pf = line(items(p.deductions), 'PF');
    if (!pf || pf.amount <= 0) continue;
    const employer = items(p.employerContributions);
    const eps = line(employer, 'EPS');
    const epf = line(employer, 'EPF');
    const uan = reveal(p.employee.uan).replace(/\s/g, '');
    if (!uan) missingUan.push(p.employee.employeeCode);
    const epfWages = Math.round(pf.wages ?? 0);
    lines.push([
      uan,
      p.employee.name.toUpperCase(),
      Math.round(p.gross),
      epfWages,
      Math.round(eps?.wages ?? 0),
      Math.round(pf.edliWages ?? Math.min(epfWages, 15000)),
      Math.round(pf.amount),
      Math.round(eps?.amount ?? 0),
      Math.round(epf?.amount ?? 0),
      Math.round(p.lopDays),
      0,
    ].join('#~#'));
  }
  return { fileName: `ECR-${ym(run.month)}.txt`, text: lines.join('\n') + (lines.length ? '\n' : ''), missingUan };
}

/** ESI monthly contribution (ESIC upload columns + contributions for reconciliation). */
export async function esiFile(companyId: string, runId: string) {
  const { run, slips } = await runWithSlips(companyId, runId);
  const rows = slips
    .map((p) => ({ p, esi: line(items(p.deductions), 'ESI'), er: line(items(p.employerContributions), 'ESI_ER') }))
    .filter((x) => x.esi && x.esi.amount > 0)
    .map(({ p, esi, er }) => [
      p.employee.esiNumber,
      p.employee.name,
      p.paidDays,
      Math.round(esi?.wages ?? 0),
      p.paidDays === 0 ? 1 : '',
      p.employee.leavingDate && ym(p.employee.leavingDate) === ym(run.month) ? p.employee.leavingDate : '',
      Math.round(esi?.amount ?? 0),
      Math.round(er?.amount ?? 0),
    ]);
  return {
    fileName: `ESI-${ym(run.month)}.csv`,
    csv: toCsv(
      ['IP Number', 'IP Name', 'No of Days', 'Total Monthly Wages', 'Reason Code', 'Last Working Day', 'Employee Contribution', 'Employer Contribution'],
      rows
    ),
  };
}

/** Professional Tax by state and slab amount. */
export async function ptSummary(companyId: string, runId: string) {
  const { run, slips } = await runWithSlips(companyId, runId);
  const groups = new Map<string, { state: string; amount: number; employees: number; total: number; gross: number }>();
  for (const p of slips) {
    const pt = line(items(p.deductions), 'PT');
    if (!pt || pt.amount <= 0) continue;
    const state = pt.state ?? '';
    const key = `${state}|${pt.amount}`;
    const g = groups.get(key) ?? { state, amount: pt.amount, employees: 0, total: 0, gross: 0 };
    g.employees++;
    g.total += pt.amount;
    g.gross += p.gross;
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((a, b) => a.state.localeCompare(b.state) || a.amount - b.amount);
  return {
    fileName: `PT-${ym(run.month)}.csv`,
    rows,
    csv: toCsv(
      ['State', 'PT per employee', 'Employees', 'Total PT', 'Gross wages'],
      rows.map((r) => [r.state, r.amount, r.employees, Math.round(r.total), Math.round(r.gross)])
    ),
  };
}

/** Payroll register: one row per payslip, every earning / deduction / employer line as a column. */
export async function registerFile(companyId: string, runId: string) {
  const { run, slips } = await runWithSlips(companyId, runId);
  const labels = (pick: (p: (typeof slips)[number]) => PayItem[]) => {
    const seen: string[] = [];
    for (const p of slips) for (const l of pick(p)) if (!seen.includes(l.label)) seen.push(l.label);
    return seen;
  };
  const eLabels = labels((p) => items(p.earnings));
  const dLabels = labels((p) => items(p.deductions));
  const cLabels = labels((p) => items(p.employerContributions));
  const amountOf = (list: PayItem[], label: string) =>
    Math.round(list.filter((l) => l.label === label).reduce((s, l) => s + l.amount, 0));
  const headers = [
    'Employee Code', 'Name', 'Department', 'Designation', 'Status', 'Working Days', 'Paid Days', 'LOP Days',
    ...eLabels, 'Gross', ...dLabels, 'Total Deductions', 'Net Pay', ...cLabels.map((l) => `${l} (Employer)`), 'Employer Cost',
  ];
  const rows = slips.map((p) => {
    const t = withTotals(p);
    const employer = items(p.employerContributions);
    return [
      p.employee.employeeCode, p.employee.name, p.employee.department, p.employee.designation, p.status,
      p.workingDays, p.paidDays, p.lopDays,
      ...eLabels.map((l) => amountOf(items(p.earnings), l)), Math.round(t.gross),
      ...dLabels.map((l) => amountOf(items(p.deductions), l)), Math.round(t.totalDeductions), Math.round(t.net),
      ...cLabels.map((l) => amountOf(employer, l)), Math.round(t.gross + employer.reduce((s, x) => s + x.amount, 0)),
    ];
  });
  return { fileName: `payroll-register-${ym(run.month)}.csv`, csv: toCsv(headers, rows) };
}

/* -------------------------------- Form 16 --------------------------------- */

/**
 * Form 16 Part B (salary details and tax computation) for an employee and
 * financial year, from the FY's published payslips. While the FY is in
 * progress the document is marked provisional. Declarations count only once
 * VERIFIED (the year-end rule).
 */
export async function form16(companyId: string, employeeId: string, fy: string) {
  const { start, endExclusive } = fyRange(fy);
  const [employee, company, stat, slips] = await Promise.all([
    prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true, name: true, employeeCode: true, designation: true, pan: true, taxRegime: true, officeId: true },
    }),
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } }),
    loadStatutoryContext(companyId),
    prisma.payslip.findMany({
      where: { companyId, employeeId, status: 'PUBLISHED', month: { gte: start, lt: endExclusive } },
      orderBy: { month: 'asc' },
    }),
  ]);
  if (!employee) throw ApiError.notFound('Employee not found');
  if (slips.length === 0) throw ApiError.notFound(`No published payslips for FY ${fy}`);

  const office = employee.officeId
    ? await prisma.office.findFirst({ where: { id: employee.officeId, companyId }, select: { isMetro: true } })
    : null;
  // Evaluate as of March (verified declarations only), over the actual payslips.
  const march = new Date(Date.UTC(start.getUTCFullYear() + 1, 2, 1));
  const tax = await loadTaxContext(companyId, fy, endExclusive, [employeeId]);
  const lastComp = slips[slips.length - 1]?.taxComputation as { regime?: string } | null;
  const regime = (lastComp?.regime ?? employee.taxRegime) === 'OLD' ? 'OLD' : 'NEW';
  const rule = tax.rules.get(regime);
  if (!rule) throw ApiError.badRequest(`No ${regime} regime tax rule for FY ${fy}`);
  const comp = projectTax({
    fy,
    month: march,
    regime,
    rule,
    prior: tax.prior.get(employeeId) ?? emptyFacts(),
    current: emptyFacts(),
    future: emptyFacts(),
    futureMonths: 0,
    declaration: tax.declarations.get(employeeId) ?? null,
    isMetro: !!office?.isMetro,
  });
  const monthly = slips.map((p) => ({ month: p.month, gross: withTotals(p).gross, tds: payslipTaxFacts(p.earnings, p.deductions).tds }));
  const provisional = new Date() < endExclusive;

  const buffer = await buildForm16Pdf({
    companyName: company.name,
    tan: stat.config.tan,
    companyPan: stat.config.companyPan,
    employee: { name: employee.name, code: employee.employeeCode, designation: employee.designation, pan: reveal(employee.pan) },
    fy,
    provisional,
    comp,
    monthly,
  });
  const key = `${companyId}/form16/${employeeId}-${fy}.pdf`;
  await putObject(key, buffer, 'application/pdf');
  const fileName = `Form16_PartB_${employee.employeeCode}_${fy}.pdf`;
  return { url: await presignedGetUrl(key, fileName), fileName, expiresInSeconds: 600, provisional, fy };
}

function buildForm16Pdf(input: {
  companyName: string;
  tan: string;
  companyPan: string;
  employee: { name: string; code: string; designation: string; pan: string };
  fy: string;
  provisional: boolean;
  comp: ReturnType<typeof projectTax>;
  monthly: { month: Date; gross: number; tds: number }[];
}): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const left = 48;
    const right = doc.page.width - 48;
    const width = right - left;
    const { comp } = input;
    const [y1 = 0] = input.fy.split('-').map(Number);
    const ay = `${y1 + 1}-${String((y1 + 2) % 100).padStart(2, '0')}`;

    const hr = (y: number) => doc.moveTo(left, y).lineTo(right, y).lineWidth(0.6).strokeColor('#CBD5E1').stroke();
    const row = (label: string, value: number | string, opts: { bold?: boolean; indent?: number } = {}) => {
      if (doc.y > doc.page.height - 80) doc.addPage();
      const y = doc.y;
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor('#0F172A')
        .text(label, left + (opts.indent ?? 0), y, { width: width - 130 });
      const after = doc.y;
      doc.text(typeof value === 'number' ? inr(Math.round(value)) : value, left, y, { width, align: 'right' });
      doc.y = Math.max(after, doc.y) + 3;
    };
    const heading = (t: string) => {
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#1E1B4B').text(t, left, doc.y);
      doc.moveDown(0.3);
    };

    doc.font('Helvetica-Bold').fontSize(15).fillColor('#1E1B4B').text('FORM No. 16 — PART B', { align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor('#475569')
      .text('Details of salary paid and tax deducted thereon (section 192)', { align: 'center' });
    if (input.provisional) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#B45309')
        .text('PROVISIONAL — the financial year is still in progress', { align: 'center' });
    }
    doc.moveDown(0.6);
    hr(doc.y);
    doc.moveDown(0.5);
    row('Employer', input.companyName);
    row('Employer TAN / PAN', `${input.tan || '—'} / ${input.companyPan || '—'}`);
    row('Employee', `${input.employee.name} (${input.employee.code})`);
    row('Designation', input.employee.designation || '—');
    row('Employee PAN', input.employee.pan || '—');
    row('Financial year / Assessment year', `${input.fy} / ${ay}`);
    row('Tax regime', comp.regime === 'OLD' ? 'Old regime' : 'New regime (section 115BAC)');
    hr(doc.y + 2);

    heading('1. Gross salary');
    row('(a) Salary as per section 17(1)', comp.salary.ytd, { indent: 8 });
    if (comp.salary.previousEmployer > 0) row('(b) Salary from previous employer(s)', comp.salary.previousEmployer, { indent: 8 });
    row('Total', comp.salary.total, { bold: true });

    heading('2. Allowances exempt under section 10');
    if (comp.exemptions.length === 0) row('None', 0, { indent: 8 });
    for (const e of comp.exemptions) row(e.label, e.amount, { indent: 8 });

    heading('3. Deductions under section 16');
    row('(ia) Standard deduction u/s 16(ia)', comp.standardDeduction, { indent: 8 });
    if (comp.regime === 'OLD') row('(iii) Tax on employment u/s 16(iii)', comp.professionalTax, { indent: 8 });

    const exemptions = comp.exemptions.reduce((s, e) => s + e.amount, 0);
    const chargeable = comp.salary.total - exemptions - comp.standardDeduction - comp.professionalTax;
    heading('4. Income chargeable under the head "Salaries"');
    row('Total', Math.max(0, chargeable), { bold: true });

    heading('5. Deductions under Chapter VI-A');
    if (comp.deductions.length === 0) row('None', 0, { indent: 8 });
    for (const d of comp.deductions) row(`Section ${d.section} — ${d.label} (claimed ${inr(d.claimed)})`, d.allowed, { indent: 8 });
    row('Aggregate of deductions', comp.totalDeductions, { bold: true });

    heading('6. Tax computation');
    row('Total taxable income', comp.taxableIncome, { bold: true });
    row('Tax on total income', comp.slabTax, { indent: 8 });
    row('Rebate under section 87A', comp.rebate, { indent: 8 });
    row('Surcharge', comp.surcharge, { indent: 8 });
    row('Health and education cess', comp.cess, { indent: 8 });
    row('Tax payable', comp.annualTax, { bold: true });
    row('Tax deducted by previous employer(s)', comp.previousEmployerTds, { indent: 8 });
    row('Tax deducted at source (this employer)', comp.tdsDeducted, { indent: 8 });
    const balance = comp.annualTax - comp.tdsDeducted - comp.previousEmployerTds;
    row(balance >= 0 ? 'Tax payable / (shortfall)' : 'Excess tax deducted (refundable)', Math.abs(balance), { bold: true });

    heading('7. Monthly TDS deposited');
    for (const m of input.monthly) {
      row(
        m.month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
        `Gross ${inr(Math.round(m.gross))}   ·   TDS ${inr(Math.round(m.tds))}`,
        { indent: 8 }
      );
    }
    row('Total TDS', comp.tdsDeducted, { bold: true });

    doc.moveDown(1);
    doc.font('Helvetica').fontSize(8.5).fillColor('#64748B')
      .text(`Total tax deducted: Rupees ${amountInWords(comp.tdsDeducted)} Only.`, left, doc.y, { width })
      .moveDown(0.4)
      .text(
        'Computer-generated statement from payroll records. Part A (TRACES) is issued separately by the employer.',
        { width }
      );
    doc.end();
  });
}

/** Current FY when none is given. */
export const defaultFy = (): string => fyOf(new Date());
