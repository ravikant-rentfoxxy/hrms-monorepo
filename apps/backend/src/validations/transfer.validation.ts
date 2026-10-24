import { z } from 'zod';
import { TRANSFER_TYPES } from '../services/transfer.service';

const optionalId = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable()).optional();

export const createTransferSchema = z.object({
  employeeId: z.string().uuid(),
  type: z.enum(TRANSFER_TYPES),
  toDepartmentId: optionalId,
  toDesignationId: optionalId,
  toManagerId: optionalId,
  toOfficeId: optionalId,
  toGradeId: optionalId,
  incrementPercent: z.coerce.number().min(0).max(200).optional(),
  effectiveDate: z.coerce.date(),
  reason: z.string().trim().min(3).max(2000),
});

export const decideTransferSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  remarks: z.string().max(500).optional(),
});

export const cancelTransferSchema = z.object({ remarks: z.string().max(500).optional() });

export const listTransfersQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'APPLIED']).optional(),
  type: z.enum(TRANSFER_TYPES).optional(),
  employeeId: z.string().uuid().optional(),
  mine: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
