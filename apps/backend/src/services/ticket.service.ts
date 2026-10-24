/** Helpdesk tickets. */
import type { TicketStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';
import { employeeIdsWithRoles } from '../utils/people';

export interface TicketInput {
  subject: string;
  category?: string;
  description: string;
}

export async function listTickets(companyId: string, filter: { scope: 'me' | 'company'; employeeId: string | null }) {
  return prisma.ticket.findMany({
    where: { companyId, ...(filter.scope === 'me' ? { employeeId: filter.employeeId ?? '' } : {}) },
    include: { employee: { select: { id: true, name: true } } },
    orderBy: { createdOn: 'desc' },
    take: 200,
  });
}

export async function createTicket(companyId: string, employeeId: string, input: TicketInput) {
  const ticket = await prisma.ticket.create({ data: { ...input, companyId, employeeId } });
  await notify(companyId, await employeeIdsWithRoles(companyId, ['ADMIN', 'HR']), {
    event: 'ticket.created',
    title: `New ${ticket.category} ticket`,
    body: ticket.subject,
    link: '/tickets',
  });
  return ticket;
}

export async function setStatus(companyId: string, ticketId: string, status: TicketStatus) {
  const ticket = await prisma.ticket.findFirst({ where: { id: ticketId, companyId } });
  if (!ticket) throw ApiError.notFound('Ticket not found');
  if (ticket.status === status) return { before: ticket, ticket };
  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: { status, resolvedAt: status === 'RESOLVED' || status === 'CLOSED' ? (ticket.resolvedAt ?? new Date()) : null },
  });
  await notify(companyId, [ticket.employeeId], {
    event: status === 'RESOLVED' ? 'ticket.resolved' : 'ticket.updated',
    title: `Ticket ${status.replace('_', ' ').toLowerCase()}`,
    body: ticket.subject,
    link: '/tickets',
  });
  return { before: ticket, ticket: updated };
}
