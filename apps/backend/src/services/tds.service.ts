/**
 * Income tax (TDS on salary, section 192) — annual projection per employee.
 *
 *   annual gross = YTD taxable earnings (this FY's published payslips)
 *                + this month's taxable earnings (incl. taxable one-off inputs)
 *                + remaining months × the regular full-month taxable salary
 *                + previous-employer income (from the tax declaration)
 *
 * NEW regime: gross − standard deduction → slabs → 87A rebate (with marginal
 * relief above the rebate limit) → surcharge (with marginal relief) → cess.
 * OLD regime: also HRA exemption (min of HRA received, rent − 10% basic,
 * 50% / 40% of basic for metro / non-metro), professional tax (16(iii)),
 * 80C (incl. employee PF, cap 1.5L), 80CCD(1B) (50k), 80D, 24(b) (2L),
 * 80TTA (10k) and any other declared section as-is.
 *
 * Monthly TDS = (annual tax − TDS already deducted this FY − previous
 * employer's TDS) ÷ months remaining including the current one; never negative.
 *
 * Declarations: VERIFIED → HR-approved amounts. SUBMITTED (not yet verified)
 * → the employee's declared amounts are trusted from April to December only;
 * from January to March (proof season) only verified amounts count. DRAFT /
 * REJECTED declarations are ignored. The regime is Employee.taxRegime.
 */
import type { TaxRule } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ensureTaxRules, fyMonthIndex, fyRange, type TaxSlab } from './statutory.service';

export interface PayLine {
  label: string;
  amount: number;
  code?: string;
  taxable?: boolean;
}

/** Taxable facts of one payslip (works for legacy payslips without codes, by label). */
export function payslipTaxFacts(earnings: unknown, deductions: unknown) {
  const e = Array.isArray(earnings) ? (earnings as PayLine[]) : [];
  const d = Array.isArray(deductions) ? (deductions as PayLine[]) : [];
  const amt = (l: PayLine) => (typeof l.amount === 'number' ? l.amount : 0);
  const is = (l: PayLine, code: string, label: RegExp) => l.code === code || (!l.code && label.test(l.label));
  return {
    taxable: e.filter((l) => l.taxable !== false).reduce((s, l) => s + amt(l), 0),
    basic: e.filter((l) => is(l, 'BASIC', /^basic/i)).reduce((s, l) => s + amt(l), 0),
    hra: e.filter((l) => is(l, 'HRA', /^hra|house rent/i)).reduce((s, l) => s + amt(l), 0),
    pf: d.filter((l) => is(l, 'PF', /provident|^pf/i)).reduce((s, l) => s + amt(l), 0),
    pt: d.filter((l) => is(l, 'PT', /professional tax/i)).reduce((s, l) => s + amt(l), 0),
    tds: d.filter((l) => is(l, 'TDS', /^tds|income tax/i)).reduce((s, l) => s + amt(l), 0),
  };
}

export type TaxFacts = ReturnType<typeof payslipTaxFacts>;

const emptyFacts = (): TaxFacts => ({ taxable: 0, basic: 0, hra: 0, pf: 0, pt: 0, tds: 0 });
const addFacts = (a: TaxFacts, b: TaxFacts): TaxFacts => ({
  taxable: a.taxable + b.taxable,
  basic: a.basic + b.basic,
  hra: a.hra + b.hra,
  pf: a.pf + b.pf,
  pt: a.pt + b.pt,
  tds: a.tds + b.tds,
});

export interface DeclarationLike {
  status: string;
  items: unknown;
  previousEmployerIncome: number;
  previousEmployerTds: number;
}

export interface RuleLike {
  regime: string;
  standardDeduction: number;
  rebateIncomeLimit: number;
  rebateMax: number;
  cessRate: number;
  slabs: TaxSlab[];
}

export interface ProjectionInput {
  fy: string;
  month: Date;
  regime: 'NEW' | 'OLD';
  rule: RuleLike;
  /** Published payslips of the FY before `month`. */
  prior: TaxFacts;
  /** This month's figures (the payslip being computed). */
  current: TaxFacts;
  /** Regular full-month figures for each remaining month after `month`. */
  future: TaxFacts;
  /** Months after `month` still expected in the FY (fewer for a leaver). */
  futureMonths: number;
  declaration: DeclarationLike | null;
  isMetro: boolean;
}

