import { ApiError, h, ok } from '../utils/http';
import { ctx } from '../middleware/auth';
import { sendCsv, toCsv } from '../utils/csv';
import * as payrollInputService from '../services/payroll-input.service';
import type { InputData } from '../services/payroll-input.service';

export const list = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await payrollInputService.list(tenantId, req.query as unknown as { month: Date; employeeId?: string; type?: string }));
});

export const create = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await payrollInputService.create(tenantId, req.body as InputData, auth.employeeId, req), 201);
});

export const update = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await payrollInputService.update(tenantId, req.params.id as string, req.body as Partial<InputData>, req));
});

export const remove = h(async (req, res) => {
  const { tenantId } = ctx(req);
  await payrollInputService.remove(tenantId, req.params.id as string, req);
  ok(res, { deleted: true });
});

/** Blank CSV with the expected header and one example row. */
export const csvTemplate = h(async (_req, res) => {
  sendCsv(
    res,
    'payroll-inputs-template.csv',
    toCsv(payrollInputService.CSV_HEADERS, [['EMP001', 'BONUS', 'Diwali bonus', 10000, 'true']])
  );
});

export const uploadCsv = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  if (!req.file) throw ApiError.badRequest('Attach the CSV in multipart field "file"');
  const { month, dryRun } = req.body as { month: Date; dryRun: boolean };
  ok(res, await payrollInputService.importCsv(tenantId, { month, dryRun, csv: req.file.buffer.toString('utf8') }, auth.employeeId, req));
});

export const importExpenses = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { month } = req.body as { month: Date };
  ok(res, await payrollInputService.importExpenses(tenantId, month, auth.employeeId, req));
});
