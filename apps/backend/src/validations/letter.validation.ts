import { z } from 'zod';
import { LETTER_TYPES } from '../services/letter.service';

export const letterTemplateSchema = z.object({
  type: z.enum(LETTER_TYPES),
  name: z.string().trim().min(2).max(120),
  subject: z.string().max(200).default(''),
  body: z.string().trim().min(10).max(20000),
  isActive: z.boolean().default(true),
});

export const letterTemplateUpdateSchema = letterTemplateSchema.partial();

const varsSchema = z.record(z.string().max(2000)).optional();

export const generateLetterSchema = z
  .object({
    templateId: z.string().uuid().optional(),
    type: z.enum(LETTER_TYPES).optional(),
    employeeId: z.string().uuid(),
    vars: varsSchema,
  })
  .refine((v) => v.templateId || v.type, { message: 'templateId or type is required' });

export const previewLetterSchema = z.object({
  templateId: z.string().uuid().optional(),
  subject: z.string().max(200).optional(),
  body: z.string().max(20000).optional(),
  employeeId: z.string().uuid().optional(),
  vars: varsSchema,
});

export const requestLetterSchema = z.object({
  type: z.enum(['SALARY_CERTIFICATE', 'EXPERIENCE']),
});

export const listLettersQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  type: z.enum(LETTER_TYPES).optional(),
});
