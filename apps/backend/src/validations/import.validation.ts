import { z } from 'zod';

/** Multipart form fields sent with the CSV on preview. */
export const importPreviewSchema = z.object({
  /** ATTENDANCE only: replace days that already have a punch. */
  overwrite: z.preprocess((v) => v === true || v === 'true' || v === '1' || v === 'on', z.boolean()).default(false),
});
