/** Performance: goals and 360° feedback. */
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';

export interface GoalInput {
  title: string;
  description?: string;
  dueDate: Date;
  category?: string;
  weightage?: number;
}

export async function listGoals(companyId: string, employeeId: string) {
  return prisma.goal.findMany({ where: { companyId, employeeId }, orderBy: { dueDate: 'asc' } });
}

/** `createdById` ≠ employeeId means a manager / HR set the goal — the employee is told. */
export async function createGoal(companyId: string, employeeId: string, input: GoalInput, createdById: string | null = null) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId } });
  if (!employee) throw ApiError.badRequest('Employee not found in this company');
  const goal = await prisma.goal.create({ data: { ...input, companyId, employeeId } });
  if (createdById && createdById !== employeeId) {
    await notify(companyId, [employeeId], {
      event: 'goal.assigned',
      title: 'New goal assigned',
      body: `"${goal.title}" was added to your goals (due ${goal.dueDate.toISOString().slice(0, 10)}).`,
      link: '/performance',
    });
  }
  return goal;
}

export async function isManagerOf(companyId: string, managerId: string, employeeId: string): Promise<boolean> {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { managerId: true } });
  return employee?.managerId === managerId;
}

/** Weighted progress (0..1) of a goal list. */
export function weightedProgress(goals: { progress: number; weightage: number }[]): number {
  const total = goals.reduce((s, g) => s + g.weightage, 0);
  return total === 0 ? 0 : goals.reduce((s, g) => s + g.progress * g.weightage, 0) / total;
}

/** Team view: each employee with their goals and weighted progress. */
export async function teamGoals(companyId: string, scope: { managerId?: string; department?: string }) {
  const employees = await prisma.employee.findMany({
    where: {
      companyId,
      isActive: true,
      ...(scope.managerId ? { managerId: scope.managerId } : {}),
      ...(scope.department ? { department: scope.department } : {}),
    },
    select: {
      id: true, name: true, designation: true, department: true, avatarColor: true,
      goals: { orderBy: { dueDate: 'asc' } },
    },
    orderBy: { name: 'asc' },
  });
  const today = new Date();
  return employees.map(({ goals, ...e }) => ({
    employee: e,
    goals,
    progress: weightedProgress(goals),
    overdue: goals.filter((g) => g.progress < 1 && g.dueDate < today).length,
  }));
}

export async function getGoal(companyId: string, id: string) {
  const goal = await prisma.goal.findFirst({ where: { id, companyId } });
  if (!goal) throw ApiError.notFound('Goal not found');
  return goal;
}

export async function updateGoal(companyId: string, id: string, data: Partial<GoalInput> & { progress?: number }) {
  await getGoal(companyId, id);
  return prisma.goal.update({ where: { id }, data });
}

export async function deleteGoal(companyId: string, id: string): Promise<void> {
  await getGoal(companyId, id);
  await prisma.goal.delete({ where: { id } });
}

export interface FeedbackInput {
  employeeId: string; // who the feedback is about
  message: string;
  rating: number;
  fromRole?: string;
}

export async function listFeedback(companyId: string, employeeId: string) {
  return prisma.feedback.findMany({
    where: { companyId, employeeId },
    include: { fromEmployee: { select: { id: true, name: true, designation: true } } },
    orderBy: { date: 'desc' },
  });
}

export async function giveFeedback(companyId: string, fromEmployeeId: string | null, input: FeedbackInput) {
  if (input.employeeId === fromEmployeeId) throw ApiError.badRequest('Cannot give feedback to yourself');
  const about = await prisma.employee.findFirst({ where: { id: input.employeeId, companyId } });
  if (!about) throw ApiError.badRequest('Employee not found in this company');
  const from = fromEmployeeId
    ? await prisma.employee.findUnique({ where: { id: fromEmployeeId }, select: { id: true, name: true } })
    : null;
  return prisma.feedback.create({
    data: {
      companyId,
      employeeId: input.employeeId,
      fromEmployeeId: from?.id ?? null,
      fromName: from?.name ?? 'Anonymous',
      fromRole: input.fromRole ?? 'Peer',
      message: input.message,
      rating: input.rating,
    },
  });
}
