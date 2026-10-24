import { z } from 'zod';

export const BADGES = ['TEAM_PLAYER', 'INNOVATOR', 'CUSTOMER_HERO', 'GO_GETTER', 'MENTOR', 'THANK_YOU'] as const;

export const kudosSchema = z.object({
  toEmployeeId: z.string().uuid(),
  badge: z.enum(BADGES).default('THANK_YOU'),
  message: z.string().trim().min(3).max(500),
  points: z.number().int().min(1).max(50).default(10),
});

export const wallQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  employeeId: z.string().uuid().optional(),
});

export const leaderboardQuerySchema = z.object({
  /** YYYY-MM; defaults to the current month. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});
