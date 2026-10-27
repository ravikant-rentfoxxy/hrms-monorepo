import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { upload } from '../middleware/upload';
import * as controller from '../controllers/timesheet.controller';
import { copyDaySchema, dayQuerySchema, listTimesheetsQuerySchema, saveDaySchema, utilisationQuerySchema } from '../validations/timesheet.validation';

export const timesheetsRouter = Router();
timesheetsRouter.use(authenticate, tenant);

// HR reports
timesheetsRouter.get('/utilisation', requireRole('ADMIN', 'HR'), validate(utilisationQuerySchema, 'query'), controller.utilisation);
timesheetsRouter.get('/utilisation.csv', requireRole('ADMIN', 'HR'), validate(utilisationQuerySchema, 'query'), controller.utilisationCsv);

// One day (own; managers/HR may read others' with ?employeeId=). Today and past days only.
timesheetsRouter.get('/day', validate(dayQuerySchema, 'query'), controller.day);
timesheetsRouter.put('/day', validate(saveDaySchema), controller.save);
timesheetsRouter.post('/day', validate(saveDaySchema), controller.save); // same as PUT, for clients without PUT
timesheetsRouter.post('/day/copy-previous', validate(copyDaySchema), controller.copyPrevious);

timesheetsRouter.get('/', validate(listTimesheetsQuerySchema, 'query'), controller.list);
timesheetsRouter.get('/:id', controller.get);
timesheetsRouter.post('/:id/submit', controller.submit);
timesheetsRouter.delete('/:id/entries/:entryId', controller.deleteEntry);

// Entry attachments (documents, images, PDFs) in multipart field `file`; owner adds/removes while the day is a draft.
timesheetsRouter.post('/:id/entries/:entryId/attachments', upload.single('file'), controller.addAttachment);
timesheetsRouter.get('/:id/attachments/:attachmentId/download', controller.attachmentDownload);
timesheetsRouter.delete('/:id/attachments/:attachmentId', controller.deleteAttachment);
