import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/travel.controller';
import { listTravelQuerySchema, settleSchema, travelDecideSchema, travelSchema } from '../validations/travel.validation';

export const travelRouter = Router();
travelRouter.use(authenticate, tenant);

travelRouter.get('/', validate(listTravelQuerySchema, 'query'), controller.list);
travelRouter.post('/', validate(travelSchema), controller.apply);
travelRouter.get('/:id', controller.get);
travelRouter.post('/:id/cancel', controller.cancel);
// No requireRole: named approvers may be plain employees — the approval engine decides who may act.
travelRouter.post('/:id/decide', validate(travelDecideSchema), controller.decide);
travelRouter.get('/:id/settlement', requireRole('ADMIN', 'HR'), controller.settlementPreview);
travelRouter.post('/:id/settle', requireRole('ADMIN', 'HR'), validate(settleSchema), controller.settle);
