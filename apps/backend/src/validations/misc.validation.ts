import { z } from 'zod';

export const goalSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(2000).default(''),
  dueDate: z.coerce.date(),
  category: z.string().max(60).default('General'),
  weightage: z.number().int().min(1).max(100).default(10),
  employeeId: z.string().uuid().optional(), // managers/HR can create for reports
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

export const taskSchema = z.object({
  title: z.string().min(2).max(200),
  project: z.string().max(120).default(''),
  due: z.coerce.date(),
  priority: z.enum(['Low', 'Medium', 'High']).default('Medium'),
  employeeId: z.string().uuid().optional(), // managers can assign to reports
});

export const taskUpdateSchema = taskSchema
  .partial()
  .omit({ employeeId: true })
  .extend({ done: z.boolean().optional() });

export const ticketSchema = z.object({
  subject: z.string().min(3).max(200),
  category: z.string().max(60).default('General'),
  description: z.string().min(3).max(5000),
});

export const ticketStatusSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
});

export const ticketScopeQuerySchema = z.object({ scope: z.enum(['me', 'company']).default('me') });
