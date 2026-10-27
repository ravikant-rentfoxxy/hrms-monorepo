import type { Request } from 'express';
import { ApiError, h, ok } from '../utils/http';
import { ctx } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import * as documentService from '../services/document.service';

const isPrivileged = (req: Request): boolean => {
  const { auth } = ctx(req);
  return auth.role === 'SUPER_ADMIN' || auth.role === 'ADMIN' || auth.role === 'HR';
};

export const list = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { scope, employeeId } = req.query as { scope?: documentService.DocumentScope; employeeId?: string };
  ok(res, await documentService.listDocuments(tenantId, { employeeId: auth.employeeId, canViewAll: isPrivileged(req) }, scope, employeeId));
});

export const owners = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await documentService.documentOwners(tenantId, auth.employeeId));
});

export const upload = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  if (!req.file) throw ApiError.badRequest('Attach a file in multipart field "file"');
  const { name, category, employeeId: requested, companyWide } =
    req.body as { name?: string; category?: string; employeeId?: string; companyWide: boolean };
  const privileged = isPrivileged(req);

  let ownerId: string | null = auth.employeeId;
  if (companyWide) {
    if (!privileged) throw ApiError.forbidden('Only ADMIN/HR can upload company-wide documents');
    ownerId = null;
  } else if (requested && requested !== auth.employeeId) {
    if (!privileged) throw ApiError.forbidden();
    const target = await prisma.employee.findFirst({ where: { id: requested, companyId: tenantId } });
    if (!target) throw ApiError.badRequest('Employee not found in this company');
    ownerId = requested;
  } else if (!auth.employeeId) {
    throw ApiError.forbidden('This account has no employee profile');
  }

  const document = await documentService.uploadDocument(tenantId, {
    file: req.file,
    name,
    category,
    ownerEmployeeId: ownerId,
    uploadedById: auth.employeeId,
  });
  ok(res, document, 201);
});

/** Edit name / folder / ownership; the file itself stays as uploaded. */
export const update = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(
    res,
    await documentService.updateDocument(tenantId, req.params.id as string, req.body, {
      employeeId: auth.employeeId,
      isPrivileged: isPrivileged(req),
    })
  );
});

/** "My documents" folders with the caller's own counts + mandatory shortfall. */
export const folders = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await documentService.folderSummary(tenantId, auth.employeeId));
});

export const download = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(
    res,
    await documentService.downloadUrl(
      tenantId,
      req.params.id as string,
      { employeeId: auth.employeeId, canViewAll: isPrivileged(req) },
      { inline: req.query.inline === 'true' || req.query.inline === '1' }
    )
  );
});

export const remove = h(async (req, res) => {
  const { tenantId } = ctx(req);
  await documentService.deleteDocument(tenantId, req.params.id as string);
  ok(res, { deleted: true });
});
