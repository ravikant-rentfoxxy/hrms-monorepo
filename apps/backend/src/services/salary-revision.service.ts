/**
 * Salary components, templates and revisions (salary history + approvals).
 *
 *   Component  — a pay head (BASIC, HRA, ...) with a calculation rule.
 *   Template   — an ordered set of components used to split a CTC.
 *   Revision   — a dated change to an employee's monthly structure.
 *                PENDING → (approval chain SALARY_REVISION) → APPROVED → APPLIED
 *                or REJECTED. Applying copies `monthly` into the Employee
 *                salary columns; back-dated revisions create ARREAR inputs for
 *                months whose payslips were already published.
 *
 * CTC convention (same as salary.service): CTC = gross + employer PF +
 * gratuity provision, so a revision's CTC matches the panel's breakup card.
 */
import type { Request } from 'express';
import type { Prisma, Role, SalaryRevision } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';
import { dateOnlyUTC, workingDays } from '../utils/geo';
import { addMonths, monthEnd, monthLabel, monthStart, rupees } from '../utils/finance';
import { gratuityFor, structureFromCtc } from './salary.service';
import * as approvalService from './approval.service';
import { recordHistory } from './employee-history.service';

// ---- Types ----

export const COMPONENT_TYPES = ['EARNING', 'DEDUCTION'] as const;
export const COMPONENT_CALCS = ['FIXED', 'PERCENT_OF_BASIC', 'PERCENT_OF_CTC', 'BALANCE'] as const;
export type ComponentCalc = (typeof COMPONENT_CALCS)[number];

export interface ComponentInput {
  code: string;
  name: string;
  type: (typeof COMPONENT_TYPES)[number];
  calc: ComponentCalc;
  value: number;
  taxable: boolean;
  sortOrder: number;
}

export interface TemplateComponent {
  code: string;
  calc: ComponentCalc;
  value: number;
}

export interface TemplateInput {
  name: string;
  description?: string;
  components: TemplateComponent[];
  isActive?: boolean;
}

/** Monthly structure, mapped 1:1 onto the Employee salary columns. */
export interface MonthlyStructure {
  basic: number;
  hra: number;
  conveyance: number;
  medical: number;
  allowance: number;
  pfEmployer: number;
  pfEmployee: number;
}

export interface RevisionInput {
  employeeId: string;
  effectiveFrom: Date;
  ctcAnnual: number;
  templateId?: string;
  monthly?: MonthlyStructure;
  reason: string;
}

export interface Actor {
  role: Role;
  employeeId: string | null;
}

const ZERO: MonthlyStructure = { basic: 0, hra: 0, conveyance: 0, medical: 0, allowance: 0, pfEmployer: 0, pfEmployee: 0 };

/** Lazily seeded pay heads for a company that has none yet. */
const DEFAULT_COMPONENTS: ComponentInput[] = [
  // Labour Codes: wages (basic) should be at least 50% of total remuneration.
  { code: 'BASIC', name: 'Basic', type: 'EARNING', calc: 'PERCENT_OF_CTC', value: 50, taxable: true, sortOrder: 1 },
  { code: 'HRA', name: 'House Rent Allowance', type: 'EARNING', calc: 'PERCENT_OF_BASIC', value: 50, taxable: true, sortOrder: 2 },
  { code: 'CONV', name: 'Conveyance Allowance', type: 'EARNING', calc: 'FIXED', value: 1600, taxable: true, sortOrder: 3 },
  { code: 'MED', name: 'Medical Allowance', type: 'EARNING', calc: 'FIXED', value: 1250, taxable: true, sortOrder: 4 },
  { code: 'SPECIAL', name: 'Special Allowance', type: 'EARNING', calc: 'BALANCE', value: 0, taxable: true, sortOrder: 5 },
];

/** Component codes that map onto a dedicated Employee column; everything else lands in `allowance`. */
const COLUMN_FOR_CODE: Record<string, keyof MonthlyStructure> = {
  BASIC: 'basic',
  HRA: 'hra',
  CONV: 'conveyance',
  CONVEYANCE: 'conveyance',
  MED: 'medical',
  MEDICAL: 'medical',
};

export const grossOf = (m: MonthlyStructure): number => m.basic + m.hra + m.conveyance + m.medical + m.allowance;

export const monthlyFromEmployee = (e: {
  salaryBasic: number; salaryHra: number; salaryConveyance: number; salaryMedical: number;
  salaryAllowance: number; salaryPfEmployer: number; salaryPfEmployee: number;
}): MonthlyStructure => ({
  basic: e.salaryBasic,
  hra: e.salaryHra,
  conveyance: e.salaryConveyance,
  medical: e.salaryMedical,
  allowance: e.salaryAllowance,
  pfEmployer: e.salaryPfEmployer,
  pfEmployee: e.salaryPfEmployee,
});

const employeeColumns = (m: MonthlyStructure) => ({
  salaryBasic: m.basic,
  salaryHra: m.hra,
  salaryConveyance: m.conveyance,
  salaryMedical: m.medical,
  salaryAllowance: m.allowance,
  salaryPfEmployer: m.pfEmployer,
  salaryPfEmployee: m.pfEmployee,
});

/** Annual CTC of a monthly structure: (gross + employer PF + gratuity provision) × 12. */
export const ctcAnnualOf = (m: MonthlyStructure): number => (grossOf(m) + m.pfEmployer + gratuityFor(m.basic)) * 12;

