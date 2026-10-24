/**
 * Leave business logic: types (policy), balances, requests, approvals and the
 * team calendar. Balances live in the ledger (see leave-ledger.service.ts).
 */
import type { LeaveType, Prisma, RequestStatus, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { logger } from '../lib/logger';
import { ApiError } from '../utils/http';
import * as approvalService from './approval.service';
import {
  addDays, awaitingActor, balanceFloor, computeBalances, dateOnly, dayDiff, ensureYearCreditsTx, expireCompOffTx, isoDay,
  post, round2, sumByRef, todayIST, trailsFor, utcDate, withLedgerLock, yearRange,
} from './leave-ledger.service';

export { balances, leaveLiability, ensureYearCredits } from './leave-ledger.service';

export interface LeaveTypeInput {
  code: string;
  name: string;
  totalPerYear: number;
  color?: string;
  isActive?: boolean;
  accrualType?: 'YEARLY' | 'MONTHLY' | 'NONE';
  accrualRate?: number;
  carryForwardMax?: number;
  encashable?: boolean;
  maxEncashDays?: number;
  maxConsecutive?: number;
  minNoticeDays?: number;
  allowNegative?: boolean;
  maxNegative?: number;
  applicableAfterDays?: number;
  gender?: '' | 'MALE' | 'FEMALE';
  sandwichRule?: boolean;
  allowHalfDay?: boolean;
  isCompOff?: boolean;
  compOffExpiryDays?: number;
  isPaid?: boolean;
}

export interface ApplyLeaveInput {
  leaveTypeId: string;
  fromDate: Date;
  toDate: Date;
  halfDay: boolean;
  reason: string;
}

export interface Actor {
  role: Role;
  employeeId: string | null;
}

const isCompanyAdmin = (role: Role) => role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR';

// ---- Types ----

export async function listTypes(companyId: string, includeInactive = false) {
  return prisma.leaveType.findMany({
    where: { companyId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: { code: 'asc' },
  });
}

/** Normalises policy combinations so the engine never sees contradictory settings. */
function normalisePolicy(data: Partial<LeaveTypeInput>, current?: LeaveType): Partial<LeaveTypeInput> {
  const merged = { ...current, ...data };
  const out = { ...data };
  if (merged.accrualType === 'MONTHLY' && !(merged.accrualRate && merged.accrualRate > 0)) {
    out.accrualRate = round2((merged.totalPerYear ?? 0) / 12);
  }
  if (merged.isCompOff) {
    out.accrualType = 'NONE';
    if (data.encashable === undefined && current === undefined) out.encashable = false;
  }
  if (merged.allowNegative === false && data.allowNegative === false) out.maxNegative = 0;
  if (merged.encashable === false && data.encashable === false) out.maxEncashDays = 0;
  return out;
}

async function assertSingleCompOff(companyId: string, exceptId?: string) {
  const other = await prisma.leaveType.findFirst({
    where: { companyId, isCompOff: true, isActive: true, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (other) throw ApiError.conflict(`${other.name} (${other.code}) is already the comp-off type`);
}

export async function createType(companyId: string, input: LeaveTypeInput) {
  const exists = await prisma.leaveType.findUnique({ where: { companyId_code: { companyId, code: input.code } } });
  if (exists) throw ApiError.conflict(`Leave type code ${input.code} already exists`);
  if (input.isCompOff) await assertSingleCompOff(companyId);
  return prisma.leaveType.create({ data: { ...(normalisePolicy(input) as LeaveTypeInput), companyId } });
}

export async function updateType(companyId: string, id: string, data: Partial<LeaveTypeInput>) {
  const current = await prisma.leaveType.findFirst({ where: { id, companyId } });
  if (!current) throw ApiError.notFound('Leave type not found');
  if (data.code && data.code !== current.code) {
    const clash = await prisma.leaveType.findUnique({ where: { companyId_code: { companyId, code: data.code } } });
    if (clash) throw ApiError.conflict(`Leave type code ${data.code} already exists`);
  }
  if (data.isCompOff && !current.isCompOff) await assertSingleCompOff(companyId, id);
  const updated = await prisma.leaveType.update({ where: { id }, data: normalisePolicy(data, current) });
  return { before: current, after: updated };
}

/** The company's comp-off type, created as 'CO' (no accrual, 90-day expiry) when missing. */
export async function compOffType(companyId: string) {
  const existing = await prisma.leaveType.findFirst({ where: { companyId, isCompOff: true, isActive: true } });
  if (existing) return existing;
  const taken = await prisma.leaveType.findUnique({ where: { companyId_code: { companyId, code: 'CO' } } });
  if (taken) {
    // Re-activate an old comp-off type rather than creating a second one.
    if (taken.isCompOff) return prisma.leaveType.update({ where: { id: taken.id }, data: { isActive: true } });
  }
  return prisma.leaveType.create({
    data: {
      companyId, code: taken ? 'COFF' : 'CO', name: 'Comp Off', totalPerYear: 0, accrualType: 'NONE', isCompOff: true,
      compOffExpiryDays: 90, color: '#0EA5E9', allowHalfDay: true,
    },
  });
}

// ---- Day counting ----

/** Non-optional company holidays in [from, to], as YYYY-MM-DD keys. */
export async function holidaySet(companyId: string, from: Date, to: Date) {
  const rows = await prisma.holiday.findMany({
    where: { companyId, optional: false, date: { gte: from, lte: to } },
    select: { date: true, name: true },
  });
  return new Map(rows.map((r) => [isoDay(r.date), r.name]));
}

const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

/**
 * Leave days a request costs. Weekends and company holidays are free, except
 * with the sandwich rule, where every day between the first and last working
 * day of the range counts.
 */
export async function countLeaveDays(
  companyId: string,
  type: Pick<LeaveType, 'sandwichRule'>,
  from: Date,
  to: Date,
  halfDay: boolean
) {
  const holidays = await holidaySet(companyId, from, to);
  const working: Date[] = [];
  for (let d = dateOnly(from); d <= to; d = addDays(d, 1)) {
    if (!isWeekend(d) && !holidays.has(isoDay(d))) working.push(d);
  }
  const first = working[0];
  const last = working[working.length - 1];
  if (!first || !last) return { days: 0, workingDays: 0, holidays: [...holidays.values()] };
  if (halfDay) return { days: 0.5, workingDays: 1, holidays: [...holidays.values()] };
  const days = type.sandwichRule ? dayDiff(last, first) + 1 : working.length;
  return { days, workingDays: working.length, holidays: [...holidays.values()] };
}

// ---- Apply (policy validation) ----

/**
 * Validates an application against the type's policy and returns what it
 * would cost. Throws ApiError with a user-facing message on the first violation.
 */
export async function validateApplication(companyId: string, employeeId: string, input: ApplyLeaveInput) {
  const { leaveTypeId, halfDay } = input;
  const fromDate = dateOnly(input.fromDate);
  const toDate = dateOnly(input.toDate);
  if (toDate < fromDate) throw ApiError.badRequest('To date must be on or after from date');
  const [type, employee] = await Promise.all([
    prisma.leaveType.findFirst({ where: { id: leaveTypeId, companyId, isActive: true } }),
    prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true, isActive: true, gender: true, joiningDate: true, leavingDate: true },
    }),
  ]);
  if (!type) throw ApiError.badRequest('Invalid leave type');
  if (!employee || !employee.isActive) throw ApiError.forbidden('Inactive employees cannot apply for leave');
  if (fromDate.getUTCFullYear() !== toDate.getUTCFullYear()) {
    throw ApiError.badRequest('A leave cannot span two calendar years — apply for each year separately');
  }
  if (employee.leavingDate && toDate > dateOnly(employee.leavingDate)) {
    throw ApiError.badRequest(`Leave cannot extend beyond your last working day (${isoDay(employee.leavingDate)})`);
  }

  // Eligibility
  if (type.gender && employee.gender !== type.gender) {
    throw ApiError.badRequest(`${type.name} is only available to ${type.gender.toLowerCase()} employees`);
  }
  if (type.applicableAfterDays > 0) {
    const eligibleFrom = addDays(dateOnly(employee.joiningDate), type.applicableAfterDays);
    if (fromDate < eligibleFrom) {
      throw ApiError.badRequest(
        `${type.name} can be used only after ${type.applicableAfterDays} days of joining (from ${isoDay(eligibleFrom)})`
      );
    }
  }
  if (halfDay) {
    if (!type.allowHalfDay) throw ApiError.badRequest(`${type.name} cannot be taken as a half day`);
    if (fromDate.getTime() !== toDate.getTime()) throw ApiError.badRequest('A half day must start and end on the same date');
  }
  if (type.minNoticeDays > 0) {
    const notice = dayDiff(fromDate, todayIST());
    if (notice < type.minNoticeDays) {
      throw ApiError.badRequest(
        `${type.name} needs ${type.minNoticeDays} day(s) notice — the earliest start is ${isoDay(addDays(todayIST(), type.minNoticeDays))}`
      );
    }
  }

  // Cost
  const count = await countLeaveDays(companyId, type, fromDate, toDate, halfDay);
  if (count.days <= 0) throw ApiError.badRequest('The selected dates are weekends or holidays — no leave is needed');
  if (type.maxConsecutive > 0 && count.days > type.maxConsecutive) {
    throw ApiError.badRequest(`${type.name} allows at most ${type.maxConsecutive} day(s) in one request (this is ${count.days})`);
  }

  // Overlap
  const overlap = await prisma.leaveRequest.findFirst({
    where: { companyId, employeeId, status: { in: ['APPROVED', 'PENDING'] }, fromDate: { lte: toDate }, toDate: { gte: fromDate } },
    include: { leaveType: { select: { code: true } } },
  });
  if (overlap) {
    throw ApiError.conflict(
      `Overlaps your ${overlap.status.toLowerCase()} ${overlap.leaveType.code} leave (${isoDay(overlap.fromDate)} → ${isoDay(overlap.toDate)})`
    );
  }

  return { type, fromDate, toDate, days: count.days, holidays: count.holidays };
}

/** Available days for a type in a year, projecting the policy credit for future years. */
async function availableFor(tx: Prisma.TransactionClient, companyId: string, employeeId: string, type: LeaveType, year: number) {
  const currentYear = todayIST().getUTCFullYear();
  if (year <= currentYear) {
    await ensureYearCreditsTx(tx, companyId, employeeId, year);
    await expireCompOffTx(tx, companyId, employeeId);
  }
  const [row] = await computeBalances(tx, companyId, employeeId, year, type.id);
  let available = row?.available ?? 0;
  if (year > currentYear && !type.isCompOff) {
    // Next year's credit isn't posted yet — count what the policy will grant.
    if (type.accrualType === 'YEARLY') available += type.totalPerYear;
    else if (type.accrualType === 'MONTHLY') available += type.accrualRate > 0 ? type.accrualRate : type.totalPerYear / 12;
  }
  return round2(available);
}

/** Dry run of an application: cost and balance after, or the policy error. */
export async function previewLeave(companyId: string, employeeId: string, input: ApplyLeaveInput) {
  try {
    const v = await validateApplication(companyId, employeeId, input);
    const available = await withLedgerLock(employeeId, (tx) =>
      availableFor(tx, companyId, employeeId, v.type, v.fromDate.getUTCFullYear())
    );
    const after = round2(available - v.days);
    const ok = after >= balanceFloor(v.type);
    return {
      ok,
      days: v.days,
      available,
      balanceAfter: after,
      holidays: v.holidays,
      error: ok ? null : `Insufficient balance: ${available} day(s) of ${v.type.code} available`,
    };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, days: 0, available: null, balanceAfter: null, holidays: [], error: err.message };
    throw err;
  }
}

export async function applyLeave(companyId: string, employeeId: string, input: ApplyLeaveInput) {
  const v = await validateApplication(companyId, employeeId, input);
  const year = v.fromDate.getUTCFullYear();
  const request = await withLedgerLock(employeeId, async (tx) => {
    const available = await availableFor(tx, companyId, employeeId, v.type, year);
    if (available - v.days < balanceFloor(v.type)) {
      throw ApiError.badRequest(
        v.type.allowNegative
          ? `Insufficient balance: ${available} day(s) of ${v.type.code} available (up to ${v.type.maxNegative} negative allowed)`
          : `Insufficient balance: ${available} day(s) of ${v.type.code} available`
      );
    }
    return tx.leaveRequest.create({
      data: {
        companyId, employeeId, leaveTypeId: v.type.id, fromDate: v.fromDate, toDate: v.toDate,
        halfDay: input.halfDay, days: v.days, reason: input.reason,
      },
      include: { leaveType: true },
    });
  });
  try {
    await approvalService.start(companyId, 'LEAVE', request.id, employeeId);
  } catch (err) {
    await prisma.leaveRequest.delete({ where: { id: request.id } }).catch(() => undefined);
    throw err;
  }
  return { ...request, approvalSteps: (await trailsFor(companyId, 'LEAVE', [request.id])).get(request.id) ?? [] };
}

// ---- Listing ----

export interface ListRequestsFilter {
  status?: RequestStatus;
  /** 'me' = own, 'team' = direct reports, 'company' = everyone, 'approvals' = waiting on the actor. */
  scope: 'me' | 'team' | 'company' | 'approvals';
  employeeId: string | null;
  role: Role;
  year?: number;
}

const requestInclude = {
  leaveType: true,
  employee: { select: { id: true, name: true, department: true, employeeCode: true } },
  approver: { select: { id: true, name: true } },
} satisfies Prisma.LeaveRequestInclude;

export async function listRequests(companyId: string, filter: ListRequestsFilter) {
  let where: Prisma.LeaveRequestWhereInput = { companyId };
  if (filter.status) where.status = filter.status;
  if (filter.year) where.fromDate = yearRange(filter.year);
  if (filter.scope === 'me') where.employeeId = filter.employeeId ?? '';
  else if (filter.scope === 'team') where.employee = { managerId: filter.employeeId ?? '' };
  else if (filter.scope === 'approvals') {
    const pending = await prisma.leaveRequest.findMany({
      where: { companyId, status: 'PENDING' },
      select: { id: true, employeeId: true, employee: { select: { managerId: true } } },
    });
    const ids = await awaitingActor(
      companyId, 'LEAVE', { role: filter.role, employeeId: filter.employeeId },
      pending.map((p) => ({ id: p.id, employeeId: p.employeeId, managerId: p.employee.managerId }))
    );
    where = { companyId, status: 'PENDING', id: { in: [...ids] } };
  }
  const rows = await prisma.leaveRequest.findMany({ where, include: requestInclude, orderBy: { appliedOn: 'desc' }, take: 500 });
  const trails = await trailsFor(companyId, 'LEAVE', rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, approvalSteps: trails.get(r.id) ?? [] }));
}

