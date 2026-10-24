import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/approval.controller';
import { inboxQuerySchema, moduleParamSchema, saveFlowSchema, trailParamSchema } from '../validations/approval.validation';

/**
 * Approval flows (configuration) + the unified inbox. Decisions are made via
 * each module's own `POST /<module>/:id/decide` (see `decidePath` on inbox items).
 */
export const approvalsRouter = Router();
approvalsRouter.use(authenticate, tenant);

approvalsRouter.get('/flows', requireRole('ADMIN', 'HR'), controller.listFlows);
approvalsRouter.put('/flows/:module', requireRole('ADMIN', 'HR'), validate(moduleParamSchema, 'params'), validate(saveFlowSchema), controller.saveFlow);
approvalsRouter.delete('/flows/:module', requireRole('ADMIN', 'HR'), validate(moduleParamSchema, 'params'), controller.resetFlow);

approvalsRouter.get('/inbox', validate(inboxQuerySchema, 'query'), controller.inbox);
approvalsRouter.get('/inbox/counts', controller.inboxCounts);
approvalsRouter.get('/trail/:module/:requestId', validate(trailParamSchema, 'params'), controller.trail);
