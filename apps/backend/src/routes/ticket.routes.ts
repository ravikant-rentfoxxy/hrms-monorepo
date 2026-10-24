import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/ticket.controller';
import { ticketSchema, ticketScopeQuerySchema, ticketStatusSchema } from '../validations/misc.validation';

export const ticketsRouter = Router();
ticketsRouter.use(authenticate, tenant);

ticketsRouter.get('/', validate(ticketScopeQuerySchema, 'query'), controller.list);
ticketsRouter.post('/', validate(ticketSchema), controller.create);
ticketsRouter.patch('/:id/status', requireRole('ADMIN', 'HR'), validate(ticketStatusSchema), controller.setStatus);
