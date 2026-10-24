/** Personal tasks (self-created or assigned by managers). */
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/http';

export interface TaskInput {
  title: string;
  project?: string;
  due: Date;
  priority?: string;
}

export async function listTasks(companyId: string, employeeId: string) {
  return prisma.task.findMany({
    where: { companyId, employeeId },
    orderBy: [{ done: 'asc' }, { due: 'asc' }],
  });
}

export async function createTask(companyId: string, employeeId: string, input: TaskInput) {
  return prisma.task.create({ data: { ...input, companyId, employeeId } });
}

export async function getTask(companyId: string, id: string) {
  const task = await prisma.task.findFirst({ where: { id, companyId } });
  if (!task) throw ApiError.notFound('Task not found');
  return task;
}

export async function updateTask(companyId: string, id: string, data: Partial<TaskInput> & { done?: boolean }) {
  await getTask(companyId, id);
  return prisma.task.update({ where: { id }, data });
}

export async function deleteTask(companyId: string, id: string): Promise<void> {
  await getTask(companyId, id);
  await prisma.task.delete({ where: { id } });
}
