/**
 * Indian statutory payroll rules: configuration (PF / ESI / PT / LWF / TDS
 * switches and rates), Professional Tax slabs, Labour Welfare Fund rules and
 * income-tax rules per financial year — plus the pure calculation functions
 * the payroll run (and the full & final settlement) use.
 *
 * Every company gets sensible defaults lazily through `ensureStatutoryDefaults`
 * (idempotent): HR edits them on the panel's statutory settings page. The
 * seeded PT / LWF figures reflect the state rules as known in 2026 and are
 * deliberately editable — states revise them often.
 *
 * Calculation rules (monthly):
 *   PF   employee = rate × EPF wages, EPF wages = min(earned basic, ceiling) when
 *        restricted to the ceiling; employer = same rate split into EPS (8.33% of
 *        min(wages, 15000), 0 from age 58) and EPF (the remainder). A typed
 *        `salaryPfEmployee` / `salaryPfEmployer` on the profile overrides the
 *        computed amount (pro-rated by payable days).
 *   ESI  when the employee's monthly wage rate is ≤ the wage limit: employee
 *        0.75% / employer 3.25% of the month's ESI wages, rounded up.
 *   PT   slab of the work state (office state, else the configured default),
 *        gender-specific and month-specific slabs win over generic ones.
 *   LWF  fixed employee / employer amounts in the state's listed months.
 */
import type { Prisma, StatutoryConfig } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/http';

/* ------------------------------ Financial year ----------------------------- */

/** "2026-27" for any date between 1 Apr 2026 and 31 Mar 2027. */
export function fyOf(d: Date): string {
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/** First month (1 Apr) and last month (1 Mar) of a financial year, as month starts. */
export function fyRange(fy: string): { start: Date; end: Date; endExclusive: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!m) throw ApiError.badRequest(`Invalid financial year "${fy}" (expected e.g. 2026-27)`);
  const y = Number(m[1]);
  return {
    start: new Date(Date.UTC(y, 3, 1)),
    end: new Date(Date.UTC(y + 1, 2, 1)),
    endExclusive: new Date(Date.UTC(y + 1, 3, 1)),
  };
}

/** 0 for April … 11 for March. */
export const fyMonthIndex = (month: Date): number => (month.getUTCMonth() + 9) % 12;

/** Months left in the FY including `month` (April → 12, March → 1). */
export const fyMonthsRemaining = (month: Date): number => 12 - fyMonthIndex(month);

export const currentFy = (): string => fyOf(new Date());

/* ------------------------------ Default data ------------------------------- */

export interface TaxSlab {
  /** Upper bound of the slab (annual taxable income); null = no upper bound. */
  upTo: number | null;
  /** Rate in percent. */
  rate: number;
}

/** New regime (Budget 2025, FY 2025-26 onwards). */
export const DEFAULT_NEW_REGIME = {
  standardDeduction: 75000,
  rebateIncomeLimit: 1200000,
  rebateMax: 60000,
  cessRate: 4,
  slabs: [
    { upTo: 400000, rate: 0 },
    { upTo: 800000, rate: 5 },
    { upTo: 1200000, rate: 10 },
    { upTo: 1600000, rate: 15 },
    { upTo: 2000000, rate: 20 },
    { upTo: 2400000, rate: 25 },
    { upTo: null, rate: 30 },
  ] as TaxSlab[],
};

/** Old regime (below-60 individual). */
export const DEFAULT_OLD_REGIME = {
  standardDeduction: 50000,
  rebateIncomeLimit: 500000,
  rebateMax: 12500,
  cessRate: 4,
  slabs: [
    { upTo: 250000, rate: 0 },
    { upTo: 500000, rate: 5 },
    { upTo: 1000000, rate: 20 },
    { upTo: null, rate: 30 },
  ] as TaxSlab[],
};

type PtSeed = { minSalary: number; maxSalary: number; amount: number; gender?: string; month?: number };

/**
 * Professional Tax (monthly gross → monthly PT). "> X" bounds are written as
 * X + 0.01 because slabs are inclusive on both ends. Half-yearly / annual
 * schemes (Tamil Nadu, Madhya Pradesh) are spread over the months.
 */
