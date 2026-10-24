import type { Request } from 'express';
import { ApiError, h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow } from '../middleware/auth';
import * as performanceService from '../services/performance.service';
import type { FeedbackInput, GoalInput } from '../services/performance.service';
import { isHrAdmin } from '../services/talent.helpers';

/**
 * Self by default. ADMIN/HR may target anyone in the company; a MANAGER only
 * their direct reports.
 */
async function targetEmployee(req: Request, requested?: string): Promise<string> {
  const { auth, tenantId } = ctx(req);
  if (!requested || requested === auth.employeeId) return employeeIdOrThrow(req);
  await assertCanManage(req, tenantId, requested);
  return requested;
}

async function assertCanManage(req: Request, tenantId: string, employeeId: string): Promise<void> {
  const { auth } = ctx(req);
  if (isHrAdmin(auth.role)) return;
  if (auth.role === 'MANAGER' && auth.employeeId && (await performanceService.isManagerOf(tenantId, auth.employeeId, employeeId))) return;
  throw ApiError.forbidden('You can only manage goals of your direct reports');
}

export const listGoals = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const employeeId = await targetEmployee(req, typeof req.query.employeeId === 'string' ? req.query.employeeId : undefined);
  ok(res, await performanceService.listGoals(tenantId, employeeId));
});

export const createGoal = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { employeeId: requested, ...input } = req.body as GoalInput & { employeeId?: string };
  const employeeId = await targetEmployee(req, requested);
  ok(res, await performanceService.createGoal(tenantId, employeeId, input, auth.employeeId), 201);
});

export const updateGoal = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const goal = await performanceService.getGoal(tenantId, req.params.id as string);
  if (goal.employeeId !== auth.employeeId) await assertCanManage(req, tenantId, goal.employeeId);
  ok(res, await performanceService.updateGoal(tenantId, goal.id, req.body as Partial<GoalInput>));
});

export const deleteGoal = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const goal = await performanceService.getGoal(tenantId, req.params.id as string);
  if (goal.employeeId !== auth.employeeId) await assertCanManage(req, tenantId, goal.employeeId);
  await performanceService.deleteGoal(tenantId, goal.id);
  ok(res, { deleted: true });
});

export const teamGoals = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const department = typeof req.query.department === 'string' ? req.query.department : undefined;
  ok(
    res,
    await performanceService.teamGoals(tenantId, isHrAdmin(auth.role) ? { department } : { managerId: employeeIdOrThrow(req) })
  );
});

export const listFeedback = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const employeeId = await targetEmployee(req, typeof req.query.employeeId === 'string' ? req.query.employeeId : undefined);
  ok(res, await performanceService.listFeedback(tenantId, employeeId));
});

export const giveFeedback = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await performanceService.giveFeedback(tenantId, auth.employeeId, req.body as FeedbackInput), 201);
});
