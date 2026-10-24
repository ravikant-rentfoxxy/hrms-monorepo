import { z } from 'zod';

const days = z.number().min(0).max(366);

const leaveTypeBase = z.object({
  code: z.string().trim().min(1).max(10).toUpperCase(),
  name: z.string().trim().min(2).max(60),
  totalPerYear: days,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  // Policy
  accrualType: z.enum(['YEARLY', 'MONTHLY', 'NONE']).optional(),
  accrualRate: z.number().min(0).max(31).optional(),
  carryForwardMax: days.optional(),
  encashable: z.boolean().optional(),
  maxEncashDays: days.optional(),
  maxConsecutive: days.optional(),
  minNoticeDays: z.number().int().min(0).max(365).optional(),
  allowNegative: z.boolean().optional(),
  maxNegative: days.optional(),
  applicableAfterDays: z.number().int().min(0).max(3650).optional(),
  gender: z.enum(['', 'MALE', 'FEMALE']).optional(),
  sandwichRule: z.boolean().optional(),
  allowHalfDay: z.boolean().optional(),
  isCompOff: z.boolean().optional(),
  compOffExpiryDays: z.number().int().min(0).max(3650).optional(),
  isPaid: z.boolean().optional(),
});

export const leaveTypeSchema = leaveTypeBase;

export const leaveTypeUpdateSchema = leaveTypeBase.partial().extend({ isActive: z.boolean().optional() });

export const listTypesQuerySchema = z.object({
  all: z.enum(['true', 'false', '1', '0']).optional(),
});

const applyBase = z.object({
  leaveTypeId: z.string().uuid(),
  fromDate: z.coerce.date(),
  toDate: z.coerce.date(),
  halfDay: z.boolean().default(false),
  reason: z.string().trim().min(3).max(500),
});

export const applyLeaveSchema = applyBase.refine((v) => v.toDate >= v.fromDate, {
  message: 'toDate must be on or after fromDate',
});

/** Preview doesn't need a reason yet. */
export const previewLeaveSchema = applyBase.extend({ reason: z.string().max(500).default('') });

const status = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
const scope = z.enum(['me', 'team', 'company', 'approvals']).default('me');

export const listLeavesQuerySchema = z.object({
  status: status.optional(),
  scope,
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const listRequestsQuerySchema = z.object({ status: status.optional(), scope });

export const decideSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  remarks: z.string().max(500).optional(),
});

export const balanceQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const ledgerQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  leaveTypeId: z.string().uuid().optional(),
});

export const adjustSchema = z.object({
  employeeId: z.string().uuid(),
  leaveTypeId: z.string().uuid(),
  days: z.number().min(-366).max(366).refine((v) => v !== 0, 'Adjustment cannot be zero'),
  reason: z.string().trim().min(3).max(300),
  date: z.coerce.date().optional(),
});

export const openingSchema = z.object({
  employeeId: z.string().uuid(),
  leaveTypeId: z.string().uuid(),
  year: z.number().int().min(2000).max(2100),
  days,
});

export const calendarQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  scope: z.enum(['team', 'company']).default('team'),
});

export const compOffSchema = z.object({
  workDate: z.coerce.date(),
  days: z.union([z.literal(0.5), z.literal(1)]).default(1),
  reason: z.string().trim().min(3).max(500),
});

export const encashmentSchema = z.object({
  leaveTypeId: z.string().uuid(),
  days: z.number().positive().max(366).refine((v) => Number.isInteger(v * 2), 'Days must be in steps of 0.5'),
  reason: z.string().trim().max(300).optional(),
});
