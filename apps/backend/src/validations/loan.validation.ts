import { z } from 'zod';

export const applyLoanSchema = z.object({
  type: z.enum(['LOAN', 'SALARY_ADVANCE']).default('LOAN'),
  principal: z.coerce.number().positive().max(100_000_000),
  tenureMonths: z.coerce.number().int().min(1).max(60).optional(),
  reason: z.string().min(3).max(500),
  // ADMIN/HR only (checked in the service).
  employeeId: z.string().uuid().optional(),
  interestRate: z.coerce.number().min(0).max(36).optional(),
});

export const listLoansQuerySchema = z.object({
  scope: z.enum(['me', 'team', 'company']).default('me'),
  status: z.enum(['PENDING', 'ACTIVE', 'CLOSED', 'REJECTED', 'CANCELLED']).optional(),
  type: z.enum(['LOAN', 'SALARY_ADVANCE']).optional(),
});

export const emiPreviewQuerySchema = z.object({
  principal: z.coerce.number().positive().max(100_000_000),
  tenureMonths: z.coerce.number().int().min(1).max(60),
  interestRate: z.coerce.number().min(0).max(36).default(0),
});

export const decideLoanSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  remarks: z.string().max(500).optional(),
  interestRate: z.coerce.number().min(0).max(36).optional(),
  startMonth: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Use YYYY-MM').optional(),
});

export const forecloseSchema = z.object({
  remarks: z.string().min(3).max(500),
});
