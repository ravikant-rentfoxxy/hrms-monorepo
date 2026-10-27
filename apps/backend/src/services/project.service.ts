/** Projects that timesheet hours are booked against (with a billable default). */
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/http';

export interface ProjectInput {
  name: string;
  code: string;
  client?: string;
  isBillable?: boolean;
}

/** A project is open to everyone until it has members; then only they may book hours on it. */
export const openToEmployee = (employeeId: string): Prisma.ProjectWhereInput => ({
  OR: [{ members: { none: {} } }, { members: { some: { employeeId } } }],
});

/**
 * `forEmployeeId` limits the list to projects that employee may log hours on
 * (the timesheet). Without it — the Projects page — every project is listed.
 */
export async function listProjects(companyId: string, opts: { includeInactive?: boolean; forEmployeeId?: string | null } = {}) {
  const projects = await prisma.project.findMany({
    where: {
      companyId,
      ...(opts.includeInactive ? {} : { isActive: true }),
      ...(opts.forEmployeeId ? openToEmployee(opts.forEmployeeId) : {}),
    },
    orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
    include: {
      _count: { select: { entries: true } },
      members: { select: { employee: { select: { id: true, name: true, employeeCode: true } } }, orderBy: { addedAt: 'asc' } },
    },
  });
  return projects.map(({ _count, members, ...p }) => ({ ...p, entryCount: _count.entries, members: members.map((m) => m.employee) }));
}

/** Replaces the project's member list (empty list = open to everyone again). */
export async function setMembers(companyId: string, projectId: string, employeeIds: string[]) {
  await getProject(companyId, projectId);
  const ids = [...new Set(employeeIds)];
  const valid = await prisma.employee.findMany({ where: { companyId, id: { in: ids } }, select: { id: true } });
  if (valid.length !== ids.length) throw ApiError.badRequest('Some employees were not found in this company');
  const before = await prisma.projectMember.findMany({ where: { projectId }, select: { employeeId: true } });
  await prisma.$transaction([
    prisma.projectMember.deleteMany({ where: { projectId, employeeId: { notIn: ids } } }),
    prisma.projectMember.createMany({ data: ids.map((employeeId) => ({ companyId, projectId, employeeId })), skipDuplicates: true }),
  ]);
  return { before: before.map((m) => m.employeeId), after: ids };
}

export async function getProject(companyId: string, id: string) {
  const project = await prisma.project.findFirst({ where: { id, companyId } });
  if (!project) throw ApiError.notFound('Project not found');
  return project;
}

function duplicateCode(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function createProject(companyId: string, input: ProjectInput) {
  try {
    return await prisma.project.create({ data: { ...input, companyId } });
  } catch (error) {
    if (duplicateCode(error)) throw ApiError.conflict(`Project code ${input.code} is already in use`);
    throw error;
  }
}

export async function updateProject(companyId: string, id: string, data: Partial<ProjectInput> & { isActive?: boolean }) {
  await getProject(companyId, id);
  try {
    return await prisma.project.update({ where: { id }, data });
  } catch (error) {
    if (duplicateCode(error)) throw ApiError.conflict(`Project code ${data.code ?? ''} is already in use`);
    throw error;
  }
}

/** Hard delete only while no hours are booked; otherwise the project must be deactivated (keeps history). */
export async function deleteProject(companyId: string, id: string) {
  const project = await getProject(companyId, id);
  const used = await prisma.timesheetEntry.count({ where: { companyId, projectId: id } });
  if (used > 0) {
    throw ApiError.conflict(`${project.code} has ${used} timesheet entr${used === 1 ? 'y' : 'ies'} — deactivate it instead`);
  }
  await prisma.project.delete({ where: { id } });
  return project;
}
