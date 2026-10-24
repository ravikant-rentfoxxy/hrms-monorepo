import { z } from 'zod';

export const INTEGRATION_TYPES = ['SLACK', 'TEAMS', 'WEBHOOK', 'GOOGLE_CALENDAR', 'OUTLOOK_CALENDAR', 'TALLY', 'ZOHO_BOOKS'] as const;
/** Types that push to a URL and therefore need one. */
export const URL_TYPES = ['SLACK', 'TEAMS', 'WEBHOOK'];

const eventsCsv = z
  .string()
  .max(1000)
  .default('')
  .transform((v) => [...new Set(v.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))].join(','));

const base = z.object({
  type: z.enum(INTEGRATION_TYPES),
  name: z.string().trim().min(2).max(80),
  url: z.union([z.literal(''), z.string().trim().url().max(1000)]).default(''),
  events: eventsCsv,
  isActive: z.boolean().default(true),
});

export const integrationSchema = base.refine((v) => !URL_TYPES.includes(v.type) || v.url !== '', {
  message: 'A URL is required for Slack / Teams / webhook integrations',
  path: ['url'],
});

export const integrationUpdateSchema = base.partial();

export const testIntegrationSchema = z.object({
  event: z.string().trim().min(1).max(80).default('integration.test'),
});

export const journalQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM'),
});
