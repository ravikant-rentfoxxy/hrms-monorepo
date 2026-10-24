import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import * as controller from '../controllers/system.controller';

/**
 * Scheduler jobs (platform-wide, not tenant-scoped — every job loops over all
 * companies and is idempotent per period). ADMIN / SUPER_ADMIN.
 */
export const systemRouter = Router();
systemRouter.use(authenticate, requireRole('ADMIN'));

systemRouter.get('/jobs', controller.jobs);
systemRouter.post('/jobs/:name/run', controller.runJob);
