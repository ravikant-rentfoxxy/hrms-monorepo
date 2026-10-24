/**
 * Leave encashment: an employee converts unused balance of an encashable type
 * into pay (approval module ENCASHMENT). On approval the amount
 * (basic ÷ 26 × days) is debited from the ledger and queued for payroll as a
 * LEAVE_ENCASHMENT PayrollInput.
 */
import type { Prisma, RequestStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';
import * as approvalService from './approval.service';
import type { Actor } from './leave.service';
import {
  awaitingActor, computeBalances, ensureYearCreditsTx, post, round2, sumByRef, todayIST, trailsFor, utcDate, withLedgerLock, yearRange,
} from './leave-ledger.service';

const isCompanyAdmin = (role: Actor['role']) => role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR';

const include = {
  employee: { select: { id: true, name: true, department: true, employeeCode: true } },
  leaveType: { select: { id: true, code: true, name: true, color: true } },
} satisfies Prisma.LeaveEncashmentInclude;

/** Amount for `days` of encashment at the employee's basic. */
export const encashmentAmount = (salaryBasic: number, days: number) => round2((salaryBasic / 26) * days);

/** Throws when `days` can't be encashed now (policy cap for the year, balance). */
async function assertEncashable(
  tx: Prisma.TransactionClient,
  companyId: string,
  employeeId: string,
  leaveTypeId: string,
  days: number,
  excludeId?: string
) {
  const type = await tx.leaveType.findFirst({ where: { id: leaveTypeId, companyId, isActive: true } });
  if (!type) throw ApiError.badRequest('Invalid leave type');
  if (!type.encashable) throw ApiError.badRequest(`${type.name} is not encashable`);
  const year = todayIST().getUTCFullYear();
  if (type.maxEncashDays > 0) {
    const agg = await tx.leaveEncashment.aggregate({
      where: {
        companyId, employeeId, leaveTypeId, status: { in: ['PENDING', 'APPROVED'] }, appliedOn: yearRange(year),
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      _sum: { days: true },
    });
    const used = agg._sum.days ?? 0;
    if (used + days > type.maxEncashDays) {
      throw ApiError.badRequest(
        `${type.name} allows encashing at most ${type.maxEncashDays} day(s) a year (${round2(Math.max(0, type.maxEncashDays - used))} left)`
      );
    }
  }
  await ensureYearCreditsTx(tx, companyId, employeeId, year);
  const [row] = await computeBalances(tx, companyId, employeeId, year, type.id);
  // `available` excludes pending encashments — add this one back when re-checking it.
  const available = round2((row?.available ?? 0) + (excludeId ? days : 0));
  if (days > available) throw ApiError.badRequest(`Insufficient balance: ${available} day(s) of ${type.code} available to encash`);
  return type;
}

export async function requestEncashment(companyId: string, employeeId: string, input: { leaveTypeId: string; days: number; reason?: string }) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { isActive: true, salaryBasic: true } });
  if (!employee?.isActive) throw ApiError.forbidden('Inactive employees cannot request encashment');
  const request = await withLedgerLock(employeeId, async (tx) => {
    await assertEncashable(tx, companyId, employeeId, input.leaveTypeId, input.days);
    return tx.leaveEncashment.create({
      data: {
        companyId, employeeId, leaveTypeId: input.leaveTypeId, days: input.days,
        amount: encashmentAmount(employee.salaryBasic, input.days), remarks: input.reason ?? null,
      },
      include,
    });
  });
  try {
    await approvalService.start(companyId, 'ENCASHMENT', request.id, employeeId);
  } catch (err) {
    await prisma.leaveEncashment.delete({ where: { id: request.id } }).catch(() => undefined);
    throw err;
  }
  return { ...request, approvalSteps: (await trailsFor(companyId, 'ENCASHMENT', [request.id])).get(request.id) ?? [] };
}

export async function listEncashments(
  companyId: string,
  filter: { scope: 'me' | 'team' | 'company' | 'approvals'; status?: RequestStatus; actor: Actor }
) {
  const { actor } = filter;
  let where: Prisma.LeaveEncashmentWhereInput = { companyId, ...(filter.status ? { status: filter.status } : {}) };
  if (filter.scope === 'me') where.employeeId = actor.employeeId ?? '';
  else if (filter.scope === 'team') where.employee = { managerId: actor.employeeId ?? '' };
  else if (filter.scope === 'approvals') {
    const pending = await prisma.leaveEncashment.findMany({
      where: { companyId, status: 'PENDING' },
      select: { id: true, employeeId: true, employee: { select: { managerId: true } } },
    });
    const ids = await awaitingActor(companyId, 'ENCASHMENT', actor, pending.map((p) => ({ id: p.id, employeeId: p.employeeId, managerId: p.employee.managerId })));
    where = { companyId, status: 'PENDING', id: { in: [...ids] } };
  }
  const rows = await prisma.leaveEncashment.findMany({ where, include, orderBy: { appliedOn: 'desc' }, take: 500 });
  const trails = await trailsFor(companyId, 'ENCASHMENT', rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, approvalSteps: trails.get(r.id) ?? [] }));
}

