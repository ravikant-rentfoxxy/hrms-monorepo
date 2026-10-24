/**
 * Pre-joining (after offer acceptance) and the joining step.
 *
 *   INITIATED → DOCUMENTS_SUBMITTED → DOCUMENTS_VERIFIED → READY_TO_JOIN → JOINED | CANCELLED
 *
 * HR (or the candidate through the portal) uploads the checklist documents,
 * HR verifies / rejects each one, runs background verification when required
 * and confirms the joining date. READY_TO_JOIN needs every required document
 * VERIFIED, BGV CLEAR (when required) and a confirmed joining date.
 * The application stage mirrors it: PRE_ONBOARDING → DOCUMENTS_VERIFIED → READY_TO_JOIN → JOINED.
 *
 * Joining creates the Employee (ID + login), applies salary / probation /
 * notice, shift and assets, files the verified documents and offer letters
 * in the employee's documents and starts the onboarding checklist.
 */
import { randomBytes } from 'crypto';
import type { Request } from 'express';
import { CopyDestinationOptions, CopySourceOptions } from 'minio';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify, notifyCandidate } from '../lib/notify';
import { logger } from '../lib/logger';
import { BUCKET, minio, objectKey, presignedGetUrl, putObject, removeObject } from '../lib/storage';
import { ApiError } from '../utils/http';
import { dateOnlyUTC } from '../utils/geo';
import { createEmployee } from './employee.service';
import { initialStatus, recordHistory, setEmploymentStatus } from './employee-history.service';
import { LETTERS_FOLDER } from './letter.service';
import { assignShift, getShift } from './shift.service';
import { completeTasksFromPrejoining } from './onboarding.service';
import { standardSalaryColumns } from './salary-revision.service';
import { assignAsset } from './asset.service';
import { fillJobIfComplete } from './recruitment.service';
import { type Db, type UploadedFile, assertDocumentFile, notifyReferrer, platformLabel, setStage, sourceForPlatform } from './recruitment.helpers';
import { type Actor, employeeNames, hrEmployeeIds, isHrAdmin } from './talent.helpers';

export const PRE_JOINING_DOC_TYPES = [
  'ID_PROOF', 'ADDRESS_PROOF', 'PAN', 'AADHAAR', 'PHOTO', 'EDUCATION', 'EXPERIENCE', 'RELIEVING', 'PAYSLIPS', 'BANK', 'OTHER',
] as const;
export const BGV_STATUSES = ['NOT_REQUIRED', 'PENDING', 'IN_PROGRESS', 'CLEAR', 'DISCREPANCY'] as const;

/** Default checklist; experience documents are only required from experienced hires. */
export function defaultDocuments(experienced: boolean) {
  return [
    { type: 'PAN', name: 'PAN card', required: true },
    { type: 'AADHAAR', name: 'Aadhaar card / government ID proof', required: true },
    { type: 'ADDRESS_PROOF', name: 'Address proof', required: true },
    { type: 'PHOTO', name: 'Passport-size photograph', required: true },
    { type: 'EDUCATION', name: 'Education certificates (highest qualification)', required: true },
    { type: 'EXPERIENCE', name: 'Experience / relieving letters', required: experienced },
    { type: 'PAYSLIPS', name: 'Last 3 months payslips', required: experienced },
    { type: 'BANK', name: 'Bank proof (cancelled cheque / passbook)', required: true },
  ];
}

/** Employee document folder for a pre-joining document type. */
const FOLDER: Record<string, string> = {
  PAN: 'Identity', AADHAAR: 'Identity', ID_PROOF: 'Identity', ADDRESS_PROOF: 'Identity', PHOTO: 'Onboarding',
  EDUCATION: 'Degrees & Certificates', EXPERIENCE: 'Previous Experience', RELIEVING: 'Previous Experience',
  PAYSLIPS: 'Previous Experience', BANK: 'Onboarding', OTHER: 'Onboarding',
};

const longDate = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

async function getOrThrow(companyId: string, id: string, db: Db = prisma) {
  const po = await db.preOnboarding.findFirst({
    where: { id, companyId },
    include: {
      documents: { orderBy: { type: 'asc' } },
      application: { include: { candidate: true, job: true, offer: true, posting: true } },
    },
  });
  if (!po) throw ApiError.notFound('Pre-onboarding record not found');
  return po;
}

