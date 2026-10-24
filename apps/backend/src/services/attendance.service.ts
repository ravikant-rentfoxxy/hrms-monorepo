/**
 * Attendance business logic: geofenced punches measured against the
 * employee's shift, regularization (REGULARIZATION approval chain), monthly
 * calendars, payable days, muster exports and the daily auto-marking.
 *
 * Shift rules (see shift.service):
 *   check-in  → LATE when after start + grace (lateMinutes counted from start)
 *   check-out → workedMinutes = stay − break (break deducted once the stay
 *               covers half a day plus the break); below fullDayMinutes the
 *               day becomes HALF_DAY, below halfDayMinutes ABSENT; minutes
 *               beyond the overtime threshold are overtimeMinutes (on a
 *               weekly off / holiday the whole day is overtime)
 *   night     → a punch before the previous day's shift end belongs to the
 *               previous day's record
 */
import type { AttendanceRecord, AttendanceStatus, Role, Shift } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';
import { dateOnlyUTC } from '../utils/geo';
import { toCsv } from '../utils/csv';
import { DAY_MS, addDays, atLocalTime, fmtMinutes, isoDate, localDateOf } from '../utils/tz';
import { checkGeofence, companyWorkingDays } from './office.service';
import * as approvalService from './approval.service';
import * as overtimeService from './overtime.service';
import {
  crossesMidnight,
  dayInfo,
  holidayMap,
  isWeeklyOff,
  overtimeThreshold,
  resolveShift,
  shiftResolver,
  shiftSummary,
} from './shift.service';

export interface PunchInput {
  latitude: number;
  longitude: number;
  note?: string;
}

/** A missed check-out is auto-closed this long after the shift end. */
const CHECKOUT_GRACE_MS = 4 * 3600 * 1000;
const MISSED_CHECKOUT_NOTE = 'Missed check-out';

export async function companyTz(companyId: string): Promise<string> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
  return c?.timezone || 'Asia/Kolkata';
}

/** Start / end instants of a shift worked on `date` (end is next day for night shifts). */
export function shiftWindow(shift: Shift, date: Date, tz: string): { start: Date; end: Date } {
  return {
    start: atLocalTime(date, shift.startTime, tz),
    end: atLocalTime(date, shift.endTime, tz, crossesMidnight(shift) ? 1 : 0),
  };
}

/**
 * The attendance date a punch at `now` belongs to: the previous day while
 * the previous day's (night) shift has not ended yet, else today.
 */
export async function attendanceDateFor(companyId: string, employeeId: string, now = new Date(), tz?: string) {
  const zone = tz ?? (await companyTz(companyId));
  const today = localDateOf(now, zone);
  const yesterday = addDays(today, -1);
  const prevShift = await resolveShift(companyId, employeeId, yesterday);
  if (crossesMidnight(prevShift) && now.getTime() < shiftWindow(prevShift, yesterday, zone).end.getTime()) {
    return { date: yesterday, shift: prevShift, tz: zone };
  }
  return { date: today, shift: await resolveShift(companyId, employeeId, today), tz: zone };
}

async function hasHalfDayLeave(companyId: string, employeeId: string, date: Date) {
  const leave = await prisma.leaveRequest.findFirst({
    where: { companyId, employeeId, status: 'APPROVED', halfDay: true, fromDate: { lte: date }, toDate: { gte: date } },
    select: { id: true },
  });
  return !!leave;
}

export async function checkIn(companyId: string, employeeId: string, input: PunchInput) {
  const now = new Date();
  const { date, shift, tz } = await attendanceDateFor(companyId, employeeId, now);
  const existing = await prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date } } });
  if (existing?.checkIn) throw ApiError.conflict('Already checked in today');

  const { distance } = await checkGeofence(companyId, input.latitude, input.longitude);

  const info = await dayInfo(companyId, employeeId, date);
  const { start } = shiftWindow(shift, date, tz);
  const lateBy = Math.floor((now.getTime() - start.getTime()) / 60000);
  // No lateness on a weekly off / holiday (that work is overtime).
  const isLate = info.isWorkingDay && lateBy > shift.graceMinutes;
  const data = {
    status: (isLate ? 'LATE' : 'PRESENT') as AttendanceStatus,
    checkIn: now,
    checkInLat: input.latitude,
    checkInLng: input.longitude,
    checkInDistance: distance,
    note: input.note,
    shiftId: shift.id,
    lateMinutes: isLate ? lateBy : 0,
    workedMinutes: null,
    overtimeMinutes: 0,
    isAutoMarked: false,
  };
  return prisma.attendanceRecord.upsert({
    where: { employeeId_date: { employeeId, date } },
    create: { companyId, employeeId, date, ...data },
    update: data,
  });
}

