/** HR documents: metadata in PostgreSQL, bytes in the MinIO bucket. */
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/http';
import { objectKey, presignedGetUrl, putObject, removeObject, FILE_LINK_TTL_SECONDS } from '../lib/storage';

export interface DocumentFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Folders of the "My documents" view. `required` = how many personal
 * documents the employee must have in that folder; shortfalls add up to the
 * "mandatory documents pending" banner in the app.
 */
export const DOCUMENT_FOLDERS: { name: string; required: number }[] = [
  { name: 'Degrees & Certificates', required: 1 },
  { name: 'Employee Letters', required: 0 },
  { name: 'Onboarding', required: 0 },
  { name: 'Offer Letter', required: 1 },
  { name: 'Important files', required: 0 },
  { name: 'Previous Experience', required: 1 },
  { name: 'Exiting documents', required: 0 },
  { name: 'Identity', required: 2 }, // PAN + Aadhaar
  { name: 'Signatures', required: 0 },
  { name: 'Tax Forms', required: 0 },
  { name: 'General', required: 0 },
];

const normalizeCategory = (category?: string): string => {
  const trimmed = category?.trim() ?? '';
  return DOCUMENT_FOLDERS.some((f) => f.name.toLowerCase() === trimmed.toLowerCase())
    ? DOCUMENT_FOLDERS.find((f) => f.name.toLowerCase() === trimmed.toLowerCase())!.name
    : 'General';
};

/** Folder list with the employee's own document counts + total mandatory shortfall. */
export async function folderSummary(companyId: string, employeeId: string | null) {
  const counts = employeeId
    ? await prisma.document.groupBy({
        by: ['category'],
        where: { companyId, employeeId },
        _count: { _all: true },
      })
    : [];
  const byCategory = new Map(counts.map((c) => [c.category, c._count._all]));
  const folders = DOCUMENT_FOLDERS.map((f) => ({
    name: f.name,
    required: f.required,
    added: byCategory.get(f.name) ?? 0,
  }));
  const pending = folders.reduce((s, f) => s + Math.max(0, f.required - f.added), 0);
  return { pending, folders };
}

export type DocumentScope = 'me' | 'company' | 'employees';

/**
 * Non-privileged users see their own documents + company-wide ones.
 * `scope` narrows the list: me = own personal documents, company = company-wide,
 * employees = other people's personal documents (ADMIN/HR only).
 */
export async function listDocuments(
  companyId: string,
  viewer: { employeeId: string | null; canViewAll: boolean },
  scope?: DocumentScope,
  employeeId?: string
) {
  if (scope === 'employees' && !viewer.canViewAll) throw ApiError.forbidden('Only HR or Admin can see other employees’ documents');
  const visible = viewer.canViewAll ? {} : { OR: [{ employeeId: null }, { employeeId: viewer.employeeId ?? '' }] };
  const scoped =
    scope === 'me'
      ? { employeeId: viewer.employeeId ?? '' }
      : scope === 'company'
        ? { employeeId: null }
        : scope === 'employees'
          ? { employeeId: employeeId ?? (viewer.employeeId ? { not: viewer.employeeId } : { not: null }) }
          : visible;
  return prisma.document.findMany({
    where: { companyId, ...scoped },
    include: {
      employee: { select: { id: true, name: true } },
      uploadedBy: { select: { id: true, name: true } },
    },
    orderBy: { uploadedOn: 'desc' },
    take: 200,
  });
}

/** Employees who have personal documents (for the HR/Admin filter), with counts, A→Z. Excludes the caller. */
export async function documentOwners(companyId: string, viewerEmployeeId: string | null) {
  const groups = await prisma.document.groupBy({
    by: ['employeeId'],
    where: { companyId, employeeId: viewerEmployeeId ? { not: viewerEmployeeId } : { not: null } },
    _count: { _all: true },
  });
  const counts = new Map(groups.map((g) => [g.employeeId, g._count._all]));
  const people = await prisma.employee.findMany({
    where: { companyId, id: { in: [...counts.keys()].filter((id): id is string => !!id) } },
    select: { id: true, name: true, employeeCode: true, isActive: true },
    orderBy: { name: 'asc' },
  });
  return people.map((p) => ({ ...p, documents: counts.get(p.id) ?? 0 }));
}

