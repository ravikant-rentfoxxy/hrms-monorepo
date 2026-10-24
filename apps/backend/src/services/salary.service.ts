/**
 * Salary structure logic (single source of truth for the CTC breakup),
 * following standard Indian payroll rules:
 *
 *   Gross Salary = Basic + HRA + Conveyance + Medical + Special Allowance
 *     (what the employee EARNS — employer contributions are NOT part of it)
 *   CTC = Gross + Employer PF (12% of basic) + Employer ESI (3.25% of gross when
 *         gross ≤ the ESI wage limit) + Gratuity provision (4.81% of basic)
 *     (what the company SPENDS)
 *   Net Pay = Gross − Employee PF − Employee ESI   (TDS/PT apply at payroll time)
 *   So: CTC > Gross > Net.
 *
 * Labour Codes (Nov 2025): Basic + DA must be ≥ 50% of CTC — flagged to HR
 * in the panel, and the CTC derivation below uses Basic = 50% of CTC.
 *
 * HR types the monthly components — Basic, HRA, Conveyance, Medical, Special
 * Allowance, PF-Employer, PF-Employee. Gross, Gratuity, CTC, Total Deductions
 * and Net Pay are always derived. A monthly `salaryCtc` is also accepted as
 * an API convenience; it derives a standard structure HR can then adjust.
 */
import type { StatutoryConfig } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/http';
import { computeEsi, getConfig } from './statutory.service';

/** The statutory settings that shape the CTC breakup (company StatutoryConfig). */
export type BreakupConfig = Pick<
  StatutoryConfig,
  'esiEnabled' | 'esiWageLimit' | 'esiEmployeeRate' | 'esiEmployerRate' | 'gratuityEnabled'
>;

/** Statutory defaults (used when no company config is passed). */
export const DEFAULT_BREAKUP_CONFIG: BreakupConfig = {
  esiEnabled: true,
  esiWageLimit: 21000,
  esiEmployeeRate: 0.75,
  esiEmployerRate: 3.25,
  gratuityEnabled: true,
};

export const PF_RATE = 0.12; // employer & employee PF, % of basic
export const GRATUITY_RATE = 0.0481; // gratuity provision, % of basic
export const STD_CONVEYANCE = 1600; // common monthly conveyance allowance
export const STD_MEDICAL = 1250; // common monthly medical allowance

export interface SalaryComponents {
  salaryBasic: number;
  salaryHra: number;
  salaryConveyance: number;
  salaryMedical: number;
  salaryAllowance: number;
  salaryPfEmployer: number;
  salaryPfEmployee: number;
}

export interface SalaryBreakup {
  basic: number;
  hra: number;
  conveyance: number;
  medical: number;
  specialAllowance: number;
  /** Gross salary = sum of the earnings above (employer PF excluded). */
  subTotal: number;
  pfEmployer: number;
  /** Employer ESI (3.25% of gross) when gross ≤ the ESI wage limit, else 0. */
  esiEmployer: number;
  /** Gratuity provision — part of CTC, derived as 4.81% of basic. */
  gratuity: number;
  /** CTC = gross + employer PF + employer ESI + gratuity provision. */
  total: number;
  deductions: { label: string; amount: number }[];
  totalDeductions: number;
  netPay: number;
}

/** Statutory suggestion: 12% of basic (₹1,800 if restricted to the ₹15,000 ceiling). */
export const suggestedPf = (basic: number): number => (basic > 0 ? Math.round(basic * PF_RATE) : 0);

export const gratuityFor = (basic: number, enabled = true): number =>
  enabled && basic > 0 ? Math.round(basic * GRATUITY_RATE) : 0;

/** Monthly ESI on a full-month gross (0 when above the wage limit / disabled). */
export const esiFor = (gross: number, cfg: BreakupConfig = DEFAULT_BREAKUP_CONFIG) =>
  computeEsi(cfg, { monthlyRate: gross, wages: gross });

/**
 * Derive a standard structure from a monthly CTC (API convenience input):
 * Basic = 50% of CTC (Labour Codes), PF = 12% and gratuity = 4.81% of basic
 * sit outside gross, HRA = 40% of basic, standard conveyance/medical when
 * they fit, and Special Allowance balances the gross. When the resulting gross
 * falls within ESI, the employer's 3.25% also comes out of the CTC.
 */
