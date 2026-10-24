import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/letter.controller';
import {
  generateLetterSchema, letterTemplateSchema, letterTemplateUpdateSchema, listLettersQuerySchema, previewLetterSchema,
  requestLetterSchema,
} from '../validations/letter.validation';

export const lettersRouter = Router();
lettersRouter.use(authenticate, tenant);

lettersRouter.get('/placeholders', controller.placeholders);
lettersRouter.get('/templates', requireRole('ADMIN', 'HR'), controller.listTemplates);
lettersRouter.post('/templates', requireRole('ADMIN', 'HR'), validate(letterTemplateSchema), controller.createTemplate);
lettersRouter.patch('/templates/:id', requireRole('ADMIN', 'HR'), validate(letterTemplateUpdateSchema), controller.updateTemplate);
lettersRouter.delete('/templates/:id', requireRole('ADMIN', 'HR'), controller.deleteTemplate);

lettersRouter.post('/preview', requireRole('ADMIN', 'HR'), validate(previewLetterSchema), controller.preview);
lettersRouter.post('/generate', requireRole('ADMIN', 'HR'), validate(generateLetterSchema), controller.generate);
// Employee self-service: salary certificate / experience letter, issued instantly.
lettersRouter.post('/request', validate(requestLetterSchema), controller.requestOwn);

// Issued letters: ADMIN/HR see all (filter by employeeId), everyone else their own.
lettersRouter.get('/', validate(listLettersQuerySchema, 'query'), controller.list);
lettersRouter.get('/:id/download', controller.download);
lettersRouter.delete('/:id', requireRole('ADMIN', 'HR'), controller.remove);
