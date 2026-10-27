import { z } from 'zod';
import { ASSET_CATEGORIES, ASSET_STATUSES } from '../services/asset.service';

export const assetSchema = z.object({
  tag: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(120),
  category: z.enum(ASSET_CATEGORIES).default('Laptop'),
  serialNumber: z.string().max(80).default(''),
  brand: z.string().max(60).default(''),
  model: z.string().max(80).default(''),
  purchaseDate: z.coerce.date().nullable().optional(),
  cost: z.coerce.number().min(0).max(1e9).default(0),
  status: z.enum(ASSET_STATUSES).optional(),
  notes: z.string().max(1000).default(''),
});

export const assetUpdateSchema = z.object({
  tag: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(2).max(120).optional(),
  category: z.enum(ASSET_CATEGORIES).optional(),
  serialNumber: z.string().max(80).optional(),
  brand: z.string().max(60).optional(),
  model: z.string().max(80).optional(),
  purchaseDate: z.coerce.date().nullable().optional(),
  cost: z.coerce.number().min(0).max(1e9).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  notes: z.string().max(1000).optional(),
});

export const assignAssetSchema = z.object({
  employeeId: z.string().uuid(),
  issuedOn: z.coerce.date().nullable().optional(),
  expectedReturn: z.coerce.date().nullable().optional(),
  conditionOut: z.string().max(60).optional(),
  notes: z.string().max(500).optional(),
});

export const returnAssetSchema = z.object({
  returnedOn: z.coerce.date().nullable().optional(),
  conditionIn: z.string().trim().min(2).max(60),
  status: z.enum(['AVAILABLE', 'IN_REPAIR']).default('AVAILABLE'),
  notes: z.string().max(500).optional(),
});

export const listAssetsQuerySchema = z.object({
  status: z.enum(ASSET_STATUSES).optional(),
  category: z.enum(ASSET_CATEGORIES).optional(),
  q: z.string().max(80).optional(),
});

/** Rows of name + count (+ serial for a single unit): new assets issued straight to one employee. */
export const newAssetItemsSchema = z
  .array(
    z.object({
      name: z.string().trim().min(2).max(120),
      category: z.enum(ASSET_CATEGORIES).default('Other'),
      count: z.coerce.number().int().min(1).max(20),
      serialNumber: z.string().trim().max(80).optional(),
      description: z.string().trim().max(1000).optional(),
      issuedOn: z.coerce.date().nullable().optional(),
    })
  )
  .min(1)
  .max(20);

export const issueAssetsSchema = z.object({ items: newAssetItemsSchema, issuedOn: z.coerce.date().nullable().optional() });

export const assignmentDatesSchema = z
  .object({
    issuedOn: z.coerce.date(),
    expectedReturn: z.coerce.date().nullable(),
    returnedOn: z.coerce.date(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'Nothing to change');