export const DEFAULT_PT_SLABS: Record<string, PtSeed[]> = {
  Maharashtra: [
    { minSalary: 0, maxSalary: 7500, amount: 0 },
    { minSalary: 7500.01, maxSalary: 10000, amount: 175 },
    { minSalary: 10000.01, maxSalary: 0, amount: 200 },
    { minSalary: 10000.01, maxSalary: 0, amount: 300, month: 2 },
    // Women earning up to ₹25,000 a month are exempt (2023 amendment).
    { minSalary: 0, maxSalary: 25000, amount: 0, gender: 'FEMALE' },
  ],
  Karnataka: [
    { minSalary: 0, maxSalary: 24999.99, amount: 0 },
    { minSalary: 25000, maxSalary: 0, amount: 200 },
    { minSalary: 25000, maxSalary: 0, amount: 300, month: 2 },
  ],
  'West Bengal': [
    { minSalary: 0, maxSalary: 10000, amount: 0 },
    { minSalary: 10000.01, maxSalary: 15000, amount: 110 },
    { minSalary: 15000.01, maxSalary: 25000, amount: 130 },
    { minSalary: 25000.01, maxSalary: 40000, amount: 150 },
    { minSalary: 40000.01, maxSalary: 0, amount: 200 },
  ],
  // Half-yearly slabs (₹0 / 180 / 430 / 930 / 1,025 / 1,250 per half-year) spread monthly.
  'Tamil Nadu': [
    { minSalary: 0, maxSalary: 3500, amount: 0 },
    { minSalary: 3500.01, maxSalary: 5000, amount: 30 },
    { minSalary: 5000.01, maxSalary: 7500, amount: 72 },
    { minSalary: 7500.01, maxSalary: 10000, amount: 155 },
    { minSalary: 10000.01, maxSalary: 12500, amount: 171 },
    { minSalary: 12500.01, maxSalary: 0, amount: 208 },
  ],
  Telangana: [
    { minSalary: 0, maxSalary: 15000, amount: 0 },
    { minSalary: 15000.01, maxSalary: 20000, amount: 150 },
    { minSalary: 20000.01, maxSalary: 0, amount: 200 },
  ],
  Gujarat: [
    { minSalary: 0, maxSalary: 11999.99, amount: 0 },
    { minSalary: 12000, maxSalary: 0, amount: 200 },
  ],
  'Andhra Pradesh': [
    { minSalary: 0, maxSalary: 15000, amount: 0 },
    { minSalary: 15000.01, maxSalary: 20000, amount: 150 },
    { minSalary: 20000.01, maxSalary: 0, amount: 200 },
  ],
  // Annual ₹0 / 1,500 / 2,000 / 2,500 by annual income (2.25L / 3L / 4L), spread monthly.
  'Madhya Pradesh': [
    { minSalary: 0, maxSalary: 18750, amount: 0 },
    { minSalary: 18750.01, maxSalary: 25000, amount: 125 },
    { minSalary: 25000.01, maxSalary: 33333.33, amount: 166 },
    { minSalary: 25000.01, maxSalary: 33333.33, amount: 174, month: 3 },
    { minSalary: 33333.34, maxSalary: 0, amount: 208 },
    { minSalary: 33333.34, maxSalary: 0, amount: 212, month: 3 },
  ],
};

export const DEFAULT_LWF_RULES: { state: string; employeeAmount: number; employerAmount: number; months: string }[] = [
  { state: 'Maharashtra', employeeAmount: 25, employerAmount: 75, months: '6,12' },
  { state: 'Karnataka', employeeAmount: 50, employerAmount: 100, months: '12' },
  { state: 'Gujarat', employeeAmount: 6, employerAmount: 12, months: '6,12' },
  { state: 'Tamil Nadu', employeeAmount: 20, employerAmount: 40, months: '12' },
  { state: 'West Bengal', employeeAmount: 3, employerAmount: 15, months: '6,12' },
  { state: 'Telangana', employeeAmount: 2, employerAmount: 5, months: '12' },
  { state: 'Andhra Pradesh', employeeAmount: 30, employerAmount: 70, months: '12' },
  { state: 'Madhya Pradesh', employeeAmount: 10, employerAmount: 30, months: '6,12' },
];

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

