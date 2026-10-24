import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/office.controller';
import { officeSchema, officeUpdateSchema } from '../validations/attendance.validation';

export const officesRouter = Router();
officesRouter.use(authenticate, tenant);

officesRouter.get('/', controller.list);
officesRouter.post('/', requireRole('ADMIN', 'HR'), validate(officeSchema), controller.create);
officesRouter.patch('/:id', requireRole('ADMIN', 'HR'), validate(officeUpdateSchema), controller.update);
officesRouter.delete('/:id', requireRole('ADMIN'), controller.remove);
