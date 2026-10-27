import { z } from 'zod';

// ---- Projects ----

export const projectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .toUpperCase()
    .regex(/^[A-Z0-9_-]+$/, 'Use letters, digits, - or _'),
  client: z.string().trim().max(120).default(''),
  isBillable: z.boolean().default(true),
});

export const projectUpdateSchema = projectSchema.partial().extend({ isActive: z.boolean().optional() });

export const listProjectsQuerySchema = z.object({
  includeInactive: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  mine: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

export const projectMembersSchema = z.object({ employeeIds: z.array(z.string().uuid()).max(500) });

// ---- Timesheets (daily) ----

export const dayQuerySchema = z.object({
  date: z.coerce.date(),
  employeeId: z.string().uuid().optional(),
});

export const timesheetEntrySchema = z.object({
  /** Client-generated uuid for new lines; send it back to keep the entry and its attachments. */
  id: z.string().uuid().optional(),
  projectId: z.string().uuid(),
  hours: z.number().min(0).max(24),
  /** Omitted → the project's billable default. */
  billable: z.boolean().optional(),
  description: z.string().max(500).default(''),
});

export const saveDaySchema = z.object({
  date: z.coerce.date(),
  entries: z.array(timesheetEntrySchema).max(50),
});

export const copyDaySchema = z.object({ date: z.coerce.date() });

export const listTimesheetsQuerySchema = z
  .object({
    /** me = own, team = direct reports, company = everyone (ADMIN/HR). */
    scope: z.enum(['me', 'team', 'company']).default('me'),
    status: z.enum(['DRAFT', 'SUBMITTED']).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    employeeId: z.string().uuid().optional(),
  })
  .refine((v) => !v.from || !v.to || v.to >= v.from, { message: 'to must be on or after from' })
  .refine((v) => !v.from || !v.to || v.to.getTime() - v.from.getTime() <= 366 * 86_400_000, { message: 'Range is limited to one year' });

export const utilisationQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    projectId: z.string().uuid().optional(),
  })
  .refine((v) => v.to >= v.from, { message: 'to must be on or after from' })
  .refine((v) => v.to.getTime() - v.from.getTime() <= 366 * 86_400_000, { message: 'Range is limited to one year' });