/** Companies already checked in this process (defaults are only ever created once). */
const seeded = new Set<string>();

/** FYs whose tax rules every company should have: the current one (and 2026-27). */
const seedFys = (): string[] => [...new Set(['2026-27', currentFy()])];

/**
 * Creates the company's statutory defaults when missing (idempotent, cheap
 * after the first call). PT slabs / LWF rules are only seeded together with
 * the config row, so HR deleting a state's slabs is respected afterwards.
 */
export async function ensureStatutoryDefaults(companyId: string): Promise<void> {
  if (seeded.has(companyId)) return;
  const existing = await prisma.statutoryConfig.findUnique({ where: { companyId }, select: { id: true } });
  if (!existing) {
    await prisma.$transaction(async (tx) => {
      const created = await tx.statutoryConfig.createMany({ data: [{ companyId }], skipDuplicates: true });
      if (created.count === 0) return; // a concurrent request seeded it
      const anySlab = await tx.professionalTaxSlab.count({ where: { companyId } });
      if (anySlab === 0) {
        await tx.professionalTaxSlab.createMany({
          data: Object.entries(DEFAULT_PT_SLABS).flatMap(([state, slabs]) =>
            slabs.map((s) => ({ companyId, state, minSalary: s.minSalary, maxSalary: s.maxSalary, amount: s.amount, gender: s.gender ?? '', month: s.month ?? 0 }))
          ),
        });
      }
      await tx.lwfRule.createMany({ data: DEFAULT_LWF_RULES.map((r) => ({ ...r, companyId })), skipDuplicates: true });
    });
  }
  for (const fy of seedFys()) await ensureTaxRules(companyId, fy);
  seeded.add(companyId);
}

/**
 * Makes sure both regimes have a rule for `fy`: copies the company's latest
 * earlier FY rule (so HR's edits carry forward), else the built-in defaults.
 */
export async function ensureTaxRules(companyId: string, fy: string): Promise<void> {
  fyRange(fy); // validates the format
  const have = await prisma.taxRule.findMany({ where: { companyId, fy }, select: { regime: true } });
  for (const regime of ['NEW', 'OLD'] as const) {
    if (have.some((r) => r.regime === regime)) continue;
    const previous = await prisma.taxRule.findFirst({
      where: { companyId, regime, fy: { lt: fy } },
      orderBy: { fy: 'desc' },
    });
    const base = previous
      ? {
          standardDeduction: previous.standardDeduction,
          rebateIncomeLimit: previous.rebateIncomeLimit,
          rebateMax: previous.rebateMax,
          cessRate: previous.cessRate,
          slabs: previous.slabs as unknown as TaxSlab[],
        }
      : regime === 'NEW'
        ? DEFAULT_NEW_REGIME
        : DEFAULT_OLD_REGIME;
    await prisma.taxRule.createMany({
      data: [{ companyId, fy, regime, ...base, slabs: asJson(base.slabs) }],
      skipDuplicates: true,
    });
  }
}

/* ---------------------------------- Config --------------------------------- */

export type StatutoryConfigInput = Partial<
  Omit<StatutoryConfig, 'id' | 'companyId'>
>;

export async function getConfig(companyId: string): Promise<StatutoryConfig> {
  await ensureStatutoryDefaults(companyId);
  return prisma.statutoryConfig.findUniqueOrThrow({ where: { companyId } });
}

export async function updateConfig(companyId: string, input: StatutoryConfigInput) {
  const before = await getConfig(companyId);
  const after = await prisma.statutoryConfig.update({ where: { companyId }, data: input });
  return { before, after };
}

/* ------------------------------- PT slabs ---------------------------------- */

export interface PtSlabInput {
  state: string;
  minSalary: number;
  maxSalary: number;
  amount: number;
  gender: string;
  month: number;
}

