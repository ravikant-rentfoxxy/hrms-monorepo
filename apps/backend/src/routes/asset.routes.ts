import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/asset.controller';
import {
  assetSchema, assetUpdateSchema, assignAssetSchema, assignmentDatesSchema, issueAssetsSchema, listAssetsQuerySchema, returnAssetSchema,
} from '../validations/asset.validation';

export const assetsRouter = Router();
assetsRouter.use(authenticate, tenant);

// Self-service first (before /:id).
assetsRouter.get('/mine', controller.mine);
assetsRouter.get('/employee/:employeeId', controller.employeeAssets);
assetsRouter.post('/employee/:employeeId/issue', requireRole('ADMIN', 'HR'), validate(issueAssetsSchema), controller.issueToEmployee);

assetsRouter.get('/meta', requireRole('ADMIN', 'HR'), controller.meta);
assetsRouter.get('/export', requireRole('ADMIN', 'HR'), controller.exportCsv);
assetsRouter.get('/', requireRole('ADMIN', 'HR'), validate(listAssetsQuerySchema, 'query'), controller.list);
assetsRouter.post('/', requireRole('ADMIN', 'HR'), validate(assetSchema), controller.create);
assetsRouter.get('/:id', requireRole('ADMIN', 'HR'), controller.get);
assetsRouter.patch('/:id', requireRole('ADMIN', 'HR'), validate(assetUpdateSchema), controller.update);
assetsRouter.delete('/:id', requireRole('ADMIN', 'HR'), controller.remove);
assetsRouter.post('/:id/assign', requireRole('ADMIN', 'HR'), validate(assignAssetSchema), controller.assign);
assetsRouter.post('/:id/return', requireRole('ADMIN', 'HR'), validate(returnAssetSchema), controller.giveBack);
assetsRouter.get('/:id/history', requireRole('ADMIN', 'HR'), controller.history);
assetsRouter.patch('/assignments/:assignmentId/dates', requireRole('ADMIN', 'HR'), validate(assignmentDatesSchema), controller.updateAssignmentDates);
