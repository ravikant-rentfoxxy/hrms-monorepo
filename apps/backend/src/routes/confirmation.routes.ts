import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/confirmation.controller';
import {
  createConfirmationSchema, decideConfirmationSchema, listConfirmationsQuerySchema, recommendSchema,
} from '../validations/confirmation.validation';

export const confirmationsRouter = Router();
confirmationsRouter.use(authenticate, tenant);

// ADMIN/HR see every request; managers their direct reports'.
confirmationsRouter.get('/', requireRole('ADMIN', 'HR', 'MANAGER'), validate(listConfirmationsQuerySchema, 'query'), controller.list);
confirmationsRouter.post('/', requireRole('ADMIN', 'HR'), validate(createConfirmationSchema), controller.create);
confirmationsRouter.get('/:id', requireRole('ADMIN', 'HR', 'MANAGER'), controller.detail);
confirmationsRouter.post('/:id/recommend', requireRole('ADMIN', 'HR', 'MANAGER'), validate(recommendSchema), controller.recommend);
// No requireRole: the approval engine decides who may act (named approvers may be plain employees).
confirmationsRouter.post('/:id/decide', validate(decideConfirmationSchema), controller.decide);