export interface TaxComputation {
  fy: string;
  regime: 'NEW' | 'OLD';
  month: string;
  monthsRemaining: number;
  salary: { ytd: number; current: number; projected: number; previousEmployer: number; total: number };
  exemptions: { label: string; amount: number }[];
  standardDeduction: number;
  professionalTax: number;
  deductions: { section: string; label: string; claimed: number; allowed: number }[];
  totalDeductions: number;
  taxableIncome: number;
  slabTax: number;
  rebate: number;
  surcharge: number;
  cess: number;
  annualTax: number;
  tdsDeducted: number;
  previousEmployerTds: number;
  balanceTax: number;
  monthlyTds: number;
  declarationStatus: string | null;
  /** VERIFIED | DECLARED | NONE — which declaration amounts were considered. */
  declarationBasis: 'VERIFIED' | 'DECLARED' | 'NONE';
}

/* ------------------------------- Tax maths -------------------------------- */

export function slabTax(slabs: TaxSlab[], income: number): number {
  let tax = 0;
  let lower = 0;
  for (const s of slabs) {
    const upper = s.upTo ?? Infinity;
    if (income > lower) tax += ((Math.min(income, upper) - lower) * s.rate) / 100;
    lower = upper;
    if (income <= upper) break;
  }
  return tax;
}

/** Surcharge brackets; the new regime caps the rate at 25%. */
const SURCHARGE: { above: number; rate: number }[] = [
  { above: 50000000, rate: 37 },
  { above: 20000000, rate: 25 },
  { above: 10000000, rate: 15 },
  { above: 5000000, rate: 10 },
];

function taxBeforeCess(rule: RuleLike, income: number): { slab: number; rebate: number; surcharge: number } {
  const slab = slabTax(rule.slabs, income);
  let rebate = 0;
  if (income <= rule.rebateIncomeLimit) rebate = Math.min(slab, rule.rebateMax);
  else if (rule.regime === 'NEW') rebate = Math.max(0, slab - (income - rule.rebateIncomeLimit)); // marginal relief
  const base = slab - rebate;
  let surcharge = 0;
  const bracket = SURCHARGE.find((b) => income > b.above);
  if (bracket) {
    const rate = rule.regime === 'NEW' ? Math.min(bracket.rate, 25) : bracket.rate;
    surcharge = (base * rate) / 100;
    // Marginal relief: tax + surcharge may not exceed the tax at the threshold + the income above it.
    const atThreshold = taxBeforeCess(rule, bracket.above);
    const cap = atThreshold.slab - atThreshold.rebate + atThreshold.surcharge + (income - bracket.above);
    if (base + surcharge > cap) surcharge = Math.max(0, cap - base);
  }
  return { slab, rebate, surcharge };
}

/** Annual tax on `taxableIncome` under `rule` (rounded to the rupee). */
export function annualTax(rule: RuleLike, taxableIncome: number) {
  const income = Math.max(0, Math.round(taxableIncome / 10) * 10); // s.288A
  const t = taxBeforeCess(rule, income);
  const cess = ((t.slab - t.rebate + t.surcharge) * rule.cessRate) / 100;
  return {
    taxableIncome: income,
    slabTax: Math.round(t.slab),
    rebate: Math.round(t.rebate),
    surcharge: Math.round(t.surcharge),
    cess: Math.round(cess),
    total: Math.round(t.slab - t.rebate + t.surcharge + cess),
  };
}

/* ------------------------------ Declarations ------------------------------ */

interface DeclItem {
  section?: string;
  label?: string;
  declared?: number;
  approved?: number | null;
  rentPerMonth?: number;
  /** HRA: rented accommodation in a metro (overrides the office's flag). */
  metro?: boolean;
}

const norm = (s: string | undefined): string => (s ?? '').toUpperCase().replace(/[\s.]/g, '').replace(/^SECTION/, '');

