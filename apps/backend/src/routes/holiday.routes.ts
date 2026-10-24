import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/holiday.controller';
import { holidayCreateSchema, holidaySchema, holidayYearQuerySchema } from '../validations/payroll.validation';

export const holidaysRouter = Router();
holidaysRouter.use(authenticate, tenant);

holidaysRouter.get('/', validate(holidayYearQuerySchema, 'query'), controller.list);
holidaysRouter.post('/', requireRole('ADMIN', 'HR'), validate(holidayCreateSchema), controller.create);
holidaysRouter.patch('/:id', requireRole('ADMIN', 'HR'), validate(holidaySchema.partial()), controller.update);
holidaysRouter.delete('/:id', requireRole('ADMIN', 'HR'), controller.remove);
