import { z } from 'zod';
import { MANUAL_INPUT_TYPES } from '../services/payroll-input.service';

/** "2026-10" or a full date; normalised to the first of the month by the service. */
const month = z.preprocess(
  (v) => (typeof v === 'string' && /^\d{4}-\d{2}$/.test(v) ? `${v}-01` : v),
  z.coerce.date()
);

export const listInputsQuerySchema = z.object({
  month,
  employeeId: z.string().uuid().optional(),
  type: z.string().max(30).optional(),
});

export const inputSchema = z.object({
  employeeId: z.string().uuid(),
  month,
  type: z.enum(MANUAL_INPUT_TYPES),
  label: z.string().min(2).max(120),
  amount: z.coerce.number().positive().max(10_000_000),
  taxable: z.boolean().default(true),
  note: z.string().max(300).optional(),
});

export const inputUpdateSchema = inputSchema.omit({ employeeId: true, month: true }).partial();

export const csvUploadSchema = z.object({
  month,
  dryRun: z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean()).default(false),
});

export const importExpensesSchema = z.object({ month });
