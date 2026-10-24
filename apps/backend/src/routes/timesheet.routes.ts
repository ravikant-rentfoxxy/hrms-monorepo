import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/timesheet.controller';
import {
  copyWeekSchema, listTimesheetsQuerySchema, saveWeekSchema, timesheetDecideSchema, utilisationQuerySchema, weekQuerySchema,
} from '../validations/timesheet.validation';

export const timesheetsRouter = Router();
timesheetsRouter.use(authenticate, tenant);

// HR reports
timesheetsRouter.get('/utilisation', requireRole('ADMIN', 'HR'), validate(utilisationQuerySchema, 'query'), controller.utilisation);
timesheetsRouter.get('/utilisation.csv', requireRole('ADMIN', 'HR'), validate(utilisationQuerySchema, 'query'), controller.utilisationCsv);

// Weekly grid (own week; managers/HR may read others' with ?employeeId=)
timesheetsRouter.get('/week', validate(weekQuerySchema, 'query'), controller.week);
timesheetsRouter.put('/week', validate(saveWeekSchema), controller.save);
timesheetsRouter.post('/week', validate(saveWeekSchema), controller.save); // same as PUT, for clients without PUT
timesheetsRouter.post('/week/copy-last', validate(copyWeekSchema), controller.copyLast);

timesheetsRouter.get('/', validate(listTimesheetsQuerySchema, 'query'), controller.list);
timesheetsRouter.get('/:id', controller.get);
timesheetsRouter.post('/:id/submit', controller.submit);
timesheetsRouter.post('/:id/recall', controller.recall);
// No requireRole: named approvers may be plain employees — the approval engine decides who may act.
timesheetsRouter.post('/:id/decide', validate(timesheetDecideSchema), controller.decide);
