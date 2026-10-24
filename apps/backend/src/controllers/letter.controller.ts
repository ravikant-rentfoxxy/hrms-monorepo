import { h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow } from '../middleware/auth';
import { audit } from '../lib/audit';
import * as letterService from '../services/letter.service';
import type { LetterType, LetterVars, TemplateInput } from '../services/letter.service';

export const placeholders = h(async (_req, res) => {
  ok(res, { placeholders: letterService.PLACEHOLDERS, types: letterService.LETTER_TYPES });
});

export const listTemplates = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await letterService.listTemplates(tenantId));
});

export const createTemplate = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const created = await letterService.createTemplate(tenantId, req.body as TemplateInput);
  await audit(req, { entity: 'LetterTemplate', entityId: created.id, action: 'CREATE', after: { type: created.type, name: created.name } });
  ok(res, created, 201);
});

export const updateTemplate = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const updated = await letterService.updateTemplate(tenantId, req.params.id as string, req.body as Partial<TemplateInput>);
  await audit(req, { entity: 'LetterTemplate', entityId: updated.id, action: 'UPDATE', after: req.body });
  ok(res, updated);
});

export const deleteTemplate = h(async (req, res) => {
  const { tenantId } = ctx(req);
  await letterService.deleteTemplate(tenantId, req.params.id as string);
  await audit(req, { entity: 'LetterTemplate', entityId: req.params.id as string, action: 'DELETE' });
  ok(res, { deleted: true });
});

export const preview = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await letterService.preview(tenantId, req.body as Parameters<typeof letterService.preview>[1]));
});

export const generate = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const body = req.body as { templateId?: string; type?: LetterType; employeeId: string; vars?: LetterVars };
  const letter = await letterService.generateLetter(tenantId, { ...body, createdById: auth.employeeId });
  await audit(req, { entity: 'GeneratedLetter', entityId: letter.id, action: 'CREATE', after: { type: letter.type, employeeId: letter.employeeId } });
  ok(res, letter, 201);
});

export const list = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await letterService.listLetters(tenantId, auth, req.query as { employeeId?: string; type?: string }));
});

export const download = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const inline = req.query.inline === 'true' || req.query.inline === '1';
  ok(res, await letterService.letterUrl(tenantId, req.params.id as string, auth, { inline }));
});

export const remove = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const letter = await letterService.deleteLetter(tenantId, req.params.id as string);
  await audit(req, { entity: 'GeneratedLetter', entityId: letter.id, action: 'DELETE', before: letter });
  ok(res, { deleted: true });
});

export const requestOwn = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { type } = req.body as { type: LetterType };
  ok(res, await letterService.requestOwnLetter(tenantId, employeeIdOrThrow(req), type), 201);
});
