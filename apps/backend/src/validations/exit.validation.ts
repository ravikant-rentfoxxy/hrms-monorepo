import { z } from 'zod';
import { CLEARANCE_DEPARTMENTS, EXIT_LETTER_TYPES, EXIT_TYPES } from '../services/exit.helpers';
import { PAYMENT_MODES } from '../services/settlement.service';

export const resignSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
  requestedLastDay: z.coerce.date().optional(),
});

export const initiateExitSchema = z.object({
  employeeId: z.string().uuid(),
  exitType: z.enum(EXIT_TYPES).refine((t) => t !== 'RESIGNATION', { message: 'Resignations are submitted by the employee' }),
  reason: z.string().trim().min(3).max(2000),
  lastWorkingDay: z.coerce.date(),
  noticeWaived: z.boolean().optional(),
});

export const decideExitSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  remarks: z.string().max(500).optional(),
  approvedLastDay: z.coerce.date().optional(),
  noticeWaived: z.boolean().optional(),
});

export const listExitsQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'COMPLETED']).optional(),
  scope: z.enum(['me', 'team', 'company']).optional(),
  fnfOverdue: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  q: z.string().trim().max(100).optional(),
});

export const clearanceSchema = z.object({
  status: z.enum(['CLEARED', 'PENDING']),
  dues: z.coerce.number().min(0).max(1e8).optional(),
  remarks: z.string().max(1000).optional(),
  /** IT / ADMIN: clear although assets are still out — their cost becomes dues. */
  assetsNotReturned: z.boolean().optional(),
  /** Clear although checklist items are still open (needs remarks). */
  force: z.boolean().optional(),
});

export const clearanceItemsSchema = z.object({
  items: z
    .array(z.object({ label: z.string().trim().min(1).max(200), done: z.boolean() }))
    .min(1)
    .max(30),
});

export const clearanceParamsSchema = z.object({
  id: z.string().uuid(),
  department: z.enum(CLEARANCE_DEPARTMENTS),
});

export const exitInterviewSchema = z.object({
  answers: z
    .array(z.object({ question: z.string().min(1).max(500), answer: z.string().max(4000) }))
    .min(1)
    .max(30),
  overallRating: z.number().int().min(1).max(5).optional(),
  wouldRejoin: z.boolean().optional(),
});

export const scheduleInterviewSchema = z.object({
  at: z.coerce.date(),
  interviewerId: z.string().uuid().nullable().optional(),
});

export const settlementItemsSchema = z.object({
  items: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(200),
        type: z.enum(['EARNING', 'DEDUCTION']),
        amount: z.coerce.number().min(0).max(1e9),
        code: z.string().max(40).optional(),
        note: z.string().max(1000).optional(),
        refIds: z.array(z.string().max(64)).max(500).optional(),
      })
    )
    .max(60),
});

export const settlementDueDateSchema = z.object({ dueDate: z.coerce.date() });

export const settlementPaySchema = z.object({
  paymentMode: z.enum(PAYMENT_MODES),
  paymentReference: z.string().trim().max(120).optional(),
  paidOn: z.coerce.date().optional(),
});

const handoverBase = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  handoverToId: z.string().uuid().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
});
export const handoverCreateSchema = handoverBase;
export const handoverUpdateSchema = handoverBase.partial();

export const handoverParamsSchema = z.object({ id: z.string().uuid(), taskId: z.string().uuid() });

export const handoverDoneSchema = z.object({ notes: z.string().trim().max(2000).optional() });

export const handoverVerifySchema = z.object({
  decision: z.enum(['VERIFIED', 'REOPEN']),
  notes: z.string().trim().max(1000).optional(),
});

export const lastDayChangeSchema = z.object({
  lastDay: z.coerce.date(),
  reason: z.string().trim().min(3).max(1000),
});

export const lastDayDecideSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  remarks: z.string().trim().max(500).optional(),
  /** HR / ADMIN only: waive the shortfall of an employee-requested early release. */
  noticeWaived: z.boolean().optional(),
});

export const issueLetterSchema = z.object({
  type: z.enum(EXIT_LETTER_TYPES),
  reissue: z.boolean().optional(),
});

export const rehireSchema = z.object({
  rehireEligible: z.boolean(),
  rehireNote: z.string().trim().max(1000).default(''),
});
export const closeExitSchema = rehireSchema;
