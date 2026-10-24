import { z } from 'zod';

export const auditQuerySchema = z.object({
  entity: z.string().max(60).optional(),
  entityId: z.string().max(64).optional(),
  actorEmployeeId: z.string().uuid().optional(),
  action: z.string().max(40).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Super admin: platform events (no companyId) or one tenant's log. */
export const platformAuditQuerySchema = auditQuerySchema.extend({
  companyId: z.string().uuid().optional(),
});