function sectionGroup(section: string): string {
  const s = norm(section);
  if (['80C', '80CCC', '80CCD(1)', '80CCD1'].includes(s)) return '80C';
  if (['80CCD(1B)', '80CCD1B'].includes(s)) return '80CCD(1B)';
  if (s === '80D') return '80D';
  if (['24B', '24(B)', '24'].includes(s)) return '24(b)';
  if (s === '80TTA') return '80TTA';
  if (s === 'HRA' || s === '10(13A)') return 'HRA';
  if (s === 'LTA' || s === '10(5)') return 'LTA';
  return s || 'OTHER';
}

const CAPS: Record<string, number> = { '80C': 150000, '80CCD(1B)': 50000, '80D': 100000, '24(b)': 200000, '80TTA': 10000 };

/** Amount of an item to consider, per the declaration-basis rule in the header. */
function itemAmount(item: DeclItem, basis: 'VERIFIED' | 'DECLARED'): number {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  if (basis === 'VERIFIED') return typeof item.approved === 'number' ? n(item.approved) : n(item.declared);
  return n(item.declared);
}

/* ------------------------------- Projection ------------------------------- */

export function projectTax(input: ProjectionInput): TaxComputation {
  const { rule, prior, current, future, futureMonths } = input;
  const monthsRemaining = futureMonths + 1;
  const projectedFuture: TaxFacts = {
    taxable: future.taxable * futureMonths,
    basic: future.basic * futureMonths,
    hra: future.hra * futureMonths,
    pf: future.pf * futureMonths,
    pt: future.pt * futureMonths,
    tds: 0,
  };
  const annual = addFacts(addFacts(prior, current), projectedFuture);
  const decl = input.declaration;
  const previousEmployer = decl?.previousEmployerIncome ?? 0;
  const previousEmployerTds = decl?.previousEmployerTds ?? 0;
  const gross = annual.taxable + previousEmployer;

  // Which declaration amounts count this month.
  let basis: TaxComputation['declarationBasis'] = 'NONE';
  if (decl?.status === 'VERIFIED') basis = 'VERIFIED';
  else if (decl?.status === 'SUBMITTED' && fyMonthIndex(input.month) <= 8) basis = 'DECLARED'; // Apr–Dec

  const exemptions: TaxComputation['exemptions'] = [];
  const deductions: TaxComputation['deductions'] = [];
  const standardDeduction = Math.min(rule.standardDeduction, gross);
  let professionalTax = 0;

  if (input.regime === 'OLD') {
    professionalTax = Math.min(2500, Math.round(annual.pt));
    const items = basis !== 'NONE' && Array.isArray(decl?.items) ? (decl.items as DeclItem[]) : [];
    const groups = new Map<string, { label: string; claimed: number }>();
    let rentAnnual = 0;
    let metro = input.isMetro;
    let lta = 0;
    for (const item of items) {
      const group = sectionGroup(item.section ?? '');
      const amount = itemAmount(item, basis as 'VERIFIED' | 'DECLARED');
      if (group === 'HRA') {
        // `declared` / `approved` are annual rent (rent × months); rentPerMonth is a fallback.
        rentAnnual += amount > 0 ? amount : (item.rentPerMonth ?? 0) * 12;
        if (typeof item.metro === 'boolean') metro = item.metro;
        continue;
      }
      if (group === 'LTA') {
        lta += amount;
        continue;
      }
      const g = groups.get(group) ?? { label: group === '24(b)' ? 'Home loan interest' : item.label ?? group, claimed: 0 };
      g.claimed += amount;
      groups.set(group, g);
    }
    if (annual.hra > 0 && rentAnnual > 0) {
      const exempt = Math.max(
        0,
        Math.min(annual.hra, rentAnnual - 0.1 * annual.basic, (metro ? 0.5 : 0.4) * annual.basic)
      );
      if (exempt > 0) exemptions.push({ label: 'HRA exemption u/s 10(13A)', amount: Math.round(exempt) });
    }
    if (lta > 0) exemptions.push({ label: 'Leave travel allowance u/s 10(5)', amount: Math.round(lta) });

    // 80C always includes the employee's PF.
    const c80 = groups.get('80C') ?? { label: '80C investments', claimed: 0 };
    c80.label = 'Section 80C (incl. employee PF)';
    c80.claimed += annual.pf;
    groups.set('80C', c80);
    for (const [section, g] of groups) {
      if (g.claimed <= 0) continue;
      const cap = CAPS[section];
      deductions.push({
        section,
        label: g.label,
        claimed: Math.round(g.claimed),
        allowed: Math.round(cap !== undefined ? Math.min(cap, g.claimed) : g.claimed),
      });
    }
  }

  const totalExemptions = exemptions.reduce((s, e) => s + e.amount, 0);
  const totalDeductions = deductions.reduce((s, d) => s + d.allowed, 0);
  const taxable = Math.max(0, gross - totalExemptions - standardDeduction - professionalTax - totalDeductions);
  const tax = annualTax(rule, taxable);
  const tdsDeducted = Math.round(prior.tds);
  const balanceTax = Math.max(0, tax.total - tdsDeducted - previousEmployerTds);
  const monthlyTds = Math.max(0, Math.round(balanceTax / monthsRemaining));

  return {
    fy: input.fy,
    regime: input.regime,
    month: input.month.toISOString().slice(0, 7),
    monthsRemaining,
    salary: {
      ytd: Math.round(prior.taxable),
      current: Math.round(current.taxable),
      projected: Math.round(projectedFuture.taxable),
      previousEmployer: Math.round(previousEmployer),
      total: Math.round(gross),
    },
    exemptions,
    standardDeduction: Math.round(standardDeduction),
    professionalTax,
    deductions,
    totalDeductions,
    taxableIncome: tax.taxableIncome,
    slabTax: tax.slabTax,
    rebate: tax.rebate,
    surcharge: tax.surcharge,
    cess: tax.cess,
    annualTax: tax.total,
    tdsDeducted,
    previousEmployerTds: Math.round(previousEmployerTds),
    balanceTax: Math.round(balanceTax),
    monthlyTds,
    declarationStatus: decl?.status ?? null,
    declarationBasis: basis,
  };
}

