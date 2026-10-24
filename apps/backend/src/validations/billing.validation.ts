import { z } from 'zod';

/** Module keys a plan can enable (informational — feature gating is per plan). */
export const MODULE_KEYS = [
  'core', 'attendance', 'leave', 'payroll', 'expenses', 'timesheets', 'travel', 'performance', 'recruitment',
  'onboarding', 'exit', 'assets', 'learning', 'surveys', 'recognition', 'integrations',
] as const;

export const planSchema = z.object({
  code: z.string().trim().min(2).max(20).toUpperCase().regex(/^[A-Z0-9_]+$/, 'Use letters, digits or _'),
  name: z.string().trim().min(2).max(60),
  pricePerEmployee: z.number().min(0).max(100_000),
  /** 0 = unlimited */
  maxEmployees: z.number().int().min(0).max(1_000_000).default(0),
  features: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
  isActive: z.boolean().default(true),
});

export const planUpdateSchema = planSchema.partial().omit({ code: true });

export const SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED'] as const;

export const subscriptionSchema = z.object({
  planId: z.string().uuid(),
  status: z.enum(SUBSCRIPTION_STATUSES).default('TRIAL'),
  trialEndsOn: z.coerce.date().nullable().optional(),
  renewsOn: z.coerce.date().nullable().optional(),
});

export const subscriptionUpdateSchema = subscriptionSchema.partial();

export const invoiceQuerySchema = z.object({
  companyId: z.string().uuid().optional(),
  status: z.enum(['DUE', 'PAID', 'VOID']).optional(),
});

export const invoiceStatusSchema = z.object({
  status: z.enum(['PAID', 'VOID', 'DUE']),
  paidOn: z.coerce.date().optional(),
});

export const generateInvoicesSchema = z.object({
  /** YYYY-MM of the period to bill; defaults to the previous month. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
});
