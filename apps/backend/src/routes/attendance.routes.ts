import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/attendance.controller';
import {
  autoMarkSchema,
  companyDayQuerySchema,
  exportQuerySchema,
  monthlyQuerySchema,
  punchSchema,
  regularizationDecideSchema,
  regularizationSchema,
  regularizationScopeSchema,
  workModeSchema,
} from '../validations/attendance.validation';

export const attendanceRouter = Router();
attendanceRouter.use(authenticate, tenant);

attendanceRouter.post('/check-in', validate(punchSchema), controller.checkIn);
attendanceRouter.post('/check-out', validate(punchSchema), controller.checkOut);
attendanceRouter.get('/today', controller.today);
attendanceRouter.get('/today/summary', controller.todaySummary);

attendanceRouter.post('/regularizations', validate(regularizationSchema), controller.requestRegularization);
attendanceRouter.get('/regularizations', validate(regularizationScopeSchema, 'query'), controller.listRegularizations);
attendanceRouter.get('/regularizations/:id/trail', controller.regularizationTrail);
attendanceRouter.post('/regularizations/:id/cancel', controller.cancelRegularization);
// No requireRole: the approval engine decides who may act (named approvers can be plain employees).
attendanceRouter.post('/regularizations/:id/decide', validate(regularizationDecideSchema), controller.decideRegularization);

attendanceRouter.get('/export', requireRole('ADMIN', 'HR'), validate(exportQuerySchema, 'query'), controller.exportCsv);
attendanceRouter.get('/muster.csv', requireRole('ADMIN', 'HR'), validate(exportQuerySchema, 'query'), controller.musterCsv);
attendanceRouter.get('/working-days', requireRole('ADMIN', 'HR'), validate(exportQuerySchema, 'query'), controller.workingDays);
attendanceRouter.post('/auto-mark', requireRole('ADMIN', 'HR'), validate(autoMarkSchema), controller.autoMark);
attendanceRouter.get('/work-modes', requireRole('ADMIN', 'HR'), controller.workModes);
attendanceRouter.put('/work-modes', requireRole('ADMIN', 'HR'), validate(workModeSchema), controller.setWorkMode);
attendanceRouter.get('/calendar', validate(monthlyQuerySchema, 'query'), controller.calendar);
attendanceRouter.get('/', validate(monthlyQuerySchema, 'query'), controller.monthly);
attendanceRouter.get('/company', validate(companyDayQuerySchema, 'query'), controller.companyDay);