/** Can the actor see this employee's leave details (self, manager, company admin)? */
async function canView(companyId: string, actor: Actor, employee: { id: string; managerId: string | null }, requestId?: string) {
  if (isCompanyAdmin(actor.role)) return true;
  if (actor.employeeId === employee.id) return true;
  if (actor.employeeId && employee.managerId === actor.employeeId) return true;
  if (requestId && actor.employeeId) {
    // Named approvers further up the chain (department head, skip-level manager).
    const step = await prisma.approvalStep.findFirst({
      where: { companyId, requestId, approverEmployeeId: actor.employeeId },
      select: { id: true },
    });
    return !!step;
  }
  return false;
}

export async function getRequest(companyId: string, actor: Actor, id: string) {
  const request = await prisma.leaveRequest.findFirst({
    where: { id, companyId },
    include: { ...requestInclude, employee: { select: { id: true, name: true, department: true, employeeCode: true, managerId: true } } },
  });
  if (!request || !(await canView(companyId, actor, request.employee, id))) throw ApiError.notFound('Leave request not found');
  const trail = await approvalService.trail(companyId, 'LEAVE', id);
  const current = await approvalService.currentStep(companyId, 'LEAVE', id);
  return {
    ...request,
    trail,
    approvalSteps: (await trailsFor(companyId, 'LEAVE', [id])).get(id) ?? [],
    canAct: request.status === 'PENDING' && (current ? approvalService.canAct(current, actor) : isCompanyAdmin(actor.role) || request.employee.managerId === actor.employeeId) && request.employeeId !== actor.employeeId,
  };
}

