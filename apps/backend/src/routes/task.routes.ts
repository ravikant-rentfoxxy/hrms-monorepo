import { Router } from 'express';
import { authenticate, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/task.controller';
import { taskSchema, taskUpdateSchema } from '../validations/misc.validation';

export const tasksRouter = Router();
tasksRouter.use(authenticate, tenant);

tasksRouter.get('/', controller.list);
tasksRouter.post('/', validate(taskSchema), controller.create);
tasksRouter.patch('/:id', validate(taskUpdateSchema), controller.update);
tasksRouter.delete('/:id', controller.remove);