/** The open record a check-out closes: the punch date's, else yesterday's within its shift end + grace. */
async function openRecord(companyId: string, employeeId: string, now: Date) {
  const { date, tz } = await attendanceDateFor(companyId, employeeId, now);
  const current = await prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date } } });
  if (current?.checkIn) return { record: current, tz };
  const prevDate = addDays(date, -1);
  const prev = await prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date: prevDate } } });
  if (prev?.checkIn && !prev.checkOut && !prev.isAutoMarked) {
    const shift = await recordShift(companyId, prev);
    if (now.getTime() <= shiftWindow(shift, prevDate, tz).end.getTime() + CHECKOUT_GRACE_MS) return { record: prev, tz };
  }
  return { record: current, tz };
}

async function recordShift(companyId: string, record: Pick<AttendanceRecord, 'shiftId' | 'employeeId' | 'date'>) {
  if (record.shiftId) {
    const s = await prisma.shift.findFirst({ where: { id: record.shiftId, companyId } });
    if (s) return s;
  }
  return resolveShift(companyId, record.employeeId, record.date);
}

/** Worked / status / overtime for a stay of `grossMinutes` on a shift. */
export function evaluateDay(
  shift: Shift,
  grossMinutes: number,
  opts: { isWorkingDay: boolean; halfDayLeave: boolean; punchStatus: AttendanceStatus }
) {
  const gross = Math.max(0, Math.round(grossMinutes));
  const worked = gross >= shift.halfDayMinutes + shift.breakMinutes ? gross - shift.breakMinutes : gross;
  if (!opts.isWorkingDay) {
    return { workedMinutes: worked, status: 'PRESENT' as AttendanceStatus, overtimeMinutes: worked, short: false };
  }
  const fullDay = opts.halfDayLeave ? shift.halfDayMinutes : shift.fullDayMinutes;
  let status: AttendanceStatus = opts.punchStatus;
  let short = false;
  if (opts.halfDayLeave && worked >= shift.halfDayMinutes) status = 'HALF_DAY';
  else if (worked >= fullDay) status = opts.punchStatus === 'LATE' ? 'LATE' : 'PRESENT';
  else if (worked >= shift.halfDayMinutes) status = 'HALF_DAY';
  else {
    status = 'ABSENT';
    short = true;
  }
  const threshold = opts.halfDayLeave ? shift.halfDayMinutes : overtimeThreshold(shift);
  return { workedMinutes: worked, status, overtimeMinutes: Math.max(0, worked - threshold), short };
}

export async function checkOut(companyId: string, employeeId: string, input: PunchInput) {
  const now = new Date();
  const { record } = await openRecord(companyId, employeeId, now);
  if (!record?.checkIn) throw ApiError.badRequest('Check in first');
  if (record.checkOut) throw ApiError.conflict('Already checked out today');

  const { distance } = await checkGeofence(companyId, input.latitude, input.longitude);
  const shift = await recordShift(companyId, record);
  const [info, halfDayLeave] = await Promise.all([
    dayInfo(companyId, employeeId, record.date),
    hasHalfDayLeave(companyId, employeeId, record.date),
  ]);
  const result = evaluateDay(shift, (now.getTime() - record.checkIn.getTime()) / 60000, {
    isWorkingDay: info.isWorkingDay,
    halfDayLeave,
    punchStatus: record.status,
  });
  const note = result.short
    ? [record.note, `Worked ${fmtMinutes(result.workedMinutes)} — below the half-day minimum`].filter(Boolean).join(' · ')
    : record.note;

  const updated = await prisma.attendanceRecord.update({
    where: { id: record.id },
    data: {
      checkOut: now,
      checkOutLat: input.latitude,
      checkOutLng: input.longitude,
      checkOutDistance: distance,
      shiftId: shift.id,
      status: result.status,
      workedMinutes: result.workedMinutes,
      overtimeMinutes: result.overtimeMinutes,
      note,
    },
  });
  if (result.overtimeMinutes >= overtimeService.AUTO_OVERTIME_MINUTES) {
    await overtimeService.raiseFromAttendance(companyId, employeeId, record.date, result.overtimeMinutes);
  }
  return updated;
}

