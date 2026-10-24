import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/salary-revision.controller';
import {
  componentSchema, componentUpdateSchema, listRevisionsQuerySchema, previewSchema, revisionCancelSchema,
  revisionDecideSchema, revisionSchema, rescheduleSchema, restructureQuerySchema, restructureSchema, templateSchema, templateUpdateSchema,
} from '../validations/salary-revision.validation';

export const salaryRouter = Router();
salaryRouter.use(authenticate, tenant);

const admin = requireRole('ADMIN', 'HR');

// Pay heads (components) and CTC templates.
salaryRouter.get('/components', admin, controller.listComponents);
salaryRouter.post('/components', admin, validate(componentSchema), controller.createComponent);
salaryRouter.patch('/components/:id', admin, validate(componentUpdateSchema), controller.updateComponent);
salaryRouter.delete('/components/:id', admin, controller.deleteComponent);

salaryRouter.get('/templates', admin, controller.listTemplates);
salaryRouter.post('/templates', admin, validate(templateSchema), controller.createTemplate);
salaryRouter.patch('/templates/:id', admin, validate(templateUpdateSchema), controller.updateTemplate);
salaryRouter.delete('/templates/:id', admin, controller.deleteTemplate);

salaryRouter.post('/preview', admin, validate(previewSchema), controller.preview);

// Structure changed → re-split existing employees' salaries (CTC unchanged) from a date.
salaryRouter.get('/restructure', admin, validate(restructureQuerySchema, 'query'), controller.restructurePlan);
salaryRouter.post('/restructure', admin, validate(restructureSchema), controller.applyRestructure);
salaryRouter.post('/restructure/reschedule', admin, validate(restructureSchema), controller.rescheduleRestructure);

// Revisions (salary history + approvals).
salaryRouter.get('/revisions/me', controller.myRevisions);
salaryRouter.get('/revisions', admin, validate(listRevisionsQuerySchema, 'query'), controller.listRevisions);
salaryRouter.post('/revisions', admin, validate(revisionSchema), controller.createRevision);
// Visible to ADMIN/HR and to the current approver (checked in the service).
salaryRouter.get('/revisions/:id', controller.getRevision);
// No role gate: the approval engine decides who may act (named approvers may be plain employees).
salaryRouter.post('/revisions/:id/decide', validate(revisionDecideSchema), controller.decideRevision);
salaryRouter.post('/revisions/:id/cancel', admin, validate(revisionCancelSchema), controller.cancelRevision);
salaryRouter.post('/revisions/:id/reschedule', admin, validate(rescheduleSchema), controller.rescheduleRevision);