const isOpen = (status: string) => !['JOINED', 'CANCELLED'].includes(status);

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Pure status rule (exported for tests). */
export function computeStatus(po: {
  bgvRequired: boolean;
  bgvStatus: string;
  confirmedJoiningDate: Date | null;
  documents: { required: boolean; status: string }[];
}): 'INITIATED' | 'DOCUMENTS_SUBMITTED' | 'DOCUMENTS_VERIFIED' | 'READY_TO_JOIN' {
  const required = po.documents.filter((d) => d.required);
  const verified = required.every((d) => d.status === 'VERIFIED');
  const submitted = required.every((d) => d.status === 'SUBMITTED' || d.status === 'VERIFIED');
  const bgvOk = !po.bgvRequired || po.bgvStatus === 'CLEAR';
  if (verified && bgvOk && po.confirmedJoiningDate) return 'READY_TO_JOIN';
  if (verified) return 'DOCUMENTS_VERIFIED';
  if (submitted && required.length > 0) return 'DOCUMENTS_SUBMITTED';
  return 'INITIATED';
}

/** What still blocks READY_TO_JOIN, for the UI and error messages. */
export function blockers(po: {
  bgvRequired: boolean;
  bgvStatus: string;
  confirmedJoiningDate: Date | null;
  documents: { required: boolean; status: string; name: string }[];
}): string[] {
  const out: string[] = [];
  const pending = po.documents.filter((d) => d.required && d.status !== 'VERIFIED');
  if (pending.length) out.push(`Verify ${pending.length} required document${pending.length === 1 ? '' : 's'}: ${pending.map((d) => d.name).join(', ')}`);
  if (po.bgvRequired && po.bgvStatus !== 'CLEAR') out.push(`Background verification is ${po.bgvStatus.toLowerCase().replace(/_/g, ' ')}`);
  if (!po.confirmedJoiningDate) out.push('Confirm the joining date');
  return out;
}

const STAGE_FOR: Record<string, string> = {
  INITIATED: 'PRE_ONBOARDING',
  DOCUMENTS_SUBMITTED: 'PRE_ONBOARDING',
  DOCUMENTS_VERIFIED: 'DOCUMENTS_VERIFIED',
  READY_TO_JOIN: 'READY_TO_JOIN',
};

/** Re-derives the pre-onboarding status and mirrors it on the application stage. */
export async function recompute(companyId: string, id: string, actorId: string | null) {
  const po = await getOrThrow(companyId, id);
  if (!isOpen(po.status)) return po;
  const status = computeStatus(po);
  if (status !== po.status) {
    await prisma.preOnboarding.update({ where: { id }, data: { status } });
    if (status === 'READY_TO_JOIN') {
      await notify(companyId, [...(await hrEmployeeIds(companyId)), po.application.job.hiringManagerId], {
        event: 'recruitment.ready_to_join',
        title: 'Candidate ready to join',
        body: `${po.application.candidate.name} is ready to join on ${longDate(po.confirmedJoiningDate ?? po.expectedJoiningDate)}.`,
        link: `/recruitment/pre-onboarding/${id}`,
      });
    }
  }
  const stage = STAGE_FOR[status] ?? 'PRE_ONBOARDING';
  if (po.application.stage !== stage) {
    await setStage(prisma, companyId, po.application, stage, { actorId, note: `Pre-joining: ${status.toLowerCase().replace(/_/g, ' ')}` });
  }
  return getOrThrow(companyId, id);
}

// ---------------------------------------------------------------------------
// Initiate / read
// ---------------------------------------------------------------------------

/**
 * Starts pre-joining for an accepted offer (idempotent: returns the existing
 * record; a cancelled one is re-opened).
 */
