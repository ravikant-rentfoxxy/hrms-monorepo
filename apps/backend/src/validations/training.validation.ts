import { z } from 'zod';

const courseBase = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().max(5000).default(''),
  category: z.string().trim().max(60).default('General'),
  durationMinutes: z.number().int().min(1).max(100_000).default(60),
  contentUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => v === '' || /^https?:\/\//i.test(v), { message: 'Content URL must start with http:// or https://' })
    .default(''),
  mandatory: z.boolean().default(false),
  dueDays: z.number().int().min(1).max(365).default(30),
  isActive: z.boolean().default(true),
});

export const courseSchema = courseBase;
export const courseUpdateSchema = courseBase.partial();

export const courseListQuerySchema = z.object({
  category: z.string().max(60).optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
});

export const assignSchema = z
  .object({
    employeeIds: z.array(z.string().uuid()).max(5000).default([]),
    departments: z.array(z.string().trim().min(1).max(120)).max(200).default([]),
    all: z.boolean().default(false),
    /** Overrides the course's dueDays for this assignment. */
    dueDate: z.coerce.date().optional(),
  })
  .refine((v) => v.all || v.employeeIds.length > 0 || v.departments.length > 0, {
    message: 'Pick employees, departments or "all"',
  });

export const progressSchema = z.object({ progress: z.number().min(0).max(1) });
export const completeSchema = z.object({ score: z.number().min(0).max(100).optional() });

export const matrixQuerySchema = z.object({
  department: z.string().max(120).optional(),
  courseId: z.string().uuid().optional(),
});
