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
});

// ---- Timesheets ----

export const weekQuerySchema = z.object({
  weekStart: z.coerce.date(),
  employeeId: z.string().uuid().optional(),
});

export const timesheetEntrySchema = z.object({
  projectId: z.string().uuid(),
  date: z.coerce.date(),
  hours: z.number().min(0).max(24),
  /** Omitted → the project's billable default. */
  billable: z.boolean().optional(),
  description: z.string().max(500).default(''),
});

export const saveWeekSchema = z.object({
  weekStart: z.coerce.date(),
  entries: z.array(timesheetEntrySchema).max(200),
});

export const copyWeekSchema = z.object({ weekStart: z.coerce.date() });

export const listTimesheetsQuerySchema = z.object({
  /** me = own, team = direct reports, approvals = waiting on me (approval engine), company = everyone (ADMIN/HR). */
  scope: z.enum(['me', 'team', 'approvals', 'company']).default('me'),
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const timesheetDecideSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  remarks: z.string().max(500).optional(),
});

export const utilisationQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    projectId: z.string().uuid().optional(),
    /** true = APPROVED weeks only; default counts SUBMITTED + APPROVED. */
    approvedOnly: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  })
  .refine((v) => v.to >= v.from, { message: 'to must be on or after from' })
  .refine((v) => v.to.getTime() - v.from.getTime() <= 366 * 86_400_000, { message: 'Range is limited to one year' });