export async function listPtSlabs(companyId: string, state?: string) {
  await ensureStatutoryDefaults(companyId);
  return prisma.professionalTaxSlab.findMany({
    where: { companyId, ...(state ? { state: { equals: state, mode: 'insensitive' } } : {}) },
    orderBy: [{ state: 'asc' }, { month: 'asc' }, { gender: 'asc' }, { minSalary: 'asc' }],
  });
}

export async function createPtSlab(companyId: string, input: PtSlabInput) {
  return prisma.professionalTaxSlab.create({ data: { ...input, companyId } });
}

export async function updatePtSlab(companyId: string, id: string, input: Partial<PtSlabInput>) {
  const before = await prisma.professionalTaxSlab.findFirst({ where: { id, companyId } });
  if (!before) throw ApiError.notFound('PT slab not found');
  const after = await prisma.professionalTaxSlab.update({ where: { id }, data: input });
  return { before, after };
}

export async function deletePtSlab(companyId: string, id: string) {
  const before = await prisma.professionalTaxSlab.findFirst({ where: { id, companyId } });
  if (!before) throw ApiError.notFound('PT slab not found');
  await prisma.professionalTaxSlab.delete({ where: { id } });
  return before;
}

/** Replaces every slab of one state (the panel's per-state slab editor saves this way). */
export async function replaceStatePtSlabs(companyId: string, state: string, slabs: Omit<PtSlabInput, 'state'>[]) {
  const name = state.trim();
  if (!name) throw ApiError.badRequest('State is required');
  const before = await prisma.professionalTaxSlab.findMany({
    where: { companyId, state: { equals: name, mode: 'insensitive' } },
  });
  await prisma.$transaction([
    prisma.professionalTaxSlab.deleteMany({ where: { companyId, state: { equals: name, mode: 'insensitive' } } }),
    prisma.professionalTaxSlab.createMany({ data: slabs.map((s) => ({ ...s, state: name, companyId })) }),
  ]);
  const after = await listPtSlabs(companyId, name);
  return { before, after };
}

/* -------------------------------- LWF rules -------------------------------- */

export interface LwfRuleInput {
  state: string;
  employeeAmount: number;
  employerAmount: number;
  months: string;
}

export async function listLwfRules(companyId: string) {
  await ensureStatutoryDefaults(companyId);
  return prisma.lwfRule.findMany({ where: { companyId }, orderBy: { state: 'asc' } });
}

/** Creates or replaces the rule of a state (one rule per state). */
export async function upsertLwfRule(companyId: string, input: LwfRuleInput) {
  const state = input.state.trim();
  const before = await prisma.lwfRule.findUnique({ where: { companyId_state: { companyId, state } } });
  const after = await prisma.lwfRule.upsert({
    where: { companyId_state: { companyId, state } },
    create: { ...input, state, companyId },
    update: { employeeAmount: input.employeeAmount, employerAmount: input.employerAmount, months: input.months },
  });
  return { before, after };
}

export async function deleteLwfRule(companyId: string, id: string) {
  const before = await prisma.lwfRule.findFirst({ where: { id, companyId } });
  if (!before) throw ApiError.notFound('LWF rule not found');
  await prisma.lwfRule.delete({ where: { id } });
  return before;
}

/* -------------------------------- Tax rules -------------------------------- */

export interface TaxRuleInput {
  fy: string;
  regime: 'NEW' | 'OLD';
  standardDeduction: number;
  rebateIncomeLimit: number;
  rebateMax: number;
  cessRate: number;
  slabs: TaxSlab[];
}

export async function listTaxRules(companyId: string, fy?: string) {
  await ensureStatutoryDefaults(companyId);
  if (fy) await ensureTaxRules(companyId, fy);
  return prisma.taxRule.findMany({
    where: { companyId, ...(fy ? { fy } : {}) },
    orderBy: [{ fy: 'desc' }, { regime: 'asc' }],
  });
}