/** The current record (today's, or last night's while that shift is running). */
export async function todayRecord(employeeId: string, companyId?: string) {
  if (!companyId) {
    return prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date: dateOnlyUTC() } } });
  }
  const { record } = await openRecord(companyId, employeeId, new Date());
  if (record) return record;
  const { date } = await attendanceDateFor(companyId, employeeId);
  return prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date } } });
}

/** Today's shift, window, weekly-off / holiday / leave status and record (app check-in card). */
export async function todaySummary(companyId: string, employeeId: string) {
  const now = new Date();
  const { date, tz } = await attendanceDateFor(companyId, employeeId, now);
  const [record, info, leave] = await Promise.all([
    todayRecord(employeeId, companyId),
    dayInfo(companyId, employeeId, date),
    prisma.leaveRequest.findFirst({
      where: { companyId, employeeId, status: 'APPROVED', fromDate: { lte: date }, toDate: { gte: date } },
      select: { id: true, halfDay: true, leaveType: { select: { code: true, name: true } } },
    }),
  ]);
  const shift = record?.shiftId ? await recordShift(companyId, record) : info.shift;
  const window = shiftWindow(shift, record?.date ?? date, tz);
  return {
    date: isoDate(record?.date ?? date),
    timezone: tz,
    shift: shiftSummary(shift),
    shiftStart: window.start,
    shiftEnd: window.end,
    lateAfter: new Date(window.start.getTime() + shift.graceMinutes * 60000),
    isWeeklyOff: info.isWeeklyOff,
    holiday: info.holiday,
    leave,
    record,
  };
}

export async function monthlyRecords(companyId: string, employeeId: string, year: number, month: number) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  return prisma.attendanceRecord.findMany({
    where: { companyId, employeeId, date: { gte: from, lt: to } },
    orderBy: { date: 'desc' },
  });
}

/**
 * Month calendar for one employee: records plus, for every day, the shift,
 * weekly-off and holiday flags — so clients stop guessing Sat/Sun.
 */
export async function monthCalendar(companyId: string, employeeId: string, year: number, month: number) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  const [records, resolve, holidays, leaves, employee] = await Promise.all([
    monthlyRecords(companyId, employeeId, year, month),
    shiftResolver(companyId, [employeeId], from, last),
    holidayMap(companyId, from, last),
    prisma.leaveRequest.findMany({
      where: { companyId, employeeId, status: 'APPROVED', fromDate: { lte: last }, toDate: { gte: from } },
      select: { fromDate: true, toDate: true, halfDay: true, leaveType: { select: { code: true, name: true } } },
    }),
    prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { joiningDate: true } }),
  ]);
  const days = [];
  for (let d = from; d.getTime() <= last.getTime(); d = addDays(d, 1)) {
    const shift = resolve(employeeId, d);
    const iso = isoDate(d);
    const leave = leaves.find((l) => l.fromDate.getTime() <= d.getTime() && l.toDate.getTime() >= d.getTime());
    days.push({
      date: iso,
      weekday: d.getUTCDay(),
      isWeeklyOff: isWeeklyOff(shift, d),
      holiday: holidays.get(iso) ?? null,
      leave: leave ? { code: leave.leaveType.code, name: leave.leaveType.name, halfDay: leave.halfDay } : null,
      beforeJoining: !!employee && d.getTime() < dateOnlyUTCOf(employee.joiningDate).getTime(),
      shift: { id: shift.id, code: shift.code, name: shift.name, startTime: shift.startTime, endTime: shift.endTime, color: shift.color },
    });
  }
  const count = (s: AttendanceStatus) => records.filter((r) => r.status === s).length;
  return {
    year,
    month,
    records,
    days,
    summary: {
      present: count('PRESENT') + count('LATE'),
      late: count('LATE'),
      halfDay: count('HALF_DAY'),
      absent: count('ABSENT'),
      leave: count('LEAVE'),
      lateMinutes: records.reduce((s, r) => s + r.lateMinutes, 0),
      workedMinutes: records.reduce((s, r) => s + (r.workedMinutes ?? 0), 0),
      overtimeMinutes: records.reduce((s, r) => s + r.overtimeMinutes, 0),
      workingDays: days.filter((d) => !d.isWeeklyOff && !d.holiday).length,
    },
  };
}

const dateOnlyUTCOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export async function companyDay(companyId: string, date: Date, actor?: { role: Role; employeeId: string | null }) {
  const scope = actor?.role === 'MANAGER' ? { employee: { managerId: actor.employeeId } } : {};
  const records = await prisma.attendanceRecord.findMany({
    where: { companyId, date: dateOnlyUTC(date), ...scope },
    include: { employee: { select: { id: true, name: true, department: true, designation: true } } },
    orderBy: { checkIn: 'asc' },
  });
  const shiftIds = [...new Set(records.map((r) => r.shiftId).filter((x): x is string => !!x))];
  const shifts = await prisma.shift.findMany({ where: { companyId, id: { in: shiftIds } }, select: { id: true, code: true, name: true, color: true } });
  return records.map((r) => ({ ...r, shift: shifts.find((s) => s.id === r.shiftId) ?? null }));
}

// ---- Regularization (attendance correction requests, REGULARIZATION approval chain) ----

export async function requestRegularization(
  companyId: string,
  employeeId: string,
  input: { date: Date; reason: string; note?: string }
) {
  const date = dateOnlyUTC(input.date);
  if (date.getTime() > dateOnlyUTC().getTime()) {
    throw ApiError.badRequest('Cannot regularize a future date');
  }
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { joiningDate: true } });
  if (employee && date.getTime() < dateOnlyUTCOf(employee.joiningDate).getTime()) {
    throw ApiError.badRequest('Cannot regularize a date before your joining date');
  }
  const pending = await prisma.regularizationRequest.findFirst({
    where: { companyId, employeeId, date, status: 'PENDING' },
  });
  if (pending) throw ApiError.conflict('A regularization request for this date is already pending');
  const request = await prisma.regularizationRequest.create({
    data: { companyId, employeeId, date, reason: input.reason, note: input.note },
  });
  try {
    await approvalService.start(companyId, 'REGULARIZATION', request.id, employeeId);
  } catch (err) {
    await prisma.regularizationRequest.delete({ where: { id: request.id } });
    throw err;
  }
  return request;
}

export async function listRegularizations(
  companyId: string,
  filter: { scope: 'me' | 'company'; actor: { role: Role; employeeId: string | null }; status?: string }
) {
  let employeeFilter: object = { employeeId: filter.actor.employeeId ?? '' };
  if (filter.scope === 'company') {
    // Managers see their reports plus requests waiting on them; ADMIN/HR see everyone.
    if (filter.actor.role === 'MANAGER') {
      const steps = await prisma.approvalStep.findMany({
        where: { companyId, module: 'REGULARIZATION', approverEmployeeId: filter.actor.employeeId ?? '' },
        select: { requestId: true },
      });
      employeeFilter = {
        OR: [{ employee: { managerId: filter.actor.employeeId } }, { id: { in: steps.map((s) => s.requestId) } }],
      };
    } else employeeFilter = {};
  }
  const requests = await prisma.regularizationRequest.findMany({
    where: {
      companyId,
      ...employeeFilter,
      ...(filter.status ? { status: filter.status as 'PENDING' } : {}),
    },
    include: {
      employee: { select: { id: true, name: true, department: true } },
      approver: { select: { id: true, name: true } },
    },
    orderBy: { appliedOn: 'desc' },
    take: 200,
  });
  const pendingIds = requests.filter((r) => r.status === 'PENDING').map((r) => r.id);
  const steps = pendingIds.length
    ? await prisma.approvalStep.findMany({
        where: { companyId, module: 'REGULARIZATION', requestId: { in: pendingIds }, status: 'PENDING' },
        orderBy: { level: 'asc' },
      })
    : [];
  return requests.map((r) => {
    const step = steps.find((s) => s.requestId === r.id);
    return { ...r, currentLevel: step?.level ?? null, pendingWith: step ? (step.approverRole ?? step.approverEmployeeId) : null };
  });
}

