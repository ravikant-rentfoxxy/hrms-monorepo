import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { upload } from '../middleware/upload';
import * as controller from '../controllers/document.controller';
import { documentUpdateSchema, documentUploadSchema } from '../validations/expense.validation';

export const documentsRouter = Router();
documentsRouter.use(authenticate, tenant);

documentsRouter.get('/', controller.list);
documentsRouter.get('/folders', controller.folders);
// File goes in multipart field `file` (any format). Documents are HR-managed:
// employees can view/download but never upload or edit them.
documentsRouter.post('/', requireRole('ADMIN', 'HR'), upload.single('file'), validate(documentUploadSchema), controller.upload);
documentsRouter.get('/:id/download', controller.download);
documentsRouter.patch('/:id', requireRole('ADMIN', 'HR'), validate(documentUpdateSchema), controller.update);
documentsRouter.delete('/:id', requireRole('ADMIN', 'HR'), controller.remove);
