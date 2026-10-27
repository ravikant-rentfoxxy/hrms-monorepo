import { z } from 'zod';

export const punchSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  note: z.string().max(300).optional(),
});

export const monthlyQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  employeeId: z.string().uuid().optional(),
  /** "calendar" returns { records, days, summary } instead of the plain record list. */
  view: z.enum(['list', 'calendar']).default('list'),
});

export const companyDayQuerySchema = z.object({ date: z.coerce.date() });

export const regularizationSchema = z.object({
  date: z.coerce.date(),
  reason: z.string().min(3).max(120),
  note: z.string().max(500).optional(),
});

export const regularizationScopeSchema = z.object({
  scope: z.enum(['me', 'company']).default('me'),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
});

export const autoMarkSchema = z.object({ date: z.coerce.date() });

export const regularizationDecideSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  remarks: z.string().max(500).optional(),
});

export const exportQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export const officeSchema = z.object({
  name: z.string().min(2).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(20).max(10000).default(200),
  // Working days per month — the payroll denominator.
  // 0 = auto (weekdays in the month minus holidays); >0 = fixed norm like 26.
  workingDays: z.number().int().min(0).max(31).default(0),
  // Indian state — selects Professional Tax / LWF rules.
  state: z.string().max(60).default(''),
  city: z.string().max(80).default(''),
  // Metro city → 50% HRA exemption (40% otherwise).
  isMetro: z.boolean().default(false),
});

export const officeUpdateSchema = z
  .object({
    name: z.string().min(2).max(120),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radiusMeters: z.number().int().min(20).max(10000),
    workingDays: z.number().int().min(0).max(31),
    state: z.string().max(60),
    city: z.string().max(80),
    isMetro: z.boolean(),
  })
  .partial()
  .extend({ isActive: z.boolean().optional() });

export const workModeSchema = z.object({
  employeeIds: z.array(z.string().uuid()).min(1).max(1000),
  workMode: z.enum(['OFFICE', 'REMOTE', 'FIELD']),
});