/* ------------------------------- Data loading ------------------------------ */

export interface TaxContext {
  fy: string;
  rules: Map<string, RuleLike>;
  /** employeeId → facts of published payslips of the FY before the month. */
  prior: Map<string, TaxFacts>;
  declarations: Map<string, DeclarationLike>;
}

const ruleLike = (r: TaxRule): RuleLike => ({
  regime: r.regime,
  standardDeduction: r.standardDeduction,
  rebateIncomeLimit: r.rebateIncomeLimit,
  rebateMax: r.rebateMax,
  cessRate: r.cessRate,
  slabs: r.slabs as unknown as TaxSlab[],
});

/** Loads everything the projection needs for many employees in a handful of queries. */
export async function loadTaxContext(companyId: string, fy: string, month: Date, employeeIds: string[]): Promise<TaxContext> {
  await ensureTaxRules(companyId, fy);
  const { start } = fyRange(fy);
  const [rules, slips, declarations] = await Promise.all([
    prisma.taxRule.findMany({ where: { companyId, fy } }),
    prisma.payslip.findMany({
      where: { companyId, employeeId: { in: employeeIds }, status: 'PUBLISHED', month: { gte: start, lt: month } },
      select: { employeeId: true, earnings: true, deductions: true },
    }),
    prisma.taxDeclaration.findMany({
      where: { companyId, fy, employeeId: { in: employeeIds } },
      select: { employeeId: true, status: true, items: true, previousEmployerIncome: true, previousEmployerTds: true },
    }),
  ]);
  const prior = new Map<string, TaxFacts>();
  for (const s of slips) {
    prior.set(s.employeeId, addFacts(prior.get(s.employeeId) ?? emptyFacts(), payslipTaxFacts(s.earnings, s.deductions)));
  }
  return {
    fy,
    rules: new Map(rules.map((r) => [r.regime, ruleLike(r)])),
    prior,
    declarations: new Map(declarations.map((d) => [d.employeeId, d])),
  };
}

export const priorFacts = (ctx: TaxContext, employeeId: string): TaxFacts => ctx.prior.get(employeeId) ?? emptyFacts();

export { emptyFacts };