export async function regularizationTrail(companyId: string, id: string) {
  const request = await prisma.regularizationRequest.findFirst({ where: { id, companyId }, select: { id: true } });
  if (!request) throw ApiError.notFound('Regularization request not found');
  return approvalService.trail(companyId, 'REGULARIZATION', id);
}

export async function cancelRegularization(companyId: string, employeeId: string, id: string) {
  const request = await prisma.regularizationRequest.findFirst({ where: { id, companyId, employeeId } });
  if (!request) throw ApiError.notFound('Regularization request not found');
  if (request.status !== 'PENDING') throw ApiError.badRequest('Only pending requests can be cancelled');
  await approvalService.cancel(companyId, 'REGULARIZATION', id);
  return prisma.regularizationRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
}

/**
 * Records a decision through the approval engine (it enforces who may act).
 * Final approval marks the day PRESENT with the resolved shift's times.
 */
export async function decideRegularization(
  companyId: string,
  requestId: string,
  input: { decision: 'APPROVED' | 'REJECTED'; remarks?: string; actor: { role: Role; employeeId: string | null } }
) {
  const { decision, remarks, actor } = input;
  const request = await prisma.regularizationRequest.findFirst({ where: { id: requestId, companyId } });
  if (!request) throw ApiError.notFound('Regularization request not found');
  if (request.status !== 'PENDING') throw ApiError.badRequest('Request already decided');

  const result = await approvalService.act(
    companyId, 'REGULARIZATION', request.id, request.employeeId, actor, decision, remarks
  );
  if (result.outcome === 'PENDING') return { ...request, outcome: result.outcome };

  const updated = await prisma.regularizationRequest.update({
    where: { id: request.id },
    data: { status: result.outcome, remarks, approverId: actor.employeeId },
  });
  if (result.outcome === 'APPROVED') {
    const d = request.date;
    const tz = await companyTz(companyId);
    const shift = await resolveShift(companyId, request.employeeId, d);
    const { start: checkIn, end: checkOut } = shiftWindow(shift, d, tz);
    const worked = Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 60000) - shift.breakMinutes);
    const data = {
      status: 'PRESENT' as const,
      checkIn,
      checkOut,
      shiftId: shift.id,
      workedMinutes: worked,
      lateMinutes: 0,
      overtimeMinutes: 0,
      isAutoMarked: false,
      note: `Regularized — ${request.reason}`,
    };
    await prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId: request.employeeId, date: d } },
      create: { companyId, employeeId: request.employeeId, date: d, ...data },
      update: data,
    });
  }
  await notify(companyId, [request.employeeId], {
    event: `regularization.${result.outcome.toLowerCase()}`,
    title: `Regularization ${result.outcome.toLowerCase()}`,
    body: `Your attendance regularization for ${isoDate(request.date)} was ${result.outcome.toLowerCase()}${remarks ? `: ${remarks}` : '.'}`,
    link: '/attendance',
  });
  return { ...updated, outcome: result.outcome };
}

// ---- Payable days ----

/**
 * Payable days per employee for a month, derived from reality:
 *   worked  = check-in days (PRESENT/LATE = 1, HALF_DAY = 0.5, regularized days included)
 *   leave   = approved paid leave on the employee's working days in the month
 *             (weekly offs of their shift and holidays excluded; half-day = 0.5)
 *   payable = worked + leave, capped at the office's working-days norm
 * This is the "Payable Days" of the pro-rata payroll formula:
 *   earned component = fixed component ÷ working days × payable days.
 * Extra per-item fields: unpaidLeave, absent, late, overtimeMinutes.
 */
