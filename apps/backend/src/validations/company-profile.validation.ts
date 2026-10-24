import { z } from 'zod';

export const companyProfileSchema = z
  .object({
    address: z.string().trim().max(500),
    email: z.union([z.literal(''), z.string().trim().email()]),
    phone: z.string().trim().max(30),
    signatoryName: z.string().trim().max(80),
    signatoryTitle: z.string().trim().max(80),
  })
  .partial();
