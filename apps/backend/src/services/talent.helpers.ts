/**
 * Small helpers shared by the talent modules (recruitment, reviews,
 * training, surveys): who is acting, who the company admins are, date math.
 */
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/http';
import { dateOnlyUTC } from '../utils/geo';

/** The caller, as the services see it. */
export interface Actor {
  role: Role;
  employeeId: string | null;
}

/** ADMIN / HR (and the platform super admin acting in a tenant). */
export const isHrAdmin = (role: Role): boolean => role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR';

export function requireEmployee(actor: Actor): string {
  if (!actor.employeeId) throw ApiError.forbidden('This account has no employee profile');
  return actor.employeeId;
}

/** Employee ids of the company's active ADMIN / HR members (notification recipients). */
export async function hrEmployeeIds(companyId: string): Promise<string[]> {
  const memberships = await prisma.membership.findMany({
    where: { companyId, isActive: true, role: { in: ['ADMIN', 'HR'] } },
    select: { userId: true },
  });
  if (memberships.length === 0) return [];
  const employees = await prisma.employee.findMany({
    where: { companyId, isActive: true, userId: { in: memberships.map((m) => m.userId) } },
    select: { id: true },
  });
  return employees.map((e) => e.id);
}

/** Throws unless the employee exists (and is active) in the company. */
export async function assertEmployee(companyId: string, employeeId: string, label = 'Employee') {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId, isActive: true },
    select: { id: true, name: true, managerId: true, department: true, designation: true },
  });
  if (!employee) throw ApiError.badRequest(`${label} not found in this company`);
  return employee;
}

/** Active companies — the periodic jobs loop over these. */
export async function activeCompanyIds(): Promise<string[]> {
  const companies = await prisma.company.findMany({ where: { isActive: true }, select: { id: true } });
  return companies.map((c) => c.id);
}

/** Midnight-UTC date `days` after `from` (date-only columns). */
export function addDays(from: Date, days: number): Date {
  const d = dateOnlyUTC(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Whole days between two instants (b − a), rounded down. */
export function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

/** Name lookup for a set of employee ids (ids that don't resolve are left out). */
export async function employeeNames(companyId: string, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map<string, { id: string; name: string; designation: string }>();
  const rows = await prisma.employee.findMany({
    where: { companyId, id: { in: unique } },
    select: { id: true, name: true, designation: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}