export function structureFromCtc(monthlyCtc: number, cfg: BreakupConfig = DEFAULT_BREAKUP_CONFIG): SalaryComponents {
  if (monthlyCtc <= 0) {
    return {
      salaryBasic: 0, salaryHra: 0, salaryConveyance: 0, salaryMedical: 0,
      salaryAllowance: 0, salaryPfEmployer: 0, salaryPfEmployee: 0,
    };
  }
  const basic = Math.round(0.5 * monthlyCtc);
  const pf = suggestedPf(basic);
  const gratuity = gratuityFor(basic, cfg.gratuityEnabled);
  let gross = monthlyCtc - pf - gratuity;
  if (esiFor(gross, cfg).applicable) {
    // gross + ceil(gross × rate) = what is left of the CTC
    gross = Math.floor((monthlyCtc - pf - gratuity) / (1 + cfg.esiEmployerRate / 100));
    while (gross + esiFor(gross, cfg).employer > monthlyCtc - pf - gratuity) gross--;
  }
  let hra = Math.round(0.4 * basic);
  let conveyance = STD_CONVEYANCE;
  let medical = STD_MEDICAL;
  let special = gross - basic - hra - conveyance - medical;
  // Small CTCs: drop the fixed allowances, then trim HRA, before going negative.
  if (special < 0) {
    medical = 0;
    special = gross - basic - hra - conveyance;
  }
  if (special < 0) {
    conveyance = 0;
    special = gross - basic - hra;
  }
  if (special < 0) {
    hra = Math.max(0, gross - basic);
    special = 0;
  }
  return {
    salaryBasic: basic,
    salaryHra: hra,
    salaryConveyance: conveyance,
    salaryMedical: medical,
    salaryAllowance: special,
    salaryPfEmployer: pf,
    salaryPfEmployee: pf,
  };
}

/** Monthly breakup (the "Salary Breakup" card) from the stored components. */
export function breakupFromComponents(c: SalaryComponents, cfg: BreakupConfig = DEFAULT_BREAKUP_CONFIG): SalaryBreakup {
  const subTotal = c.salaryBasic + c.salaryHra + c.salaryConveyance + c.salaryMedical + c.salaryAllowance;
  const gratuity = gratuityFor(c.salaryBasic, cfg.gratuityEnabled);
  const esi = esiFor(subTotal, cfg);
  const deductions = [{ label: 'PF Employee', amount: c.salaryPfEmployee }];
  if (esi.employee > 0) deductions.push({ label: 'ESI Employee', amount: esi.employee });
  const totalDeductions = deductions.reduce((s, d) => s + d.amount, 0);
  return {
    basic: c.salaryBasic,
    hra: c.salaryHra,
    conveyance: c.salaryConveyance,
    medical: c.salaryMedical,
    specialAllowance: c.salaryAllowance,
    subTotal,
    pfEmployer: c.salaryPfEmployer,
    esiEmployer: esi.employer,
    gratuity,
    total: subTotal + c.salaryPfEmployer + esi.employer + gratuity,
    deductions,
    totalDeductions,
    netPay: subTotal - totalDeductions,
  };
}

const times12 = (b: SalaryBreakup): SalaryBreakup => ({
  basic: b.basic * 12,
  hra: b.hra * 12,
  conveyance: b.conveyance * 12,
  medical: b.medical * 12,
  specialAllowance: b.specialAllowance * 12,
  subTotal: b.subTotal * 12,
  pfEmployer: b.pfEmployer * 12,
  esiEmployer: b.esiEmployer * 12,
  gratuity: b.gratuity * 12,
  total: b.total * 12,
  deductions: b.deductions.map((d) => ({ ...d, amount: d.amount * 12 })),
  totalDeductions: b.totalDeductions * 12,
  netPay: b.netPay * 12,
});

/** Full monthly + annual breakup for one employee (caller enforces self-or-privileged). */
export async function salaryStructure(companyId: string, employeeId: string) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    select: {
      id: true,
      name: true,
      salaryBasic: true,
      salaryHra: true,
      salaryConveyance: true,
      salaryMedical: true,
      salaryAllowance: true,
      salaryPfEmployer: true,
      salaryPfEmployee: true,
    },
  });
  if (!employee) throw ApiError.notFound('Employee not found');
  const monthly = breakupFromComponents(employee, await getConfig(companyId));
  return {
    employeeId: employee.id,
    name: employee.name,
    hasStructure: monthly.subTotal > 0,
    monthly,
    annual: times12(monthly),
  };
}
