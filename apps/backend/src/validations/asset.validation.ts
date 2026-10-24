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
  expectedReturn: z.coerce.date().nullable().optional(),
  conditionOut: z.string().max(60).optional(),
  notes: z.string().max(500).optional(),
});

export const returnAssetSchema = z.object({
  conditionIn: z.string().trim().min(2).max(60),
  status: z.enum(['AVAILABLE', 'IN_REPAIR']).default('AVAILABLE'),
  notes: z.string().max(500).optional(),
});

export const listAssetsQuerySchema = z.object({
  status: z.enum(ASSET_STATUSES).optional(),
  category: z.enum(ASSET_CATEGORIES).optional(),
  q: z.string().max(80).optional(),
});
