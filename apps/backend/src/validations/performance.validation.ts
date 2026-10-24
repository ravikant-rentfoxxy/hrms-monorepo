import { z } from 'zod';

export const goalSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(2000).default(''),
  dueDate: z.coerce.date(),
  category: z.string().max(60).default('General'),
  weightage: z.number().int().min(1).max(100).default(10),
  employeeId: z.string().uuid().optional(), // managers (for reports) / HR (anyone) can create for others
});

export const goalUpdateSchema = goalSchema
  .partial()
  .omit({ employeeId: true })
  .extend({ progress: z.number().min(0).max(1).optional() });

export const feedbackSchema = z.object({
  employeeId: z.string().uuid(), // who the feedback is about
  message: z.string().min(3).max(2000),
  rating: z.number().int().min(1).max(5),
  fromRole: z.string().max(40).default('Peer'),
});

export const teamGoalsQuerySchema = z.object({
  department: z.string().max(120).optional(),
});
