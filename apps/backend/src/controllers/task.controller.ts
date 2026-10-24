import { ApiError, h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow, isManagerial } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import * as taskService from '../services/task.service';
import type { TaskInput } from '../services/task.service';

export const list = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await taskService.listTasks(tenantId, employeeIdOrThrow(req)));
});

export const create = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { employeeId: requested, ...input } = req.body as TaskInput & { employeeId?: string };
  let employeeId = employeeIdOrThrow(req);
  if (requested && requested !== auth.employeeId) {
    if (!isManagerial(auth.role)) throw ApiError.forbidden();
    const target = await prisma.employee.findFirst({ where: { id: requested, companyId: tenantId } });
    if (!target) throw ApiError.badRequest('Employee not found in this company');
    // Managers assign to their direct reports; ADMIN / HR to anyone.
    if (auth.role === 'MANAGER' && target.managerId !== auth.employeeId) {
      throw ApiError.forbidden('Managers can only assign tasks to their direct reports');
    }
    employeeId = requested;
  }
  const task = await taskService.createTask(tenantId, employeeId, input);
  if (employeeId !== auth.employeeId) {
    await notify(tenantId, [employeeId], {
      event: 'task.assigned',
      title: 'New task assigned to you',
      body: `${task.title}${task.project ? ` (${task.project})` : ''}`,
      link: '/tasks',
    });
  }
  ok(res, task, 201);
});

export const update = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const task = await taskService.getTask(tenantId, req.params.id as string);
  if (task.employeeId !== auth.employeeId && !isManagerial(auth.role)) throw ApiError.forbidden();
  ok(res, await taskService.updateTask(tenantId, task.id, req.body as Partial<TaskInput>));
});

export const remove = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const task = await taskService.getTask(tenantId, req.params.id as string);
  if (task.employeeId !== auth.employeeId && !isManagerial(auth.role)) throw ApiError.forbidden();
  await taskService.deleteTask(tenantId, task.id);
  ok(res, { deleted: true });
});
