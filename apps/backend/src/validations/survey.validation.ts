import { z } from 'zod';

export const QUESTION_TYPES = ['RATING', 'NPS', 'TEXT', 'CHOICE'] as const;

export const questionSchema = z
  .object({
    id: z.string().trim().min(1).max(40).optional(),
    text: z.string().trim().min(3).max(500),
    type: z.enum(QUESTION_TYPES),
    options: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    required: z.boolean().default(true),
  })
  .refine((q) => q.type !== 'CHOICE' || (q.options?.length ?? 0) >= 2, {
    message: 'A choice question needs at least 2 options',
    path: ['options'],
  });

const surveyBase = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().max(5000).default(''),
  anonymous: z.boolean().default(true),
  questions: z.array(questionSchema).min(1).max(50),
  closesOn: z.coerce.date().nullable().optional(),
});

export const surveySchema = surveyBase;
export const surveyUpdateSchema = surveyBase.partial();

/** answers: { [questionId]: number | string } */
export const respondSchema = z.object({
  answers: z.record(z.string(), z.union([z.number(), z.string().max(5000)])),
});

export const resultsQuerySchema = z.object({ department: z.string().max(120).optional() });
