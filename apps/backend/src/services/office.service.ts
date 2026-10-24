/** Geofence office locations used by attendance. */
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/http';
import { distanceMeters } from '../utils/geo';
import { ensureDefaultShift, isWeeklyOff } from './shift.service';

export interface OfficeInput {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  /** Working days per month — the payroll denominator. */
  workingDays?: number;
  /** Indian state — selects Professional Tax / LWF rules. */
  state?: string;
  city?: string;
  /** Metro city for the HRA exemption (50% vs 40% of basic). */
  isMetro?: boolean;
}

export interface WorkingDaysInfo {
  workingDays: number;
  /** 'auto' = calculated from the calendar; 'fixed' = HR's office norm. */
  source: 'auto' | 'fixed';
  calendarDays: number;
  /** Weekly-off days of the default shift (Sat/Sun unless configured otherwise). */
  weekendDays: number;
  holidayDays: number;
}

/**
 * The month's working days (payroll denominator). When the office norm is 0
 * ("auto"), it is calculated from the calendar:
 *   working days = days in month − weekly offs − holidays on working days
 * where weekly offs follow the company's default shift (Sat/Sun by default,
 * alternate Saturdays when configured). A fixed office norm (e.g. 26)
 * overrides the calculation for every month.
 */
export async function companyWorkingDays(companyId: string, year: number, month: number): Promise<WorkingDaysInfo> {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));
  const [office, holidays, shift] = await Promise.all([
    prisma.office.findFirst({ where: { companyId, isActive: true }, select: { workingDays: true } }),
    prisma.holiday.findMany({
      where: { companyId, optional: false, date: { gte: monthStart, lt: monthEnd } },
      select: { date: true },
    }),
    ensureDefaultShift(companyId),
  ]);

  const calendarDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let weekendDays = 0;
  for (let d = 1; d <= calendarDays; d++) {
    if (isWeeklyOff(shift, new Date(Date.UTC(year, month - 1, d)))) weekendDays++;
  }
  // Distinct holiday dates that fall on working days (holidays on a weekly off cost nothing).
  const holidayDates = new Set(
    holidays.filter((h) => !isWeeklyOff(shift, h.date)).map((h) => h.date.toISOString().slice(0, 10))
  );
  const holidayDays = holidayDates.size;

  const fixed = office?.workingDays ?? 0;
  return {
    workingDays: fixed > 0 ? fixed : calendarDays - weekendDays - holidayDays,
    source: fixed > 0 ? 'fixed' : 'auto',
    calendarDays,
    weekendDays,
    holidayDays,
  };
}

export async function listOffices(companyId: string) {
  return prisma.office.findMany({ where: { companyId, isActive: true }, orderBy: { name: 'asc' } });
}

export async function createOffice(companyId: string, input: OfficeInput) {
  // One geofenced location per company: edit or remove the existing one instead.
  const existing = await prisma.office.findFirst({ where: { companyId, isActive: true } });
  if (existing) {
    throw ApiError.conflict('This company already has an office location. Edit or remove it instead.');
  }
  return prisma.office.create({ data: { ...input, companyId } });
}

export async function updateOffice(companyId: string, id: string, data: Partial<OfficeInput> & { isActive?: boolean }) {
  const result = await prisma.office.updateMany({ where: { id, companyId }, data });
  if (result.count === 0) throw ApiError.notFound('Office not found');
  return prisma.office.findUnique({ where: { id } });
}

export async function deleteOffice(companyId: string, id: string): Promise<void> {
  const result = await prisma.office.deleteMany({ where: { id, companyId } });
  if (result.count === 0) throw ApiError.notFound('Office not found');
}

/**
 * Distance to the nearest active office; throws when outside every geofence.
 * Companies without offices get `{ distance: null }` (punch from anywhere).
 */
export async function checkGeofence(companyId: string, lat: number, lng: number) {
  const offices = await prisma.office.findMany({ where: { companyId, isActive: true } });
  if (offices.length === 0) return { distance: null as number | null, office: null as string | null };
  let best: { distance: number; office: (typeof offices)[number] } | null = null;
  for (const office of offices) {
    const d = distanceMeters(lat, lng, office.latitude, office.longitude);
    if (!best || d < best.distance) best = { distance: d, office };
  }
  const { distance, office } = best!;
  if (distance > office.radiusMeters) {
    throw ApiError.badRequest(
      `You are ${Math.round(distance)} m from ${office.name}; must be within ${office.radiusMeters} m to punch`
    );
  }
  return { distance, office: office.name };
}
