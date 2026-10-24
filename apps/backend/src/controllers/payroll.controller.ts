import type { Response } from 'express';
import { ApiError, h, ok } from '../utils/http';
import { ctx } from '../middleware/auth';
import { audit } from '../lib/audit';
import { sendCsv } from '../utils/csv';
import * as payrollService from '../services/payroll.service';
import * as exportsService from '../services/payroll-exports.service';
import type { PayslipInput } from '../services/payroll.service';

const isPayrollAdmin = (role: string): boolean => role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR';

/* -------------------------------- Payslips -------------------------------- */

/** Own payslips (published only); ADMIN/HR may pass `employeeId` and also see drafts. */
export const list = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  let employeeId = auth.employeeId;
  const q = req.query.employeeId;
  if (typeof q === 'string' && q !== auth.employeeId) {
    if (!isPayrollAdmin(auth.role)) throw ApiError.forbidden();
    employeeId = q;
  }
  if (!employeeId) throw ApiError.badRequest('employeeId required');
  ok(res, await payrollService.listPayslips(tenantId, employeeId, { includeDrafts: isPayrollAdmin(auth.role) }));
});

/** Loads a payslip the caller may see: own published payslips, or any for ADMIN/HR. */
async function visiblePayslip(req: Parameters<typeof ctx>[0]) {
  const { auth, tenantId } = ctx(req);
  const payslip = await payrollService.getPayslip(tenantId, req.params.id as string);
  if (!isPayrollAdmin(auth.role)) {
    if (payslip.employeeId !== auth.employeeId) throw ApiError.forbidden();
    if (payslip.status !== 'PUBLISHED') throw ApiError.notFound('Payslip not found');
  }
  return payslip;
}

export const get = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const payslip = await visiblePayslip(req);
  ok(res, await payrollService.payslipDetail(tenantId, payslip.id));
});

/** Short-lived link to the generated payslip PDF (owner or ADMIN/HR). */
export const pdf = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const payslip = await visiblePayslip(req);
  ok(
    res,
    await payrollService.payslipPdfUrl(tenantId, payslip.id, {
      inline: req.query.inline === 'true' || req.query.inline === '1',
    })
  );
});

export const create = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const payslip = await payrollService.createPayslip(tenantId, req.body as PayslipInput);
  await audit(req, { entity: 'Payslip', entityId: payslip.id, action: 'CREATE', after: payslip });
  ok(res, payslip, 201);
});

export const update = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await payrollService.updatePayslip(tenantId, req.params.id as string, req.body as Partial<PayslipInput>);
  await audit(req, { entity: 'Payslip', entityId: after.id, action: 'UPDATE', before, after });
  ok(res, after);
});

export const remove = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const before = await payrollService.deletePayslip(tenantId, req.params.id as string);
  await audit(req, { entity: 'Payslip', entityId: before.id, action: 'DELETE', before });
  ok(res, { deleted: true });
});

/* ---------------------------------- Runs ---------------------------------- */

export const listRuns = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await payrollService.listRuns(tenantId));
});

/** Creates the month's DRAFT run, or refreshes it when it is still DRAFT. */
export const createRun = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { month, workingDays } = req.body as { month: Date; workingDays?: number };
  const result = await payrollService.generateRun(tenantId, month, { workingDays, actorEmployeeId: auth.employeeId });
  await audit(req, {
    entity: 'PayrollRun',
    entityId: result.run.id,
    action: 'CREATE',
    after: { month: result.run.month, workingDays: result.run.workingDays, totals: result.run.totals },
  });
  ok(res, result, 201);
});

export const getRun = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await payrollService.getRun(tenantId, req.params.id as string));
});

export const recalculateRun = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { workingDays } = req.body as { workingDays?: number };
  const result = await payrollService.recalculateRun(tenantId, req.params.id as string, workingDays, auth.employeeId);
  await audit(req, {
    entity: 'PayrollRun',
    entityId: result.run.id,
    action: 'RECALCULATE',
    after: { workingDays: result.run.workingDays, totals: result.run.totals },
  });
  ok(res, result);
});

