import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().default('hrms-files'),
  SUPERADMIN_EMAIL: z.string().email().default('superadmin@hrms.local'),
  SUPERADMIN_PASSWORD: z.string().min(8).default('SuperAdmin@123'),
  CORS_ORIGINS: z.string().default('*'),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(15),
  /** AES key material for PAN / Aadhaar / bank account / UAN at rest. Falls back to a key derived from JWT_ACCESS_SECRET. */
  FIELD_ENCRYPTION_KEY: z.string().optional(),
  /** Public web URL used in candidate-portal links (e.g. https://hr.example.com). */
  WEB_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  /** Set to 'false' to disable the in-process job scheduler (e.g. on extra API replicas). */
  SCHEDULER_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
