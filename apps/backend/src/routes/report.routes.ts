import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/report.controller';
import { reportQuerySchema } from '../validations/report.validation';

export const reportsRouter = Router();
reportsRouter.use(authenticate, tenant);

// Managers get the team-scoped subset (enforced per report in the controller).
reportsRouter.get('/catalog', requireRole('ADMIN', 'HR', 'MANAGER'), controller.catalog);
reportsRouter.get('/:key', requireRole('ADMIN', 'HR', 'MANAGER'), validate(reportQuerySchema, 'query'), controller.run);
