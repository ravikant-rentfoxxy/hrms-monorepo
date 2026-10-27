import { h, ok } from '../utils/http';
import { ctx } from '../middleware/auth';
import { audit, diff } from '../lib/audit';
import * as projectService from '../services/project.service';
import type { ProjectInput } from '../services/project.service';

export const list = h(async (req, res) => {
  const { tenantId, auth } = ctx(req);
  const { includeInactive, mine } = req.query as unknown as { includeInactive: boolean; mine: boolean };
  // `mine` (the timesheet) = only projects the caller may log hours on.
  ok(res, await projectService.listProjects(tenantId, { includeInactive, forEmployeeId: mine ? (auth.employeeId ?? '') : null }));
});

export const setMembers = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { employeeIds } = req.body as { employeeIds: string[] };
  const { before, after } = await projectService.setMembers(tenantId, req.params.id as string, employeeIds);
  await audit(req, { entity: 'Project', entityId: req.params.id as string, action: 'MEMBERS', before: { members: before }, after: { members: after } });
  ok(res, { members: after.length });
});

export const create = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const project = await projectService.createProject(tenantId, req.body as ProjectInput);
  await audit(req, { entity: 'Project', entityId: project.id, action: 'CREATE', after: project });
  ok(res, project, 201);
});

export const update = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const before = await projectService.getProject(tenantId, req.params.id as string);
  const after = await projectService.updateProject(tenantId, before.id, req.body as Partial<ProjectInput> & { isActive?: boolean });
  await audit(req, { entity: 'Project', entityId: before.id, action: 'UPDATE', ...diff(before, after) });
  ok(res, after);
});

export const remove = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const project = await projectService.deleteProject(tenantId, req.params.id as string);
  await audit(req, { entity: 'Project', entityId: project.id, action: 'DELETE', before: project });
  ok(res, { deleted: true });
});
