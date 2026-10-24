import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/payroll.controller';
import {
  form16QuerySchema, payslipListQuerySchema, payslipSchema, payslipUpdateSchema, runCreateSchema, runPaidSchema,
  runRecalculateSchema, taxProjectionQuerySchema,
} from '../validations/payroll.validation';

export const payrollRouter = Router();
payrollRouter.use(authenticate, tenant);

/** @deprecated one-shot run + publish (kept for older clients). */

// Run workflow: DRAFT → LOCKED → PUBLISHED
payrollRouter.get('/runs', requireRole('ADMIN', 'HR'), controller.listRuns);
payrollRouter.post('/runs', requireRole('ADMIN', 'HR'), validate(runCreateSchema), controller.createRun);
payrollRouter.get('/runs/:id', requireRole('ADMIN', 'HR'), controller.getRun);
payrollRouter.post('/runs/:id/recalculate', requireRole('ADMIN', 'HR'), validate(runRecalculateSchema), controller.recalculateRun);
payrollRouter.post('/runs/:id/lock', requireRole('ADMIN', 'HR'), controller.lockRun);
payrollRouter.post('/runs/:id/unlock', requireRole('ADMIN'), controller.unlockRun);
payrollRouter.post('/runs/:id/approve', requireRole('ADMIN'), controller.approveRun);
payrollRouter.post('/runs/:id/publish', requireRole('ADMIN', 'HR'), controller.publishRun);
payrollRouter.post('/runs/:id/mark-paid', requireRole('ADMIN', 'HR'), validate(runPaidSchema), controller.markRunPaid);

// Statutory / bank outputs of a run
payrollRouter.get('/runs/:id/bank-file.csv', requireRole('ADMIN', 'HR'), controller.bankFile);
payrollRouter.get('/runs/:id/ecr.txt', requireRole('ADMIN', 'HR'), controller.ecrFile);
payrollRouter.get('/runs/:id/esi.csv', requireRole('ADMIN', 'HR'), controller.esiFile);
payrollRouter.get('/runs/:id/pt.csv', requireRole('ADMIN', 'HR'), controller.ptFile);
payrollRouter.get('/runs/:id/register.csv', requireRole('ADMIN', 'HR'), controller.registerFile);

// Income tax
payrollRouter.get('/tax-projection', validate(taxProjectionQuerySchema, 'query'), controller.taxProjection);
payrollRouter.get('/form16/:employeeId', validate(form16QuerySchema, 'query'), controller.form16);

// Payslips (employees see their own PUBLISHED payslips; drafts are ADMIN/HR only)
payrollRouter.get('/payslips', validate(payslipListQuerySchema, 'query'), controller.list);
payrollRouter.get('/payslips/:id', controller.get);
payrollRouter.get('/payslips/:id/pdf', controller.pdf);
payrollRouter.post('/payslips', requireRole('ADMIN', 'HR'), validate(payslipSchema), controller.create);
payrollRouter.patch('/payslips/:id', requireRole('ADMIN'), validate(payslipUpdateSchema), controller.update);
payrollRouter.delete('/payslips/:id', requireRole('ADMIN'), controller.remove);
