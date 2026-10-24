/**
 * Travel requests: apply → approval engine (module TRAVEL) → APPROVED /
 * REJECTED, cancel while pending, and settlement against expense claims.
 *
 * Advances are paid outside payroll (by finance); the approved advance is
 * recorded on the request and listed as "advance to be paid" until the trip
 * is settled. Settlement: settledAmount = approved claims − advance
 * (positive → pay the employee, negative → recover from the employee).
 *
 * Claims are linked by the trip window (departDate … returnDate): the
 * schema has no claim → trip foreign key, and overlapping trips are
 * refused, so a claim can belong to at most one trip.
 */
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';
import { employeeIdsWithRoles, isoDay, utcDay } from '../utils/people';
import * as approvalService from './approval.service';
import { dispatchIntegrationEvent } from './integration.service';

export interface TravelInput {
  purpose: string;
  fromCity: string;
  toCity: string;
  departDate: Date;
  returnDate: Date;
  mode: string;
  estimatedCost: number;
  advanceAmount: number;
}

export interface Actor {
  role: Role;
  employeeId: string | null;
}

const OVERRIDE_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'HR'];
const round2 = (n: number) => Math.round(n * 100) / 100;
const employeeSelect = { select: { id: true, name: true, employeeCode: true, department: true, managerId: true } };

async function findRequest(companyId: string, id: string) {
  const request = await prisma.travelRequest.findFirst({ where: { id, companyId }, include: { employee: employeeSelect } });
  if (!request) throw ApiError.notFound('Travel request not found');
  return request;
}

async function assertCanView(companyId: string, request: { id: string; employeeId: string; employee: { managerId: string | null } }, actor: Actor) {
  if (actor.employeeId === request.employeeId || OVERRIDE_ROLES.includes(actor.role)) return;
  if (actor.employeeId && request.employee.managerId === actor.employeeId) return;
  if (actor.employeeId) {
    const named = await prisma.approvalStep.count({
      where: { companyId, module: 'TRAVEL', requestId: request.id, approverEmployeeId: actor.employeeId },
    });
    if (named > 0) return;
  }
  throw ApiError.forbidden('You cannot view this travel request');
}

// ---- Read ----

export interface ListFilter {
  scope: 'me' | 'team' | 'approvals' | 'company';
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  advancesDue: boolean;
}

export async function listRequests(companyId: string, actor: Actor, filter: ListFilter) {
  let where: object;
  if (filter.scope === 'me') where = { employeeId: actor.employeeId ?? '' };
  else if (filter.scope === 'team') where = { employee: { managerId: actor.employeeId ?? '' } };
  else if (filter.scope === 'approvals') {
    const steps = await approvalService.pendingFor(companyId, actor, 'TRAVEL');
    where = { id: { in: steps.map((s) => s.requestId) }, status: 'PENDING' };
  } else where = {};
  const due = filter.advancesDue ? { status: 'APPROVED' as const, advanceAmount: { gt: 0 }, settledOn: null } : {};
  const requests = await prisma.travelRequest.findMany({
    where: { companyId, ...where, ...(filter.status ? { status: filter.status } : {}), ...due },
    include: { employee: { select: { id: true, name: true, employeeCode: true, department: true } } },
    orderBy: { appliedOn: 'desc' },
    take: 300,
  });
  return requests.map((r) => ({
    ...r,
    advanceToBePaid: r.status === 'APPROVED' && r.advanceAmount > 0 && !r.settledOn ? r.advanceAmount : 0,
  }));
}

export async function getRequest(companyId: string, id: string, actor: Actor) {
  const request = await findRequest(companyId, id);
  await assertCanView(companyId, request, actor);
  return { ...request, trail: await approvalService.trail(companyId, 'TRAVEL', request.id) };
}

// ---- Lifecycle ----

export async function applyTravel(companyId: string, employeeId: string, input: TravelInput) {
  const departDate = utcDay(input.departDate);
  const returnDate = utcDay(input.returnDate);
  if (returnDate < departDate) throw ApiError.badRequest('Return date must be on or after the departure date');
  if (input.advanceAmount > input.estimatedCost) throw ApiError.badRequest('Advance cannot exceed the estimated cost');

  const overlap = await prisma.travelRequest.findFirst({
    where: {
      companyId,
      employeeId,
      status: { in: ['PENDING', 'APPROVED'] },
      departDate: { lte: returnDate },
      returnDate: { gte: departDate },
    },
  });
  if (overlap) {
    throw ApiError.conflict(
      `You already have a ${overlap.status.toLowerCase()} trip ${overlap.fromCity} → ${overlap.toCity} (${isoDay(overlap.departDate)} – ${isoDay(overlap.returnDate)})`
    );
  }

  const request = await prisma.travelRequest.create({
    data: { ...input, departDate, returnDate, companyId, employeeId, status: 'PENDING' },
  });
  await approvalService.start(companyId, 'TRAVEL', request.id, employeeId);
  return request;
}

export async function cancelRequest(companyId: string, employeeId: string, id: string) {
  const request = await prisma.travelRequest.findFirst({ where: { id, companyId, employeeId } });
  if (!request) throw ApiError.notFound('Travel request not found');
  if (request.status !== 'PENDING') throw ApiError.badRequest(`Cannot cancel a ${request.status.toLowerCase()} request`);
  await approvalService.cancel(companyId, 'TRAVEL', request.id);
  return prisma.travelRequest.update({ where: { id: request.id }, data: { status: 'CANCELLED' } });
}