/** PF (employer, employee) on a basic, per the company's statutory settings. */
async function pfCalculator(companyId: string) {
  const cfg = await prisma.statutoryConfig.findUnique({ where: { companyId } });
  const enabled = cfg?.pfEnabled ?? true;
  const ceiling = cfg?.pfWageCeiling ?? 15000;
  const restrict = cfg?.pfRestrictToCeiling ?? true;
  const erRate = cfg?.pfEmployerRate ?? 12;
  const eeRate = cfg?.pfEmployeeRate ?? 12;
  return (basic: number) => {
    if (!enabled || basic <= 0) return { employer: 0, employee: 0 };
    const wage = restrict ? Math.min(basic, ceiling) : basic;
    return { employer: rupees((wage * erRate) / 100), employee: rupees((wage * eeRate) / 100) };
  };
}

// ---- Components ----

export async function ensureDefaultComponents(companyId: string) {
  const count = await prisma.salaryComponent.count({ where: { companyId } });
  if (count > 0) return;
  await prisma.salaryComponent.createMany({
    data: DEFAULT_COMPONENTS.map((c) => ({ ...c, companyId })),
    skipDuplicates: true,
  });
}

export async function listComponents(companyId: string) {
  await ensureDefaultComponents(companyId);
  return prisma.salaryComponent.findMany({ where: { companyId }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
}

export async function createComponent(companyId: string, input: ComponentInput, req: Request) {
  await ensureDefaultComponents(companyId);
  const exists = await prisma.salaryComponent.findUnique({ where: { companyId_code: { companyId, code: input.code } } });
  if (exists) throw ApiError.conflict(`Component ${input.code} already exists`);
  const created = await prisma.salaryComponent.create({ data: { ...input, companyId } });
  await audit(req, { entity: 'SalaryComponent', entityId: created.id, action: 'CREATE', after: created });
  return created;
}

export async function updateComponent(
  companyId: string,
  id: string,
  input: Partial<Omit<ComponentInput, 'code'>> & { isActive?: boolean },
  req: Request
) {
  const before = await prisma.salaryComponent.findFirst({ where: { id, companyId } });
  if (!before) throw ApiError.notFound('Component not found');
  if (before.code === 'BASIC' && input.isActive === false) throw ApiError.badRequest('BASIC cannot be deactivated');
  const after = await prisma.salaryComponent.update({ where: { id }, data: input });
  await audit(req, { entity: 'SalaryComponent', entityId: id, action: 'UPDATE', before, after });
  return after;
}

/** Deletes a pay head unless an active template still uses it (deactivate it instead). */
export async function deleteComponent(companyId: string, id: string, req: Request) {
  const comp = await prisma.salaryComponent.findFirst({ where: { id, companyId } });
  if (!comp) throw ApiError.notFound('Component not found');
  if (comp.code === 'BASIC') throw ApiError.badRequest('BASIC cannot be deleted');
  const templates = await prisma.salaryTemplate.findMany({ where: { companyId, isActive: true } });
  const usedBy = templates.filter((t) => (t.components as unknown as TemplateComponent[]).some((c) => c.code === comp.code));
  if (usedBy.length > 0) {
    throw ApiError.conflict(`Used by template(s): ${usedBy.map((t) => t.name).join(', ')} — remove it there or deactivate it`);
  }
  await prisma.salaryComponent.delete({ where: { id } });
  await audit(req, { entity: 'SalaryComponent', entityId: id, action: 'DELETE', before: comp });
}

// ---- Templates ----

async function validateTemplateComponents(companyId: string, components: TemplateComponent[]) {
  await ensureDefaultComponents(companyId);
  const codes = components.map((c) => c.code);
  if (new Set(codes).size !== codes.length) throw ApiError.badRequest('A component can appear only once in a template');
  if (!codes.includes('BASIC')) throw ApiError.badRequest('A template needs a BASIC component');
  if (components.filter((c) => c.calc === 'BALANCE').length > 1) {
    throw ApiError.badRequest('Only one component can be the BALANCE (remaining CTC)');
  }
  const basic = components.find((c) => c.code === 'BASIC');
  if (basic?.calc === 'PERCENT_OF_BASIC' || basic?.calc === 'BALANCE') {
    throw ApiError.badRequest('BASIC must be FIXED or PERCENT_OF_CTC');
  }
  const known = await prisma.salaryComponent.findMany({ where: { companyId, code: { in: codes } }, select: { code: true } });
  const missing = codes.filter((c) => !known.some((k) => k.code === c));
  if (missing.length > 0) throw ApiError.badRequest(`Unknown component(s): ${missing.join(', ')}`);
}

export async function listTemplates(companyId: string) {
  return prisma.salaryTemplate.findMany({ where: { companyId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
}

export async function createTemplate(companyId: string, input: TemplateInput, req: Request) {
  await validateTemplateComponents(companyId, input.components);
  const created = await prisma.salaryTemplate.create({
    data: {
      companyId,
      name: input.name,
      description: input.description ?? '',
      components: input.components as unknown as Prisma.InputJsonValue,
      isActive: input.isActive ?? true,
    },
  });
  await audit(req, { entity: 'SalaryTemplate', entityId: created.id, action: 'CREATE', after: created });
  return created;
}

export async function updateTemplate(companyId: string, id: string, input: Partial<TemplateInput>, req: Request) {
  const before = await prisma.salaryTemplate.findFirst({ where: { id, companyId } });
  if (!before) throw ApiError.notFound('Template not found');
  if (input.components) await validateTemplateComponents(companyId, input.components);
  const after = await prisma.salaryTemplate.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.components ? { components: input.components as unknown as Prisma.InputJsonValue } : {}),
    },
  });
  await audit(req, { entity: 'SalaryTemplate', entityId: id, action: 'UPDATE', before, after });
  return after;
}

export async function deleteTemplate(companyId: string, id: string, req: Request) {
  const before = await prisma.salaryTemplate.findFirst({ where: { id, companyId } });
  if (!before) throw ApiError.notFound('Template not found');
  // Revisions keep a templateId for reference only, so a hard delete is safe.
  await prisma.salaryTemplate.delete({ where: { id } });
  await audit(req, { entity: 'SalaryTemplate', entityId: id, action: 'DELETE', before });
}

// ---- Preview (CTC → monthly breakup) ----

export interface PreviewLine {
  code: string;
  name: string;
  amount: number;
  column: keyof MonthlyStructure;
}

export interface SalaryPreview {
  ctcAnnual: number;
  ctcMonthly: number;
  monthly: MonthlyStructure;
  lines: PreviewLine[];
  gross: number;
  gratuity: number;
  netMonthly: number;
  warnings: string[];
}

/** The company standard structure: active earning components from Salary → Components, in order. */
async function standardParts(companyId: string): Promise<TemplateComponent[]> {
  await ensureDefaultComponents(companyId);
  const comps = await prisma.salaryComponent.findMany({
    where: { companyId, isActive: true, type: 'EARNING' },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
  });
  return comps.map((c) => ({ code: c.code, calc: c.calc as TemplateComponent['calc'], value: c.value }));
}

/**
 * Splits an annual CTC into the monthly Employee columns.
 * Without a template the company standard (Salary → Components) is used; if
 * it has no active BASIC, the built-in structure from salary.service.
 * With a template: PERCENT_OF_CTC is a % of the monthly gross (CTC − employer
 * PF − gratuity; solved iteratively since PF depends on basic), PERCENT_OF_BASIC
 * a % of basic, FIXED a fixed amount, BALANCE whatever gross remains.
 */
export async function preview(companyId: string, ctcAnnual: number, templateId?: string): Promise<SalaryPreview> {
  if (ctcAnnual <= 0) throw ApiError.badRequest('CTC must be greater than zero');
  const ctcMonthly = ctcAnnual / 12;
  const warnings: string[] = [];

  let parts: TemplateComponent[];
  if (templateId) {
    const template = await prisma.salaryTemplate.findFirst({ where: { id: templateId, companyId } });
    if (!template) throw ApiError.notFound('Salary template not found');
    if (!template.isActive) throw ApiError.badRequest('This template is inactive');
    parts = template.components as unknown as TemplateComponent[];
  } else {
    parts = await standardParts(companyId);
  }

  if (!parts.some((p) => p.code === 'BASIC')) {
    const s = structureFromCtc(rupees(ctcMonthly));
    const monthly: MonthlyStructure = {
      basic: s.salaryBasic, hra: s.salaryHra, conveyance: s.salaryConveyance, medical: s.salaryMedical,
      allowance: s.salaryAllowance, pfEmployer: s.salaryPfEmployer, pfEmployee: s.salaryPfEmployee,
    };
    return finishPreview(ctcAnnual, monthly, [
      { code: 'BASIC', name: 'Basic', amount: monthly.basic, column: 'basic' },
      { code: 'HRA', name: 'House Rent Allowance', amount: monthly.hra, column: 'hra' },
      { code: 'CONV', name: 'Conveyance Allowance', amount: monthly.conveyance, column: 'conveyance' },
      { code: 'MED', name: 'Medical Allowance', amount: monthly.medical, column: 'medical' },
      { code: 'SPECIAL', name: 'Special Allowance', amount: monthly.allowance, column: 'allowance' },
    ], warnings);
  }

  const comps = await prisma.salaryComponent.findMany({ where: { companyId, code: { in: parts.map((p) => p.code) } } });
  const meta = (code: string) => comps.find((c) => c.code === code);
  const earnings = parts
    .filter((p) => (meta(p.code)?.type ?? 'EARNING') === 'EARNING')
    .sort((a, b) => (meta(a.code)?.sortOrder ?? 0) - (meta(b.code)?.sortOrder ?? 0));
  const skipped = parts.filter((p) => meta(p.code)?.type === 'DEDUCTION');
  if (skipped.length > 0) {
    warnings.push(`Deduction components (${skipped.map((p) => p.code).join(', ')}) are not part of the monthly structure`);
  }
  const basicPart = earnings.find((p) => p.code === 'BASIC');
  if (!basicPart) throw ApiError.badRequest('Template has no BASIC component');

  const pf = await pfCalculator(companyId);
  const basicFor = (gross: number) => (basicPart.calc === 'FIXED' ? basicPart.value : (gross * basicPart.value) / 100);
  // gross = CTC − employer PF(basic) − gratuity(basic), basic = f(gross): converges in a few steps.
  let gross = ctcMonthly;
  for (let i = 0; i < 8; i++) {
    const b = rupees(basicFor(gross));
    gross = ctcMonthly - pf(b).employer - gratuityFor(b);
  }
  gross = rupees(gross);
  const basic = rupees(basicFor(gross));

  const lines: PreviewLine[] = [];
  let used = 0;
  for (const p of earnings) {
    if (p.calc === 'BALANCE') continue;
    let amount = p.code === 'BASIC' ? basic : 0;
    if (p.code !== 'BASIC') {
      if (p.calc === 'FIXED') amount = p.value;
      else if (p.calc === 'PERCENT_OF_BASIC') amount = (basic * p.value) / 100;
      else if (p.calc === 'PERCENT_OF_CTC') amount = (gross * p.value) / 100;
    }
    amount = Math.max(0, rupees(amount));
    used += amount;
    lines.push({ code: p.code, name: meta(p.code)?.name ?? p.code, amount, column: COLUMN_FOR_CODE[p.code] ?? 'allowance' });
  }
  const balancePart = earnings.find((p) => p.calc === 'BALANCE');
  let remainder = gross - used;
  if (remainder < 0) {
    // Over-allocated: trim fixed / percentage allowances (never basic) from the bottom up.
    warnings.push('Components exceed the CTC — allowances were reduced to fit');
    for (const line of [...lines].reverse()) {
      if (remainder >= 0) break;
      if (line.code === 'BASIC') continue;
      const cut = Math.min(line.amount, -remainder);
      line.amount -= cut;
      remainder += cut;
    }
    if (remainder < 0) throw ApiError.badRequest('CTC is too low for this template (basic alone exceeds it)');
  }
  if (balancePart) {
    lines.push({ code: balancePart.code, name: meta(balancePart.code)?.name ?? balancePart.code, amount: remainder,
      column: COLUMN_FOR_CODE[balancePart.code] ?? 'allowance' });
  } else if (remainder > 0) {
    warnings.push(`₹${remainder} of the CTC is unallocated (no BALANCE component) — added to allowance`);
    lines.push({ code: 'UNALLOCATED', name: 'Other allowance', amount: remainder, column: 'allowance' });
  }

  const monthly: MonthlyStructure = { ...ZERO };
  for (const l of lines) monthly[l.column] += l.amount;
  const p = pf(monthly.basic);
  monthly.pfEmployer = p.employer;
  monthly.pfEmployee = p.employee;
  return finishPreview(ctcAnnual, monthly, lines, warnings);
}

function finishPreview(ctcAnnual: number, monthly: MonthlyStructure, lines: PreviewLine[], warnings: string[]): SalaryPreview {
  const gross = grossOf(monthly);
  const gratuity = gratuityFor(monthly.basic);
  // Labour Codes: wages (basic) should be at least 50% of total remuneration.
  if (gross > 0 && monthly.basic < 0.5 * (gross + monthly.pfEmployer + gratuity) - 1) {
    warnings.push('Basic is below 50% of CTC (Labour Codes wage rule)');
  }
  return {
    ctcAnnual,
    ctcMonthly: rupees(ctcAnnual / 12),
    monthly,
    lines,
    gross,
    gratuity,
    netMonthly: gross - monthly.pfEmployee,
    warnings,
  };
}

// ---- Revisions ----

const revisionInclude = {
  employee: { select: { id: true, name: true, employeeCode: true, department: true, designation: true } },
} as const;

async function withExtras<T extends SalaryRevision>(companyId: string, rows: T[]) {
  const arrears = await prisma.payrollInput.findMany({
    where: { companyId, refId: { in: rows.map((r) => r.id) }, type: { in: ['ARREAR', 'DEDUCTION'] } },
    select: { id: true, refId: true, month: true, label: true, amount: true, type: true, payslipId: true },
    orderBy: { label: 'asc' },
  });
  const creators = await prisma.employee.findMany({
    where: { id: { in: rows.map((r) => r.createdById).filter((x): x is string => !!x) } },
    select: { id: true, name: true },
  });
  return rows.map((r) => {
    const monthly = r.monthly as unknown as MonthlyStructure;
    const previous = (r.previous as unknown as MonthlyStructure | null) ?? null;
    return {
      ...r,
      grossMonthly: grossOf(monthly),
      previousGrossMonthly: previous ? grossOf(previous) : null,
      createdByName: creators.find((c) => c.id === r.createdById)?.name ?? null,
      arrears: arrears.filter((a) => a.refId === r.id),
    };
  });
}

export async function listRevisions(companyId: string, filter: { employeeId?: string; status?: string }) {
  const rows = await prisma.salaryRevision.findMany({
    where: {
      companyId,
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    include: revisionInclude,
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    take: 500,
  });
  return withExtras(companyId, rows);
}

/** An employee's own salary history (pending/rejected proposals are not shown to them). */
export async function myRevisions(companyId: string, employeeId: string) {
  const rows = await prisma.salaryRevision.findMany({
    where: { companyId, employeeId, status: { in: ['APPROVED', 'APPLIED'] } },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
  });
  const withData = await withExtras(companyId, rows);
  return withData.map(({ createdById: _c, templateId: _t, createdByName: _n, ...r }) => r);
}

/** One revision + approval trail. Visible to ADMIN/HR and to whoever must act on the current step. */
export async function getRevision(companyId: string, id: string, actor: Actor) {
  const rev = await prisma.salaryRevision.findFirst({ where: { id, companyId }, include: revisionInclude });
  if (!rev) throw ApiError.notFound('Salary revision not found');
  const privileged = actor.role === 'SUPER_ADMIN' || actor.role === 'ADMIN' || actor.role === 'HR';
  if (!privileged) {
    const step = await approvalService.currentStep(companyId, 'SALARY_REVISION', id);
    const isApprover = !!step && rev.status === 'PENDING' && approvalService.canAct(step, actor) && actor.employeeId !== rev.employeeId;
    if (!isApprover) throw ApiError.forbidden();
  }
  const [withData] = await withExtras(companyId, [rev]);
  return { ...withData, trail: await approvalService.trail(companyId, 'SALARY_REVISION', id) };
}

/** The employee id that "raised" the revision in the approval chain (HR, or the target as a fallback). */
const requesterOf = (rev: Pick<SalaryRevision, 'createdById' | 'employeeId'>) => rev.createdById ?? rev.employeeId;

export async function createRevision(companyId: string, input: RevisionInput, actor: Actor, req: Request) {
  const employee = await prisma.employee.findFirst({ where: { id: input.employeeId, companyId } });
  if (!employee) throw ApiError.notFound('Employee not found');
  if (!employee.isActive) throw ApiError.badRequest('Employee is inactive');
  if (actor.employeeId && actor.employeeId === input.employeeId) {
    throw ApiError.forbidden('You cannot propose a revision of your own salary');
  }
  const open = await prisma.salaryRevision.findFirst({
    where: { companyId, employeeId: input.employeeId, status: { in: ['PENDING', 'APPROVED'] } },
  });
  if (open) {
    throw ApiError.conflict(
      open.status === 'PENDING'
        ? 'This employee already has a revision awaiting approval'
        : 'This employee has an approved revision waiting for its effective date — cancel it first'
    );
  }
  const effectiveFrom = dateOnlyUTC(input.effectiveFrom);
  if (effectiveFrom < new Date(employee.joiningDate.getTime() - 86400000)) {
    throw ApiError.badRequest('Effective date is before the joining date');
  }
  const monthly = input.monthly ?? (await preview(companyId, input.ctcAnnual, input.templateId)).monthly;
  if (grossOf(monthly) <= 0) throw ApiError.badRequest('The new structure has no earnings');
  if (monthly.basic <= 0) throw ApiError.badRequest('Basic must be greater than zero');

  const rev = await prisma.salaryRevision.create({
    data: {
      companyId,
      employeeId: input.employeeId,
      effectiveFrom,
      ctcAnnual: input.ctcAnnual,
      monthly: monthly as unknown as Prisma.InputJsonValue,
      reason: input.reason,
      templateId: input.templateId ?? null,
      status: 'PENDING',
      createdById: actor.employeeId,
    },
  });
  await approvalService.start(companyId, 'SALARY_REVISION', rev.id, requesterOf(rev));
  await audit(req, { entity: 'SalaryRevision', entityId: rev.id, action: 'CREATE', after: rev });
  return rev;
}

export async function decideRevision(
  companyId: string,
  id: string,
  input: { decision: 'APPROVED' | 'REJECTED'; remarks?: string; actor: Actor },
  req: Request
) {
  const rev = await prisma.salaryRevision.findFirst({ where: { id, companyId } });
  if (!rev) throw ApiError.notFound('Salary revision not found');
  if (rev.status !== 'PENDING') throw ApiError.badRequest(`Revision is already ${rev.status.toLowerCase()}`);
  if (input.actor.employeeId && input.actor.employeeId === rev.employeeId) {
    throw ApiError.forbidden('You cannot decide a revision of your own salary');
  }
  const r = await approvalService.act(
    companyId, 'SALARY_REVISION', rev.id, requesterOf(rev), input.actor, input.decision, input.remarks
  );
  if (r.outcome === 'PENDING') {
    await audit(req, { entity: 'SalaryRevision', entityId: rev.id, action: 'APPROVE_STEP', after: { level: r.step.level } });
    return { ...rev, outcome: r.outcome };
  }
  if (r.outcome === 'REJECTED') {
    const updated = await prisma.salaryRevision.update({ where: { id: rev.id }, data: { status: 'REJECTED' } });
    await audit(req, { entity: 'SalaryRevision', entityId: rev.id, action: 'REJECT', before: rev, after: updated });
    await notify(companyId, [rev.createdById], {
      event: 'salary_revision.rejected',
      title: 'Salary revision rejected',
      body: input.remarks ? `Remarks: ${input.remarks}` : 'The proposed salary revision was rejected.',
      link: '/salary',
    });
    return { ...updated, outcome: r.outcome };
  }
  await audit(req, { entity: 'SalaryRevision', entityId: rev.id, action: 'APPROVE', before: rev });
  const finalized = await finalizeApproved(companyId, rev.id, req);
  return { ...finalized, outcome: r.outcome };
}

/** Approved: apply now when already effective, otherwise leave APPROVED for the daily job. */
async function finalizeApproved(companyId: string, id: string, req: Request | null) {
  const rev = await prisma.salaryRevision.findFirstOrThrow({ where: { id, companyId } });
  const employee = await prisma.employee.findFirstOrThrow({ where: { id: rev.employeeId, companyId } });
  const approved = await prisma.salaryRevision.update({
    where: { id },
    data: { status: 'APPROVED', previous: monthlyFromEmployee(employee) as unknown as Prisma.InputJsonValue },
  });
  if (approved.effectiveFrom <= dateOnlyUTC()) return applyRevision(companyId, id, req);
  await notify(companyId, [rev.employeeId, rev.createdById], {
    event: 'salary_revision.approved',
    title: 'Salary revision approved',
    body: `Your revised salary takes effect from ${approved.effectiveFrom.toISOString().slice(0, 10)}.`,
    link: '/salary',
  });
  return approved;
}

/**
 * Copies the revision into the Employee salary columns (status APPLIED) and
 * raises arrears for already-published months. Idempotent: an APPLIED
 * revision is returned unchanged.
 */
export async function applyRevision(companyId: string, id: string, req: Request | null) {
  const rev = await prisma.salaryRevision.findFirst({ where: { id, companyId } });
  if (!rev) throw ApiError.notFound('Salary revision not found');
  if (rev.status === 'APPLIED') return rev;
  if (rev.status !== 'APPROVED') throw ApiError.badRequest('Only approved revisions can be applied');
  const monthly = rev.monthly as unknown as MonthlyStructure;

  const { applied, previous } = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findFirstOrThrow({ where: { id: rev.employeeId, companyId } });
    const prev = monthlyFromEmployee(employee);
    await tx.employee.update({
      where: { id: employee.id },
      data: { ...employeeColumns(monthly), ...(rev.templateId ? { salaryTemplateId: rev.templateId } : {}) },
    });
    const updated = await tx.salaryRevision.update({
      where: { id: rev.id },
      data: { status: 'APPLIED', previous: prev as unknown as Prisma.InputJsonValue },
    });
    // Career history: old → new CTC.
    await recordHistory(tx, {
      companyId,
      employeeId: employee.id,
      type: 'SALARY_REVISION',
      effectiveDate: rev.effectiveFrom,
      title: `Salary revised: CTC ₹${ctcAnnualOf(prev).toLocaleString('en-IN')} → ₹${rev.ctcAnnual.toLocaleString('en-IN')}`,
      from: { ctcAnnual: ctcAnnualOf(prev), monthly: prev },
      to: { ctcAnnual: rev.ctcAnnual, monthly },
      reason: rev.reason,
      refType: 'SalaryRevision',
      refId: rev.id,
      createdById: rev.createdById,
    });
    return { applied: updated, previous: prev };
  });
  await audit(req, {
    entity: 'Employee',
    entityId: rev.employeeId,
    action: 'SALARY_REVISION_APPLIED',
    before: previous,
    after: monthly,
    ...(req ? {} : { companyId }),
  });
  const arrears = await createArrears(companyId, applied, previous, req);
  await notify(companyId, [rev.employeeId], {
    event: 'salary_revision.applied',
    title: 'Your salary has been revised',
    body:
      `New monthly gross ₹${grossOf(monthly).toLocaleString('en-IN')} effective ${rev.effectiveFrom.toISOString().slice(0, 10)}` +
      (arrears.length > 0 ? `; arrears of ₹${arrears.reduce((s, a) => s + a.amount, 0).toLocaleString('en-IN')} will be paid.` : '.'),
    link: '/salary',
  });
  return applied;
}

