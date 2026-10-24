import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/leave.controller';
import {
  adjustSchema, applyLeaveSchema, balanceQuerySchema, calendarQuerySchema, compOffSchema, decideSchema, encashmentSchema,
  leaveTypeSchema, leaveTypeUpdateSchema, ledgerQuerySchema, listLeavesQuerySchema, listRequestsQuerySchema,
  listTypesQuerySchema, openingSchema, previewLeaveSchema,
} from '../validations/leave.validation';

export const leavesRouter = Router();
leavesRouter.use(authenticate, tenant);

// Types / policy
leavesRouter.get('/types', validate(listTypesQuerySchema, 'query'), controller.listTypes);
leavesRouter.post('/types', requireRole('ADMIN', 'HR'), validate(leaveTypeSchema), controller.createType);
leavesRouter.patch('/types/:id', requireRole('ADMIN', 'HR'), validate(leaveTypeUpdateSchema), controller.updateType);

// Balances & ledger
leavesRouter.get('/balance', validate(balanceQuerySchema, 'query'), controller.balance);
leavesRouter.get('/ledger', validate(ledgerQuerySchema, 'query'), controller.ledger);
leavesRouter.get('/employees', controller.employees);
leavesRouter.post('/ledger/adjust', requireRole('ADMIN', 'HR'), validate(adjustSchema), controller.adjust);
leavesRouter.post('/ledger/opening', requireRole('ADMIN', 'HR'), validate(openingSchema), controller.opening);
leavesRouter.get('/liability', requireRole('ADMIN', 'HR'), controller.liability);
leavesRouter.get('/calendar', validate(calendarQuerySchema, 'query'), controller.calendar);

// Comp-off (decide is guarded by the approval engine)
leavesRouter.get('/comp-off', validate(listRequestsQuerySchema, 'query'), controller.listCompOff);
leavesRouter.post('/comp-off', validate(compOffSchema), controller.requestCompOff);
leavesRouter.post('/comp-off/:id/decide', validate(decideSchema), controller.decideCompOff);
leavesRouter.post('/comp-off/:id/cancel', controller.cancelCompOff);

// Encashment
leavesRouter.get('/encashments', validate(listRequestsQuerySchema, 'query'), controller.listEncashments);
leavesRouter.post('/encashments', validate(encashmentSchema), controller.requestEncashment);
leavesRouter.post('/encashments/:id/decide', validate(decideSchema), controller.decideEncashment);
leavesRouter.post('/encashments/:id/cancel', controller.cancelEncashment);

// Leave requests
leavesRouter.get('/', validate(listLeavesQuerySchema, 'query'), controller.list);
leavesRouter.post('/', validate(applyLeaveSchema), controller.apply);
leavesRouter.post('/preview', validate(previewLeaveSchema), controller.preview);
leavesRouter.get('/:id', controller.get);
leavesRouter.post('/:id/cancel', controller.cancel);
leavesRouter.post('/:id/decide', validate(decideSchema), controller.decide);
