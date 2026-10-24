import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/employee.controller';
import {
  createEmployeeSchema, directoryQuerySchema, orgChartQuerySchema, setPasswordSchema, updateEmployeeSchema,
} from '../validations/employee.validation';

export const employeesRouter = Router();
employeesRouter.use(authenticate, tenant);

employeesRouter.get('/', validate(directoryQuerySchema, 'query'), controller.list);
employeesRouter.get('/birthdays', controller.birthdays);
employeesRouter.get('/former/export', requireRole('ADMIN', 'HR'), validate(directoryQuerySchema, 'query'), controller.exportFormer);
employeesRouter.get('/org-chart', validate(orgChartQuerySchema, 'query'), controller.orgChart);
// One-off migration: encrypt identity numbers still stored as plaintext.
employeesRouter.post('/encrypt-existing', requireRole('ADMIN'), controller.encryptExisting);
employeesRouter.get('/:id', controller.get);
employeesRouter.get('/:id/salary-structure', controller.salaryStructure);
employeesRouter.get('/:id/reporting-chain', controller.reportingChain);
employeesRouter.post('/', requireRole('ADMIN', 'HR'), validate(createEmployeeSchema), controller.create);
employeesRouter.patch('/:id', validate(updateEmployeeSchema), controller.update);
employeesRouter.post('/:id/password', requireRole('ADMIN', 'HR'), validate(setPasswordSchema), controller.setPassword);
employeesRouter.delete('/:id', requireRole('ADMIN'), controller.deactivate);
