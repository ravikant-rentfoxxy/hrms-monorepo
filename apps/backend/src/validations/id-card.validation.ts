import { z } from 'zod';
import { CARD_FIELDS, CARD_LAYOUTS, MAX_CARD_FIELDS, PHOTO_SHAPES } from '../services/id-card.service';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #059571');

export const idCardSettingsSchema = z
  .object({
    brandColor: hex,
    idCardLayout: z.enum(CARD_LAYOUTS),
    idCardFields: z
      .array(z.enum(CARD_FIELDS))
      .transform((f) => [...new Set(f)])
      .refine((f) => f.length <= MAX_CARD_FIELDS, `Up to ${MAX_CARD_FIELDS} details fit on the card`),
    idCardBackNote: z.string().trim().max(200),
    idCardStyle: z
      .object({
        headerColor: hex,
        headerColor2: z.union([z.literal(''), hex]),
        bodyColor: hex,
        accentColor: hex,
        footerColor: hex,
        photoShape: z.enum(PHOTO_SHAPES),
        title: z.string().trim().max(30),
        showAddress: z.boolean(),
        showContact: z.boolean(),
        showSignatory: z.boolean(),
        validityMonths: z.number().int().min(0).max(120),
      })
      .partial()
      .strict(),
  })
  .partial();
