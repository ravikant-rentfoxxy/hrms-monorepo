import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/shift.controller';
import {
  assignSchema,
  assignmentsQuerySchema,
  shiftListQuerySchema,
  shiftSchema,
  shiftUpdateSchema,
} from '../validations/shift.validation';

export const shiftsRouter = Router();
shiftsRouter.use(authenticate, tenant);

shiftsRouter.get('/', validate(shiftListQuerySchema, 'query'), controller.list);
shiftsRouter.post('/', requireRole('ADMIN', 'HR'), validate(shiftSchema), controller.create);


shiftsRouter.get('/assignments', validate(assignmentsQuerySchema, 'query'), controller.assignments);
shiftsRouter.post('/assignments', requireRole('ADMIN', 'HR'), validate(assignSchema), controller.assign);
shiftsRouter.delete('/assignments/:id', requireRole('ADMIN', 'HR'), controller.removeAssignment);

shiftsRouter.patch('/:id', requireRole('ADMIN', 'HR'), validate(shiftUpdateSchema), controller.update);
shiftsRouter.delete('/:id', requireRole('ADMIN', 'HR'), controller.remove);
