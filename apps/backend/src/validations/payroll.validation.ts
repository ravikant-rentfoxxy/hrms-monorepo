import { z } from 'zod';

const payItemSchema = z.object({ label: z.string().min(1).max(60), amount: z.number().min(0) });

export const payslipSchema = z.object({
  employeeId: z.string().uuid(),
  month: z.coerce.date(),
  earnings: z.array(payItemSchema).min(1),
  deductions: z.array(payItemSchema).default([]),
  workingDays: z.number().int().min(0).max(31),
  paidDays: z.number().int().min(0).max(31),
  paidOn: z.coerce.date(),
});

export const payslipUpdateSchema = payslipSchema.partial().omit({ employeeId: true });

export const payrollRunSchema = z.object({
  month: z.coerce.date(),
  // Overrides the office's working-days default for this run.
  workingDays: z.number().int().min(1).max(31).optional(),
});

export const runCreateSchema = payrollRunSchema;

export const runPaidSchema = z.object({
  paymentReference: z.string().trim().min(2).max(100),
  /** NEFT | RTGS | IMPS | CHEQUE | CASH | OTHER */
  paymentMode: z.enum(['NEFT', 'RTGS', 'IMPS', 'CHEQUE', 'CASH', 'OTHER']),
  paidAt: z.coerce.date().optional(),
});

export const runRecalculateSchema = z.object({
  workingDays: z.number().int().min(1).max(31).optional(),
});

const fySchema = z.string().regex(/^\d{4}-\d{2}$/, 'Financial year like 2026-27');

export const form16QuerySchema = z.object({ fy: fySchema.optional() });

export const taxProjectionQuerySchema = z.object({ employeeId: z.string().uuid().optional() });

export const payslipListQuerySchema = z.object({ employeeId: z.string().uuid().optional() });

export const holidaySchema = z.object({
  name: z.string().min(2).max(120),
  date: z.coerce.date(),
  optional: z.boolean().default(false),
});

export const holidayCreateSchema = z.union([holidaySchema, z.array(holidaySchema).min(1).max(100)]);

export const holidayYearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const announcementSchema = z.object({
  title: z.string().min(2).max(200),
  body: z.string().min(1).max(5000),
  category: z.string().max(40).default('General'),
});
