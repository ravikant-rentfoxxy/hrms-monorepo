/** Small people lookups shared by the engagement / platform services (notification recipients, week maths). */
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';

/** Active employees of a company whose membership holds one of `roles` (e.g. HR + ADMIN for finance notices). */
export async function employeeIdsWithRoles(companyId: string, roles: Role[]): Promise<string[]> {
  const members = await prisma.membership.findMany({
    where: { companyId, role: { in: roles }, isActive: true },
    select: { userId: true },
  });
  if (members.length === 0) return [];
  const emps = await prisma.employee.findMany({
    where: { companyId, isActive: true, userId: { in: members.map((m) => m.userId) } },
    select: { id: true },
  });
  return emps.map((e) => e.id);
}

/** Date-only (midnight UTC) from the UTC calendar parts of `d`. */
export function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Monday (midnight UTC) of the week containing `d`. */
export function mondayOf(d: Date): Date {
  const day = utcDay(d);
  const offset = (day.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  day.setUTCDate(day.getUTCDate() - offset);
  return day;
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/** "2026-10-19" */
export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** First day (midnight UTC) of the month given as "YYYY-MM". */
export function monthStart(key: string): Date {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1));
}