// ---- Cancel ----

/**
 * Employees withdraw their own pending leave, or approved leave that hasn't
 * started; ADMIN/HR may cancel any. Cancelling approved leave reverses its debit.
 */
export async function cancelRequest(companyId: string, actor: Actor, requestId: string) {
  const request = await prisma.leaveRequest.findFirst({
    where: { id: requestId, companyId },
    include: { leaveType: true, employee: { select: { id: true, name: true, managerId: true } } },
  });
  const own = !!request && request.employeeId === actor.employeeId;
  if (!request || (!own && !isCompanyAdmin(actor.role))) throw ApiError.notFound('Leave request not found');
  if (request.status !== 'PENDING' && request.status !== 'APPROVED') {
    throw ApiError.badRequest(`Cannot cancel a ${request.status.toLowerCase()} request`);
  }
  if (request.status === 'APPROVED' && !isCompanyAdmin(actor.role) && request.fromDate <= todayIST()) {
    throw ApiError.badRequest('This leave has already started — ask HR to cancel it');
  }
  const wasApproved = request.status === 'APPROVED';
  const updated = await withLedgerLock(request.employeeId, async (tx) => {
    const res = await tx.leaveRequest.updateMany({
      where: { id: request.id, status: { in: ['PENDING', 'APPROVED'] } },
      data: { status: 'CANCELLED' },
    });
    if (res.count === 0) throw ApiError.conflict('The request changed meanwhile — refresh and try again');
    if (wasApproved) {
      const net = await sumByRef(tx, companyId, request.id, ['AVAILED', 'REVERSAL']);
      if (net < 0) {
        await post(tx, {
          companyId, employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, date: request.fromDate, change: -net,
          kind: 'REVERSAL', reason: own ? 'Leave cancelled by employee' : 'Leave cancelled by HR', refId: request.id,
          createdById: actor.employeeId,
        });
      }
    }
    return tx.leaveRequest.findUnique({ where: { id: request.id }, include: requestInclude });
  });
  await approvalService.cancel(companyId, 'LEAVE', request.id);
  const range = `${isoDay(request.fromDate)} → ${isoDay(request.toDate)}`;
  if (own) {
    if (wasApproved) {
      await notify(companyId, [request.employee.managerId, request.approverId], {
        event: 'leave.cancelled', title: 'Leave cancelled', body: `${request.employee.name} cancelled approved ${request.leaveType.code} leave (${range}).`, link: '/leaves',
      });
    }
  } else {
    await notify(companyId, [request.employeeId], {
      event: 'leave.cancelled', title: 'Your leave was cancelled', body: `HR cancelled your ${request.leaveType.code} leave (${range}).`, link: '/leaves',
    });
  }
  return updated;
}