/** The month new payroll inputs should land in: this month, or the next one if it's already locked/published. */
async function openInputMonth(companyId: string): Promise<Date> {
  let month = monthStart();
  for (let i = 0; i < 3; i++) {
    const run = await prisma.payrollRun.findUnique({ where: { companyId_month: { companyId, month } } });
    if (!run || run.status === 'DRAFT') return month;
    month = addMonths(month, 1);
  }
  return month;
}

/**
 * Arrears for a back-dated revision: one input per already-published payslip
 * month from the effective month on, (new gross − old gross) × paidDays /
 * workingDays — also prorated for a mid-month effective date. A pay cut
 * produces a recovery DEDUCTION instead. Idempotent per revision (refId).
 */
async function createArrears(companyId: string, rev: SalaryRevision, previous: MonthlyStructure, req: Request | null) {
  const existing = await prisma.payrollInput.count({ where: { companyId, refId: rev.id } });
  if (existing > 0) return [];
  const diff = grossOf(rev.monthly as unknown as MonthlyStructure) - grossOf(previous);
  if (diff === 0) return [];
  const effMonth = monthStart(rev.effectiveFrom);
  const payslips = await prisma.payslip.findMany({
    where: { companyId, employeeId: rev.employeeId, status: 'PUBLISHED', month: { gte: effMonth } },
    orderBy: { month: 'asc' },
  });
  if (payslips.length === 0) return [];
  const target = await openInputMonth(companyId);
  const rows: Prisma.PayrollInputCreateManyInput[] = [];
  for (const p of payslips) {
    if (p.month >= target) continue; // that month will be paid at the new rate anyway
    if (p.workingDays <= 0) continue;
    let factor = Math.min(1, p.paidDays / p.workingDays);
    if (p.month.getTime() === effMonth.getTime() && rev.effectiveFrom.getUTCDate() > 1) {
      const monthDays = workingDays(effMonth, monthEnd(effMonth));
      const covered = workingDays(rev.effectiveFrom, monthEnd(effMonth));
      if (monthDays > 0) factor *= covered / monthDays;
    }
    const amount = rupees(Math.abs(diff) * factor);
    if (amount <= 0) continue;
    rows.push({
      companyId,
      employeeId: rev.employeeId,
      month: target,
      type: diff > 0 ? 'ARREAR' : 'DEDUCTION',
      label: diff > 0 ? `Arrear ${monthLabel(p.month)}` : `Salary recovery ${monthLabel(p.month)}`,
      amount,
      taxable: true,
      refId: rev.id,
      note: `Salary revision effective ${rev.effectiveFrom.toISOString().slice(0, 10)}`,
      createdById: rev.createdById,
    });
  }
  if (rows.length === 0) return [];
  await prisma.payrollInput.createMany({ data: rows });
  await audit(req, {
    entity: 'SalaryRevision',
    entityId: rev.id,
    action: 'ARREARS_CREATED',
    after: rows.map((r) => ({ label: r.label, amount: r.amount, month: r.month })),
    ...(req ? {} : { companyId }),
  });
  return rows.map((r) => ({ label: r.label, amount: r.amount }));
}