export async function payableDaysForMonth(companyId: string, year: number, month: number) {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));
  const lastDay = addDays(monthEnd, -1);
  const [workingDaysInfo, records, leaves, holidays] = await Promise.all([
    companyWorkingDays(companyId, year, month),
    prisma.attendanceRecord.findMany({
      where: { companyId, date: { gte: monthStart, lt: monthEnd } },
      select: { employeeId: true, status: true, overtimeMinutes: true },
    }),
    prisma.leaveRequest.findMany({
      where: { companyId, status: 'APPROVED', fromDate: { lt: monthEnd }, toDate: { gte: monthStart } },
      select: { employeeId: true, fromDate: true, toDate: true, halfDay: true, leaveType: { select: { isPaid: true } } },
    }),
    holidayMap(companyId, monthStart, lastDay),
  ]);

  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const worked = new Map<string, number>();
  const absent = new Map<string, number>();
  const late = new Map<string, number>();
  const overtime = new Map<string, number>();
  for (const r of records) {
    if (r.status === 'PRESENT' || r.status === 'LATE') add(worked, r.employeeId, 1);
    if (r.status === 'HALF_DAY') add(worked, r.employeeId, 0.5);
    if (r.status === 'ABSENT') add(absent, r.employeeId, 1);
    if (r.status === 'LATE') add(late, r.employeeId, 1);
    if (r.overtimeMinutes > 0) add(overtime, r.employeeId, r.overtimeMinutes);
  }

  // Leave days on each employee's working days (their shift's weekly offs and holidays excluded).
  const resolve = await shiftResolver(companyId, [...new Set(leaves.map((l) => l.employeeId))], monthStart, lastDay);
  const leave = new Map<string, number>();
  const unpaid = new Map<string, number>();
  for (const l of leaves) {
    const target = l.leaveType.isPaid ? leave : unpaid;
    const from = l.fromDate < monthStart ? monthStart : l.fromDate;
    const to = l.toDate < monthEnd ? l.toDate : lastDay;
    let days = 0;
    for (let d = from; d.getTime() <= to.getTime(); d = new Date(d.getTime() + DAY_MS)) {
      if (!isWeeklyOff(resolve(l.employeeId, d), d) && !holidays.has(isoDate(d))) days++;
    }
    if (l.halfDay) days = Math.min(days, 1) * 0.5;
    if (days > 0) add(target, l.employeeId, days);
  }

  const { workingDays } = workingDaysInfo;
  const employeeIds = new Set([...worked.keys(), ...leave.keys(), ...unpaid.keys(), ...absent.keys()]);
  const items = [...employeeIds].map((employeeId) => {
    const w = worked.get(employeeId) ?? 0;
    const lv = leave.get(employeeId) ?? 0;
    return {
      employeeId,
      worked: w,
      leave: lv,
      payable: Math.min(workingDays, w + lv),
      unpaidLeave: unpaid.get(employeeId) ?? 0,
      absent: absent.get(employeeId) ?? 0,
      late: late.get(employeeId) ?? 0,
      overtimeMinutes: overtime.get(employeeId) ?? 0,
    };
  });
  return { ...workingDaysInfo, items };
}

// ---- Exports ----

/** Month's attendance for the whole company as CSV (ADMIN/HR export). */
export async function exportMonthCsv(companyId: string, year: number, month: number): Promise<string> {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  const [records, shifts] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { companyId, date: { gte: from, lt: to } },
      include: { employee: { select: { employeeCode: true, name: true, department: true } } },
      orderBy: [{ date: 'asc' }, { employeeId: 'asc' }],
    }),
    prisma.shift.findMany({ where: { companyId }, select: { id: true, code: true } }),
  ]);
  const shiftCode = new Map(shifts.map((s) => [s.id, s.code]));
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const time = (d: Date | null) => (d ? d.toISOString().slice(11, 16) : '');
  const hours = (m: number | null) => (m == null ? '' : (m / 60).toFixed(2));
  const lines = [
    'Date,Employee Code,Name,Department,Status,Check In (UTC),Check Out (UTC),Distance (m),Note,Shift,Late (min),Worked (h),OT (h)',
    ...records.map((r) =>
      [
        r.date.toISOString().slice(0, 10),
        esc(r.employee.employeeCode),
        esc(r.employee.name),
        esc(r.employee.department),
        r.status,
        time(r.checkIn),
        time(r.checkOut),
        r.checkInDistance == null ? '' : String(Math.round(r.checkInDistance)),
        esc(r.note ?? ''),
        r.shiftId ? (shiftCode.get(r.shiftId) ?? '') : '',
        String(r.lateMinutes),
        hours(r.workedMinutes),
        r.overtimeMinutes ? hours(r.overtimeMinutes) : '',
      ].join(',')
    ),
  ];
  return lines.join('\n');
}