// ---- Decide ----

export interface DecideInput {
  decision: 'APPROVED' | 'REJECTED';
  remarks?: string;
  actor: Actor;
}

/** Records a decision through the approval engine; finalises when the chain completes. */
export async function decideRequest(companyId: string, requestId: string, input: DecideInput) {
  const { decision, remarks, actor } = input;
  const request = await prisma.leaveRequest.findFirst({
    where: { id: requestId, companyId },
    include: { leaveType: true, employee: { select: { id: true, name: true, managerId: true } } },
  });
  if (!request) throw ApiError.notFound('Leave request not found');
  if (request.status !== 'PENDING') throw ApiError.badRequest('Request already decided');

  if (decision === 'APPROVED') {
    // Balance may have moved since applying (adjustments, other approvals).
    const year = request.fromDate.getUTCFullYear();
    if (year <= todayIST().getUTCFullYear()) {
      const available = await withLedgerLock(request.employeeId, (tx) =>
        availableFor(tx, companyId, request.employeeId, request.leaveType, year)
      );
      // `available` already excludes this pending request.
      if (available < balanceFloor(request.leaveType)) {
        throw ApiError.badRequest(
          `Approving would take ${request.employee.name}'s ${request.leaveType.code} balance below the allowed limit (${round2(available + request.days)} day(s) left for ${request.days} requested)`
        );
      }
    }
  }

  const r = await approvalService.act(companyId, 'LEAVE', request.id, request.employeeId, actor, decision, remarks);
  const range = `${isoDay(request.fromDate)} → ${isoDay(request.toDate)}`;

  if (r.outcome === 'PENDING') {
    await notify(companyId, [request.employeeId], {
      event: 'leave.progress', title: 'Leave approved at one level',
      body: `Your ${request.leaveType.code} leave (${range}) moved to the next approver.`, link: '/leaves',
    });
  } else if (r.outcome === 'REJECTED') {
    await prisma.leaveRequest.update({
      where: { id: request.id },
      data: { status: 'REJECTED', remarks: remarks ?? null, approverId: actor.employeeId },
    });
    await notify(companyId, [request.employeeId], {
      event: 'leave.rejected', title: 'Leave rejected',
      body: `Your ${request.leaveType.code} leave (${range}) was rejected${remarks ? `: ${remarks}` : '.'}`, link: '/leaves',
    });
  } else {
    await withLedgerLock(request.employeeId, async (tx) => {
      const res = await tx.leaveRequest.updateMany({
        where: { id: request.id, status: 'PENDING' },
        data: { status: 'APPROVED', remarks: remarks ?? null, approverId: actor.employeeId },
      });
      if (res.count === 0) throw ApiError.conflict('The request changed meanwhile — refresh and try again');
      const already = await sumByRef(tx, companyId, request.id, ['AVAILED']);
      if (already === 0) {
        await post(tx, {
          companyId, employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, date: request.fromDate,
          change: -request.days, kind: 'AVAILED', reason: 'Approved leave', refId: request.id, createdById: actor.employeeId,
        });
      }
    });
    await notify(companyId, [request.employeeId], {
      event: 'leave.approved', title: 'Leave approved',
      body: `Your ${request.leaveType.code} leave (${range}) was approved.`, link: '/leaves',
    });
    // Let the team know who's away (peers under the same manager + the manager).
    if (request.employee.managerId) {
      const peers = await prisma.employee.findMany({
        where: { companyId, isActive: true, managerId: request.employee.managerId, NOT: { id: request.employeeId } },
        select: { id: true },
      });
      await notify(companyId, [request.employee.managerId, ...peers.map((p) => p.id)].filter((id) => id !== actor.employeeId), {
        event: 'leave.team', title: `${request.employee.name} is on leave`,
        body: `${request.employee.name} will be away ${range}.`, link: '/leaves/calendar',
      });
    }
  }

  const updated = await prisma.leaveRequest.findUnique({ where: { id: request.id }, include: requestInclude });
  return { ...updated, outcome: r.outcome, approvalSteps: (await trailsFor(companyId, 'LEAVE', [request.id])).get(request.id) ?? [] };
}