export async function initiate(companyId: string, applicationId: string, actorId: string | null) {
  const app = await prisma.application.findFirst({
    where: { id: applicationId, companyId },
    include: { offer: true, candidate: true, job: true, preOnboarding: true },
  });
  if (!app) throw ApiError.notFound('Application not found');
  if (app.offer?.status !== 'ACCEPTED') throw ApiError.badRequest('Pre-joining starts once the candidate has accepted the offer');
  if (app.preOnboarding && app.preOnboarding.status !== 'CANCELLED') return app.preOnboarding;

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
  const joining = app.offer.joiningDate;
  const instructions = [
    `Welcome to ${company?.name ?? 'the team'}! Your joining date is ${longDate(joining)}.`,
    `Please upload the documents listed below before your joining date. Accepted formats: PDF, JPG, PNG, WEBP or HEIC.`,
    `On day one, report to ${app.offer.workLocation || app.job.location || 'the office'} at 9:30 AM with the originals of the documents for verification.`,
  ].join('\n\n');
  const po = app.preOnboarding
    ? await prisma.preOnboarding.update({
        where: { id: app.preOnboarding.id },
        data: { status: 'INITIATED', expectedJoiningDate: joining, startedById: actorId },
      })
    : await prisma.preOnboarding.create({
        data: {
          companyId,
          applicationId,
          expectedJoiningDate: joining,
          instructions,
          startedById: actorId,
          documents: {
            create: defaultDocuments(app.candidate.experienceYears > 0).map((d) => ({ ...d, companyId })),
          },
        },
      });
  await setStage(prisma, companyId, app, 'PRE_ONBOARDING', { actorId, note: 'Pre-joining started' });
  await notifyCandidate(companyId, app.candidate, {
    event: 'recruitment.pre_joining_started',
    title: `Next steps before you join ${company?.name ?? ''}`.trim(),
    body: `${instructions}\n\nUpload your documents on the candidate portal link shared by HR.`,
  });
  return po;
}

export async function list(companyId: string, filter: { status?: string }) {
  const where: Prisma.PreOnboardingWhereInput = { companyId };
  if (filter.status) where.status = filter.status;
  const rows = await prisma.preOnboarding.findMany({
    where,
    include: {
      documents: { select: { status: true, required: true } },
      application: {
        select: {
          id: true, code: true, stage: true,
          candidate: { select: { id: true, code: true, name: true, email: true, phone: true } },
          job: { select: { id: true, code: true, title: true } },
          offer: { select: { id: true, code: true, designation: true, joiningDate: true } },
        },
      },
    },
    orderBy: [{ expectedJoiningDate: 'asc' }],
    take: 500,
  });
  return rows.map(({ documents, ...r }) => ({
    ...r,
    documentsTotal: documents.length,
    documentsRequired: documents.filter((d) => d.required).length,
    documentsSubmitted: documents.filter((d) => d.status === 'SUBMITTED' || d.status === 'VERIFIED').length,
    documentsVerified: documents.filter((d) => d.status === 'VERIFIED').length,
  }));
}