export async function decideRequest(
  companyId: string,
  id: string,
  input: { decision: 'APPROVED' | 'REJECTED'; remarks?: string; actor: Actor }
) {
  const request = await prisma.travelRequest.findFirst({ where: { id, companyId } });
  if (!request) throw ApiError.notFound('Travel request not found');
  if (request.status !== 'PENDING') throw ApiError.badRequest(`Request is already ${request.status.toLowerCase()}`);

  const r = await approvalService.act(
    companyId,
    'TRAVEL',
    request.id,
    request.employeeId,
    { role: input.actor.role, employeeId: input.actor.employeeId },
    input.decision,
    input.remarks
  );
  if (r.outcome === 'PENDING') return { outcome: r.outcome, request };

  const updated = await prisma.travelRequest.update({
    where: { id: request.id },
    data: { status: r.outcome, approverId: input.actor.employeeId, remarks: input.remarks ?? null },
  });
  const trip = `${request.fromCity} → ${request.toCity} (${isoDay(request.departDate)})`;
  await notify(companyId, [request.employeeId], {
    event: r.outcome === 'APPROVED' ? 'travel.approved' : 'travel.rejected',
    title: `Travel request ${r.outcome === 'APPROVED' ? 'approved' : 'rejected'}`,
    body: `${trip}${input.remarks ? ` — ${input.remarks}` : ''}`,
    link: '/travel',
  });
  if (r.outcome === 'APPROVED' && request.advanceAmount > 0) {
    // Finance pays the advance outside payroll.
    await notify(companyId, await employeeIdsWithRoles(companyId, ['ADMIN', 'HR']), {
      event: 'travel.advance_due',
      title: 'Travel advance to be paid',
      body: `Advance of ₹${request.advanceAmount} approved for ${trip}.`,
      link: '/travel',
    });
  }
  if (r.outcome === 'APPROVED') {
    await dispatchIntegrationEvent(companyId, 'travel.approved', {
      title: `Travel approved: ${trip}`,
      body: request.purpose,
      employeeId: request.employeeId,
      departDate: isoDay(request.departDate),
      returnDate: isoDay(request.returnDate),
    });
  }
  return { outcome: r.outcome, request: updated };
}

// ---- Settlement ----

/** Approved / pending claims of the employee dated inside the trip window, with the computed settlement. */
export async function settlementPreview(companyId: string, id: string) {
  const request = await findRequest(companyId, id);
  const claims = await prisma.expenseClaim.findMany({
    where: {
      companyId,
      employeeId: request.employeeId,
      date: { gte: request.departDate, lte: request.returnDate },
      status: { in: ['APPROVED', 'PENDING'] },
    },
    orderBy: { date: 'asc' },
  });
  const approved = claims.filter((c) => c.status === 'APPROVED');
  const claimsTotal = round2(approved.reduce((s, c) => s + c.amount, 0));
  return {
    request,
    claims: approved,
    pendingClaims: claims.filter((c) => c.status === 'PENDING'),
    claimsTotal,
    advance: request.advanceAmount,
    settledAmount: round2(claimsTotal - request.advanceAmount),
  };
}

export async function settle(companyId: string, id: string, claimIds?: string[]) {
  const preview = await settlementPreview(companyId, id);
  const { request } = preview;
  if (request.status !== 'APPROVED') throw ApiError.badRequest('Only an approved trip can be settled');
  if (request.settledOn) throw ApiError.conflict(`Trip already settled on ${isoDay(request.settledOn)}`);
  if (utcDay(new Date()) < request.departDate) throw ApiError.badRequest('The trip has not started yet');

  let claims = preview.claims;
  if (claimIds) {
    const unknown = claimIds.filter((cid) => !preview.claims.some((c) => c.id === cid));
    if (unknown.length > 0) {
      throw ApiError.badRequest('Only approved claims of this employee dated within the trip can be settled', { claimIds: unknown });
    }
    claims = preview.claims.filter((c) => claimIds.includes(c.id));
  }
  const claimsTotal = round2(claims.reduce((s, c) => s + c.amount, 0));
  const settledAmount = round2(claimsTotal - request.advanceAmount);

  const updated = await prisma.travelRequest.update({
    where: { id: request.id },
    data: { settledAmount, settledOn: new Date() },
  });
  await notify(companyId, [request.employeeId], {
    event: 'travel.settled',
    title: 'Travel settled',
    body:
      settledAmount > 0
        ? `₹${settledAmount} will be paid to you (claims ₹${claimsTotal} − advance ₹${request.advanceAmount}).`
        : settledAmount < 0
          ? `₹${-settledAmount} of the advance is to be recovered (claims ₹${claimsTotal} − advance ₹${request.advanceAmount}).`
          : 'Claims match the advance — nothing to pay or recover.',
    link: '/travel',
  });
  return {
    request: updated,
    claimIds: claims.map((c) => c.id),
    claimsTotal,
    advance: request.advanceAmount,
    settledAmount,
    direction: settledAmount > 0 ? 'PAY_EMPLOYEE' : settledAmount < 0 ? 'RECOVER' : 'NIL',
  };
}
