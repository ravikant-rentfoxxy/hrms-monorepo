import { ApiError, h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow } from '../middleware/auth';
import { audit } from '../lib/audit';
import * as onboardingService from '../services/onboarding.service';
import type { TemplateInput } from '../services/onboarding.service';

const viewerOf = (auth: { role: onboardingService.Viewer['role']; employeeId: string | null }) => ({
  role: auth.role,
  employeeId: auth.employeeId,
});

// ---- Templates ----

export const listTemplates = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await onboardingService.listTemplates(tenantId));
});

export const createTemplate = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const created = await onboardingService.createTemplate(tenantId, req.body as TemplateInput);
  await audit(req, { entity: 'OnboardingTemplate', entityId: created.id, action: 'CREATE', after: created });
  ok(res, created, 201);
});

export const updateTemplate = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const updated = await onboardingService.updateTemplate(tenantId, req.params.id as string, req.body as Partial<TemplateInput>);
  await audit(req, { entity: 'OnboardingTemplate', entityId: updated.id, action: 'UPDATE', after: updated });
  ok(res, updated);
});

export const deleteTemplate = h(async (req, res) => {
  const { tenantId } = ctx(req);
  await onboardingService.deleteTemplate(tenantId, req.params.id as string);
  await audit(req, { entity: 'OnboardingTemplate', entityId: req.params.id as string, action: 'DELETE' });
  ok(res, { deleted: true });
});

// ---- Cases ----

export const listCases = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { status } = req.query as { status?: string };
  ok(res, await onboardingService.listCases(tenantId, viewerOf(auth), { status }));
});

export const startCase = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { employeeId, templateId } = req.body as { employeeId: string; templateId?: string };
  const started = await onboardingService.startOnboarding(tenantId, employeeId, templateId);
  await audit(req, { entity: 'OnboardingCase', entityId: started.id, action: 'CREATE', after: { employeeId, templateId: started.templateId } });
  ok(res, started, 201);
});

export const myCase = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await onboardingService.myCase(tenantId, employeeIdOrThrow(req)));
});

export const getCase = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await onboardingService.getCase(tenantId, req.params.id as string, viewerOf(auth)));
});

export const cancelCase = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const cancelled = await onboardingService.cancelCase(tenantId, req.params.id as string);
  await audit(req, { entity: 'OnboardingCase', entityId: cancelled.id, action: 'CANCEL' });
  ok(res, cancelled);
});

// ---- Tasks ----

export const myTasks = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const includeDone = req.query.includeDone === 'true' || req.query.includeDone === '1';
  ok(res, await onboardingService.myTasks(tenantId, viewerOf(auth), { includeDone }));
});

/** Multipart: optional file in field `file` (required for document tasks). */
export const completeTask = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  if (req.file && req.file.size === 0) throw ApiError.badRequest('The uploaded file is empty');
  ok(res, await onboardingService.completeTask(tenantId, req.params.id as string, viewerOf(auth), req.file));
});

/** Creates the listed assets, issues them to the task's joiner and (by default) completes the task. */
export const issueTaskAssets = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const input = req.body as Parameters<typeof onboardingService.issueTaskAssets>[3];
  const result = await onboardingService.issueTaskAssets(tenantId, req.params.id as string, viewerOf(auth), input);
  await audit(req, {
    entity: 'OnboardingTask',
    entityId: req.params.id as string,
    action: 'ISSUE_ASSETS',
    after: { assets: result.assets.map((a) => `${a.tag} ${a.name}`), completed: result.task.done },
  });
  ok(res, result, 201);
});

export const reopenTask = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await onboardingService.reopenTask(tenantId, req.params.id as string, viewerOf(auth)));
});
