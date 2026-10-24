import { z } from 'zod';

const money = z.number().min(0).max(1e9);
const rate = z.number().min(0).max(100);
const state = z.string().trim().min(2).max(60);

export const statutoryConfigSchema = z
  .object({
    pfEnabled: z.boolean(),
    pfEmployeeRate: rate,
    pfEmployerRate: rate,
    pfWageCeiling: money,
    pfRestrictToCeiling: z.boolean(),
    esiEnabled: z.boolean(),
    esiWageLimit: money,
    esiEmployeeRate: rate,
    esiEmployerRate: rate,
    ptEnabled: z.boolean(),
    lwfEnabled: z.boolean(),
    tdsEnabled: z.boolean(),
    gratuityEnabled: z.boolean(),
    defaultState: state,
    pfEstablishmentCode: z.string().trim().max(40),
    esiEmployerCode: z.string().trim().max(40),
    tan: z.string().trim().toUpperCase().regex(/^([A-Z]{4}[0-9]{5}[A-Z])?$/, 'TAN like MUMA12345B'),
    companyPan: z.string().trim().toUpperCase().regex(/^([A-Z]{5}[0-9]{4}[A-Z])?$/, 'PAN like AAACA1234A'),
  })
  .partial();

const ptSlabBase = z.object({
  minSalary: money,
  maxSalary: money.default(0), // 0 = no upper bound
  amount: z.number().min(0).max(5000),
  gender: z.enum(['', 'MALE', 'FEMALE', 'OTHER']).default(''),
  month: z.number().int().min(0).max(12).default(0),
});

const slabRange = (v: { minSalary: number; maxSalary: number }) => v.maxSalary === 0 || v.maxSalary >= v.minSalary;
const rangeMsg = { message: 'maxSalary must be 0 (no limit) or ≥ minSalary', path: ['maxSalary'] };

export const ptSlabSchema = ptSlabBase.extend({ state }).refine(slabRange, rangeMsg);
export const ptSlabUpdateSchema = ptSlabBase.extend({ state }).partial();

export const ptStateSlabsSchema = z.object({
  state,
  slabs: z.array(ptSlabBase.refine(slabRange, rangeMsg)).max(40),
});

export const ptListQuerySchema = z.object({ state: z.string().max(60).optional() });

export const lwfRuleSchema = z.object({
  state,
  employeeAmount: z.number().min(0).max(10000),
  employerAmount: z.number().min(0).max(10000),
  months: z
    .string()
    .trim()
    .regex(/^(1[0-2]|[1-9])(\s*,\s*(1[0-2]|[1-9]))*$/, 'Comma-separated months 1–12, e.g. 6,12'),
});

export const taxRuleSchema = z.object({
  fy: z.string().regex(/^\d{4}-\d{2}$/, 'Financial year like 2026-27'),
  regime: z.enum(['NEW', 'OLD']),
  standardDeduction: money,
  rebateIncomeLimit: money,
  rebateMax: money,
  cessRate: rate,
  slabs: z.array(z.object({ upTo: z.number().positive().nullable(), rate })).min(1).max(15),
});

export const taxRuleQuerySchema = z.object({
  fy: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});
