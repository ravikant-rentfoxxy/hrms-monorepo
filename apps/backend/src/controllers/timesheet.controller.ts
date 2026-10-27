import { ApiError, h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow, isManagerial } from '../middleware/auth';
import { audit } from '../lib/audit';
import { sendCsv, toCsv } from '../utils/csv';
import { isoDay } from '../utils/people';
import * as timesheetService from '../services/timesheet.service';
import type { EntryInput, ListFilter, UtilisationFilter } from '../services/timesheet.service';

export const day = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { date, employeeId } = req.query as unknown as { date: Date; employeeId?: string };
  const target = await timesheetService.resolveTarget(tenantId, auth, employeeId);
  ok(res, await timesheetService.getDay(tenantId, target, date));
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
  ok(res, await timesheetService.listDays(tenantId, auth, filter));
});

export const save = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { date, entries } = req.body as { date: Date; entries: EntryInput[] };
  ok(res, await timesheetService.saveDay(tenantId, employeeIdOrThrow(req), date, entries));
});

export const copyPrevious = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { date } = req.body as { date: Date };
  ok(res, await timesheetService.copyPreviousDay(tenantId, employeeIdOrThrow(req), date));
});

export const submit = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const day = await timesheetService.submitDay(tenantId, employeeIdOrThrow(req), req.params.id as string);
  await audit(req, { entity: 'TimesheetDay', entityId: day.id, action: 'SUBMIT', after: { status: day.status, date: isoDay(day.date), totalHours: day.totalHours } });
  ok(res, day);
});

export const deleteEntry = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await timesheetService.deleteEntry(tenantId, employeeIdOrThrow(req), req.params.id as string, req.params.entryId as string));
});

export const addAttachment = h(async (req, res) => {
  const { tenantId } = ctx(req);
  if (!req.file) throw ApiError.badRequest('Attach the file in multipart field "file"');
  const { originalname, mimetype, buffer, size } = req.file;
  const att = await timesheetService.addAttachment(tenantId, employeeIdOrThrow(req), req.params.id as string, req.params.entryId as string, {
    originalname, mimetype, buffer, size,
  });
  await audit(req, { entity: 'TimesheetDay', entityId: req.params.id as string, action: 'ATTACH', after: { attachmentId: att.id, entryId: att.entryId, name: att.name } });
  ok(res, att, 201);
});

export const deleteAttachment = h(async (req, res) => {
  const { tenantId } = ctx(req);
  await timesheetService.deleteAttachment(tenantId, employeeIdOrThrow(req), req.params.id as string, req.params.attachmentId as string);
  await audit(req, { entity: 'TimesheetDay', entityId: req.params.id as string, action: 'DETACH', before: { attachmentId: req.params.attachmentId } });
  ok(res, { deleted: true });
});

export const attachmentDownload = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const inline = req.query.inline === 'true' || req.query.inline === '1';
  ok(res, await timesheetService.attachmentUrl(tenantId, req.params.id as string, req.params.attachmentId as string, auth, inline));
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
