import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/company.controller';
import * as auditController from '../controllers/audit.controller';
import { companySchema, companyUpdateSchema, memberSchema } from '../validations/company.validation';
import { platformAuditQuerySchema } from '../validations/audit.validation';

/** Platform-level routes: only SUPER_ADMIN. Manages tenants (companies). */
export const superAdminRouter = Router();

superAdminRouter.use(authenticate, requireRole('SUPER_ADMIN'));

superAdminRouter.get('/companies', controller.list);
superAdminRouter.post('/companies', validate(companySchema), controller.create);
superAdminRouter.get('/companies/:id', controller.get);
superAdminRouter.patch('/companies/:id', validate(companyUpdateSchema), controller.update);
superAdminRouter.delete('/companies/:id', controller.remove);

superAdminRouter.post('/companies/:id/members', validate(memberSchema), controller.grantMember);
superAdminRouter.post('/companies/:id/admins', validate(memberSchema), controller.grantAdmin);
superAdminRouter.get('/companies/:id/members', controller.listMembers);
superAdminRouter.delete('/companies/:id/members/:userId', controller.revokeMember);

superAdminRouter.get('/stats', controller.stats);

// Audit trail: platform events (companyId null), or one tenant's with ?companyId=.
superAdminRouter.get('/audit', validate(platformAuditQuerySchema, 'query'), auditController.platformList);
superAdminRouter.get('/audit/facets', auditController.platformFacets);
