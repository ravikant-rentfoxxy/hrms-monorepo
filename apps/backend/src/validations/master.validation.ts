import { z } from 'zod';

const clearableId = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable()).optional();

export const departmentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().max(20).optional(),
  headId: clearableId,
  parentId: clearableId,
  isActive: z.boolean().optional(),
});
export const departmentUpdateSchema = departmentSchema.partial();

export const designationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  level: z.coerce.number().int().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
});
export const designationUpdateSchema = designationSchema.partial();

export const gradeSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(80),
  minCtc: z.coerce.number().min(0).max(1_000_000_000).optional(),
  maxCtc: z.coerce.number().min(0).max(1_000_000_000).optional(),
  isActive: z.boolean().optional(),
});
export const gradeUpdateSchema = gradeSchema.partial();

export const masterListQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
