import { z } from 'zod';
import { SKILL_LEVELS } from '../services/career.service';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
/** Optional date where null / '' clears the value (multipart sends strings). */
const clearableDate = z.preprocess((v) => (v === '' || v === 'null' ? null : v), z.coerce.date().nullable()).optional();

export const skillSchema = z.object({
  skill: z.string().trim().min(1).max(60),
  level: z.enum(SKILL_LEVELS).default('INTERMEDIATE'),
  years: z.coerce.number().min(0).max(60).optional(),
  // ADMIN/HR maintaining someone else's profile.
  employeeId: z.string().uuid().optional(),
});

export const updateSkillSchema = z.object({
  skill: z.string().trim().min(1).max(60).optional(),
  level: z.enum(SKILL_LEVELS).optional(),
  years: z.coerce.number().min(0).max(60).optional(),
});

export const endorseSchema = z.object({ endorse: z.boolean().default(true) });

export const skillSearchQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  level: z.enum(SKILL_LEVELS).optional(),
  department: z.string().max(80).optional(),
  endorsed: bool.optional(),
});

/** Multipart-friendly (all strings); the file is optional. */
export const certificationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  issuer: z.string().trim().max(160).optional(),
  credentialId: z.string().trim().max(120).optional(),
  credentialUrl: z.union([z.string().trim().url().max(500), z.literal('')]).optional(),
  issuedOn: clearableDate,
  expiresOn: clearableDate,
  employeeId: z.string().uuid().optional(),
});

export const updateCertificationSchema = certificationSchema.omit({ employeeId: true }).partial();

export const verifySchema = z.object({ verified: z.boolean().default(true) });

export const certificationQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  employeeId: z.string().uuid().optional(),
  department: z.string().max(80).optional(),
  verified: bool.optional(),
  status: z.enum(['VALID', 'EXPIRING', 'EXPIRED', 'NO_EXPIRY']).optional(),
  internal: bool.optional(),
});

export const expiringQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
