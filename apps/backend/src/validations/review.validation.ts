import { z } from 'zod';

export const CYCLE_STATUSES = ['DRAFT', 'SELF_REVIEW', 'MANAGER_REVIEW', 'CALIBRATION', 'CLOSED'] as const;

const cycleBase = z.object({
  name: z.string().trim().min(2).max(120),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  selfReviewDue: z.coerce.date().nullable().optional(),
  managerReviewDue: z.coerce.date().nullable().optional(),
  ratingScale: z.number().int().min(3).max(10).default(5),
  includePeer: z.boolean().default(false),
});

const periodOk = (v: { periodStart?: Date; periodEnd?: Date }) => !(v.periodStart && v.periodEnd && v.periodEnd < v.periodStart);

export const cycleSchema = cycleBase.refine(periodOk, { message: 'Period end must be after the start', path: ['periodEnd'] });
export const cycleUpdateSchema = cycleBase.partial().refine(periodOk, { message: 'Period end must be after the start', path: ['periodEnd'] });

export const submitReviewSchema = z.object({
  rating: z.number().min(1).max(10).optional(),
  strengths: z.string().max(5000).default(''),
  improvements: z.string().max(5000).default(''),
  comments: z.string().max(5000).default(''),
  goalRatings: z
    .array(z.object({ goalId: z.string().uuid(), rating: z.number().min(1).max(10), comment: z.string().max(1000).optional() }))
    .max(100)
    .default([]),
  /** Save without submitting. */
  draft: z.boolean().default(false),
});

export const peerSchema = z.object({
  employeeId: z.string().uuid(),
  reviewerIds: z.array(z.string().uuid()).min(1).max(3),
});

export const outcomeUpdateSchema = z.object({
  finalRating: z.number().min(1).max(10).nullable().optional(),
  normalizedRating: z.number().min(1).max(10).nullable().optional(),
  incrementPercent: z.number().min(0).max(100).optional(),
  promotion: z.boolean().optional(),
  newDesignation: z.string().trim().max(120).optional(),
  remarks: z.string().max(2000).optional(),
});

export const bulkApproveSchema = z.object({ ids: z.array(z.string().uuid()).max(5000).optional() });

export const cycleReviewsQuerySchema = z.object({
  type: z.enum(['SELF', 'MANAGER', 'PEER']).optional(),
  status: z.enum(['PENDING', 'SUBMITTED']).optional(),
});

export const applyOutcomeSchema = z.object({ effectiveFrom: z.coerce.date().optional() });