export async function get(companyId: string, id: string) {
  const po = await getOrThrow(companyId, id);
  const people = await employeeNames(companyId, [po.startedById, po.application.job.hiringManagerId, ...po.documents.map((d) => d.verifiedById)]);
  const { candidate, job, offer, posting, portalTokenHash, ...app } = po.application;
  const { resumeKey: _r, ...cand } = candidate;
  return {
    ...po,
    blockers: isOpen(po.status) ? blockers(po) : [],
    startedBy: po.startedById ? (people.get(po.startedById) ?? null) : null,
    documents: po.documents.map((d) => ({ ...d, hasFile: !!d.fileKey, fileKey: undefined, verifiedBy: d.verifiedById ? (people.get(d.verifiedById) ?? null) : null })),
    application: {
      ...app,
      candidate: cand,
      job: { id: job.id, code: job.code, title: job.title, department: job.department, location: job.location, hiringManagerId: job.hiringManagerId },
      hiringManager: job.hiringManagerId ? (people.get(job.hiringManagerId) ?? null) : null,
      offer,
      posting: posting ? { id: posting.id, label: platformLabel(posting) } : null,
      portal: { active: !!portalTokenHash && !!app.portalExpiresAt && app.portalExpiresAt > new Date(), expiresAt: app.portalExpiresAt },
    },
  };
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

export interface PreOnboardingInput {
  instructions?: string;
  expectedJoiningDate?: Date;
  bgvRequired?: boolean;
  bgvStatus?: string;
  bgvVendor?: string;
  bgvNotes?: string;
}

export async function update(companyId: string, id: string, actor: Actor, input: PreOnboardingInput) {
  const before = await getOrThrow(companyId, id);
  if (!isOpen(before.status)) throw ApiError.badRequest(`Pre-joining is ${before.status.toLowerCase()}`);
  const bgvRequired = input.bgvRequired ?? before.bgvRequired;
  let bgvStatus = input.bgvStatus ?? before.bgvStatus;
  if (!bgvRequired) bgvStatus = 'NOT_REQUIRED';
  else if (bgvStatus === 'NOT_REQUIRED') bgvStatus = 'PENDING';
  const data: Prisma.PreOnboardingUpdateInput = {
    ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
    ...(input.expectedJoiningDate ? { expectedJoiningDate: dateOnlyUTC(input.expectedJoiningDate) } : {}),
    ...(input.bgvVendor !== undefined ? { bgvVendor: input.bgvVendor } : {}),
    ...(input.bgvNotes !== undefined ? { bgvNotes: input.bgvNotes } : {}),
    bgvRequired,
    bgvStatus,
    ...(bgvStatus === 'CLEAR' && before.bgvStatus !== 'CLEAR' ? { bgvCompletedAt: new Date() } : bgvStatus !== 'CLEAR' ? { bgvCompletedAt: null } : {}),
  };
  await prisma.preOnboarding.update({ where: { id }, data });
  const after = await recompute(companyId, id, actor.employeeId);
  if (input.instructions !== undefined && input.instructions !== before.instructions) {
    await notifyCandidate(companyId, before.application.candidate, {
      event: 'recruitment.joining_instructions',
      title: 'Updated joining instructions',
      body: input.instructions,
    });
  }
  return { before, after };
}

export async function confirmJoining(companyId: string, id: string, actor: Actor, date: Date) {
  const before = await getOrThrow(companyId, id);
  if (!isOpen(before.status)) throw ApiError.badRequest(`Pre-joining is ${before.status.toLowerCase()}`);
  const confirmed = dateOnlyUTC(date);
  await prisma.preOnboarding.update({ where: { id }, data: { confirmedJoiningDate: confirmed, expectedJoiningDate: confirmed } });
  const after = await recompute(companyId, id, actor.employeeId);
  await notifyCandidate(companyId, before.application.candidate, {
    event: 'recruitment.joining_confirmed',
    title: 'Your joining date is confirmed',
    body: `We look forward to seeing you on ${longDate(confirmed)}.`,
  });
  await notify(companyId, [before.application.job.hiringManagerId], {
    event: 'recruitment.joining_confirmed',
    title: 'Joining date confirmed',
    body: `${before.application.candidate.name} joins on ${longDate(confirmed)}.`,
    link: `/recruitment/pre-onboarding/${id}`,
  });
  return { before, after };
}

export async function addDocument(companyId: string, id: string, actor: Actor, input: { type: string; name: string; required?: boolean }) {
  const po = await getOrThrow(companyId, id);
  if (!isOpen(po.status)) throw ApiError.badRequest(`Pre-joining is ${po.status.toLowerCase()}`);
  await prisma.preJoiningDocument.create({ data: { companyId, preOnboardingId: id, type: input.type, name: input.name, required: input.required ?? true } });
  return recompute(companyId, id, actor.employeeId);
}

async function getDocOrThrow(companyId: string, preOnboardingId: string, docId: string) {
  const doc = await prisma.preJoiningDocument.findFirst({ where: { id: docId, companyId, preOnboardingId } });
  if (!doc) throw ApiError.notFound('Document not found');
  return doc;
}

export async function updateDocument(companyId: string, id: string, docId: string, actor: Actor, input: { name?: string; required?: boolean }) {
  const po = await getOrThrow(companyId, id);
  if (!isOpen(po.status)) throw ApiError.badRequest(`Pre-joining is ${po.status.toLowerCase()}`);
  await getDocOrThrow(companyId, id, docId);
  await prisma.preJoiningDocument.update({ where: { id: docId }, data: input });
  return recompute(companyId, id, actor.employeeId);
}

export async function removeDocument(companyId: string, id: string, docId: string, actor: Actor) {
  const po = await getOrThrow(companyId, id);
  if (!isOpen(po.status)) throw ApiError.badRequest(`Pre-joining is ${po.status.toLowerCase()}`);
  const doc = await getDocOrThrow(companyId, id, docId);
  if (doc.status === 'VERIFIED') throw ApiError.badRequest('A verified document cannot be removed — mark it optional instead');
  await prisma.preJoiningDocument.delete({ where: { id: docId } });
  if (doc.fileKey) await removeObject(doc.fileKey).catch(() => undefined);
  return recompute(companyId, id, actor.employeeId);
}

/** Stores a checklist file (HR upload or the candidate via the portal) → SUBMITTED. */
export async function uploadDocument(companyId: string, id: string, docId: string, file: UploadedFile | undefined, by: { actorId: string | null; via: 'HR' | 'PORTAL' }) {
  assertDocumentFile(file);
  const po = await getOrThrow(companyId, id);
  if (!isOpen(po.status)) throw ApiError.badRequest(`Pre-joining is ${po.status.toLowerCase()}`);
  const doc = await getDocOrThrow(companyId, id, docId);
  if (doc.status === 'VERIFIED') throw ApiError.badRequest('This document is already verified');
  const key = objectKey(companyId, 'pre-joining', file.originalname);
  await putObject(key, file.buffer, file.mimetype);
  await prisma.preJoiningDocument.update({
    where: { id: docId },
    data: {
      fileKey: key, fileName: file.originalname, mimeType: file.mimetype, size: file.size, status: 'SUBMITTED',
      submittedAt: new Date(), remarks: '', verifiedById: null, verifiedAt: null,
    },
  });
  if (doc.fileKey) await removeObject(doc.fileKey).catch(() => undefined);
  const after = await recompute(companyId, id, by.actorId);
  if (by.via === 'PORTAL') {
    await notify(companyId, await hrEmployeeIds(companyId), {
      event: 'recruitment.pre_joining_document',
      title: 'Pre-joining document uploaded',
      body: `${po.application.candidate.name} uploaded "${doc.name}" — please verify.`,
      link: `/recruitment/pre-onboarding/${id}`,
    });
  }
  return after;
}

export async function verifyDocument(
  companyId: string,
  id: string,
  docId: string,
  actor: Actor,
  input: { decision: 'VERIFIED' | 'REJECTED'; remarks?: string }
) {
  const po = await getOrThrow(companyId, id);
  if (!isOpen(po.status)) throw ApiError.badRequest(`Pre-joining is ${po.status.toLowerCase()}`);
  const doc = await getDocOrThrow(companyId, id, docId);
  if (!doc.fileKey) throw ApiError.badRequest('Nothing has been uploaded for this document yet');
  if (input.decision === 'REJECTED' && !input.remarks?.trim()) throw ApiError.badRequest('Tell the candidate why the document was rejected');
  await prisma.preJoiningDocument.update({
    where: { id: docId },
    data: { status: input.decision, remarks: input.remarks ?? '', verifiedById: actor.employeeId, verifiedAt: new Date() },
  });
  const after = await recompute(companyId, id, actor.employeeId);
  if (input.decision === 'REJECTED') {
    await notifyCandidate(companyId, po.application.candidate, {
      event: 'recruitment.pre_joining_document_rejected',
      title: `Please re-upload: ${doc.name}`,
      body: `${input.remarks ?? ''}\n\nUpload a new copy on your candidate portal.`.trim(),
    });
  }
  return { before: doc, after };
}

export async function documentUrl(companyId: string, id: string, docId: string, inline: boolean) {
  const doc = await getDocOrThrow(companyId, id, docId);
  if (!doc.fileKey) throw ApiError.notFound('Nothing has been uploaded for this document yet');
  return { url: await presignedGetUrl(doc.fileKey, doc.fileName || doc.name, inline ? 'inline' : 'attachment') };
}

/** Candidate dropped out before joining: pre-joining CANCELLED, application WITHDRAWN. */
export async function cancel(companyId: string, id: string, actor: Actor, reason: string) {
  const po = await getOrThrow(companyId, id);
  if (!isOpen(po.status)) throw ApiError.badRequest(`Pre-joining is ${po.status.toLowerCase()}`);
  await prisma.preOnboarding.update({ where: { id }, data: { status: 'CANCELLED' } });
  await setStage(prisma, companyId, po.application, 'WITHDRAWN', {
    actorId: actor.employeeId,
    rejectionReason: reason,
    data: { portalTokenHash: null, portalExpiresAt: null },
  });
  await notifyReferrer(companyId, po.application.candidate, po.application.job.title, 'WITHDRAWN');
  await notify(companyId, [po.application.job.hiringManagerId], {
    event: 'recruitment.joining_cancelled',
    title: 'Joining cancelled',
    body: `${po.application.candidate.name} will not be joining: ${reason}`,
    link: `/recruitment/applications/${po.applicationId}`,
  });
  return po;
}

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

export interface JoinInput {
  joiningDate?: Date;
  role: 'HR' | 'MANAGER' | 'EMPLOYEE';
  managerId?: string | null;
  departmentId?: string | null;
  designationId?: string | null;
  gradeId?: string | null;
  officeId?: string | null;
  shiftId?: string | null;
  employmentType?: string;
  probationMonths?: number;
  noticePeriodDays?: number;
  ctcAnnual?: number;
  assetIds?: string[];
}

const addMonths = (d: Date, months: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));

