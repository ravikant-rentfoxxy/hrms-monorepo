import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/exit.controller';
import {
  clearanceItemsSchema, clearanceParamsSchema, clearanceSchema, closeExitSchema, decideExitSchema, exitInterviewSchema,
  handoverCreateSchema, handoverDoneSchema, handoverParamsSchema, handoverUpdateSchema, handoverVerifySchema, initiateExitSchema,
  issueLetterSchema, lastDayChangeSchema, lastDayDecideSchema, listExitsQuerySchema, rehireSchema, resignSchema,
  scheduleInterviewSchema, settlementDueDateSchema, settlementItemsSchema, settlementPaySchema,
} from '../validations/exit.validation';

export const exitsRouter = Router();
exitsRouter.use(authenticate, tenant);

exitsRouter.get('/meta', controller.questions);
exitsRouter.get('/me', controller.mine);
exitsRouter.get('/', validate(listExitsQuerySchema, 'query'), controller.list);
exitsRouter.post('/', validate(resignSchema), controller.resign);
// HR-initiated exits: TERMINATION / RETIREMENT / END_OF_CONTRACT / ABSCONDING (approved immediately).
exitsRouter.post('/initiate', requireRole('ADMIN', 'HR'), validate(initiateExitSchema), controller.initiate);
exitsRouter.get('/:id', controller.detail);
exitsRouter.post('/:id/withdraw', controller.withdraw);
// No requireRole: the approval engine decides who may act (named approvers may be plain employees).
exitsRouter.post('/:id/decide', validate(decideExitSchema), controller.decide);

// Notice period: attendance / leave summary (HR, manager, the employee), early release / extension.
exitsRouter.get('/:id/notice-summary', controller.noticeSummary);
// Employee, reporting manager or HR request; HR's own request applies at once (checked in the service).
exitsRouter.post('/:id/last-day-change', validate(lastDayChangeSchema), controller.requestLastDayChange);
// HR / ADMIN or the reporting manager (checked in the service).
exitsRouter.post('/:id/last-day-change/decide', validate(lastDayDecideSchema), controller.decideLastDayChange);

// Handover: reporting manager / HR plan & verify, the leaver marks done (checked in the service).
exitsRouter.post('/:id/handover', validate(handoverCreateSchema), controller.createHandover);
exitsRouter.patch('/:id/handover/:taskId', validate(handoverParamsSchema, 'params'), validate(handoverUpdateSchema), controller.updateHandover);
exitsRouter.delete('/:id/handover/:taskId', validate(handoverParamsSchema, 'params'), controller.deleteHandover);
exitsRouter.post('/:id/handover/:taskId/done', validate(handoverParamsSchema, 'params'), validate(handoverDoneSchema), controller.completeHandover);
exitsRouter.post('/:id/handover/:taskId/verify', validate(handoverParamsSchema, 'params'), validate(handoverVerifySchema), controller.verifyHandover);

// MANAGER clearance: the employee's manager or ADMIN/HR; other departments: ADMIN/HR (checked in the service).
exitsRouter.post('/:id/clearances/:department', validate(clearanceParamsSchema, 'params'), validate(clearanceSchema), controller.clearance);
exitsRouter.patch('/:id/clearances/:department/items', validate(clearanceParamsSchema, 'params'), validate(clearanceItemsSchema), controller.clearanceItems);

exitsRouter.post('/:id/interview/schedule', requireRole('ADMIN', 'HR'), validate(scheduleInterviewSchema), controller.scheduleInterview);
// The leaver, or HR recording the interview on their behalf.
exitsRouter.post('/:id/interview', validate(exitInterviewSchema), controller.interview);

exitsRouter.post('/:id/settlement/compute', requireRole('ADMIN', 'HR'), controller.computeSettlement);
exitsRouter.put('/:id/settlement', requireRole('ADMIN', 'HR'), validate(settlementItemsSchema), controller.updateSettlement);
exitsRouter.patch('/:id/settlement/due-date', requireRole('ADMIN', 'HR'), validate(settlementDueDateSchema), controller.settlementDueDate);
exitsRouter.post('/:id/settlement/approve', requireRole('ADMIN'), controller.approveSettlement);
exitsRouter.post('/:id/settlement/pay', requireRole('ADMIN', 'HR'), validate(settlementPaySchema), controller.paySettlement);
exitsRouter.get('/:id/settlement/pdf', controller.settlementPdf);

exitsRouter.post('/:id/letters', requireRole('ADMIN', 'HR'), validate(issueLetterSchema), controller.issueLetter);
exitsRouter.post('/:id/close', requireRole('ADMIN', 'HR'), validate(closeExitSchema), controller.close);
exitsRouter.patch('/:id/rehire', requireRole('ADMIN', 'HR'), validate(rehireSchema), controller.rehire);