/** HR withdraws a PENDING revision, or an APPROVED one before its effective date. */
export async function cancelRevision(companyId: string, id: string, remarks: string | undefined, req: Request) {
  const rev = await prisma.salaryRevision.findFirst({ where: { id, companyId } });
  if (!rev) throw ApiError.notFound('Salary revision not found');
  if (rev.status !== 'PENDING' && rev.status !== 'APPROVED') {
    throw ApiError.badRequest(`A ${rev.status.toLowerCase()} revision cannot be cancelled`);
  }
  await approvalService.cancel(companyId, 'SALARY_REVISION', id);
  const updated = await prisma.salaryRevision.update({
    where: { id },
    data: { status: 'REJECTED', reason: remarks ? `${rev.reason} [Cancelled: ${remarks}]`.trim() : rev.reason },
  });
  await audit(req, { entity: 'SalaryRevision', entityId: id, action: 'CANCEL', before: rev, after: updated });
  return updated;
}

/**
 * For the performance/talent module (review outcomes): raises an already
 * approved revision of `percent`% on the employee's current structure and
 * applies it now when effective (else the daily job applies it).
 * Every earning column scales by the same factor; PF is recomputed.
 */
export async function applyIncrement(
  companyId: string,
  employeeId: string,
  percent: number,
  effectiveFrom: Date,
  reason: string,
  actor: { employeeId: string | null; req?: Request | null }
) {
  if (!(percent > 0) || percent > 200) throw ApiError.badRequest('Increment % must be between 0 and 200');
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId } });
  if (!employee) throw ApiError.notFound('Employee not found');
  const current = monthlyFromEmployee(employee);
  if (grossOf(current) <= 0) throw ApiError.badRequest(`${employee.name} has no salary structure to increment`);
  const open = await prisma.salaryRevision.findFirst({
    where: { companyId, employeeId, status: { in: ['PENDING', 'APPROVED'] } },
  });
  if (open) throw ApiError.conflict(`${employee.name} already has an open salary revision`);

  const f = 1 + percent / 100;
  const pf = await pfCalculator(companyId);
  const monthly: MonthlyStructure = {
    basic: rupees(current.basic * f),
    hra: rupees(current.hra * f),
    conveyance: rupees(current.conveyance * f),
    medical: rupees(current.medical * f),
    allowance: rupees(current.allowance * f),
    pfEmployer: 0,
    pfEmployee: 0,
  };
  const p = pf(monthly.basic);
  monthly.pfEmployer = current.pfEmployer > 0 ? p.employer : 0;
  monthly.pfEmployee = current.pfEmployee > 0 ? p.employee : 0;

  const rev = await prisma.salaryRevision.create({
    data: {
      companyId,
      employeeId,
      effectiveFrom: dateOnlyUTC(effectiveFrom),
      ctcAnnual: ctcAnnualOf(monthly),
      monthly: monthly as unknown as Prisma.InputJsonValue,
      previous: current as unknown as Prisma.InputJsonValue,
      reason: reason || `Increment ${percent}%`,
      status: 'APPROVED',
      createdById: actor.employeeId,
    },
  });
  const req = actor.req ?? null;
  await audit(req, { entity: 'SalaryRevision', entityId: rev.id, action: 'CREATE', after: rev, ...(req ? {} : { companyId }) });
  return finalizeApproved(companyId, rev.id, req);
}

