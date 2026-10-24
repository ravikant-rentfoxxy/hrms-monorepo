import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/audit.controller';
import { auditQuerySchema } from '../validations/audit.validation';

/** Audit trail viewer for company admins. Platform events live under /superadmin/audit. */
export const auditRouter = Router();
auditRouter.use(authenticate, tenant, requireRole('ADMIN', 'HR'));

auditRouter.get('/', validate(auditQuerySchema, 'query'), controller.list);
auditRouter.get('/facets', controller.facets);
