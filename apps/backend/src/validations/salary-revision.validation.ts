import { z } from 'zod';
import { COMPONENT_CALCS, COMPONENT_TYPES } from '../services/salary-revision.service';

const money = z.coerce.number().min(0).max(100_000_000);

export const componentSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(20)
    .transform((s) => s.trim().toUpperCase())
    .refine((s) => /^[A-Z][A-Z0-9_]*$/.test(s), { message: 'Use letters, digits and _ only' }),
  name: z.string().min(2).max(80),
  type: z.enum(COMPONENT_TYPES).default('EARNING'),
  calc: z.enum(COMPONENT_CALCS).default('FIXED'),
  value: z.number().min(0).max(10_000_000).default(0),
  taxable: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

export const componentUpdateSchema = componentSchema
  .omit({ code: true })
  .partial()
  .extend({ isActive: z.boolean().optional() });

const templateComponentSchema = z.object({
  code: z.string().min(2).max(20).transform((s) => s.trim().toUpperCase()),
  calc: z.enum(COMPONENT_CALCS),
  value: z.number().min(0).max(10_000_000).default(0),
});

const percentWithinLimit = (cs: { calc: string; value: number }[]) =>
  cs.every((c) => !(c.calc === 'PERCENT_OF_BASIC' || c.calc === 'PERCENT_OF_CTC') || c.value <= 100);

export const templateSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(300).optional(),
  components: z
    .array(templateComponentSchema)
    .min(1)
    .max(30)
    .refine(percentWithinLimit, { message: 'Percentages cannot exceed 100' }),
  isActive: z.boolean().optional(),
});

export const templateUpdateSchema = templateSchema.partial();

export const previewSchema = z.object({
  ctcAnnual: z.coerce.number().positive().max(1_000_000_000),
  templateId: z.string().uuid().optional(),
});

export const monthlySchema = z.object({
  basic: money,
  hra: money,
  conveyance: money,
  medical: money,
  allowance: money,
  pfEmployer: money,
  pfEmployee: money,
});

export const revisionSchema = z.object({
  employeeId: z.string().uuid(),
  effectiveFrom: z.coerce.date(),
  ctcAnnual: z.coerce.number().positive().max(1_000_000_000),
  templateId: z.string().uuid().optional(),
  // Explicit monthly structure (HR-adjusted preview); derived from CTC/template when omitted.
  monthly: monthlySchema.optional(),
  reason: z.string().min(3).max(500),
});

export const listRevisionsQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'APPLIED', 'REJECTED']).optional(),
});

export const revisionDecideSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  remarks: z.string().max(500).optional(),
});

export const revisionCancelSchema = z.object({
  remarks: z.string().max(500).optional(),
});

export const restructureQuerySchema = z.object({
  templateId: z.string().uuid().optional(),
});

export const restructureSchema = z.object({
  /** Omitted / null = employees on the company standard structure. */
  templateId: z.string().uuid().nullable().optional(),
  effectiveFrom: z.coerce.date(),
});

export const rescheduleSchema = z.object({
  effectiveFrom: z.coerce.date(),
});