/** Monthly Employee salary columns for an annual CTC on the company standard structure (joining, offers, quick entry). */
export async function standardSalaryColumns(companyId: string, ctcAnnual: number) {
  return employeeColumns((await preview(companyId, ctcAnnual)).monthly);
}

// ---- Restructure (structure changed → re-split existing salaries, CTC unchanged) ----

const RESTRUCTURE_REASON = 'Salary structure updated (CTC unchanged)';

export interface RestructureRow {
  employeeId: string;
  name: string;
  employeeCode: string;
  ctcAnnual: number;
  current: MonthlyStructure;
  next: MonthlyStructure;
  /** Why this employee is left out (e.g. an open revision). */
  skip?: string;
}

const sameStructure = (a: MonthlyStructure, b: MonthlyStructure) =>
  (Object.keys(ZERO) as (keyof MonthlyStructure)[]).every((k) => a[k] === b[k]);

/**
 * Who would change if the structure (template, or null = company standard)
 * were re-applied now: each active employee on it keeps their CTC; only the
 * split changes. Unchanged employees are counted, not listed.
 */
export async function restructurePlan(companyId: string, templateId: string | null) {
  const employees = await prisma.employee.findMany({
    where: { companyId, isActive: true, salaryTemplateId: templateId },
    orderBy: { name: 'asc' },
  });
  const open = await prisma.salaryRevision.findMany({
    where: { companyId, status: { in: ['PENDING', 'APPROVED'] }, employeeId: { in: employees.map((e) => e.id) } },
    select: { employeeId: true },
  });
  const busy = new Set(open.map((r) => r.employeeId));
  const rows: RestructureRow[] = [];
  let unchanged = 0;
  for (const e of employees) {
    const current = monthlyFromEmployee(e);
    if (grossOf(current) <= 0) continue;
    const ctcAnnual = ctcAnnualOf(current);
    const next = (await preview(companyId, ctcAnnual, templateId ?? undefined)).monthly;
    // Keep PF off for employees who aren't in PF.
    if (current.pfEmployer === 0) next.pfEmployer = 0;
    if (current.pfEmployee === 0) next.pfEmployee = 0;
    if (sameStructure(current, next)) {
      unchanged++;
      continue;
    }
    rows.push({
      employeeId: e.id, name: e.name, employeeCode: e.employeeCode, ctcAnnual, current, next,
      ...(busy.has(e.id) ? { skip: 'Has an open salary revision' } : {}),
    });
  }
  // Already applied but waiting for its date: shown as "scheduled" with a change-date option.
  const pending = await prisma.salaryRevision.findMany({
    where: { companyId, status: 'APPROVED', reason: RESTRUCTURE_REASON, templateId },
    select: { employeeId: true, effectiveFrom: true },
  });
  const scheduledIds = new Set(pending.map((r) => r.employeeId));
  const dates = [...new Set(pending.map((r) => r.effectiveFrom.toISOString().slice(0, 10)))].sort();
  return {
    rows: rows.filter((r) => !scheduledIds.has(r.employeeId)),
    unchanged,
    scheduled: { count: pending.length, dates },
  };
}

