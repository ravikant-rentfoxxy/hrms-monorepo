/** Small helpers shared by the employee-lifecycle modules (onboarding, letters, assets, exit). */
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { dateOnlyUTC } from './geo';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today as a date-only value (midnight UTC), matching `@db.Date` columns. */
export const todayUTC = (): Date => dateOnlyUTC();

export const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * DAY_MS);

/** Whole calendar days from `a` to `b` (date parts only; negative when b is before a). */
export function daysBetween(a: Date, b: Date): number {
  const ua = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const ub = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((ub - ua) / DAY_MS);
}

/** Midnight UTC of the given instant's UTC date. */
export const dateOnly = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** ADMIN / HR (and the platform super admin) administer the company. */
export const isCompanyAdmin = (role: Role): boolean => role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR';

/** "19 October 2026" — the long form used in letters. */
export const longDate = (d: Date | null | undefined): string =>
  d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';

/** "Rs. 1,23,456" (Indian grouping). */
export const inr = (n: number): string => `Rs. ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Active employee ids holding one of the given company roles (notification recipients). */
export async function employeeIdsWithRoles(companyId: string, roles: Role[] = ['ADMIN', 'HR']): Promise<string[]> {
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

/** Monthly gross from the Employee salary columns (employer PF excluded). */
export const monthlyGross = (e: {
  salaryBasic: number;
  salaryHra: number;
  salaryConveyance: number;
  salaryMedical: number;
  salaryAllowance: number;
}): number => e.salaryBasic + e.salaryHra + e.salaryConveyance + e.salaryMedical + e.salaryAllowance;
