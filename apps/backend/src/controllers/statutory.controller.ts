import { h, ok } from '../utils/http';
import { ctx } from '../middleware/auth';
import { audit, diff } from '../lib/audit';
import * as statutoryService from '../services/statutory.service';
import type {
  LwfRuleInput, PtSlabInput, StatutoryConfigInput, TaxRuleInput,
} from '../services/statutory.service';

/* --------------------------------- Config --------------------------------- */

export const getConfig = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await statutoryService.getConfig(tenantId));
});

export const updateConfig = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await statutoryService.updateConfig(tenantId, req.body as StatutoryConfigInput);
  await audit(req, { entity: 'StatutoryConfig', entityId: after.id, action: 'UPDATE', ...diff(before, after) });
  ok(res, after);
});

/** Indian states + the states that already have PT slabs / LWF rules. */
export const states = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const [slabs, lwf] = await Promise.all([statutoryService.listPtSlabs(tenantId), statutoryService.listLwfRules(tenantId)]);
  ok(res, {
    all: statutoryService.INDIAN_STATES,
    withPt: [...new Set(slabs.map((s) => s.state))].sort(),
    withLwf: lwf.map((r) => r.state),
  });
});

/* -------------------------------- PT slabs -------------------------------- */

export const listPtSlabs = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await statutoryService.listPtSlabs(tenantId, (req.query as { state?: string }).state));
});

export const createPtSlab = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const slab = await statutoryService.createPtSlab(tenantId, req.body as PtSlabInput);
  await audit(req, { entity: 'ProfessionalTaxSlab', entityId: slab.id, action: 'CREATE', after: slab });
  ok(res, slab, 201);
});

export const updatePtSlab = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await statutoryService.updatePtSlab(tenantId, req.params.id as string, req.body as Partial<PtSlabInput>);
  await audit(req, { entity: 'ProfessionalTaxSlab', entityId: after.id, action: 'UPDATE', ...diff(before, after) });
  ok(res, after);
});

export const deletePtSlab = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const before = await statutoryService.deletePtSlab(tenantId, req.params.id as string);
  await audit(req, { entity: 'ProfessionalTaxSlab', entityId: before.id, action: 'DELETE', before });
  ok(res, { deleted: true });
});

export const replaceStatePtSlabs = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { state, slabs } = req.body as { state: string; slabs: Omit<PtSlabInput, 'state'>[] };
  const { before, after } = await statutoryService.replaceStatePtSlabs(tenantId, state, slabs);
  await audit(req, { entity: 'ProfessionalTaxSlab', entityId: state, action: 'REPLACE_STATE', before, after });
  ok(res, after);
});

/* -------------------------------- LWF rules ------------------------------- */

export const listLwfRules = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await statutoryService.listLwfRules(tenantId));
});

export const upsertLwfRule = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await statutoryService.upsertLwfRule(tenantId, req.body as LwfRuleInput);
  await audit(req, { entity: 'LwfRule', entityId: after.id, action: before ? 'UPDATE' : 'CREATE', before, after });
  ok(res, after, before ? 200 : 201);
});

export const deleteLwfRule = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const before = await statutoryService.deleteLwfRule(tenantId, req.params.id as string);
  await audit(req, { entity: 'LwfRule', entityId: before.id, action: 'DELETE', before });
  ok(res, { deleted: true });
});

/* -------------------------------- Tax rules ------------------------------- */

export const listTaxRules = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await statutoryService.listTaxRules(tenantId, (req.query as { fy?: string }).fy));
});

export const upsertTaxRule = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await statutoryService.upsertTaxRule(tenantId, req.body as TaxRuleInput);
  await audit(req, { entity: 'TaxRule', entityId: after.id, action: before ? 'UPDATE' : 'CREATE', before, after });
  ok(res, after, before ? 200 : 201);
});

export const deleteTaxRule = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const before = await statutoryService.deleteTaxRule(tenantId, req.params.id as string);
  await audit(req, { entity: 'TaxRule', entityId: before.id, action: 'DELETE', before });
  ok(res, { deleted: true });
});
