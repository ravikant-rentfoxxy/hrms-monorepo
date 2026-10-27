/**
 * Shifts, shift assignments and weekly offs.
 *
 * Every employee works the shift assigned to them for a date (ShiftAssignment
 * covering it) or else the company's default shift. A company always has
 * exactly one default; a "GEN" General shift is created from Company.workStart
 * the first time one is needed.
 *
 *   const shift = await resolveShift(companyId, employeeId, date);
 *   if (isWeeklyOff(shift, date)) ...
 */
import { Prisma, type Shift } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/http';
import { addDays, fromMinutes, isoDate, toMinutes } from '../utils/tz';

export interface ShiftInput {
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  graceMinutes?: number;
  breakMinutes?: number;
  fullDayMinutes?: number;
  halfDayMinutes?: number;
  overtimeAfterMinutes?: number;
  isNight?: boolean;
  weeklyOffs?: string;
  altSaturdaysOff?: string;
  color?: string;
  isDefault?: boolean;
  isActive?: boolean;
}

// ---- Pure helpers ----

const csvInts = (csv: string): number[] =>
  csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map(Number)
    .filter((n) => Number.isInteger(n));

/** Night shifts (or any shift whose end is not after its start) end the next calendar day. */
export function crossesMidnight(shift: Pick<Shift, 'isNight' | 'startTime' | 'endTime'>): boolean {
  return shift.isNight || toMinutes(shift.endTime) <= toMinutes(shift.startTime);
}

/** Scheduled shift length in minutes (start → end, including the break). */
export function shiftLengthMinutes(shift: Pick<Shift, 'isNight' | 'startTime' | 'endTime'>): number {
  const len = toMinutes(shift.endTime) - toMinutes(shift.startTime);
  return crossesMidnight(shift) ? len + 1440 : len;
}

/**
 * True when `date` is a weekly off for the shift. Saturdays follow
 * `altSaturdaysOff` when it is set ("2,4" = only the 2nd and 4th Saturdays
 * are off, the others are working days); otherwise `weeklyOffs` decides.
 */
export function isWeeklyOff(shift: Pick<Shift, 'weeklyOffs' | 'altSaturdaysOff'>, date: Date): boolean {
  const weekday = date.getUTCDay();
  const alt = csvInts(shift.altSaturdaysOff);
  if (weekday === 6 && alt.length > 0) return alt.includes(Math.ceil(date.getUTCDate() / 7));
  return csvInts(shift.weeklyOffs).includes(weekday);
}

/** Overtime threshold in worked minutes (0 on the shift = beyond a full day). */
export const overtimeThreshold = (shift: Pick<Shift, 'overtimeAfterMinutes' | 'fullDayMinutes'>): number =>
  shift.overtimeAfterMinutes > 0 ? shift.overtimeAfterMinutes : shift.fullDayMinutes;

/** Compact shape for API payloads (calendar, today). */
export const shiftSummary = (s: Shift) => ({
  id: s.id,
  name: s.name,
  code: s.code,
  startTime: s.startTime,
  endTime: s.endTime,
  graceMinutes: s.graceMinutes,
  breakMinutes: s.breakMinutes,
  fullDayMinutes: s.fullDayMinutes,
  halfDayMinutes: s.halfDayMinutes,
  isNight: crossesMidnight(s),
  color: s.color,
});

function validateShape(s: Pick<Shift, 'fullDayMinutes' | 'halfDayMinutes' | 'startTime' | 'endTime' | 'isNight' | 'breakMinutes'>) {
  if (s.halfDayMinutes > s.fullDayMinutes) throw ApiError.badRequest('Half-day minutes cannot exceed full-day minutes');
  if (s.startTime === s.endTime) throw ApiError.badRequest('Shift start and end cannot be the same');
  if (!s.isNight && toMinutes(s.endTime) < toMinutes(s.startTime)) {
    throw ApiError.badRequest('End time is before start time — mark it as a night shift if it ends the next day');
  }
  if (s.breakMinutes >= shiftLengthMinutes(s)) throw ApiError.badRequest('Break is longer than the shift');
}

// ---- Shift masters ----

