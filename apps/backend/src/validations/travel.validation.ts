import { z } from 'zod';

export const TRAVEL_MODES = ['FLIGHT', 'TRAIN', 'BUS', 'CAR', 'OTHER'] as const;

export const travelSchema = z
  .object({
    purpose: z.string().trim().min(3).max(500),
    fromCity: z.string().trim().min(2).max(80),
    toCity: z.string().trim().min(2).max(80),
    departDate: z.coerce.date(),
    returnDate: z.coerce.date(),
    mode: z.enum(TRAVEL_MODES).default('FLIGHT'),
    estimatedCost: z.number().min(0).max(10_000_000).default(0),
    advanceAmount: z.number().min(0).max(10_000_000).default(0),
  })
  .refine((v) => v.returnDate >= v.departDate, { message: 'returnDate must be on or after departDate', path: ['returnDate'] })
  .refine((v) => v.advanceAmount <= v.estimatedCost, { message: 'Advance cannot exceed the estimated cost', path: ['advanceAmount'] });

export const listTravelQuerySchema = z.object({
  scope: z.enum(['me', 'team', 'approvals', 'company']).default('me'),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  /** true = only approved trips with an advance that are not settled yet (finance view). */
  advancesDue: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

export const travelDecideSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  remarks: z.string().max(500).optional(),
});

export const settleSchema = z.object({
  /** Approved claims to settle against; omitted → every approved claim of the employee dated within the trip. */
  claimIds: z.array(z.string().uuid()).max(200).optional(),
});
