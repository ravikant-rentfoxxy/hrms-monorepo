import type { TicketStatus } from '@prisma/client';
import { ApiError, h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow, isManagerial } from '../middleware/auth';
import { audit } from '../lib/audit';
import * as ticketService from '../services/ticket.service';
import type { TicketInput } from '../services/ticket.service';

export const list = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { scope } = req.query as unknown as { scope: 'me' | 'company' };
  if (scope === 'company' && !isManagerial(auth.role)) throw ApiError.forbidden();
  ok(res, await ticketService.listTickets(tenantId, { scope, employeeId: auth.employeeId }));
});

export const create = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await ticketService.createTicket(tenantId, employeeIdOrThrow(req), req.body as TicketInput), 201);
});

export const setStatus = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { status } = req.body as { status: TicketStatus };
  const { before, ticket } = await ticketService.setStatus(tenantId, req.params.id as string, status);
  await audit(req, { entity: 'Ticket', entityId: ticket.id, action: 'UPDATE', before: { status: before.status }, after: { status: ticket.status } });
  ok(res, ticket);
});
