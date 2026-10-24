import { h, ok } from '../utils/http';
import { ctx } from '../middleware/auth';
import { audit, diff } from '../lib/audit';
import { sendCsv, toCsv } from '../utils/csv';
import * as integrationService from '../services/integration.service';
import type { IntegrationInput } from '../services/integration.service';

export const list = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await integrationService.listIntegrations(tenantId));
});

export const events = h(async (_req, res) => {
  ok(res, integrationService.EVENT_CATALOGUE);
});

export const create = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const integration = await integrationService.createIntegration(tenantId, req.body as IntegrationInput);
  await audit(req, { entity: 'Integration', entityId: integration.id, action: 'CREATE', after: integration });
  ok(res, integration, 201);
});

export const update = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const before = await integrationService.getIntegration(tenantId, req.params.id as string);
  const after = await integrationService.updateIntegration(tenantId, before.id, req.body as Partial<IntegrationInput>);
  await audit(req, { entity: 'Integration', entityId: before.id, action: 'UPDATE', ...diff(before, after) });
  ok(res, after);
});

export const remove = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const integration = await integrationService.deleteIntegration(tenantId, req.params.id as string);
  await audit(req, { entity: 'Integration', entityId: integration.id, action: 'DELETE', before: integration });
  ok(res, { deleted: true });
});

export const test = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { event } = req.body as { event: string };
  ok(res, await integrationService.testIntegration(tenantId, req.params.id as string, event));
});

export const journal = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { month } = req.query as { month: string };
  ok(res, await integrationService.payrollJournal(tenantId, month));
});

export const journalCsv = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { month } = req.query as { month: string };
  const j = await integrationService.payrollJournal(tenantId, month);
  const narration = `Salary for ${month} (${j.payslips} payslips)`;
  const csv = toCsv(
    ['Date', 'Voucher Type', 'Voucher No', 'Ledger', 'Debit', 'Credit', 'Narration'],
    [
      ...j.lines.map((l) => [j.voucherDate, 'Journal', j.voucherNo, l.ledger, l.debit || '', l.credit || '', narration]),
      ['', '', '', 'Total', j.totalDebit, j.totalCredit, ''],
    ]
  );
  await audit(req, { entity: 'PayrollJournal', entityId: month, action: 'EXPORT', after: { totalDebit: j.totalDebit, totalCredit: j.totalCredit } });
  sendCsv(res, `payroll-journal-${month}.csv`, csv);
});
