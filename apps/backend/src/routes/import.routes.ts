import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { upload } from '../middleware/upload';
import * as controller from '../controllers/import.controller';
import { importPreviewSchema } from '../validations/import.validation';

export const importsRouter = Router();
importsRouter.use(authenticate, tenant, requireRole('ADMIN', 'HR'));

importsRouter.get('/', controller.list);
importsRouter.get('/templates', controller.templates);
importsRouter.get('/templates/:type', controller.template); // e.g. /templates/employees.csv
importsRouter.post('/:type/preview', upload.single('file'), validate(importPreviewSchema), controller.preview);
importsRouter.post('/:id/commit', controller.commit);
importsRouter.get('/:id', controller.get);