/** Slabs must ascend and end with an open (null) bound. */
export function validateSlabs(slabs: TaxSlab[]): TaxSlab[] {
  if (slabs.length === 0) throw ApiError.badRequest('At least one tax slab is required');
  let prev = 0;
  slabs.forEach((s, i) => {
    const last = i === slabs.length - 1;
    if (last && s.upTo !== null) throw ApiError.badRequest('The last slab must have no upper limit');
    if (!last && (s.upTo === null || s.upTo <= prev)) {
      throw ApiError.badRequest('Slab upper limits must be increasing; only the last slab may be open-ended');
    }
    if (s.upTo !== null) prev = s.upTo;
  });
  return slabs;
}

export async function upsertTaxRule(companyId: string, input: TaxRuleInput) {
  fyRange(input.fy);
  const slabs = asJson(validateSlabs(input.slabs));
  const key = { companyId_fy_regime: { companyId, fy: input.fy, regime: input.regime } };
  const before = await prisma.taxRule.findUnique({ where: key });
  const data = {
    standardDeduction: input.standardDeduction,
    rebateIncomeLimit: input.rebateIncomeLimit,
    rebateMax: input.rebateMax,
    cessRate: input.cessRate,
    slabs,
  };
  const after = await prisma.taxRule.upsert({
    where: key,
    create: { companyId, fy: input.fy, regime: input.regime, ...data },
    update: data,
  });
  return { before, after };
}

export async function deleteTaxRule(companyId: string, id: string) {
  const before = await prisma.taxRule.findFirst({ where: { id, companyId } });
  if (!before) throw ApiError.notFound('Tax rule not found');
  await prisma.taxRule.delete({ where: { id } });
  return before;
}

/* ------------------------------ Calculations ------------------------------- */

/**
 * Default statutory wage ceiling (₹15,000 since Sept 2014). The live value is
 * StatutoryConfig.pfWageCeiling — EPF, EPS and EDLI all use that one setting,
 * so a notified change (e.g. to ₹25,000) is a single edit in Statutory settings.
 */
export const EPS_WAGE_CEILING = 15000;
export const EPS_RATE = 8.33;
export const GRATUITY_RATE = 4.81;
/** Employees aged 58+ stop contributing to EPS (everything goes to EPF). */
const EPS_AGE_LIMIT = 58;

const r2 = (n: number): number => Math.round(n * 100) / 100;

export interface PfResult {
  /** EPF wages (basis of the employee contribution). */
  epfWages: number;
  epsWages: number;
  edliWages: number;
  employee: number;
  /** Employer total = eps + epf. */
  employer: number;
  eps: number;
  epf: number;
}

export function ageOn(dateOfBirth: Date | null | undefined, on: Date): number | null {
  if (!dateOfBirth) return null;
  let age = on.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const m = on.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (m < 0 || (m === 0 && on.getUTCDate() < dateOfBirth.getUTCDate())) age--;
  return age;
}

/**
 * Monthly PF on the earned basic. `ratio` = payable ÷ working days, used to
 * pro-rate typed overrides (`salaryPfEmployee` / `salaryPfEmployer` > 0).
 */
export function computePf(
  cfg: Pick<StatutoryConfig, 'pfEnabled' | 'pfEmployeeRate' | 'pfEmployerRate' | 'pfWageCeiling' | 'pfRestrictToCeiling'>,
  input: {
    earnedBasic: number;
    ratio: number;
    employeeOverride?: number;
    employerOverride?: number;
    age?: number | null;
  }
): PfResult {
  const zero: PfResult = { epfWages: 0, epsWages: 0, edliWages: 0, employee: 0, employer: 0, eps: 0, epf: 0 };
  if (!cfg.pfEnabled || input.earnedBasic <= 0) return zero;
  const epfWages = Math.round(cfg.pfRestrictToCeiling ? Math.min(input.earnedBasic, cfg.pfWageCeiling) : input.earnedBasic);
  const epsEligible = input.age === null || input.age === undefined || input.age < EPS_AGE_LIMIT;
  // EPS / EDLI are always capped at the statutory ceiling, even when EPF is paid on the full basic.
  const statutoryCeiling = cfg.pfWageCeiling > 0 ? cfg.pfWageCeiling : EPS_WAGE_CEILING;
  const epsWages = epsEligible ? Math.min(epfWages, statutoryCeiling) : 0;
  const edliWages = Math.min(epfWages, statutoryCeiling);

  const employee = input.employeeOverride && input.employeeOverride > 0
    ? Math.round(input.employeeOverride * input.ratio)
    : Math.round((epfWages * cfg.pfEmployeeRate) / 100);
  const employer = input.employerOverride && input.employerOverride > 0
    ? Math.round(input.employerOverride * input.ratio)
    : input.employeeOverride && input.employeeOverride > 0
      ? employee
      : Math.round((epfWages * cfg.pfEmployerRate) / 100);
  const eps = Math.min(employer, Math.round((epsWages * EPS_RATE) / 100));
  return { epfWages, epsWages, edliWages, employee, employer, eps, epf: employer - eps };
}