/**
 * Applies the plan as pre-approved salary revisions effective `effectiveFrom`
 * (applied now when already effective, else by the daily job). Back-dated
 * months that were already paid get arrears / recoveries as usual.
 */
export async function applyRestructure(
  companyId: string,
  templateId: string | null,
  effectiveFrom: Date,
  actor: Actor,
  req: Request
) {
  const { rows } = await restructurePlan(companyId, templateId);
  const eff = dateOnlyUTC(effectiveFrom);
  let applied = 0;
  let scheduled = 0;
  const skipped: { name: string; reason: string }[] = [];
  for (const row of rows) {
    if (row.skip) {
      skipped.push({ name: row.name, reason: row.skip });
      continue;
    }
    const employee = await prisma.employee.findFirstOrThrow({ where: { id: row.employeeId, companyId }, select: { joiningDate: true } });
    const from = eff < dateOnlyUTC(employee.joiningDate) ? dateOnlyUTC(employee.joiningDate) : eff;
    const rev = await prisma.salaryRevision.create({
      data: {
        companyId,
        employeeId: row.employeeId,
        effectiveFrom: from,
        ctcAnnual: row.ctcAnnual,
        monthly: row.next as unknown as Prisma.InputJsonValue,
        previous: row.current as unknown as Prisma.InputJsonValue,
        reason: RESTRUCTURE_REASON,
        templateId,
        status: 'APPROVED',
        createdById: actor.employeeId,
      },
    });
    await audit(req, { entity: 'SalaryRevision', entityId: rev.id, action: 'CREATE', after: rev });
    const done = await finalizeApproved(companyId, rev.id, req);
    if (done.status === 'APPLIED') applied++;
    else scheduled++;
  }
  return { applied, scheduled, skipped };
}

