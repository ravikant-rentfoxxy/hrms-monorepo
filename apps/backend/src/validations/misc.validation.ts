import { z } from 'zod';

export const ticketSchema = z.object({
  subject: z.string().min(3).max(200),
  category: z.string().max(60).default('General'),
  description: z.string().min(3).max(5000),
});

export const ticketStatusSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
});

export const ticketScopeQuerySchema = z.object({ scope: z.enum(['me', 'company']).default('me') });