export interface EsiResult {
  applicable: boolean;
  wages: number;
  employee: number;
  employer: number;
}

/**
 * ESI. Coverage is decided on the monthly wage rate (full-month gross of the
 * structure), so a month with LOP does not pull a ₹25,000 employee into ESI;
 * contributions are on the month's actual ESI wages, rounded up to the rupee.
 * (Simplification: the contribution-period rule — once covered, stay covered
 * until the period ends — is not tracked.)
 */
export function computeEsi(
  cfg: Pick<StatutoryConfig, 'esiEnabled' | 'esiWageLimit' | 'esiEmployeeRate' | 'esiEmployerRate'>,
  input: { monthlyRate: number; wages: number }
): EsiResult {
  if (!cfg.esiEnabled || input.monthlyRate <= 0 || input.monthlyRate > cfg.esiWageLimit || input.wages <= 0) {
    return { applicable: false, wages: 0, employee: 0, employer: 0 };
  }
  const wages = Math.round(input.wages);
  return {
    applicable: true,
    wages,
    employee: Math.ceil(r2((wages * cfg.esiEmployeeRate) / 100)),
    employer: Math.ceil(r2((wages * cfg.esiEmployerRate) / 100)),
  };
}

export interface PtSlabLike {
  state: string;
  minSalary: number;
  maxSalary: number;
  amount: number;
  gender: string;
  month: number;
}

/**
 * Monthly Professional Tax for `gross` in `state`. When several slabs match,
 * a gender-specific slab beats a generic one and a month-specific slab beats
 * an every-month one (gender first: e.g. Maharashtra's women exemption holds in February).
 */
export function computePt(slabs: PtSlabLike[], input: { state: string; gender: string; month: number; gross: number }): number {
  const state = input.state.trim().toLowerCase();
  const gender = input.gender.trim().toUpperCase();
  let best: { score: number; amount: number } | null = null;
  for (const s of slabs) {
    if (s.state.trim().toLowerCase() !== state) continue;
    if (input.gross < s.minSalary || (s.maxSalary > 0 && input.gross > s.maxSalary)) continue;
    const sg = s.gender.trim().toUpperCase();
    if (sg && sg !== gender) continue;
    if (s.month !== 0 && s.month !== input.month) continue;
    const score = (sg ? 2 : 0) + (s.month ? 1 : 0);
    if (!best || score > best.score) best = { score, amount: s.amount };
  }
  return best ? Math.round(best.amount) : 0;
}

export interface LwfRuleLike {
  state: string;
  employeeAmount: number;
  employerAmount: number;
  months: string;
}

export function computeLwf(rules: LwfRuleLike[], input: { state: string; month: number }) {
  const state = input.state.trim().toLowerCase();
  const rule = rules.find((r) => r.state.trim().toLowerCase() === state);
  if (!rule) return { employee: 0, employer: 0 };
  const months = rule.months.split(',').map((m) => Number(m.trim())).filter((m) => m >= 1 && m <= 12);
  if (!months.includes(input.month)) return { employee: 0, employer: 0 };
  return { employee: Math.round(rule.employeeAmount), employer: Math.round(rule.employerAmount) };
}

