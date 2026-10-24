import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/loan.controller';
import {
  applyLoanSchema, decideLoanSchema, emiPreviewQuerySchema, forecloseSchema, listLoansQuerySchema,
} from '../validations/loan.validation';

export const loansRouter = Router();
loansRouter.use(authenticate, tenant);

loansRouter.get('/', validate(listLoansQuerySchema, 'query'), controller.list);
loansRouter.get('/emi-preview', validate(emiPreviewQuerySchema, 'query'), controller.emiPreview);
loansRouter.post('/', validate(applyLoanSchema), controller.apply);
loansRouter.get('/:id', controller.detail); // owner, their manager, the current approver or ADMIN/HR (service)
loansRouter.post('/:id/cancel', controller.cancel);
// No role gate: the approval engine decides who may act (named approvers may be plain employees).
loansRouter.post('/:id/decide', validate(decideLoanSchema), controller.decide);
loansRouter.post('/:id/close', requireRole('ADMIN', 'HR'), validate(forecloseSchema), controller.foreclose);
