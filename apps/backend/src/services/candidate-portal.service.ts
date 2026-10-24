/**
 * Candidate portal (no login): a token link HR shares with the candidate
 * (issued by POST /recruitment/applications/:id/portal-link or on sending the
 * offer). The candidate views and answers the offer, uploads the signed copy
 * and their pre-joining documents.
 *
 * Security: only the sha256 of the token is stored; lookups compare hashes in
 * constant time, links expire, and the view exposes this candidate's own data
 * only — never internal notes, ratings, feedback or anyone else's salary.
 */
import { timingSafeEqual } from 'crypto';
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/http';
import { type UploadedFile, hashToken } from './recruitment.helpers';
import * as offerService from './offer.service';
import * as preOnboardingService from './pre-onboarding.service';

const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;
/** Offer states the candidate can see. */
const VISIBLE_OFFER = ['SENT', 'NEGOTIATING', 'ACCEPTED'];

/** Resolves a portal token to its application, or 404 (same answer for unknown and expired links). */
async function resolve(token: string) {
  const invalid = ApiError.notFound('This link is invalid or has expired. Please contact HR for a new link.');
  if (!TOKEN_RE.test(token)) throw invalid;
  const hash = hashToken(token);
  const app = await prisma.application.findUnique({
    where: { portalTokenHash: hash },
    include: {
      candidate: true,
      job: { select: { id: true, title: true, department: true, location: true, companyId: true } },
      offer: true,
      preOnboarding: { include: { documents: { orderBy: { type: 'asc' } } } },
    },
  });
  if (!app?.portalTokenHash) throw invalid;
  const a = Buffer.from(app.portalTokenHash, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw invalid;
  if (!app.portalExpiresAt || app.portalExpiresAt.getTime() < Date.now()) throw invalid;
  return app;
}

/** What the candidate sees. */
export async function view(token: string) {
  const app = await resolve(token);
  const company = await prisma.company.findUnique({ where: { id: app.companyId }, select: { name: true } });
  const offer = app.offer && VISIBLE_OFFER.includes(app.offer.status) ? app.offer : null;
  const letterUrl = offer?.letterDocumentId
    ? await offerService.letterFileUrl(app.companyId, offer.letterDocumentId, offerService.offerLetterFileName(app.candidate.name), 'attachment').catch(() => null)
    : null;
  const po = app.preOnboarding && app.preOnboarding.status !== 'CANCELLED' ? app.preOnboarding : null;
  const expired = !!offer?.validUntil && offer.validUntil.getTime() < Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  return {
    company: { name: company?.name ?? '' },
    candidate: { name: app.candidate.name, email: app.candidate.email, code: app.candidate.code },
    job: { title: app.job.title, department: app.job.department, location: app.job.location },
    application: { code: app.code, status: app.stage === 'JOINED' ? 'JOINED' : app.stage.includes('DECLINED') || app.stage === 'WITHDRAWN' || app.stage === 'REJECTED' ? 'CLOSED' : 'ACTIVE' },
    offer: offer
      ? {
          code: offer.code,
          status: offer.status,
          designation: offer.designation,
          department: offer.department,
          ctcAnnual: offer.ctcAnnual,
          joiningDate: offer.joiningDate,
          workLocation: offer.workLocation,
          employmentType: offer.employmentType,
          probationMonths: offer.probationMonths,
          noticePeriodDays: offer.noticePeriodDays,
          terms: offer.terms,
          validUntil: offer.validUntil,
          sentAt: offer.sentAt,
          respondedAt: offer.respondedAt,
          acceptedVia: offer.acceptedVia,
          counterCtc: offer.counterCtc,
          negotiationNote: offer.negotiationNote,
          hasSignedCopy: !!offer.signedFileKey,
          signedFileName: offer.signedFileName,
          letterUrl,
          canRespond: ['SENT', 'NEGOTIATING'].includes(offer.status) && !expired,
          expired,
        }
      : null,
    preJoining: po
      ? {
          status: po.status,
          expectedJoiningDate: po.expectedJoiningDate,
          confirmedJoiningDate: po.confirmedJoiningDate,
          instructions: po.instructions,
          canUpload: !['JOINED', 'CANCELLED'].includes(po.status),
          documents: po.documents.map((d) => ({
            id: d.id,
            type: d.type,
            name: d.name,
            required: d.required,
            status: d.status,
            // Remarks are only meaningful (and meant for the candidate) on a rejected upload.
            remarks: d.status === 'REJECTED' ? d.remarks : '',
            fileName: d.fileName,
            submittedAt: d.submittedAt,
          })),
        }
      : null,
    linkExpiresAt: app.portalExpiresAt,
  };
}

async function offerFor(token: string) {
  const app = await resolve(token);
  if (!app.offer || !VISIBLE_OFFER.includes(app.offer.status)) throw ApiError.badRequest('There is no open offer on this link');
  return { app, offer: app.offer };
}

export async function accept(token: string) {
  const { app, offer } = await offerFor(token);
  await offerService.respond(app.companyId, offer.id, { response: 'ACCEPT' }, { via: 'PORTAL', actorId: null });
  return { app, offer };
}

export async function decline(token: string, reason: string) {
  const { app, offer } = await offerFor(token);
  await offerService.respond(app.companyId, offer.id, { response: 'DECLINE', reason }, { via: 'PORTAL', actorId: null });
  return { app, offer };
}

export async function negotiate(token: string, input: { counterCtc?: number; note: string }) {
  const { app, offer } = await offerFor(token);
  await offerService.respond(app.companyId, offer.id, { response: 'NEGOTIATE', ...input }, { via: 'PORTAL', actorId: null });
  return { app, offer };
}

export async function uploadSigned(token: string, file: UploadedFile | undefined) {
  const { app, offer } = await offerFor(token);
  await offerService.uploadSigned(app.companyId, offer.id, file, { via: 'PORTAL' });
  return { app, offer };
}

export async function uploadDocument(token: string, docId: string, file: UploadedFile | undefined) {
  const app = await resolve(token);
  const po = app.preOnboarding;
  if (!po || po.status === 'CANCELLED') throw ApiError.badRequest('Document upload opens once you have accepted the offer');
  if (!po.documents.some((d) => d.id === docId)) throw ApiError.notFound('Document not found');
  await preOnboardingService.uploadDocument(app.companyId, po.id, docId, file, { actorId: null, via: 'PORTAL' });
  return { app, preOnboardingId: po.id };
}

/** Daily: clears expired portal tokens (the hash is useless after expiry). */
export async function cleanupExpiredTokens(companyId: string): Promise<number> {
  const r = await prisma.application.updateMany({
    where: { companyId, portalTokenHash: { not: null }, portalExpiresAt: { lt: new Date() } },
    data: { portalTokenHash: null, portalExpiresAt: null },
  });
  return r.count;
}