/** Monthly gratuity provision (CTC display): 4.81% of basic. */
export const gratuityProvision = (basic: number, enabled = true): number =>
  enabled && basic > 0 ? Math.round((basic * GRATUITY_RATE) / 100) : 0;

/**
 * Gratuity payable at exit under the Payment of Gratuity Act:
 * last drawn monthly basic × 15/26 × completed years (≥ 6 months rounds up),
 * only after 5 years of service (pass `ignoreEligibility` for death/disablement
 * or fixed-term employees under the Labour Codes),
 * capped at ₹20 lakh (tax-exempt limit).
 */
export function gratuityPayable(input: {
  monthlyBasic: number;
  joiningDate: Date;
  lastWorkingDay: Date;
  ignoreEligibility?: boolean;
}): { years: number; eligible: boolean; amount: number } {
  const days = Math.max(0, Math.floor((input.lastWorkingDay.getTime() - input.joiningDate.getTime()) / 86400000) + 1);
  const totalMonths = Math.floor(days / 30.4375);
  const years = Math.floor(totalMonths / 12) + (totalMonths % 12 >= 6 ? 1 : 0);
  // 4 years + 240 days is treated as 5 years of continuous service (courts' reading of s.2A).
  const eligible = !!input.ignoreEligibility || days >= 4 * 365 + 240;
  const amount = eligible ? Math.min(2000000, Math.round((input.monthlyBasic * 15 * years) / 26)) : 0;
  return { years, eligible, amount };
}

/** Effective work state of an employee: office state, else the configured default. */
export function stateFor(officeState: string | null | undefined, cfg: Pick<StatutoryConfig, 'defaultState'>): string {
  return (officeState ?? '').trim() || cfg.defaultState;
}

/**
 * All monthly statutory amounts for one employee-month — the single entry
 * point used by the payroll run, the live tax projection and the F&F
 * settlement. Pass the company's config / slabs / LWF rules (load once with
 * `loadStatutoryContext`).
 */
export function computeMonthlyStatutory(
  ctx: StatutoryContext,
  input: {
    /** Month being paid (first day). */
    month: Date;
    state: string;
    gender: string;
    dateOfBirth?: Date | null;
    earnedBasic: number;
    /** payable ÷ working days. */
    ratio: number;
    /** Full-month structure gross (ESI coverage test). */
    monthlyRate: number;
    /** The month's ESI wages (earned gross minus excluded one-offs). */
    esiWages: number;
    /** The month's total gross (PT basis). */
    gross: number;
    pfEmployeeOverride?: number;
    pfEmployerOverride?: number;
  }
) {
  const { config } = ctx;
  const m = input.month.getUTCMonth() + 1;
  const pf = computePf(config, {
    earnedBasic: input.earnedBasic,
    ratio: input.ratio,
    employeeOverride: input.pfEmployeeOverride,
    employerOverride: input.pfEmployerOverride,
    age: ageOn(input.dateOfBirth, input.month),
  });
  const esi = computeEsi(config, { monthlyRate: input.monthlyRate, wages: input.esiWages });
  const pt = config.ptEnabled && input.gross > 0
    ? computePt(ctx.ptSlabs, { state: input.state, gender: input.gender, month: m, gross: input.gross })
    : 0;
  const lwf = config.lwfEnabled && input.gross > 0 ? computeLwf(ctx.lwfRules, { state: input.state, month: m }) : { employee: 0, employer: 0 };
  return { pf, esi, pt, lwf, state: input.state };
}

export interface StatutoryContext {
  config: StatutoryConfig;
  ptSlabs: PtSlabLike[];
  lwfRules: LwfRuleLike[];
}

export async function loadStatutoryContext(companyId: string): Promise<StatutoryContext> {
  await ensureStatutoryDefaults(companyId);
  const [config, ptSlabs, lwfRules] = await Promise.all([
    prisma.statutoryConfig.findUniqueOrThrow({ where: { companyId } }),
    prisma.professionalTaxSlab.findMany({ where: { companyId } }),
    prisma.lwfRule.findMany({ where: { companyId } }),
  ]);
  return { config, ptSlabs, lwfRules };
}