/**
 * Moves a not-yet-applied revision to another effective date. An approved one
 * dated today or earlier is applied at once (arrears for paid months as usual).
 */
export async function rescheduleRevision(companyId: string, id: string, effectiveFrom: Date, req: Request) {
  const rev = await prisma.salaryRevision.findFirst({ where: { id, companyId }, include: { employee: { select: { joiningDate: true } } } });
  if (!rev) throw ApiError.notFound('Salary revision not found');
  if (rev.status !== 'PENDING' && rev.status !== 'APPROVED') {
    throw ApiError.badRequest(`A ${rev.status.toLowerCase()} revision cannot be rescheduled`);
  }
  const eff = dateOnlyUTC(effectiveFrom);
  if (eff < dateOnlyUTC(rev.employee.joiningDate)) throw ApiError.badRequest('Effective date is before the joining date');
  const updated = await prisma.salaryRevision.update({ where: { id }, data: { effectiveFrom: eff } });
  await audit(req, { entity: 'SalaryRevision', entityId: id, action: 'RESCHEDULE', before: { effectiveFrom: rev.effectiveFrom }, after: { effectiveFrom: eff } });
  if (updated.status === 'APPROVED' && eff <= dateOnlyUTC()) return applyRevision(companyId, id, req);
  return updated;
}

