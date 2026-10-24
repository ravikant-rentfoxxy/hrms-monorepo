import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { upload } from '../middleware/upload';
import * as controller from '../controllers/onboarding.controller';
import {
  listCasesQuerySchema, onboardingTemplateSchema, onboardingTemplateUpdateSchema, startCaseSchema,
} from '../validations/onboarding.validation';

export const onboardingRouter = Router();
onboardingRouter.use(authenticate, tenant);

onboardingRouter.get('/templates', requireRole('ADMIN', 'HR'), controller.listTemplates);
onboardingRouter.post('/templates', requireRole('ADMIN', 'HR'), validate(onboardingTemplateSchema), controller.createTemplate);
onboardingRouter.patch('/templates/:id', requireRole('ADMIN', 'HR'), validate(onboardingTemplateUpdateSchema), controller.updateTemplate);
onboardingRouter.delete('/templates/:id', requireRole('ADMIN', 'HR'), controller.deleteTemplate);

onboardingRouter.get('/cases', requireRole('ADMIN', 'HR', 'MANAGER'), validate(listCasesQuerySchema, 'query'), controller.listCases);
onboardingRouter.post('/cases', requireRole('ADMIN', 'HR'), validate(startCaseSchema), controller.startCase);
onboardingRouter.get('/cases/me', controller.myCase);
onboardingRouter.get('/cases/:id', controller.getCase);
onboardingRouter.post('/cases/:id/cancel', requireRole('ADMIN', 'HR'), controller.cancelCase);

// My tasks: the joiner's own tasks, a manager's tasks for reports, HR/IT/Admin department tasks.
onboardingRouter.get('/tasks', controller.myTasks);
onboardingRouter.post('/tasks/:id/complete', upload.single('file'), controller.completeTask);
onboardingRouter.post('/tasks/:id/reopen', controller.reopenTask);