const MUSTER_CODE: Record<AttendanceStatus, string> = {
  PRESENT: 'P',
  LATE: 'P',
  ABSENT: 'A',
  LEAVE: 'L',
  HOLIDAY: 'H',
  WEEKEND: 'WO',
  HALF_DAY: 'HD',
};

/**
 * Monthly muster roll: employees × days with P / A / L / H / WO / HD and
 * totals (present, half days, absent, leave, late count, OT hours). Days
 * without a record show the expected WO / H, "-" when unmarked, blank in future.
 */
export async function musterCsv(companyId: string, year: number, month: number): Promise<string> {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  const today = dateOnlyUTC();
  const employees = await prisma.employee.findMany({
    where: {
      companyId,
      joiningDate: { lt: addDays(last, 1) },
      OR: [{ leavingDate: null }, { leavingDate: { gte: from } }],
      AND: [{ OR: [{ isActive: true }, { leavingDate: { gte: from } }] }],
    },
    select: { id: true, employeeCode: true, name: true, department: true, joiningDate: true, leavingDate: true },
    orderBy: [{ department: 'asc' }, { name: 'asc' }],
  });
  const ids = employees.map((e) => e.id);
  const [records, resolve, holidays] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { companyId, employeeId: { in: ids }, date: { gte: from, lte: last } },
      select: { employeeId: true, date: true, status: true, overtimeMinutes: true },
    }),
    shiftResolver(companyId, ids, from, last),
    holidayMap(companyId, from, last),
  ]);
  const byKey = new Map(records.map((r) => [`${r.employeeId}|${isoDate(r.date)}`, r]));
  const days: Date[] = [];
  for (let d = from; d.getTime() <= last.getTime(); d = addDays(d, 1)) days.push(d);

  const headers = [
    'Employee Code', 'Name', 'Department',
    ...days.map((d) => String(d.getUTCDate())),
    'Present', 'Half Days', 'Absent', 'Leave', 'Holidays', 'Week Offs', 'Late Count', 'OT Hours', 'Payable Days',
  ];
  const rows = employees.map((e) => {
    let present = 0, half = 0, absent = 0, leave = 0, hol = 0, wo = 0, late = 0, ot = 0;
    const joined = dateOnlyUTCOf(e.joiningDate);
    const cells = days.map((d) => {
      const rec = byKey.get(`${e.id}|${isoDate(d)}`);
      if (d.getTime() < joined.getTime() || (e.leavingDate && d.getTime() > e.leavingDate.getTime())) return '';
      if (rec) {
        if (rec.status === 'PRESENT' || rec.status === 'LATE') present++;
        if (rec.status === 'LATE') late++;
        if (rec.status === 'HALF_DAY') half++;
        if (rec.status === 'ABSENT') absent++;
        if (rec.status === 'LEAVE') leave++;
        if (rec.status === 'HOLIDAY') hol++;
        if (rec.status === 'WEEKEND') wo++;
        ot += rec.overtimeMinutes;
        return MUSTER_CODE[rec.status];
      }
      if (holidays.has(isoDate(d))) { hol++; return 'H'; }
      if (isWeeklyOff(resolve(e.id, d), d)) { wo++; return 'WO'; }
      return d.getTime() >= today.getTime() ? '' : '-';
    });
    return [
      e.employeeCode, e.name, e.department, ...cells,
      present, half, absent, leave, hol, wo, late, (ot / 60).toFixed(2), present + half * 0.5 + leave,
    ];
  });
  return toCsv(headers, rows);
}

// ---- Daily auto-marking (used by jobs/attendance.jobs.ts and the admin "run" endpoint) ----

