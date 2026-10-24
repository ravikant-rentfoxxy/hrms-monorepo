/**
 * Overtime requests. Raised by the employee, or by the system at check-out
 * when the day's overtime reaches AUTO_OVERTIME_MINUTES. Goes through the
 * OVERTIME approval chain; on final approval a PayrollInput (type OVERTIME)
 * is created for the month of the overtime date:
 *   hourly rate = (basic + special allowance) ÷ 26 ÷ 8
 *   amount      = round(hourly rate × hours × 2)          (double rate)
 */
import { Prisma, type RequestStatus, type Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';
import { fmtMinutes, isoDate } from '../utils/tz';
import * as approvalService from './approval.service';

/** Overtime at check-out at or above this raises a request automatically. */
export const AUTO_OVERTIME_MINUTES = 30;
const MAX_OVERTIME_MINUTES = 16 * 60;

export interface OvertimeInput {
  date: Date;
  minutes: number;
  reason?: string;
}

interface Actor {
  role: Role;
  employeeId: string | null;
  userId?: string;
}

const employeeSelect = { id: true, name: true, employeeCode: true, department: true, managerId: true } as const;

function today(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
}

/**
 * Creates (or re-opens a cancelled) request and starts its approval chain.
 * One request per employee per date.
 */
export async function createRequest(companyId: string, employeeId: string, input: OvertimeInput, opts: { system?: boolean } = {}) {
  const date = input.date;
  if (date.getTime() > today().getTime()) throw ApiError.badRequest('Overtime can only be claimed for today or a past date');
  if (input.minutes < 1 || input.minutes > MAX_OVERTIME_MINUTES) {
    throw ApiError.badRequest(`Overtime must be between 1 and ${MAX_OVERTIME_MINUTES} minutes`);
  }
  const reason = (input.reason ?? '').trim() || (opts.system ? 'Auto-raised from check-out' : '');

  const existing = await prisma.overtimeRequest.findUnique({ where: { employeeId_date: { employeeId, date } } });
  let request;
  if (existing) {
    if (existing.companyId !== companyId) throw ApiError.conflict('Overtime already recorded for this date');
    if (existing.status !== 'CANCELLED') {
      throw ApiError.conflict(`An overtime request for ${isoDate(date)} already exists (${existing.status.toLowerCase()})`);
    }
    request = await prisma.overtimeRequest.update({
      where: { id: existing.id },
      data: { minutes: input.minutes, reason, status: 'PENDING', approverId: null, remarks: null, appliedOn: new Date(), paidInMonth: null },
    });
  } else {
    try {
      request = await prisma.overtimeRequest.create({
        data: { companyId, employeeId, date, minutes: input.minutes, reason },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw ApiError.conflict(`An overtime request for ${isoDate(date)} already exists`);
      }
      throw err;
    }
  }
  try {
    await approvalService.start(companyId, 'OVERTIME', request.id, employeeId);
  } catch (err) {
    // No approver could be resolved: don't leave an orphan pending request.
    if (!existing) await prisma.overtimeRequest.delete({ where: { id: request.id } });
    else await prisma.overtimeRequest.update({ where: { id: request.id }, data: { status: 'CANCELLED' } });
    throw err;
  }
  if (opts.system) {
    await notify(companyId, [employeeId], {
      event: 'overtime.raised',
      title: 'Overtime request raised',
      body: `${fmtMinutes(input.minutes)} of overtime on ${isoDate(date)} was sent for approval.`,
      link: '/overtime',
    });
  }
  return request;
}

/** Called from check-out: raises a request unless one already exists for the date. Never throws. */
export async function raiseFromAttendance(companyId: string, employeeId: string, date: Date, minutes: number) {
  if (minutes < AUTO_OVERTIME_MINUTES) return null;
  try {
    const existing = await prisma.overtimeRequest.findUnique({ where: { employeeId_date: { employeeId, date } } });
    if (existing) return null;
    return await createRequest(companyId, employeeId, { date, minutes }, { system: true });
  } catch {
    return null;
  }
}

export async function listRequests(
  companyId: string,
  filter: { scope: 'me' | 'team' | 'company'; status?: RequestStatus; employeeId: string | null; from?: Date; to?: Date }
) {
  const who =
    filter.scope === 'me'
      ? { employeeId: filter.employeeId ?? '' }
      : filter.scope === 'team'
        ? { employee: { managerId: filter.employeeId ?? '' } }
        : {};
  const requests = await prisma.overtimeRequest.findMany({
    where: {
      companyId,
      ...who,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.from || filter.to ? { date: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } } : {}),
    },
    include: { employee: { select: employeeSelect } },
    orderBy: [{ appliedOn: 'desc' }],
    take: 300,
  });
  // Attendance context for approvers (worked / overtime measured at check-out).
  const records = await prisma.attendanceRecord.findMany({
    where: { companyId, OR: requests.map((r) => ({ employeeId: r.employeeId, date: r.date })) },
    select: { employeeId: true, date: true, workedMinutes: true, overtimeMinutes: true, checkIn: true, checkOut: true, status: true },
  });
  const key = (employeeId: string, d: Date) => `${employeeId}|${isoDate(d)}`;
  const byKey = new Map(records.map((r) => [key(r.employeeId, r.date), r]));
  const pending = requests.filter((r) => r.status === 'PENDING');
  const steps = pending.length
    ? await prisma.approvalStep.findMany({
        where: { companyId, module: 'OVERTIME', requestId: { in: pending.map((r) => r.id) }, status: 'PENDING' },
        orderBy: { level: 'asc' },
      })
    : [];
  return requests.map((r) => {
    const step = steps.find((s) => s.requestId === r.id);
    return {
      ...r,
      attendance: byKey.get(key(r.employeeId, r.date)) ?? null,
      currentLevel: step?.level ?? null,
      pendingWith: step ? (step.approverRole ?? step.approverEmployeeId) : null,
    };
  });
}

