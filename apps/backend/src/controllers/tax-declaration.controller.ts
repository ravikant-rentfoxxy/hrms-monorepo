import { ApiError, h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow } from '../middleware/auth';
import * as taxDeclarationService from '../services/tax-declaration.service';
import type { DeclarationInput, VerifyInput } from '../services/tax-declaration.service';

/** Section metadata (labels, caps) + the current FY, for the declaration forms. */
export const meta = h(async (_req, res) => {
  const fy = taxDeclarationService.currentFy();
  ok(res, {
    currentFy: fy,
    sections: taxDeclarationService.TAX_SECTIONS.map((s) => ({
      section: s,
      title: taxDeclarationService.SECTION_LABELS[s],
      cap: taxDeclarationService.SECTION_CAPS[s],
    })),
  });
});

export const getMine = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const fy = (req.query.fy as string | undefined) ?? taxDeclarationService.currentFy();
  ok(res, await taxDeclarationService.getMine(tenantId, employeeIdOrThrow(req), fy));
});

export const saveMine = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await taxDeclarationService.saveMine(tenantId, employeeIdOrThrow(req), req.body as DeclarationInput, req));
});

export const submitMine = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { fy } = req.body as { fy: string };
  ok(res, await taxDeclarationService.submitMine(tenantId, employeeIdOrThrow(req), fy, req));
});

export const list = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const q = req.query as { fy?: string; status?: string; employeeId?: string };
  ok(res, await taxDeclarationService.list(tenantId, { ...q, fy: q.fy ?? taxDeclarationService.currentFy() }));
});

export const getOne = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await taxDeclarationService.getOne(tenantId, req.params.id as string, auth));
});

export const addProof = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  if (!req.file) throw ApiError.badRequest('Attach the proof in multipart field "file"');
  const { section, name } = req.body as { section: string; name?: string };
  ok(
    res,
    await taxDeclarationService.addProof(tenantId, req.params.id as string, auth, {
      section,
      name,
      file: { originalname: req.file.originalname, mimetype: req.file.mimetype, buffer: req.file.buffer, size: req.file.size },
    }),
    201
  );
});

export const deleteProof = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  await taxDeclarationService.deleteProof(tenantId, req.params.id as string, req.params.proofId as string, auth);
  ok(res, { deleted: true });
});

export const proofDownload = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const inline = req.query.inline === 'true' || req.query.inline === '1';
  ok(res, await taxDeclarationService.proofUrl(tenantId, req.params.id as string, req.params.proofId as string, auth, inline));
});

export const verify = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await taxDeclarationService.verify(tenantId, req.params.id as string, req.body as VerifyInput, auth, req));
});

export const reject = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { remarks } = req.body as { remarks: string };
  ok(res, await taxDeclarationService.reject(tenantId, req.params.id as string, remarks, auth, req));
});