// ---- Team calendar ----

export interface CalendarQuery {
  year: number;
  month: number; // 1-12
  scope: 'team' | 'company';
}

/**
 * Leaves and holidays for a month. HR/ADMIN: everyone (company) or their
 * reports (team); MANAGER: their reports + themselves; EMPLOYEE: approved
 * leaves of their own team (same manager), names only.
 */
export async function calendar(companyId: string, actor: Actor, q: CalendarQuery) {
  const from = utcDate(q.year, q.month - 1, 1);
  const to = utcDate(q.year, q.month, 0);
  const admin = isCompanyAdmin(actor.role);
  const managerial = admin || actor.role === 'MANAGER';

  let employeeWhere: Prisma.EmployeeWhereInput;
  let statuses: RequestStatus[] = ['APPROVED', 'PENDING'];
  let detailed = true;
  if (admin && q.scope === 'company') employeeWhere = {};
  else if (managerial) employeeWhere = { OR: [{ managerId: actor.employeeId ?? '' }, { id: actor.employeeId ?? '' }] };
  else {
    const me = actor.employeeId
      ? await prisma.employee.findFirst({ where: { id: actor.employeeId, companyId }, select: { managerId: true } })
      : null;
    employeeWhere = me?.managerId ? { managerId: me.managerId } : { id: actor.employeeId ?? '' };
    statuses = ['APPROVED'];
    detailed = false;
  }

  const [leaves, holidays] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: {
        companyId, status: { in: statuses }, fromDate: { lte: to }, toDate: { gte: from },
        employee: { companyId, isActive: true, ...employeeWhere },
      },
      include: {
        leaveType: { select: { code: true, name: true, color: true } },
        employee: { select: { id: true, name: true, department: true, avatarColor: true } },
      },
      orderBy: { fromDate: 'asc' },
    }),
    prisma.holiday.findMany({ where: { companyId, date: { gte: from, lte: to } }, orderBy: { date: 'asc' } }),
  ]);

  return {
    year: q.year,
    month: q.month,
    scope: admin && q.scope === 'company' ? 'company' : 'team',
    holidays,
    leaves: leaves.map((l) => {
      const own = l.employeeId === actor.employeeId;
      const base = {
        id: l.id, employeeId: l.employeeId, employeeName: l.employee.name, avatarColor: l.employee.avatarColor,
        fromDate: l.fromDate, toDate: l.toDate, halfDay: l.halfDay, status: l.status,
      };
      return detailed || own
        ? { ...base, department: l.employee.department, days: l.days, leaveType: l.leaveType }
        : base;
    }),
  };
}

