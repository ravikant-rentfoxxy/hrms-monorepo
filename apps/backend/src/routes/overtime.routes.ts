import { Router } from 'express';
import { authenticate, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/overtime.controller';
import { overtimeDecideSchema, overtimeListQuerySchema, overtimeSchema } from '../validations/overtime.validation';

export const overtimeRouter = Router();
overtimeRouter.use(authenticate, tenant);

overtimeRouter.get('/', validate(overtimeListQuerySchema, 'query'), controller.list);
overtimeRouter.post('/', validate(overtimeSchema), controller.create);
overtimeRouter.get('/:id', controller.get);
overtimeRouter.post('/:id/cancel', controller.cancel);
// No requireRole: the approval engine decides who may act.
overtimeRouter.post('/:id/decide', validate(overtimeDecideSchema), controller.decide);