/** The company's default shift; creates "GEN" (General, workStart + 9h) when none exists. */
export async function ensureDefaultShift(companyId: string): Promise<Shift> {
  const existing = await prisma.shift.findFirst({ where: { companyId, isDefault: true, isActive: true } });
  if (existing) return existing;

  const gen = await prisma.shift.findUnique({ where: { companyId_code: { companyId, code: 'GEN' } } });
  if (gen) {
    return prisma.shift.update({ where: { id: gen.id }, data: { isDefault: true, isActive: true } });
  }
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { workStart: true } });
  const start = /^\d{2}:\d{2}$/.test(company?.workStart ?? '') ? (company?.workStart as string) : '09:30';
  try {
    return await prisma.shift.create({
      data: {
        companyId,
        name: 'General',
        code: 'GEN',
        startTime: start,
        endTime: fromMinutes(toMinutes(start) + 9 * 60),
        isDefault: true,
      },
    });
  } catch (err) {
    // Another request created it concurrently.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return prisma.shift.findUniqueOrThrow({ where: { companyId_code: { companyId, code: 'GEN' } } });
    }
    throw err;
  }
}

export async function listShifts(companyId: string, includeInactive = false) {
  await ensureDefaultShift(companyId);
  const shifts = await prisma.shift.findMany({
    where: { companyId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ isDefault: 'desc' }, { startTime: 'asc' }, { name: 'asc' }],
  });
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const counts = await prisma.shiftAssignment.groupBy({
    by: ['shiftId'],
    where: { companyId, fromDate: { lte: today }, OR: [{ toDate: null }, { toDate: { gte: today } }] },
    _count: { _all: true },
  });
  const byShift = new Map(counts.map((c) => [c.shiftId, c._count._all]));
  return shifts.map((s) => ({ ...s, isNight: crossesMidnight(s), assignedNow: byShift.get(s.id) ?? 0 }));
}

export async function getShift(companyId: string, id: string): Promise<Shift> {
  const shift = await prisma.shift.findFirst({ where: { id, companyId } });
  if (!shift) throw ApiError.notFound('Shift not found');
  return shift;
}

export async function createShift(companyId: string, input: ShiftInput) {
  const code = input.code.trim().toUpperCase();
  const dup = await prisma.shift.findUnique({ where: { companyId_code: { companyId, code } } });
  if (dup) throw ApiError.conflict(`A shift with code ${code} already exists`);
  const data = {
    ...input,
    code,
    graceMinutes: input.graceMinutes ?? 10,
    breakMinutes: input.breakMinutes ?? 60,
    fullDayMinutes: input.fullDayMinutes ?? 480,
    halfDayMinutes: input.halfDayMinutes ?? 240,
    isNight: input.isNight ?? false,
  };
  validateShape(data);
  return prisma.$transaction(async (tx) => {
    if (input.isDefault) await tx.shift.updateMany({ where: { companyId, isDefault: true }, data: { isDefault: false } });
    return tx.shift.create({ data: { ...data, companyId, isActive: true } });
  });
}

export async function updateShift(companyId: string, id: string, input: Partial<ShiftInput>) {
  const before = await getShift(companyId, id);
  const code = input.code?.trim().toUpperCase();
  if (code && code !== before.code) {
    const dup = await prisma.shift.findUnique({ where: { companyId_code: { companyId, code } } });
    if (dup) throw ApiError.conflict(`A shift with code ${code} already exists`);
  }
  if (before.isDefault && input.isDefault === false) {
    throw ApiError.badRequest('Make another shift the default instead of un-setting this one');
  }
  if (before.isDefault && input.isActive === false) throw ApiError.badRequest('The default shift cannot be deactivated');
  const merged = { ...before, ...input, ...(code ? { code } : {}) };
  validateShape(merged);
  const after = await prisma.$transaction(async (tx) => {
    if (input.isDefault && !before.isDefault) {
      await tx.shift.updateMany({ where: { companyId, isDefault: true }, data: { isDefault: false } });
    }
    return tx.shift.update({
      where: { id },
      data: { ...input, ...(code ? { code } : {}), ...(input.isDefault ? { isActive: true } : {}) },
    });
  });
  return { before, after };
}

