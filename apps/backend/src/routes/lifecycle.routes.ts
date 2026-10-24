import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/lifecycle.controller';
import { pipelineQuerySchema } from '../validations/lifecycle.validation';

export const lifecycleRouter = Router();
lifecycleRouter.use(authenticate, tenant);

lifecycleRouter.get('/pipeline', requireRole('ADMIN', 'HR'), validate(pipelineQuerySchema, 'query'), controller.pipeline);
lifecycleRouter.get('/employees/me/timeline', controller.myTimeline);
// Self, reporting manager or ADMIN/HR (checked in the service).
lifecycleRouter.get('/employees/:id/timeline', controller.timeline);
