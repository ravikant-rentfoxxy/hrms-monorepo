import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/transfer.controller';
import {
  cancelTransferSchema, createTransferSchema, decideTransferSchema, listTransfersQuerySchema,
} from '../validations/transfer.validation';

export const transfersRouter = Router();
transfersRouter.use(authenticate, tenant);

// ADMIN/HR see all; managers their reports' (+ raised by them); employees their own.
transfersRouter.get('/', validate(listTransfersQuerySchema, 'query'), controller.list);
transfersRouter.get('/me', controller.mine);
transfersRouter.get('/:id', controller.detail);
// The service checks the caller is the employee's reporting manager or HR.
transfersRouter.post('/', requireRole('ADMIN', 'HR', 'MANAGER'), validate(createTransferSchema), controller.create);
// No requireRole: the approval engine decides who may act (named approvers may be plain employees).
transfersRouter.post('/:id/decide', validate(decideTransferSchema), controller.decide);
transfersRouter.post('/:id/cancel', validate(cancelTransferSchema), controller.cancel);
transfersRouter.post('/:id/apply', requireRole('ADMIN', 'HR'), controller.applyNow);
