import { h, ok } from '../utils/http';
import { ctx } from '../middleware/auth';
import * as auditService from '../services/audit.service';
import type { AuditQuery } from '../services/audit.service';

/** Tenant audit log (ADMIN / HR). */
export const list = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await auditService.listAudit(tenantId, req.query as unknown as AuditQuery));
});

export const facets = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await auditService.auditFacets(tenantId));
});

/** Super admin: `?companyId=` for a tenant, otherwise platform-level events. */
export const platformList = h(async (req, res) => {
  const { companyId, ...query } = req.query as unknown as AuditQuery & { companyId?: string };
  ok(res, await auditService.listAudit(companyId ?? null, query));
});

export const platformFacets = h(async (req, res) => {
  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : null;
  ok(res, await auditService.auditFacets(companyId));
});
