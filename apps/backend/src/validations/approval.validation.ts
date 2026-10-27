import { z } from 'zod';
import { APPROVAL_MODULES } from '../services/approval.service';

export const approvalModuleSchema = z.enum(APPROVAL_MODULES);

export const flowStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('MANAGER') }),
  z.object({ type: z.literal('MANAGERS_MANAGER') }),
  z.object({ type: z.literal('DEPARTMENT_HEAD') }),
  z.object({ type: z.literal('ROLE'), role: z.enum(['HR', 'ADMIN', 'MANAGER', 'FINANCE']) }),
  z.object({ type: z.literal('EMPLOYEE'), employeeId: z.string().uuid() }),
]);

export const saveFlowSchema = z.object({
  steps: z.array(flowStepSchema).min(1, 'A flow needs at least one step').max(6, 'At most 6 levels'),
});

export const moduleParamSchema = z.object({ module: approvalModuleSchema });

export const trailParamSchema = z.object({ module: approvalModuleSchema, requestId: z.string().uuid() });

export const inboxQuerySchema = z.object({
  module: approvalModuleSchema.optional(),
  // ADMIN / HR: every pending request in the company, not only their own steps.
  all: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
