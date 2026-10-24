import { ApiError, h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow, isManagerial } from '../middleware/auth';
import { audit } from '../lib/audit';
import { sendCsv, toCsv } from '../utils/csv';
import { isoDay } from '../utils/people';
import * as timesheetService from '../services/timesheet.service';
import type { EntryInput, ListFilter, UtilisationFilter } from '../services/timesheet.service';

export const week = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { weekStart, employeeId } = req.query as unknown as { weekStart: Date; employeeId?: string };
  const target = await timesheetService.resolveTarget(tenantId, auth, employeeId);
  ok(res, await timesheetService.getWeek(tenantId, target, weekStart));
});

export const get = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await timesheetService.getById(tenantId, req.params.id as string, auth));
});

export const list = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const filter = req.query as unknown as ListFilter;
  if (filter.scope === 'team' && !isManagerial(auth.role)) throw ApiError.forbidden();
  if (filter.scope === 'company' && !(auth.role === 'SUPER_ADMIN' || auth.role === 'ADMIN' || auth.role === 'HR')) {
    throw ApiError.forbidden();
  }
  if ((filter.scope === 'me' || filter.scope === 'team') && !auth.employeeId) {
    throw ApiError.forbidden('This account has no employee profile');
  }
  ok(res, await timesheetService.listWeeks(tenantId, auth, filter));
});

export const save = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { weekStart, entries } = req.body as { weekStart: Date; entries: EntryInput[] };
  ok(res, await timesheetService.saveWeek(tenantId, employeeIdOrThrow(req), weekStart, entries));
});

export const copyLast = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { weekStart } = req.body as { weekStart: Date };
  ok(res, await timesheetService.copyLastWeek(tenantId, employeeIdOrThrow(req), weekStart));
});

export const submit = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const week = await timesheetService.submitWeek(tenantId, employeeIdOrThrow(req), req.params.id as string);
  await audit(req, { entity: 'TimesheetWeek', entityId: week.id, action: 'SUBMIT', after: { status: week.status, totalHours: week.totalHours } });
  ok(res, week);
});

export const recall = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const week = await timesheetService.recallWeek(tenantId, employeeIdOrThrow(req), req.params.id as string);
  await audit(req, { entity: 'TimesheetWeek', entityId: week.id, action: 'RECALL', before: { status: 'SUBMITTED' }, after: { status: week.status } });
  ok(res, week);
});

export const decide = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { decision, remarks } = req.body as { decision: 'APPROVED' | 'REJECTED'; remarks?: string };
  const result = await timesheetService.decideWeek(tenantId, req.params.id as string, { decision, remarks, actor: auth });
  await audit(req, {
    entity: 'TimesheetWeek',
    entityId: result.week.id,
    action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
    after: { outcome: result.outcome, status: result.week.status, remarks: remarks ?? null },
  });
  ok(res, result);
});

export const utilisation = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await timesheetService.utilisation(tenantId, req.query as unknown as UtilisationFilter));
});

export const utilisationCsv = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const filter = req.query as unknown as UtilisationFilter;
  const report = await timesheetService.utilisation(tenantId, filter);
  const csv = toCsv(
    ['Project code', 'Project', 'Client', 'Employee code', 'Employee', 'Department', 'Billable hours', 'Non-billable hours', 'Total hours', 'Billable %'],
    [
      ...report.rows.map((r) => [
        r.project.code, r.project.name, r.project.client, r.employee.employeeCode, r.employee.name, r.employee.department,
        r.billable, r.nonBillable, r.total, r.billablePct,
      ]),
      ['TOTAL', '', '', '', '', '', report.totals.billable, report.totals.nonBillable, report.totals.total, report.totals.billablePct],
    ]
  );
  sendCsv(res, `utilisation-${isoDay(report.from)}-to-${isoDay(report.to)}.csv`, csv);
});
