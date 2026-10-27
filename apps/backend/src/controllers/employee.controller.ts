import type { Request } from 'express';
import { ApiError, h, ok } from '../utils/http';
import { ctx } from '../middleware/auth';
import { audit } from '../lib/audit';
import * as employeeService from '../services/employee.service';
import * as salaryService from '../services/salary.service';
import type { CreateEmployeeInput } from '../services/employee.service';
import { sendCsv, toCsv } from '../utils/csv';

const isPrivileged = (req: Request): boolean => {
  const { auth } = ctx(req);
  return auth.role === 'SUPER_ADMIN' || auth.role === 'ADMIN' || auth.role === 'HR';
};

export const list = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const query = req.query as unknown as employeeService.DirectoryQuery;
  ok(res, await employeeService.listDirectory(tenantId, query, { isPrivileged: isPrivileged(req) }));
});

export const birthdays = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await employeeService.upcomingBirthdays(tenantId));
});

export const get = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const id = req.params.id as string;
  ok(
    res,
    await employeeService.getEmployee(tenantId, id, {
      isSelf: auth.employeeId === id,
      isPrivileged: isPrivileged(req),
      role: auth.role,
    })
  );
});

/** Monthly + annual CTC breakup — visible to the employee themself and ADMIN/HR only. */
export const salaryStructure = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const id = req.params.id as string;
  if (auth.employeeId !== id && !isPrivileged(req)) throw ApiError.forbidden();
  ok(res, await salaryService.salaryStructure(tenantId, id));
});

export const create = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await employeeService.createEmployee(tenantId, req.body as CreateEmployeeInput, req), 201);
});

export const update = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const id = req.params.id as string;
  const privileged = isPrivileged(req);
  if (auth.employeeId !== id && !privileged) throw ApiError.forbidden();
  ok(res, await employeeService.updateEmployee(tenantId, id, req.body as Record<string, unknown>, { isPrivileged: privileged }, req));
});

export const deactivate = h(async (req, res) => {
  const { tenantId } = ctx(req);
  await employeeService.deactivateEmployee(tenantId, req.params.id as string, req);
  ok(res, { deactivated: true });
});

export const encryptExisting = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await employeeService.encryptExisting(tenantId, req));
});

/** Reporting tree; `?rootId=` limits it to one employee's subtree. Everyone in the company may view it. */
export const orgChart = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { rootId } = req.query as { rootId?: string };
  ok(res, await employeeService.orgChart(tenantId, rootId));
});

export const reportingChain = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await employeeService.reportingChain(tenantId, req.params.id as string));
});

/** Former employees (archive) as CSV — ADMIN/HR. Same filters as the list. */
export const exportFormer = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const query = { ...(req.query as unknown as employeeService.DirectoryQuery), status: 'SEPARATED' as const, page: 1, pageSize: 5000 };
  const { items } = await employeeService.listDirectory(tenantId, query, { isPrivileged: true });
  const d = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : '');
  const rows = (items as unknown as Record<string, unknown>[]).map((e) => [
    e.employeeCode as string, e.name as string, e.designation as string, e.department as string, d(e.joiningDate),
    d(e.separatedOn ?? e.leavingDate), e.separationReason as string,
    e.rehireEligible === true ? 'Yes' : e.rehireEligible === false ? 'No' : '', e.rehireNote as string, d(e.archivedAt),
  ]);
  sendCsv(res, 'former-employees.csv', toCsv(
    ['Employee ID', 'Name', 'Designation', 'Department', 'Joined', 'Separated on', 'Reason', 'Rehire eligible', 'Rehire note', 'Archived'],
    rows
  ));
});

export const setRole = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const employeeId = req.params.id as string;
  const { role } = req.body as { role: (typeof employeeService.ASSIGNABLE_ROLES)[number] };
  const { before, after } = await employeeService.setEmployeeRole(tenantId, employeeId, role, { userId: auth.userId });
  await audit(req, { entity: 'Employee', entityId: employeeId, action: 'ROLE_CHANGE', before: { role: before }, after: { role: after } });
  ok(res, { role: after });
});

export const setPassword = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const employeeId = req.params.id as string;
  await employeeService.setEmployeePassword(tenantId, employeeId, (req.body as { password: string }).password, { userId: auth.userId, role: auth.role });
  // Never log the password itself.
  await audit(req, { entity: 'Employee', entityId: employeeId, action: 'PASSWORD_SET' });
  ok(res, { ok: true });
});
