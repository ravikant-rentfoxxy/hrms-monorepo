import { ApiError, h, ok } from '../utils/http';
import { sendCsv } from '../utils/csv';
import { ctx } from '../middleware/auth';
import * as reportService from '../services/report.service';
import type { ReportQuery } from '../services/report.service';

const isCompanyAdmin = (role: string) => role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR';

export const catalog = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await reportService.catalog(tenantId, auth.role));
});

/**
 * GET /reports/:key — JSON, or a CSV download with ?format=csv.
 * ADMIN/HR see the whole company; a MANAGER only team-capable reports, scoped to direct reports.
 */
export const run = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const key = req.params.key as string;
  const def = reportService.findReport(key);
  if (!def) throw ApiError.notFound(`Unknown report "${key}"`);
  const admin = isCompanyAdmin(auth.role);
  if (!admin) {
    if (auth.role !== 'MANAGER' || !def.manager) throw ApiError.forbidden('This report is available to HR and admins only');
    if (!auth.employeeId) throw ApiError.forbidden('This account has no employee profile');
  }
  const { format, ...query } = req.query as unknown as ReportQuery & { format?: 'json' | 'csv' };
  const result = await reportService.runReport(key, { companyId: tenantId, teamOf: admin ? null : auth.employeeId }, query);
  if (format === 'csv') {
    const stamp = new Date().toISOString().slice(0, 10);
    sendCsv(res, `${key}-${stamp}.csv`, reportService.toReportCsv(result));
    return;
  }
  ok(res, result);
});
