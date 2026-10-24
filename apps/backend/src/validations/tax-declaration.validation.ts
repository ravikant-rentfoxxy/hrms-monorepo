import { z } from 'zod';
import { TAX_SECTIONS } from '../services/tax-declaration.service';

const fy = z.string().regex(/^\d{4}-\d{2}$/, 'Financial year must look like 2026-27');
const amount = z.coerce.number().min(0).max(100_000_000);

const itemSchema = z.object({
  section: z.enum(TAX_SECTIONS),
  label: z.string().max(120).default(''),
  declared: amount.default(0),
  // HRA
  rentPerMonth: amount.optional(),
  months: z.coerce.number().int().min(1).max(12).optional(),
  landlordName: z.string().max(120).optional(),
  landlordPan: z.string().max(10).optional(),
  landlordAddress: z.string().max(300).optional(),
  metro: z.boolean().optional(),
  // 80D
  forParents: z.boolean().optional(),
  seniorCitizen: z.boolean().optional(),
});

export const fyQuerySchema = z.object({ fy: fy.optional() });

export const saveDeclarationSchema = z.object({
  fy,
  regime: z.enum(['NEW', 'OLD']),
  items: z.array(itemSchema).max(60).default([]),
  previousEmployerIncome: amount.default(0),
  previousEmployerTds: amount.default(0),
});

export const submitDeclarationSchema = z.object({ fy });

export const listDeclarationsQuerySchema = z.object({
  fy: fy.optional(),
  status: z.enum(['DRAFT', 'SUBMITTED', 'VERIFIED', 'REJECTED']).optional(),
  employeeId: z.string().uuid().optional(),
});

export const proofUploadSchema = z.object({
  section: z.enum(TAX_SECTIONS),
  name: z.string().max(200).optional(),
});

export const verifySchema = z.object({
  items: z.array(z.object({ index: z.number().int().min(0), approved: amount })).default([]),
  proofs: z.array(z.object({ id: z.string().uuid(), status: z.enum(['ACCEPTED', 'REJECTED', 'PENDING']) })).default([]),
  remarks: z.string().max(500).optional(),
});

export const rejectSchema = z.object({
  remarks: z.string().min(3).max(500),
});
