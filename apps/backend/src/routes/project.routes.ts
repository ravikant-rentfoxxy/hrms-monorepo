import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/project.controller';
import { listProjectsQuerySchema, projectMembersSchema, projectSchema, projectUpdateSchema } from '../validations/timesheet.validation';

/** Timesheet projects. Everyone can list (the timesheet grid needs them); ADMIN/HR/MANAGER maintain them. */
export const projectsRouter = Router();
projectsRouter.use(authenticate, tenant);

projectsRouter.get('/', validate(listProjectsQuerySchema, 'query'), controller.list);
projectsRouter.post('/', requireRole('ADMIN', 'HR', 'MANAGER'), validate(projectSchema), controller.create);
projectsRouter.patch('/:id', requireRole('ADMIN', 'HR', 'MANAGER'), validate(projectUpdateSchema), controller.update);
projectsRouter.delete('/:id', requireRole('ADMIN', 'HR', 'MANAGER'), controller.remove);
// Who may log hours on the project (empty = everyone).
projectsRouter.put('/:id/members', requireRole('ADMIN', 'HR', 'MANAGER'), validate(projectMembersSchema), controller.setMembers);
