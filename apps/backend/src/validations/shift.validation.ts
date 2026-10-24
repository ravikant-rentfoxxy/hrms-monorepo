import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (24-hour)');
const weekdaysCsv = z
  .string()
  .regex(/^([0-6](,[0-6])*)?$/, 'Comma-separated weekdays 0–6 (0 = Sunday)')
  .transform((s) => [...new Set(s.split(',').filter(Boolean))].sort().join(','));
const weeksCsv = z
  .string()
  .regex(/^([1-5](,[1-5])*)?$/, 'Comma-separated week numbers 1–5 (e.g. "2,4")')
  .transform((s) => [...new Set(s.split(',').filter(Boolean))].sort().join(','));

const shiftFields = {
  name: z.string().trim().min(2).max(60),
  code: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, - and _ only'),
  startTime: hhmm,
  endTime: hhmm,
  graceMinutes: z.number().int().min(0).max(240),
  breakMinutes: z.number().int().min(0).max(240),
  fullDayMinutes: z.number().int().min(60).max(1440),
  halfDayMinutes: z.number().int().min(30).max(1440),
  overtimeAfterMinutes: z.number().int().min(0).max(1440),
  isNight: z.boolean(),
  weeklyOffs: weekdaysCsv,
  altSaturdaysOff: weeksCsv,
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Hex colour like #4F46E5'),
  isDefault: z.boolean(),
};

export const shiftSchema = z.object(shiftFields).partial().required({ name: true, code: true, startTime: true, endTime: true });

export const shiftUpdateSchema = z.object(shiftFields).partial().extend({ isActive: z.boolean().optional() });

export const shiftListQuerySchema = z.object({ includeInactive: z.enum(['true', 'false']).default('false').transform((v) => v === 'true') });

export const assignSchema = z.object({
  shiftId: z.string().uuid(),
  employeeIds: z.array(z.string().uuid()).min(1).max(500),
  fromDate: z.coerce.date(),
  toDate: z.coerce.date().nullable().optional(),
});

export const assignmentsQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  shiftId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const rosterQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  departmentId: z.string().uuid().optional(),
});

export const myRosterQuerySchema = z.object({
  from: z.coerce.date().optional(),
  days: z.coerce.number().int().min(1).max(62).default(14),
});