export async function decideEncashment(
  companyId: string,
  id: string,
  input: { decision: 'APPROVED' | 'REJECTED'; remarks?: string; actor: Actor }
) {
  const request = await prisma.leaveEncashment.findFirst({
    where: { id, companyId },
    include: { ...include, employee: { select: { id: true, name: true, department: true, employeeCode: true, salaryBasic: true } } },
  });
  if (!request) throw ApiError.notFound('Encashment request not found');
  if (request.status !== 'PENDING') throw ApiError.badRequest('Request already decided');
  if (input.decision === 'APPROVED') {
    if (request.employee.salaryBasic <= 0) throw ApiError.badRequest(`${request.employee.name} has no basic salary set — cannot compute the amount`);
    await withLedgerLock(request.employeeId, (tx) =>
      assertEncashable(tx, companyId, request.employeeId, request.leaveTypeId, request.days, request.id)
    );
  }

  const r = await approvalService.act(companyId, 'ENCASHMENT', id, request.employeeId, input.actor, input.decision, input.remarks);

  if (r.outcome === 'REJECTED') {
    await prisma.leaveEncashment.update({
      where: { id }, data: { status: 'REJECTED', remarks: input.remarks ?? request.remarks, approverId: input.actor.employeeId },
    });
    await notify(companyId, [request.employeeId], {
      event: 'encashment.rejected', title: 'Leave encashment rejected',
      body: `Your request to encash ${request.days} day(s) of ${request.leaveType.code} was rejected${input.remarks ? `: ${input.remarks}` : '.'}`,
      link: '/leaves',
    });
  } else if (r.outcome === 'APPROVED') {
    const today = todayIST();
    const month = utcDate(today.getUTCFullYear(), today.getUTCMonth(), 1);
    const amount = encashmentAmount(request.employee.salaryBasic, request.days);
    await withLedgerLock(request.employeeId, async (tx) => {
      const res = await tx.leaveEncashment.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'APPROVED', amount, paidInMonth: month, approverId: input.actor.employeeId, remarks: input.remarks ?? request.remarks },
      });
      if (res.count === 0) throw ApiError.conflict('The request changed meanwhile — refresh and try again');
      if ((await sumByRef(tx, companyId, id, ['ENCASHED'])) === 0) {
        await post(tx, {
          companyId, employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, date: today, change: -request.days,
          kind: 'ENCASHED', reason: `Encashed ${request.days} day(s)`, refId: id, createdById: input.actor.employeeId,
        });
      }
      const existing = await tx.payrollInput.findFirst({ where: { companyId, refId: id, type: 'LEAVE_ENCASHMENT' } });
      if (!existing) {
        await tx.payrollInput.create({
          data: {
            companyId, employeeId: request.employeeId, month, type: 'LEAVE_ENCASHMENT',
            label: `Leave encashment (${request.days} day(s) ${request.leaveType.code})`, amount, taxable: true, refId: id,
            createdById: input.actor.employeeId,
          },
        });
      }
    });
    await notify(companyId, [request.employeeId], {
      event: 'encashment.approved', title: 'Leave encashment approved',
      body: `${request.days} day(s) of ${request.leaveType.code} will be paid with this month's payroll.`, link: '/leaves',
    });
  }
  const updated = await prisma.leaveEncashment.findUnique({ where: { id }, include });
  return { ...updated, outcome: r.outcome, approvalSteps: (await trailsFor(companyId, 'ENCASHMENT', [id])).get(id) ?? [] };
}

/** Employees withdraw pending requests; ADMIN/HR may cancel an approved one until payroll has paid it. */
export async function cancelEncashment(companyId: string, actor: Actor, id: string) {
  const request = await prisma.leaveEncashment.findFirst({ where: { id, companyId } });
  const own = !!request && request.employeeId === actor.employeeId;
  if (!request || (!own && !isCompanyAdmin(actor.role))) throw ApiError.notFound('Encashment request not found');
  if (request.status === 'APPROVED' && !isCompanyAdmin(actor.role)) throw ApiError.badRequest('Approved encashment can only be cancelled by HR');
  if (request.status !== 'PENDING' && request.status !== 'APPROVED') {
    throw ApiError.badRequest(`Cannot cancel a ${request.status.toLowerCase()} request`);
  }
  const wasApproved = request.status === 'APPROVED';
  await withLedgerLock(request.employeeId, async (tx) => {
    if (wasApproved) {
      const input = await tx.payrollInput.findFirst({ where: { companyId, refId: id, type: 'LEAVE_ENCASHMENT' } });
      if (input?.payslipId) throw ApiError.badRequest('Already paid in a payslip — it can no longer be cancelled');
      if (input) await tx.payrollInput.delete({ where: { id: input.id } });
      const net = await sumByRef(tx, companyId, id, ['ENCASHED', 'REVERSAL']);
      if (net < 0) {
        await post(tx, {
          companyId, employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, date: todayIST(), change: -net,
          kind: 'REVERSAL', reason: 'Encashment cancelled', refId: id, createdById: actor.employeeId,
        });
      }
    }
    const res = await tx.leaveEncashment.updateMany({
      where: { id, status: request.status },
      data: { status: 'CANCELLED', paidInMonth: null },
    });
    if (res.count === 0) throw ApiError.conflict('The request changed meanwhile — refresh and try again');
  });
  await approvalService.cancel(companyId, 'ENCASHMENT', id);
  if (!own) {
    await notify(companyId, [request.employeeId], {
      event: 'encashment.cancelled', title: 'Leave encashment cancelled',
      body: `HR cancelled your encashment of ${request.days} day(s).`, link: '/leaves',
    });
  }
  return prisma.leaveEncashment.findUnique({ where: { id }, include });
}
