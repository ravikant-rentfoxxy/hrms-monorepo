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

export async function listProjects(companyId: string, includeInactive = false) {
  const projects = await prisma.project.findMany({
    where: { companyId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
    include: { _count: { select: { entries: true } } },
  });
  return projects.map(({ _count, ...p }) => ({ ...p, entryCount: _count.entries }));
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
