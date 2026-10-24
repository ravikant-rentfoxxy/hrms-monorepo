import { h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow } from '../middleware/auth';
import * as salaryRevisionService from '../services/salary-revision.service';
import type { ComponentInput, RevisionInput, TemplateInput } from '../services/salary-revision.service';

// ---- Components ----

export const listComponents = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await salaryRevisionService.listComponents(tenantId));
});

export const createComponent = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await salaryRevisionService.createComponent(tenantId, req.body as ComponentInput, req), 201);
});

export const updateComponent = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await salaryRevisionService.updateComponent(tenantId, req.params.id as string, req.body as Partial<ComponentInput>, req));
});

export const deleteComponent = h(async (req, res) => {
  const { tenantId } = ctx(req);
  await salaryRevisionService.deleteComponent(tenantId, req.params.id as string, req);
  ok(res, { deleted: true });
});

// ---- Templates ----

export const listTemplates = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await salaryRevisionService.listTemplates(tenantId));
});

export const createTemplate = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await salaryRevisionService.createTemplate(tenantId, req.body as TemplateInput, req), 201);
});

export const updateTemplate = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await salaryRevisionService.updateTemplate(tenantId, req.params.id as string, req.body as Partial<TemplateInput>, req));
});

export const deleteTemplate = h(async (req, res) => {
  const { tenantId } = ctx(req);
  await salaryRevisionService.deleteTemplate(tenantId, req.params.id as string, req);
  ok(res, { deleted: true });
});

export const preview = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { ctcAnnual, templateId } = req.body as { ctcAnnual: number; templateId?: string };
  ok(res, await salaryRevisionService.preview(tenantId, ctcAnnual, templateId));
});

// ---- Revisions ----

export const listRevisions = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await salaryRevisionService.listRevisions(tenantId, req.query as { employeeId?: string; status?: string }));
});

export const myRevisions = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await salaryRevisionService.myRevisions(tenantId, employeeIdOrThrow(req)));
});

export const getRevision = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await salaryRevisionService.getRevision(tenantId, req.params.id as string, auth));
});

export const createRevision = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await salaryRevisionService.createRevision(tenantId, req.body as RevisionInput, auth, req), 201);
});

export const decideRevision = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { decision, remarks } = req.body as { decision: 'APPROVED' | 'REJECTED'; remarks?: string };
  ok(res, await salaryRevisionService.decideRevision(tenantId, req.params.id as string, { decision, remarks, actor: auth }, req));
});

export const cancelRevision = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { remarks } = req.body as { remarks?: string };
  ok(res, await salaryRevisionService.cancelRevision(tenantId, req.params.id as string, remarks, req));
});

// ---- Restructure ----

export const restructurePlan = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { templateId } = req.query as { templateId?: string };
  ok(res, await salaryRevisionService.restructurePlan(tenantId, templateId ?? null));
});

export const applyRestructure = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const body = req.body as { templateId?: string | null; effectiveFrom: Date };
  ok(res, await salaryRevisionService.applyRestructure(tenantId, body.templateId ?? null, body.effectiveFrom, { role: auth.role, employeeId: auth.employeeId }, req));
});

export const rescheduleRevision = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { effectiveFrom } = req.body as { effectiveFrom: Date };
  ok(res, await salaryRevisionService.rescheduleRevision(tenantId, req.params.id as string, effectiveFrom, req));
});

export const rescheduleRestructure = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const body = req.body as { templateId?: string | null; effectiveFrom: Date };
  ok(res, await salaryRevisionService.rescheduleRestructure(tenantId, body.templateId ?? null, body.effectiveFrom, req));
});
