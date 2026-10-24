import { z } from 'zod';

export const createConfirmationSchema = z.object({
  employeeId: z.string().uuid(),
  dueDate: z.coerce.date().optional(),
});

export const recommendSchema = z
  .object({
    recommendation: z.enum(['CONFIRM', 'EXTEND', 'TERMINATE']),
    extendByDays: z.coerce.number().int().min(1).max(365).optional(),
    comments: z.string().trim().min(3).max(2000),
  })
  .refine((v) => v.recommendation !== 'EXTEND' || !!v.extendByDays, {
    message: 'extendByDays is required to extend the probation',
    path: ['extendByDays'],
  });

export const decideConfirmationSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  remarks: z.string().max(500).optional(),
});

export const listConfirmationsQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});