export const lockRun = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await payrollService.lockRun(tenantId, req.params.id as string);
  await audit(req, { entity: 'PayrollRun', entityId: after.id, action: 'LOCK', before: { status: before.status }, after: { status: after.status } });
  ok(res, after);
});

export const unlockRun = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await payrollService.unlockRun(tenantId, req.params.id as string);
  await audit(req, { entity: 'PayrollRun', entityId: after.id, action: 'UNLOCK', before: { status: before.status }, after: { status: after.status } });
  ok(res, after);
});

export const approveRun = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { before, after } = await payrollService.approveRun(tenantId, req.params.id as string, auth.employeeId);
  await audit(req, { entity: 'PayrollRun', entityId: after.id, action: 'APPROVE', before: { status: before.status }, after: { status: after.status } });
  ok(res, after);
});

export const markRunPaid = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await payrollService.markRunPaid(
    tenantId,
    req.params.id as string,
    req.body as { paymentReference: string; paymentMode: string; paidAt?: Date }
  );
  await audit(req, {
    entity: 'PayrollRun',
    entityId: after.id,
    action: 'MARK_PAID',
    before: { paidAt: before.paidAt },
    after: { paidAt: after.paidAt, paymentReference: after.paymentReference, paymentMode: after.paymentMode },
  });
  ok(res, after);
});

export const publishRun = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const result = await payrollService.publishRun(tenantId, req.params.id as string);
  await audit(req, {
    entity: 'PayrollRun',
    entityId: result.after.id,
    action: 'PUBLISH',
    before: { status: result.before.status },
    after: { status: result.after.status, totals: result.after.totals, payslips: result.payslips, loanRepayments: result.loanRepayments },
  });
  ok(res, result.after);
});

/* --------------------------------- Exports -------------------------------- */

const sendText = (res: Response, fileName: string, text: string) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`);
  res.send(text);
};

export const bankFile = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const file = await exportsService.bankFile(tenantId, req.params.id as string);
  await audit(req, { entity: 'PayrollRun', entityId: req.params.id as string, action: 'EXPORT_BANK_FILE' });
  sendCsv(res, file.fileName, file.csv);
});

export const ecrFile = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const file = await exportsService.ecrFile(tenantId, req.params.id as string);
  if (file.missingUan.length) res.setHeader('X-Missing-UAN', file.missingUan.join(','));
  sendText(res, file.fileName, file.text);
});

export const esiFile = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const file = await exportsService.esiFile(tenantId, req.params.id as string);
  sendCsv(res, file.fileName, file.csv);
});

export const ptFile = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const file = await exportsService.ptSummary(tenantId, req.params.id as string);
  sendCsv(res, file.fileName, file.csv);
});

export const registerFile = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const file = await exportsService.registerFile(tenantId, req.params.id as string);
  sendCsv(res, file.fileName, file.csv);
});

/* ---------------------------------- Tax ----------------------------------- */

/** Form 16 Part B link; employees may fetch their own only. */
export const form16 = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const employeeId = req.params.employeeId as string;
  if (!isPayrollAdmin(auth.role) && employeeId !== auth.employeeId) throw ApiError.forbidden();
  const { fy } = req.query as { fy?: string };
  ok(res, await exportsService.form16(tenantId, employeeId, fy ?? exportsService.defaultFy()));
});

/** Live annual tax projection (own, or any employee for ADMIN/HR). */
export const taxProjection = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { employeeId: q } = req.query as { employeeId?: string };
  let employeeId = auth.employeeId;
  if (q && q !== auth.employeeId) {
    if (!isPayrollAdmin(auth.role)) throw ApiError.forbidden();
    employeeId = q;
  }
  if (!employeeId) throw ApiError.badRequest('employeeId required');
  ok(res, await payrollService.taxProjection(tenantId, employeeId));
});
