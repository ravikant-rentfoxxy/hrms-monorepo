/**
 * Compensatory off: an employee who worked on a weekend / company holiday
 * requests credit for it (approval module COMP_OFF). On approval the days are
 * credited to the company's comp-off leave type and expire after the type's
 * compOffExpiryDays.
 */
import type { Prisma, RequestStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';
import * as approvalService from './approval.service';
import { compOffType, type Actor } from './leave.service';
import {
  addDays, awaitingActor, dateOnly, dayDiff, isoDay, post, sumByRef, todayIST, trailsFor, withLedgerLock,
} from './leave-ledger.service';

export interface CompOffInput {
  workDate: Date;
  days: number;
  reason: string;
}

const isCompanyAdmin = (role: Actor['role']) => role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR';

const include = {
  employee: { select: { id: true, name: true, department: true, employeeCode: true } },
} satisfies Prisma.CompOffRequestInclude;

export async function requestCompOff(companyId: string, employeeId: string, input: CompOffInput) {
  const workDate = dateOnly(input.workDate);
  const today = todayIST();
  if (workDate > today) throw ApiError.badRequest('You can only claim comp-off for a day you have already worked');
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { isActive: true } });
  if (!employee?.isActive) throw ApiError.forbidden('Inactive employees cannot request comp-off');

  const type = await compOffType(companyId);
  if (type.compOffExpiryDays > 0 && dayDiff(today, workDate) > type.compOffExpiryDays) {
    throw ApiError.badRequest(`Comp-off must be claimed within ${type.compOffExpiryDays} days of the day worked`);
  }

  const weekend = workDate.getUTCDay() === 0 || workDate.getUTCDay() === 6;
  const holiday = await prisma.holiday.findFirst({ where: { companyId, date: workDate, optional: false } });
  if (!weekend && !holiday) throw ApiError.badRequest(`${isoDay(workDate)} is a working day — comp-off is only for weekends and holidays`);

  const attendance = await prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date: workDate } } });
  if (!attendance?.checkIn) throw ApiError.badRequest(`No check-in found on ${isoDay(workDate)} — check in on the day you work`);

  const duplicate = await prisma.compOffRequest.findFirst({
    where: { companyId, employeeId, workDate, status: { in: ['PENDING', 'APPROVED'] } },
  });
  if (duplicate) throw ApiError.conflict(`You already have a ${duplicate.status.toLowerCase()} comp-off request for ${isoDay(workDate)}`);

  const request = await prisma.compOffRequest.create({
    data: { companyId, employeeId, workDate, days: input.days, reason: input.reason },
    include,
  });
  try {
    await approvalService.start(companyId, 'COMP_OFF', request.id, employeeId);
  } catch (err) {
    await prisma.compOffRequest.delete({ where: { id: request.id } }).catch(() => undefined);
    throw err;
  }
  return { ...request, holidayName: holiday?.name ?? null, approvalSteps: (await trailsFor(companyId, 'COMP_OFF', [request.id])).get(request.id) ?? [] };
}

export async function listCompOff(
  companyId: string,
  filter: { scope: 'me' | 'team' | 'company' | 'approvals'; status?: RequestStatus; actor: Actor }
) {
  const { actor } = filter;
  let where: Prisma.CompOffRequestWhereInput = { companyId, ...(filter.status ? { status: filter.status } : {}) };
  if (filter.scope === 'me') where.employeeId = actor.employeeId ?? '';
  else if (filter.scope === 'team') where.employee = { managerId: actor.employeeId ?? '' };
  else if (filter.scope === 'approvals') {
    const pending = await prisma.compOffRequest.findMany({
      where: { companyId, status: 'PENDING' },
      select: { id: true, employeeId: true, employee: { select: { managerId: true } } },
    });
    const ids = await awaitingActor(companyId, 'COMP_OFF', actor, pending.map((p) => ({ id: p.id, employeeId: p.employeeId, managerId: p.employee.managerId })));
    where = { companyId, status: 'PENDING', id: { in: [...ids] } };
  }
  const rows = await prisma.compOffRequest.findMany({ where, include, orderBy: { appliedOn: 'desc' }, take: 500 });
  const trails = await trailsFor(companyId, 'COMP_OFF', rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, approvalSteps: trails.get(r.id) ?? [] }));
}

