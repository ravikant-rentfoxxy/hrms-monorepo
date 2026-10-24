import { z } from 'zod';

export const companySchema = z.object({
  name: z.string().min(2).max(120),
  // Optional: when omitted, the backend generates the next Code-01-style code.
  code: z
    .string()
    .min(2)
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, 'Letters, digits and dashes only')
    .optional(),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  timezone: z.string().max(60).optional(),
  workStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

export const companyUpdateSchema = companySchema.partial().extend({ isActive: z.boolean().optional() });

export const memberSchema = z.object({
  email: z.string().email().toLowerCase(),
  role: z.enum(['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE']).default('ADMIN'),
  // Required only when the email does not belong to an existing user yet.
  password: z.string().min(8).max(128).optional(),
  name: z.string().min(2).max(120).optional(),
  employeeCode: z.string().min(1).max(30).optional(),
  designation: z.string().max(80).default('Administrator'),
  department: z.string().max(80).default('Management'),
});
