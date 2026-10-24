import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/integration.controller';
import { integrationSchema, integrationUpdateSchema, journalQuerySchema, testIntegrationSchema } from '../validations/integration.validation';

/** Company integrations — ADMIN only (the accounting export is also open to HR). */
export const integrationsRouter = Router();
integrationsRouter.use(authenticate, tenant);

integrationsRouter.get('/accounting/payroll-journal', requireRole('ADMIN', 'HR'), validate(journalQuerySchema, 'query'), controller.journal);
integrationsRouter.get('/accounting/payroll-journal.csv', requireRole('ADMIN', 'HR'), validate(journalQuerySchema, 'query'), controller.journalCsv);

integrationsRouter.get('/events', requireRole('ADMIN'), controller.events);
integrationsRouter.get('/', requireRole('ADMIN'), controller.list);
integrationsRouter.post('/', requireRole('ADMIN'), validate(integrationSchema), controller.create);
integrationsRouter.patch('/:id', requireRole('ADMIN'), validate(integrationUpdateSchema), controller.update);
integrationsRouter.delete('/:id', requireRole('ADMIN'), controller.remove);
integrationsRouter.post('/:id/test', requireRole('ADMIN'), validate(testIntegrationSchema), controller.test);
