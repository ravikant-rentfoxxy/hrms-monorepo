import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/announcement.controller';
import { announcementSchema } from '../validations/payroll.validation';

export const announcementsRouter = Router();
announcementsRouter.use(authenticate, tenant);

announcementsRouter.get('/', controller.list);
announcementsRouter.post('/', requireRole('ADMIN', 'HR'), validate(announcementSchema), controller.create);
announcementsRouter.post('/:id/read', controller.markRead);
announcementsRouter.delete('/:id', requireRole('ADMIN', 'HR'), controller.remove);