export async function getRequest(companyId: string, id: string, actor: Actor) {
  const request = await prisma.overtimeRequest.findFirst({ where: { id, companyId }, include: { employee: { select: employeeSelect } } });
  if (!request) throw ApiError.notFound('Overtime request not found');
  const isOwner = actor.employeeId === request.employeeId;
  const isAdmin = actor.role === 'SUPER_ADMIN' || actor.role === 'ADMIN' || actor.role === 'HR';
  const isManager = !!actor.employeeId && request.employee.managerId === actor.employeeId;
  const trail = await approvalService.trail(companyId, 'OVERTIME', id);
  const isApprover = trail.some((s) => s.approverEmployeeId === actor.employeeId);
  if (!isOwner && !isAdmin && !isManager && !isApprover) throw ApiError.forbidden();
  const payrollInput = await prisma.payrollInput.findFirst({ where: { companyId, refId: id, type: 'OVERTIME' } });
  return { ...request, trail, payrollInput };
}

export async function cancelRequest(companyId: string, employeeId: string, id: string) {
  const request = await prisma.overtimeRequest.findFirst({ where: { id, companyId, employeeId } });
  if (!request) throw ApiError.notFound('Overtime request not found');
  if (request.status !== 'PENDING') throw ApiError.badRequest('Only pending requests can be cancelled');
  await approvalService.cancel(companyId, 'OVERTIME', id);
  return prisma.overtimeRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
}

/** Hourly overtime base: (basic + special allowance) ÷ 26 days ÷ 8 hours. */
export const hourlyRate = (e: { salaryBasic: number; salaryAllowance: number }): number =>
  (e.salaryBasic + e.salaryAllowance) / 26 / 8;

/**
 * Records a decision through the approval engine (which decides who may act).
 * Final approval creates the OVERTIME payroll input (idempotent per request).
 */
export async function decideRequest(
  companyId: string,
  id: string,
  input: { decision: 'APPROVED' | 'REJECTED'; remarks?: string; actor: Actor }
) {
  const { decision, remarks, actor } = input;
  const request = await prisma.overtimeRequest.findFirst({ where: { id, companyId } });
  if (!request) throw ApiError.notFound('Overtime request not found');
  if (request.status !== 'PENDING') throw ApiError.badRequest('Request already decided');

  const result = await approvalService.act(companyId, 'OVERTIME', id, request.employeeId, actor, decision, remarks);
  if (result.outcome === 'PENDING') {
    return { request, outcome: result.outcome, payrollInput: null };
  }
  if (result.outcome === 'REJECTED') {
    const updated = await prisma.overtimeRequest.update({
      where: { id },
      data: { status: 'REJECTED', approverId: actor.employeeId, remarks: remarks ?? null },
    });
    await notify(companyId, [request.employeeId], {
      event: 'overtime.rejected',
      title: 'Overtime request rejected',
      body: `Your overtime for ${isoDate(request.date)} was rejected${remarks ? `: ${remarks}` : '.'}`,
      link: '/overtime',
    });
    return { request: updated, outcome: result.outcome, payrollInput: null };
  }

  // APPROVED → payroll input for the overtime month (next month if that payroll is already out).
  const employee = await prisma.employee.findFirstOrThrow({
    where: { id: request.employeeId, companyId },
    select: { salaryBasic: true, salaryAllowance: true },
  });
  let month = new Date(Date.UTC(request.date.getUTCFullYear(), request.date.getUTCMonth(), 1));
  const paid = await prisma.payslip.findFirst({ where: { companyId, employeeId: request.employeeId, month } });
  if (paid) month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
  const hours = request.minutes / 60;
  const rate = hourlyRate(employee);
  const amount = Math.round(rate * hours * 2);
  const label = `Overtime (${Math.floor(request.minutes / 60)}h ${request.minutes % 60}m)`;

  const { updated, payrollInput } = await prisma.$transaction(async (tx) => {
    const updated = await tx.overtimeRequest.update({
      where: { id },
      data: { status: 'APPROVED', approverId: actor.employeeId, remarks: remarks ?? null, paidInMonth: amount > 0 ? month : null },
    });
    let payrollInput = await tx.payrollInput.findFirst({ where: { companyId, refId: id, type: 'OVERTIME' } });
    if (!payrollInput && amount > 0) {
      payrollInput = await tx.payrollInput.create({
        data: {
          companyId,
          employeeId: request.employeeId,
          month,
          type: 'OVERTIME',
          label,
          amount,
          taxable: true,
          refId: id,
          note: `${isoDate(request.date)} · ${hours.toFixed(2)} h × ₹${rate.toFixed(2)}/h × 2${paid ? ' (carried to next payroll)' : ''}`,
          createdById: actor.userId ?? null,
        },
      });
    }
    return { updated, payrollInput };
  });
  await notify(companyId, [request.employeeId], {
    event: 'overtime.approved',
    title: 'Overtime approved',
    body:
      amount > 0
        ? `${label} on ${isoDate(request.date)} approved — ₹${amount} will be paid with ${month.toISOString().slice(0, 7)} payroll.`
        : `${label} on ${isoDate(request.date)} approved.`,
    link: '/overtime',
  });
  return { request: updated, outcome: result.outcome, payrollInput };
}

export async function trail(companyId: string, id: string) {
  return approvalService.trail(companyId, 'OVERTIME', id);
}
