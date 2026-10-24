import { z } from 'zod';

export const overtimeSchema = z.object({
  date: z.coerce.date(),
  minutes: z.number().int().min(1).max(960),
  reason: z.string().trim().min(3).max(500),
});

export const overtimeListQuerySchema = z.object({
  scope: z.enum(['me', 'team', 'company']).default('me'),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const overtimeDecideSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  remarks: z.string().max(500).optional(),
});