export interface UploadDocumentInput {
  file: DocumentFile;
  name?: string;
  /** Folder of the "My documents" view; defaults to General. */
  category?: string;
  /** null = company-wide document, visible to everyone in the tenant. */
  ownerEmployeeId: string | null;
  uploadedById: string | null;
}

export async function uploadDocument(companyId: string, input: UploadDocumentInput) {
  const { file, name, category, ownerEmployeeId, uploadedById } = input;
  const key = objectKey(companyId, 'documents', file.originalname);
  await putObject(key, file.buffer, file.mimetype || 'application/octet-stream');
  return prisma.document.create({
    data: {
      companyId,
      employeeId: ownerEmployeeId,
      name: name?.trim() || file.originalname,
      category: normalizeCategory(category),
      fileKey: key,
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.size,
      uploadedById,
    },
  });
}

export interface UpdateDocumentInput {
  name?: string;
  category?: string;
  /** Ownership change — privileged callers only (enforced here). */
  employeeId?: string;
  companyWide?: boolean;
}

/**
 * Edit a document's details. The owner may rename/re-folder their own
 * document; only ADMIN/HR can touch other people's documents or change
 * who a document belongs to.
 */
export async function updateDocument(
  companyId: string,
  documentId: string,
  input: UpdateDocumentInput,
  viewer: { employeeId: string | null; isPrivileged: boolean }
) {
  const document = await prisma.document.findFirst({ where: { id: documentId, companyId } });
  if (!document) throw ApiError.notFound('Document not found');
  const isOwner = document.employeeId !== null && document.employeeId === viewer.employeeId;
  if (!viewer.isPrivileged && !isOwner) throw ApiError.forbidden();
  if (!viewer.isPrivileged && (input.employeeId !== undefined || input.companyWide !== undefined)) {
    throw ApiError.forbidden('Only ADMIN/HR can change who a document belongs to');
  }

  let ownerId = document.employeeId;
  if (input.companyWide === true) {
    ownerId = null;
  } else if (input.employeeId) {
    const target = await prisma.employee.findFirst({ where: { id: input.employeeId, companyId } });
    if (!target) throw ApiError.badRequest('Employee not found in this company');
    ownerId = target.id;
  }

  return prisma.document.update({
    where: { id: document.id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.category !== undefined ? { category: normalizeCategory(input.category) } : {}),
      employeeId: ownerId,
    },
    include: {
      employee: { select: { id: true, name: true } },
      uploadedBy: { select: { id: true, name: true } },
    },
  });
}

export async function downloadUrl(
  companyId: string,
  documentId: string,
  viewer: { employeeId: string | null; canViewAll: boolean },
  opts: { inline?: boolean } = {} // inline = view in the browser instead of downloading
) {
  const document = await prisma.document.findFirst({ where: { id: documentId, companyId } });
  if (!document) throw ApiError.notFound('Document not found');
  if (!viewer.canViewAll && document.employeeId !== null && document.employeeId !== viewer.employeeId) {
    throw ApiError.forbidden();
  }
  return {
    url: await presignedGetUrl(document.fileKey, document.name, opts.inline ? 'inline' : 'attachment'),
    expiresInSeconds: FILE_LINK_TTL_SECONDS,
  };
}

export async function deleteDocument(companyId: string, documentId: string): Promise<void> {
  const document = await prisma.document.findFirst({ where: { id: documentId, companyId } });
  if (!document) throw ApiError.notFound('Document not found');
  await prisma.document.delete({ where: { id: document.id } });
  await removeObject(document.fileKey).catch(() => undefined); // metadata is the source of truth
}