async function copyToDocuments(companyId: string, employeeId: string, src: { key: string; fileName: string; mimeType: string; name: string; category: string }, uploadedById: string | null) {
  const key = objectKey(companyId, 'documents', src.fileName || 'document');
  await minio.copyObject(new CopySourceOptions({ Bucket: BUCKET, Object: src.key }), new CopyDestinationOptions({ Bucket: BUCKET, Object: key }));
  const size = await minio.statObject(BUCKET, key).then((st) => st.size).catch(() => 0);
  return prisma.document.create({
    data: { companyId, employeeId, name: src.name, category: src.category, fileKey: key, mimeType: src.mimeType || 'application/octet-stream', size, uploadedById },
  });
}

/**
 * HR confirms the actual joining: creates the employee (Employee ID + login —
 * the joiner sets a password with "Forgot password"), applies the offer's
 * terms, shift and assets, files documents and closes the hiring loop.
 */
export async function join(companyId: string, id: string, actor: Actor, input: JoinInput, req: Request | null) {
  if (!isHrAdmin(actor.role)) throw ApiError.forbidden('Only HR can confirm joining');
  const po = await getOrThrow(companyId, id);
  const app = po.application;
  const offer = app.offer;
  if (po.status === 'JOINED') throw ApiError.conflict('This candidate has already joined');
  if (po.status !== 'READY_TO_JOIN') {
    throw ApiError.badRequest(`Not ready to join yet: ${blockers(po).join('; ') || po.status.toLowerCase()}`);
  }
  if (!offer || offer.status !== 'ACCEPTED') throw ApiError.badRequest('The offer is not accepted');
  if (offer.employeeId) throw ApiError.conflict('This candidate has already been hired');

  // Validate everything that could fail before the employee exists.
  if (input.shiftId) {
    const shift = await getShift(companyId, input.shiftId);
    if (!shift.isActive) throw ApiError.badRequest('That shift is inactive');
  }
  const assetIds = [...new Set(input.assetIds ?? [])];
  if (assetIds.length) {
    const assets = await prisma.asset.findMany({ where: { companyId, id: { in: assetIds } }, select: { id: true, tag: true, status: true } });
    if (assets.length !== assetIds.length) throw ApiError.badRequest('One or more assets were not found');
    const busy = assets.filter((a) => a.status !== 'AVAILABLE');
    if (busy.length) throw ApiError.badRequest(`Not available: ${busy.map((a) => a.tag).join(', ')}`);
  }

  const joiningDate = dateOnlyUTC(input.joiningDate ?? po.confirmedJoiningDate ?? offer.joiningDate);
  const probationMonths = input.probationMonths ?? offer.probationMonths;
  const probationEndDate = probationMonths > 0 ? addMonths(joiningDate, probationMonths) : null;
  const ctc = input.ctcAnnual ?? offer.ctcAnnual;
  // Source code (LINKEDIN, NAUKRI, REFERRAL, ...) like the backfill; the posting itself stays linked via sourceApplicationId.
  const hireSource = app.posting ? sourceForPlatform(app.posting.platform) : app.source || app.candidate.source;

  // Claim the record so two concurrent joins cannot both create an employee.
  const claimed = await prisma.preOnboarding.updateMany({ where: { id, status: 'READY_TO_JOIN' }, data: { status: 'JOINED', joinedAt: new Date() } });
  if (claimed.count === 0) throw ApiError.conflict('This candidate was just processed by someone else');

  let created;
  try {
    created = await createEmployee(
      companyId,
      {
        name: app.candidate.name,
        email: app.candidate.email,
        // Never used: the joiner sets their own password via "Forgot password".
        password: randomBytes(18).toString('base64url'),
        role: input.role,
        phone: app.candidate.phone,
        designation: offer.designation,
        department: offer.department || app.job.department,
        ...(input.departmentId ? { departmentId: input.departmentId } : {}),
        ...(input.designationId ? { designationId: input.designationId } : {}),
        ...(input.gradeId ? { gradeId: input.gradeId } : {}),
        ...(input.officeId ? { officeId: input.officeId } : {}),
        location: offer.workLocation || app.job.location,
        joiningDate,
        managerId: input.managerId === undefined ? app.job.hiringManagerId : input.managerId,
        employmentType: input.employmentType ?? offer.employmentType,
        probationEndDate,
        noticePeriodDays: input.noticePeriodDays ?? offer.noticePeriodDays,
        // Same split as the offer letter: the company standard structure (Salary → Components).
        ...(await standardSalaryColumns(companyId, ctc)),
      },
      req,
      // We write our own JOINED row below, linked to the application.
      { recordJoined: false }
    );
  } catch (err) {
    await prisma.preOnboarding.update({ where: { id }, data: { status: 'READY_TO_JOIN', joinedAt: null } });
    throw err;
  }
  const employeeId = created.employee.id;
  const warnings: string[] = [];

  await prisma.employee.update({ where: { id: employeeId }, data: { sourceApplicationId: app.id, hireSource } });
  const hasJoined = await prisma.employeeHistory.count({ where: { companyId, employeeId, type: 'JOINED', refType: 'Application' } });
  if (!hasJoined) {
    await recordHistory(prisma, {
      companyId,
      employeeId,
      type: 'JOINED',
      effectiveDate: joiningDate,
      title: `Joined as ${offer.designation}`,
      to: { designation: offer.designation, department: offer.department || app.job.department, ctcAnnual: ctc, hireSource },
      refType: 'Application',
      refId: app.id,
      createdById: actor.employeeId,
    });
  }
  const status = initialStatus(probationEndDate, null);
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { employmentStatus: true } });
  if (emp.employmentStatus !== status) {
    await setEmploymentStatus(prisma, companyId, employeeId, status, {
      effectiveDate: joiningDate,
      title: status === 'PROBATION' ? 'Joined on probation' : undefined,
      refType: 'Application',
      refId: app.id,
      createdById: actor.employeeId,
    });
  }

  if (input.shiftId) {
    await assignShift(companyId, { shiftId: input.shiftId, employeeIds: [employeeId], fromDate: joiningDate }).catch((err: unknown) => {
      warnings.push(`Shift not assigned: ${err instanceof Error ? err.message : 'error'}`);
    });
  }
  for (const assetId of assetIds) {
    await assignAsset(companyId, assetId, { employeeId, notes: 'Issued on joining' }, actor.employeeId).catch((err: unknown) => {
      warnings.push(`Asset not issued: ${err instanceof Error ? err.message : 'error'}`);
    });
  }

  // Verified pre-joining documents and the signed offer → employee documents (new object keys: Document.fileKey is unique).
  const filed: { type: string; documentId: string }[] = [];
  for (const doc of po.documents) {
    if (doc.status !== 'VERIFIED' || !doc.fileKey) continue;
    await copyToDocuments(
      companyId,
      employeeId,
      { key: doc.fileKey, fileName: doc.fileName, mimeType: doc.mimeType, name: doc.fileName ? `${doc.name} - ${doc.fileName}` : doc.name, category: FOLDER[doc.type] ?? 'Onboarding' },
      actor.employeeId
    ).then((d) => {
      filed.push({ type: doc.type, documentId: d.id });
    }).catch((err: unknown) => {
      logger.warn({ err, docId: doc.id }, 'could not copy pre-joining document');
      warnings.push(`Could not file "${doc.name}"`);
    });
  }
  if (offer.signedFileKey) {
    await copyToDocuments(
      companyId,
      employeeId,
      { key: offer.signedFileKey, fileName: offer.signedFileName, mimeType: /\.pdf$/i.test(offer.signedFileName) ? 'application/pdf' : 'image/jpeg', name: `Signed offer letter - ${offer.signedFileName}`, category: 'Offer Letter' },
      actor.employeeId
    ).then((d) => {
      filed.push({ type: 'OFFER', documentId: d.id });
    }).catch(() => warnings.push('Could not file the signed offer letter'));
  }
  // Onboarding started when the employee was created — don't ask again for what was just filed.
  await completeTasksFromPrejoining(companyId, employeeId, filed, actor.employeeId).catch((err: unknown) =>
    logger.warn({ err, employeeId }, 'could not pre-complete onboarding document tasks')
  );

  // The offer letter the candidate accepted becomes the employee's; letters superseded by a
  // revision / regeneration stay on the candidate record only.
  const letters = await prisma.generatedLetter.findMany({
    where: { companyId, candidateId: app.candidateId, employeeId: null },
    orderBy: { createdAt: 'desc' },
  });
  const acceptedLetter = letters.find((l) => l.id === offer.letterDocumentId) ?? letters.find((l) => l.type === 'OFFER');
  for (const letter of letters.filter((l) => l.type !== 'OFFER' || l.id === acceptedLetter?.id)) {
    let documentId = letter.documentId;
    if (!documentId && letter.fileKey) {
      const taken = await prisma.document.findUnique({ where: { fileKey: letter.fileKey }, select: { id: true } });
      if (taken) documentId = taken.id;
      else {
        const size = await minio.statObject(BUCKET, letter.fileKey).then((st) => st.size).catch(() => 0);
        const doc = await prisma.document.create({
          data: { companyId, employeeId, name: `${letter.title}.pdf`, category: LETTERS_FOLDER, fileKey: letter.fileKey, mimeType: 'application/pdf', size },
        });
        documentId = doc.id;
      }
    }
    await prisma.generatedLetter.update({ where: { id: letter.id }, data: { employeeId, documentId } });
  }

  await prisma.offer.update({ where: { id: offer.id }, data: { employeeId } });
  await setStage(prisma, companyId, app, 'JOINED', {
    actorId: actor.employeeId,
    note: `Joined as ${created.employee.employeeCode}`,
    data: { portalTokenHash: null, portalExpiresAt: null },
  });
  await prisma.preOnboarding.update({ where: { id }, data: { confirmedJoiningDate: joiningDate } });
  const jobFilled = await fillJobIfComplete(companyId, app.jobId);

  const managerId = input.managerId === undefined ? app.job.hiringManagerId : input.managerId;
  await notify(companyId, [app.job.hiringManagerId, managerId, ...(await hrEmployeeIds(companyId))], {
    event: 'recruitment.joined',
    title: 'New joiner',
    body: `${app.candidate.name} (${created.employee.employeeCode}) joined as ${offer.designation} on ${longDate(joiningDate)}.`,
    link: `/employees/${employeeId}`,
  });
  await notify(companyId, [employeeId], {
    event: 'recruitment.welcome',
    title: 'Welcome aboard!',
    body: 'Your onboarding checklist is ready in the app.',
    link: '/onboarding',
  });
  await notifyCandidate(companyId, app.candidate, {
    event: 'recruitment.login_ready',
    title: 'Your employee account is ready',
    body: `Your Employee ID is ${created.employee.employeeCode}. Sign in with ${app.candidate.email} — use "Forgot password" on the login screen to set your password.`,
  });
  await notifyReferrer(companyId, app.candidate, app.job.title, 'JOINED');

  return {
    employee: { id: employeeId, employeeCode: created.employee.employeeCode, name: created.employee.name },
    loginEmail: created.user.email,
    jobFilled,
    warnings,
  };
}
