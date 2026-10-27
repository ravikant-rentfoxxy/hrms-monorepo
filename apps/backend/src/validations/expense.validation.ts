import { z } from 'zod';

export const expenseSchema = z.object({
  category: z.string().min(2).max(60),
  description: z.string().min(2).max(500),
  amount: z.coerce.number().positive().max(10_000_000),
  date: z.coerce.date(),
});

export const listExpensesQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  scope: z.enum(['me', 'company']).default('me'),
});

export const expenseDecideSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  remarks: z.string().max(500).optional(),
});

export const documentUploadSchema = z.object({
  name: z.string().max(200).optional(),
  category: z.string().max(60).optional(), // folder; unknown values fall back to General
  employeeId: z.string().uuid().optional(),
  companyWide: z.coerce.boolean().default(false),
});

/**
 * Documents list filter. me = the caller's personal documents, company = company-wide ones,
 * employees = other people's personal documents (ADMIN/HR). Omitted = everything the caller may see.
 */
export const documentListQuerySchema = z.object({
  scope: z.enum(['me', 'company', 'employees']).optional(),
  /** With scope=employees: only this employee's personal documents. */
  employeeId: z.string().uuid().optional(),
});

/** Edit a document's details (the file itself is immutable — re-upload instead). */
export const documentUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  category: z.string().max(60).optional(),
  // Ownership (ADMIN/HR only): employeeId reassigns, companyWide=true makes it visible to everyone.
  employeeId: z.string().uuid().optional(),
  companyWide: z.boolean().optional(),
});
