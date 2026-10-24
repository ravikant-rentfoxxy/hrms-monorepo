import { z } from 'zod';
import { LIFECYCLE_STAGES } from '../services/lifecycle.service';

const STAGE_KEYS = LIFECYCLE_STAGES.map((s) => s.key) as [string, ...string[]];

export const pipelineQuerySchema = z.object({ stage: z.enum(STAGE_KEYS).optional() });
