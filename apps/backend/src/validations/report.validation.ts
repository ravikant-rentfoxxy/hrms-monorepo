import { z } from 'zod';

/** Empty query-string values ("?department=") count as "not given". */
const opt = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());

export const reportQuerySchema = z
  .object({
    from: opt(z.coerce.date()),
    to: opt(z.coerce.date()),
    asOf: opt(z.coerce.date()),
    year: opt(z.coerce.number().int().min(2000).max(2100)),
    month: opt(z.coerce.number().int().min(1).max(12)),
    departmentId: opt(z.string().uuid()),
    department: opt(z.string().max(80)),
    officeId: opt(z.string().uuid()),
    groupBy: opt(z.string().max(30)),
    status: opt(z.string().max(30).toUpperCase()),
    days: opt(z.coerce.number().int().min(1).max(365)),
    format: opt(z.enum(['json', 'csv'])),
  })
  .refine((v) => !(v.from && v.to) || v.from <= v.to, { message: '"from" must be on or before "to"', path: ['to'] });