/**
 * Deletes an unused shift. A shift with assignment history or attendance
 * stamped with it is deactivated instead, so past records keep their meaning.
 */
export async function deleteShift(companyId: string, id: string) {
  const shift = await getShift(companyId, id);
  if (shift.isDefault) throw ApiError.badRequest('The default shift cannot be deleted — make another shift the default first');
  const [assignments, records] = await Promise.all([
    prisma.shiftAssignment.count({ where: { companyId, shiftId: id } }),
    prisma.attendanceRecord.count({ where: { companyId, shiftId: id } }),
  ]);
  if (assignments > 0 || records > 0) {
    await prisma.shift.update({ where: { id }, data: { isActive: false } });
    return { deleted: false, deactivated: true, shift };
  }
  await prisma.shift.delete({ where: { id } });
  return { deleted: true, deactivated: false, shift };
}

// ---- Resolution ----

/** The shift an employee works on `date`: covering assignment, else the company default. */
export async function resolveShift(companyId: string, employeeId: string, date: Date): Promise<Shift> {
  const assignment = await prisma.shiftAssignment.findFirst({
    where: { companyId, employeeId, fromDate: { lte: date }, OR: [{ toDate: null }, { toDate: { gte: date } }] },
    orderBy: [{ fromDate: 'desc' }, { createdAt: 'desc' }],
    include: { shift: true },
  });
  return assignment?.shift ?? ensureDefaultShift(companyId);
}

export type ShiftResolver = (employeeId: string, date: Date) => Shift;

/**
 * Bulk version of resolveShift for many employees over a date range
 * (one query) — used by the daily job, muster and payroll.
 */
export async function shiftResolver(companyId: string, employeeIds: string[], from: Date, to: Date): Promise<ShiftResolver> {
  const [fallback, assignments] = await Promise.all([
    ensureDefaultShift(companyId),
    prisma.shiftAssignment.findMany({
      where: {
        companyId,
        employeeId: { in: employeeIds },
        fromDate: { lte: to },
        OR: [{ toDate: null }, { toDate: { gte: from } }],
      },
      orderBy: [{ fromDate: 'desc' }, { createdAt: 'desc' }],
      include: { shift: true },
    }),
  ]);
  const byEmployee = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const list = byEmployee.get(a.employeeId) ?? [];
    list.push(a);
    byEmployee.set(a.employeeId, list);
  }
  return (employeeId, date) => {
    const hit = byEmployee
      .get(employeeId)
      ?.find((a) => a.fromDate.getTime() <= date.getTime() && (!a.toDate || a.toDate.getTime() >= date.getTime()));
    return hit?.shift ?? fallback;
  };
}

/** Non-optional company holidays in [from, to], keyed by ISO date → name. */
export async function holidayMap(companyId: string, from: Date, to: Date): Promise<Map<string, string>> {
  const holidays = await prisma.holiday.findMany({
    where: { companyId, optional: false, date: { gte: from, lte: to } },
    select: { date: true, name: true },
  });
  return new Map(holidays.map((h) => [isoDate(h.date), h.name]));
}

export interface DayInfo {
  shift: Shift;
  isWeeklyOff: boolean;
  holiday: string | null;
  /** Not a weekly off and not a company holiday. */
  isWorkingDay: boolean;
}

/** Shift + weekly-off + holiday status of one employee-day. */
export async function dayInfo(companyId: string, employeeId: string, date: Date): Promise<DayInfo> {
  const [shift, holidays] = await Promise.all([resolveShift(companyId, employeeId, date), holidayMap(companyId, date, date)]);
  const off = isWeeklyOff(shift, date);
  const holiday = holidays.get(isoDate(date)) ?? null;
  return { shift, isWeeklyOff: off, holiday, isWorkingDay: !off && !holiday };
}

/** True when the employee is expected to work on `date` (shift weekly offs + holidays). */
export async function isWorkingDay(companyId: string, employeeId: string, date: Date): Promise<boolean> {
  return (await dayInfo(companyId, employeeId, date)).isWorkingDay;
}