/**
 * Creates the missing AttendanceRecords of `date` for every employee employed
 * that day: HOLIDAY / WEEKEND (shift weekly off) / LEAVE / ABSENT, flagged
 * isAutoMarked. Existing (punched or regularized) records are never touched,
 * so re-runs are safe. A half-day leave without a punch is LEAVE (0.5 leave
 * paid, the other half unpaid).
 */
export async function autoMarkDay(companyId: string, date: Date) {
  const day = dateOnlyUTCOf(date);
  const employees = await prisma.employee.findMany({
    where: {
      companyId,
      isActive: true,
      joiningDate: { lt: addDays(day, 1) },
      OR: [{ leavingDate: null }, { leavingDate: { gte: day } }],
    },
    select: { id: true },
  });
  if (employees.length === 0) return { date: isoDate(day), created: 0, absent: 0 };
  const ids = employees.map((e) => e.id);
  const [existing, resolve, holidays, leaves] = await Promise.all([
    prisma.attendanceRecord.findMany({ where: { companyId, date: day, employeeId: { in: ids } }, select: { employeeId: true } }),
    shiftResolver(companyId, ids, day, day),
    holidayMap(companyId, day, day),
    prisma.leaveRequest.findMany({
      where: { companyId, employeeId: { in: ids }, status: 'APPROVED', fromDate: { lte: day }, toDate: { gte: day } },
      select: { employeeId: true, halfDay: true, leaveType: { select: { code: true } } },
    }),
  ]);
  const marked = new Set(existing.map((r) => r.employeeId));
  const holiday = holidays.get(isoDate(day));
  const rows = ids
    .filter((id) => !marked.has(id))
    .map((employeeId) => {
      const shift = resolve(employeeId, day);
      const leave = leaves.find((l) => l.employeeId === employeeId);
      let status: AttendanceStatus = 'ABSENT';
      let note: string | null = null;
      if (holiday) {
        status = 'HOLIDAY';
        note = holiday;
      } else if (isWeeklyOff(shift, day)) status = 'WEEKEND';
      else if (leave) {
        status = 'LEAVE';
        note = leave.halfDay ? `${leave.leaveType.code} half-day leave · no punch for the other half` : leave.leaveType.code;
      }
      return { companyId, employeeId, date: day, status, note, shiftId: shift.id, isAutoMarked: true };
    });
  const created = await prisma.attendanceRecord.createMany({ data: rows, skipDuplicates: true });
  const absentees = rows.filter((r) => r.status === 'ABSENT').map((r) => r.employeeId);
  if (absentees.length) {
    await notify(companyId, absentees, {
      event: 'attendance.absent',
      title: 'Marked absent',
      body: `No punch was recorded on ${isoDate(day)}. Apply leave or request regularization if this is wrong.`,
      link: '/attendance',
    });
  }
  return { date: isoDate(day), created: created.count, absent: absentees.length };
}

/**
 * Closes records with a check-in but no check-out once the shift end plus
 * grace has passed: status HALF_DAY, note "Missed check-out" (the employee
 * can regularize). Only looks back a week.
 */
export async function closeMissedCheckouts(companyId: string, now = new Date()) {
  const tz = await companyTz(companyId);
  const today = localDateOf(now, tz);
  const open = await prisma.attendanceRecord.findMany({
    where: {
      companyId,
      checkIn: { not: null },
      checkOut: null,
      isAutoMarked: false,
      date: { gte: addDays(today, -7), lt: today },
    },
  });
  const closed: string[] = [];
  for (const r of open) {
    const shift = await recordShift(companyId, r);
    if (now.getTime() <= shiftWindow(shift, r.date, tz).end.getTime() + CHECKOUT_GRACE_MS) continue;
    await prisma.attendanceRecord.update({
      where: { id: r.id },
      data: {
        status: 'HALF_DAY',
        shiftId: shift.id,
        isAutoMarked: true,
        note: [r.note, MISSED_CHECKOUT_NOTE].filter(Boolean).join(' · '),
      },
    });
    closed.push(r.employeeId);
    await notify(companyId, [r.employeeId], {
      event: 'attendance.missed_checkout',
      title: 'Missed check-out',
      body: `You did not check out on ${isoDate(r.date)}; the day was marked half day. Request regularization to correct it.`,
      link: '/attendance',
    });
  }
  return { closed: closed.length };
}