export async function decideCompOff(
  companyId: string,
  id: string,
  input: { decision: 'APPROVED' | 'REJECTED'; remarks?: string; actor: Actor }
) {
  const request = await prisma.compOffRequest.findFirst({ where: { id, companyId }, include });
  if (!request) throw ApiError.notFound('Comp-off request not found');
  if (request.status !== 'PENDING') throw ApiError.badRequest('Request already decided');
  const r = await approvalService.act(companyId, 'COMP_OFF', id, request.employeeId, input.actor, input.decision, input.remarks);
  const day = isoDay(request.workDate);

  if (r.outcome === 'REJECTED') {
    await prisma.compOffRequest.update({
      where: { id }, data: { status: 'REJECTED', remarks: input.remarks ?? null, approverId: input.actor.employeeId },
    });
    await notify(companyId, [request.employeeId], {
      event: 'compoff.rejected', title: 'Comp-off rejected',
      body: `Your comp-off for ${day} was rejected${input.remarks ? `: ${input.remarks}` : '.'}`, link: '/leaves',
    });
  } else if (r.outcome === 'APPROVED') {
    const type = await compOffType(companyId);
    await withLedgerLock(request.employeeId, async (tx) => {
      const res = await tx.compOffRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'APPROVED', remarks: input.remarks ?? null, approverId: input.actor.employeeId },
      });
      if (res.count === 0) throw ApiError.conflict('The request changed meanwhile — refresh and try again');
      if ((await sumByRef(tx, companyId, id, ['COMP_OFF'])) === 0) {
        await post(tx, {
          companyId, employeeId: request.employeeId, leaveTypeId: type.id, date: request.workDate, change: request.days,
          kind: 'COMP_OFF', reason: `Worked on ${day}`, refId: id, createdById: input.actor.employeeId,
          expiresOn: type.compOffExpiryDays > 0 ? addDays(request.workDate, type.compOffExpiryDays) : null,
        });
      }
    });
    await notify(companyId, [request.employeeId], {
      event: 'compoff.approved', title: 'Comp-off credited',
      body: `${request.days} day(s) of ${type.name} credited for ${day}${type.compOffExpiryDays > 0 ? `, valid until ${isoDay(addDays(request.workDate, type.compOffExpiryDays))}` : ''}.`,
      link: '/leaves',
    });
  }
  const updated = await prisma.compOffRequest.findUnique({ where: { id }, include });
  return { ...updated, outcome: r.outcome, approvalSteps: (await trailsFor(companyId, 'COMP_OFF', [id])).get(id) ?? [] };
}

/** Employees withdraw pending requests; ADMIN/HR may also revoke an approved credit. */
export async function cancelCompOff(companyId: string, actor: Actor, id: string) {
  const request = await prisma.compOffRequest.findFirst({ where: { id, companyId } });
  const own = !!request && request.employeeId === actor.employeeId;
  if (!request || (!own && !isCompanyAdmin(actor.role))) throw ApiError.notFound('Comp-off request not found');
  if (request.status === 'APPROVED' && !isCompanyAdmin(actor.role)) {
    throw ApiError.badRequest('Approved comp-off can only be revoked by HR');
  }
  if (request.status !== 'PENDING' && request.status !== 'APPROVED') {
    throw ApiError.badRequest(`Cannot cancel a ${request.status.toLowerCase()} request`);
  }
  const wasApproved = request.status === 'APPROVED';
  await withLedgerLock(request.employeeId, async (tx) => {
    const res = await tx.compOffRequest.updateMany({ where: { id, status: request.status }, data: { status: 'CANCELLED' } });
    if (res.count === 0) throw ApiError.conflict('The request changed meanwhile — refresh and try again');
    if (wasApproved) {
      const credit = await tx.leaveLedger.findFirst({ where: { companyId, refId: id, kind: 'COMP_OFF' } });
      // Remove what is still outstanding of the credit (expired parts are already gone).
      const net = await sumByRef(tx, companyId, id, ['COMP_OFF', 'EXPIRED', 'REVERSAL']);
      if (credit && net > 0) {
        await post(tx, {
          companyId, employeeId: request.employeeId, leaveTypeId: credit.leaveTypeId, date: todayIST(), change: -net,
          kind: 'REVERSAL', reason: `Comp-off for ${isoDay(request.workDate)} revoked`, refId: id, createdById: actor.employeeId,
        });
      }
    }
  });
  await approvalService.cancel(companyId, 'COMP_OFF', id);
  if (!own) {
    await notify(companyId, [request.employeeId], {
      event: 'compoff.cancelled', title: 'Comp-off revoked',
      body: `Your comp-off for ${isoDay(request.workDate)} was cancelled by HR.`, link: '/leaves',
    });
  }
  return prisma.compOffRequest.findUnique({ where: { id }, include });
}