/** Working days of an employee in [from, to] (inclusive), per their shifts and holidays. */
export async function countWorkingDays(companyId: string, employeeId: string, from: Date, to: Date): Promise<number> {
  const [resolve, holidays] = await Promise.all([
    shiftResolver(companyId, [employeeId], from, to),
    holidayMap(companyId, from, to),
  ]);
  let n = 0;
  for (let d = from; d.getTime() <= to.getTime(); d = addDays(d, 1)) {
    if (!isWeeklyOff(resolve(employeeId, d), d) && !holidays.has(isoDate(d))) n++;
  }
  return n;
}

// ---- Assignments ----

export interface AssignInput {
  shiftId: string;
  employeeIds: string[];
  fromDate: Date;
  toDate?: Date | null;
}

/**
 * Assigns a shift to many employees for a date range (open-ended when toDate
 * is empty). Existing assignments overlapping the range are trimmed or split,
 * so every employee-day resolves to exactly one shift.
 */
export async function assignShift(companyId: string, input: AssignInput) {
  const shift = await getShift(companyId, input.shiftId);
  if (!shift.isActive) throw ApiError.badRequest('This shift is inactive');
  const from = input.fromDate;
  const to = input.toDate ?? null;
  if (to && to.getTime() < from.getTime()) throw ApiError.badRequest('End date is before start date');
  const employeeIds = [...new Set(input.employeeIds)];
  const found = await prisma.employee.count({ where: { companyId, id: { in: employeeIds } } });
  if (found !== employeeIds.length) throw ApiError.badRequest('One or more employees were not found');

  const FAR = new Date(Date.UTC(9999, 0, 1));
  const end = to ?? FAR;
  await prisma.$transaction(async (tx) => {
    const overlapping = await tx.shiftAssignment.findMany({
      where: {
        companyId,
        employeeId: { in: employeeIds },
        fromDate: { lte: end },
        OR: [{ toDate: null }, { toDate: { gte: from } }],
      },
    });
    for (const a of overlapping) {
      const aEnd = a.toDate ?? FAR;
      const startsBefore = a.fromDate.getTime() < from.getTime();
      const endsAfter = aEnd.getTime() > end.getTime();
      if (startsBefore && endsAfter) {
        // Split: keep the head, re-create the tail after the new range.
        await tx.shiftAssignment.update({ where: { id: a.id }, data: { toDate: addDays(from, -1) } });
        await tx.shiftAssignment.create({
          data: { companyId, employeeId: a.employeeId, shiftId: a.shiftId, fromDate: addDays(end, 1), toDate: a.toDate },
        });
      } else if (startsBefore) {
        await tx.shiftAssignment.update({ where: { id: a.id }, data: { toDate: addDays(from, -1) } });
      } else if (endsAfter) {
        await tx.shiftAssignment.update({ where: { id: a.id }, data: { fromDate: addDays(end, 1) } });
      } else {
        await tx.shiftAssignment.delete({ where: { id: a.id } });
      }
    }
    await tx.shiftAssignment.createMany({
      data: employeeIds.map((employeeId) => ({ companyId, employeeId, shiftId: shift.id, fromDate: from, toDate: to })),
    });
  });
  return { assigned: employeeIds.length, shift: shiftSummary(shift), fromDate: from, toDate: to };
}

export async function listAssignments(
  companyId: string,
  filter: { employeeId?: string; shiftId?: string; from?: Date; to?: Date }
) {
  return prisma.shiftAssignment.findMany({
    where: {
      companyId,
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      ...(filter.shiftId ? { shiftId: filter.shiftId } : {}),
      ...(filter.to ? { fromDate: { lte: filter.to } } : {}),
      ...(filter.from ? { OR: [{ toDate: null }, { toDate: { gte: filter.from } }] } : {}),
    },
    include: {
      shift: { select: { id: true, name: true, code: true, color: true, startTime: true, endTime: true } },
      employee: { select: { id: true, name: true, employeeCode: true, department: true } },
    },
    orderBy: [{ fromDate: 'desc' }],
    take: 500,
  });
}

export async function deleteAssignment(companyId: string, id: string) {
  const a = await prisma.shiftAssignment.findFirst({ where: { id, companyId } });
  if (!a) throw ApiError.notFound('Assignment not found');
  await prisma.shiftAssignment.delete({ where: { id } });
  return a;
}