/** Changes the effective date of every scheduled structure update (template, or null = standard). */
export async function rescheduleRestructure(companyId: string, templateId: string | null, effectiveFrom: Date, req: Request) {
  const pending = await prisma.salaryRevision.findMany({
    where: { companyId, status: 'APPROVED', reason: RESTRUCTURE_REASON, templateId },
    include: { employee: { select: { name: true, joiningDate: true } } },
  });
  let applied = 0;
  let scheduled = 0;
  const skipped: { name: string; reason: string }[] = [];
  for (const rev of pending) {
    // Joined after the new date → start on the joining date instead.
    const join = dateOnlyUTC(rev.employee.joiningDate);
    const eff = dateOnlyUTC(effectiveFrom) < join ? join : effectiveFrom;
    try {
      const r = await rescheduleRevision(companyId, rev.id, eff, req);
      if (r.status === 'APPLIED') applied++;
      else scheduled++;
    } catch (err) {
      skipped.push({ name: rev.employee.name, reason: err instanceof Error ? err.message : 'failed' });
    }
  }
  return { applied, scheduled, skipped };
}

/** Daily job body: applies approved revisions whose effective date has arrived. */
export async function applyDueRevisions(companyId: string): Promise<number> {
  const due = await prisma.salaryRevision.findMany({
    where: { companyId, status: 'APPROVED', effectiveFrom: { lte: dateOnlyUTC() } },
    orderBy: { effectiveFrom: 'asc' },
  });
  for (const rev of due) await applyRevision(companyId, rev.id, null);
  return due.length;
}
