/** Platform-level (super admin) business logic: tenants and their members. */
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/http';
import { hashPassword } from '../utils/crypto';

export const DEFAULT_LEAVE_TYPES = [
  { code: 'CL', name: 'Casual Leave', totalPerYear: 12, color: '#0EA5E9' },
  { code: 'SL', name: 'Sick Leave', totalPerYear: 10, color: '#F59E0B' },
  { code: 'EL', name: 'Earned Leave', totalPerYear: 15, color: '#16A34A' },
  { code: 'WFH', name: 'Work From Home', totalPerYear: 24, color: '#7C3AED' },
];

export interface CompanyInput {
  name: string;
  /** Optional — when omitted, the next sequential code (Code-01, Code-02, …) is generated. */
  code?: string;
  email?: string;
  phone?: string;
  address?: string;
  timezone?: string;
  workStart?: string;
}

/** Next code in the Code-01 pattern, based on the highest existing one. */
async function nextCompanyCode(): Promise<string> {
  const companies = await prisma.company.findMany({ select: { code: true } });
  let max = 0;
  for (const company of companies) {
    const match = /^code-(\d+)$/i.exec(company.code);
    if (match) max = Math.max(max, parseInt(match[1]!, 10));
  }
  return `Code-${String(max + 1).padStart(2, '0')}`;
}

export async function listCompanies() {
  return prisma.company.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { employees: true, memberships: true } } },
  });
}

export async function createCompany(input: CompanyInput) {
  // Retry on the (unlikely) race where two creations generate the same code.
  for (let attempt = 1; ; attempt++) {
    const code = input.code ?? (await nextCompanyCode());
    try {
      return await prisma.company.create({
        data: { ...input, code, leaveTypes: { create: DEFAULT_LEAVE_TYPES } },
      });
    } catch (error) {
      const isDuplicateCode =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!isDuplicateCode || input.code || attempt >= 3) throw error;
    }
  }
}

export async function getCompany(id: string) {
  const company = await prisma.company.findUnique({
    where: { id },
    include: { _count: { select: { employees: true, memberships: true, offices: true } } },
  });
  if (!company) throw ApiError.notFound('Company not found');
  return company;
}

export async function updateCompany(id: string, data: Partial<CompanyInput> & { isActive?: boolean }) {
  await getCompany(id); // 404 instead of a Prisma error
  return prisma.company.update({ where: { id }, data });
}

export async function deleteCompany(id: string): Promise<void> {
  await getCompany(id);
  await prisma.company.delete({ where: { id } });
}

export interface GrantMembershipInput {
  email: string;
  role: 'ADMIN' | 'HR' | 'MANAGER' | 'EMPLOYEE';
  password?: string;
  name?: string;
  employeeCode?: string;
  designation?: string;
  department?: string;
}

/**
 * Grant any user access to a company. If the email is new, a user account is
 * created (password required); if it already exists — e.g. an admin of
 * another company — a membership and an employee profile in this company are
 * added, so one person can work across multiple tenants.
 */
export async function grantMembership(companyId: string, input: GrantMembershipInput) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw ApiError.notFound('Company not found');
  const { email, role, password, name, employeeCode, designation = 'Administrator', department = 'Management' } = input;

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    if (!password) throw ApiError.badRequest('password is required for a new user');
    if (!name) throw ApiError.badRequest('name is required for a new user');
    user = await prisma.user.create({ data: { email, passwordHash: await hashPassword(password), role } });
  } else if (user.role === 'SUPER_ADMIN') {
    throw ApiError.badRequest('The super admin does not need company memberships');
  }

  const membership = await prisma.membership.upsert({
    where: { userId_companyId: { userId: user.id, companyId } },
    create: { userId: user.id, companyId, role },
    update: { role, isActive: true },
  });

  let employee = await prisma.employee.findUnique({
    where: { userId_companyId: { userId: user.id, companyId } },
  });
  if (!employee) {
    const code = employeeCode ?? `M-${Date.now() % 1000000}`;
    employee = await prisma.employee.create({
      data: { companyId, userId: user.id, employeeCode: code, name: name ?? email.split('@')[0] ?? email, designation, department },
    });
  } else if (!employee.isActive) {
    employee = await prisma.employee.update({ where: { id: employee.id }, data: { isActive: true } });
  }

  return { user: { id: user.id, email: user.email }, membership, employee };
}

export async function listMembers(companyId: string) {
  return prisma.membership.findMany({
    where: { companyId },
    include: { user: { select: { id: true, email: true, isActive: true, lastLoginAt: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

/** Revoke a user's access to a company (their other memberships keep working). */
export async function revokeMembership(companyId: string, userId: string) {
  const membership = await prisma.membership.findUnique({
    where: { userId_companyId: { userId, companyId } },
  });
  if (!membership) throw ApiError.notFound('Membership not found');
  await prisma.$transaction([
    prisma.membership.update({ where: { id: membership.id }, data: { isActive: false } }),
    prisma.employee.updateMany({ where: { userId, companyId }, data: { isActive: false } }),
    // Force re-login so tokens scoped to this company stop working at refresh.
    prisma.user.update({ where: { id: userId }, data: { refreshTokenHash: null } }),
  ]);
  return membership;
}

export async function platformStats() {
  const [companies, activeCompanies, users, employees] = await Promise.all([
    prisma.company.count(),
    prisma.company.count({ where: { isActive: true } }),
    prisma.user.count(),
    prisma.employee.count(),
  ]);
  return { companies, activeCompanies, users, employees };
}