/** Employees whose leave data the actor may open (ledger picker). */
export async function viewableEmployees(companyId: string, actor: Actor) {
  const where: Prisma.EmployeeWhereInput = isCompanyAdmin(actor.role)
    ? { companyId }
    : actor.role === 'MANAGER'
      ? { companyId, OR: [{ managerId: actor.employeeId ?? '' }, { id: actor.employeeId ?? '' }] }
      : { companyId, id: actor.employeeId ?? '' };
  return prisma.employee.findMany({
    where,
    select: { id: true, name: true, employeeCode: true, department: true, isActive: true },
    orderBy: { name: 'asc' },
  });
}

/** Throws unless the actor may view the employee's balances / ledger. */
export async function assertCanView(companyId: string, actor: Actor, employeeId: string) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { id: true, managerId: true } });
  if (!employee || !(await canView(companyId, actor, employee))) throw ApiError.forbidden('You cannot view this employee');
}

// ---- Jobs support ----

/** Active employee ids of a company (job loops). */
export async function activeEmployeeIds(companyId: string) {
  const rows = await prisma.employee.findMany({ where: { companyId, isActive: true }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Runs `fn` per employee, logging (not throwing) individual failures so one bad row can't stop a job. */
export async function forEachEmployee(companyId: string, job: string, fn: (employeeId: string) => Promise<void>) {
  let failed = 0;
  for (const id of await activeEmployeeIds(companyId)) {
    try {
      await fn(id);
    } catch (err) {
      failed++;
      logger.error({ err, companyId, employeeId: id, job }, 'leave job: employee failed');
    }
  }
  return failed;
}
