/**
 * Offers: created for a SELECTED application, approved through the OFFER
 * approval chain (default: ADMIN), the letter is generated from the company's
 * OFFER template and sent with a candidate-portal link. The candidate accepts,
 * declines or negotiates (on the portal, or HR records the answer); HR revises
 * a negotiated offer (old terms kept in `revisions`; a higher CTC needs approval
 * again). Unanswered offers expire after validUntil (daily job).
 *
 *   DRAFT → PENDING_APPROVAL → APPROVED → SENT → NEGOTIATING → ACCEPTED | DECLINED | EXPIRED | WITHDRAWN
 *
 * Application stage: SELECTED → OFFERED (sent) → OFFER_ACCEPTED (→ PRE_ONBOARDING) | OFFER_DECLINED.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify, notifyCandidate } from '../lib/notify';
import { objectKey, presignedGetUrl, putObject, removeObject } from '../lib/storage';
import { ApiError } from '../utils/http';
import { dateOnlyUTC } from '../utils/geo';
import { inr, longDate } from '../utils/lifecycle';
import { nextCode } from '../utils/codes';
import * as approvalService from './approval.service';
import { generateLetter } from './letter.service';
import { buildOfferLetterPdf } from './offer-letter-pdf';
import { breakupFromComponents } from './salary.service';
import { standardSalaryColumns } from './salary-revision.service';
import { getConfig } from './statutory.service';
import { initiate as initiatePreOnboarding } from './pre-onboarding.service';
import {
  type UploadedFile, assertDocumentFile, getApplicationOrThrow, issuePortalLink, notifyReferrer, setStage,
} from './recruitment.helpers';
import { type Actor, employeeNames, hrEmployeeIds, isHrAdmin } from './talent.helpers';

export const OFFER_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'NEGOTIATING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN'] as const;
const OPEN_FOR_RESPONSE = ['SENT', 'NEGOTIATING'];
const REISSUABLE = ['DECLINED', 'EXPIRED', 'WITHDRAWN'];

export interface OfferInput {
  applicationId: string;
  designation: string;
  department?: string;
  ctcAnnual: number;
  joiningDate: Date;
  workLocation?: string;
  employmentType?: string;
  probationMonths?: number;
  noticePeriodDays?: number;
  terms?: string;
  validUntil?: Date | null;
}

type OfferWithApp = Awaited<ReturnType<typeof getOfferOrThrow>>;

async function getOfferOrThrow(companyId: string, id: string) {
  const offer = await prisma.offer.findFirst({
    where: { id, companyId },
    include: { application: { include: { job: true, candidate: true, preOnboarding: true } } },
  });
  if (!offer) throw ApiError.notFound('Offer not found');
  return offer;
}

const plain = (o: OfferWithApp) => {
  const { application: _a, ...rest } = o;
  return rest;
};

const statusText = (s: string) => s.toLowerCase().replace(/_/g, ' ');

/** Budget warnings for a CTC against the requisition / job band. */
async function budgetWarnings(job: { requisitionId: string | null; minCtc: number; maxCtc: number }, ctc: number) {
  const req = job.requisitionId
    ? await prisma.jobRequisition.findUnique({ where: { id: job.requisitionId }, select: { budgetMinCtc: true, budgetMaxCtc: true } })
    : null;
  const max = req?.budgetMaxCtc || job.maxCtc;
  const min = req?.budgetMinCtc || job.minCtc;
  const out: string[] = [];
  if (max > 0 && ctc > max) out.push(`CTC is above the approved budget (max ₹${Math.round(max).toLocaleString('en-IN')})`);
  if (min > 0 && ctc < min) out.push(`CTC is below the budget band (min ₹${Math.round(min).toLocaleString('en-IN')})`);
  return out;
}

function assertDates(joiningDate: Date, validUntil: Date | null | undefined) {
  const today = dateOnlyUTC();
  if (dateOnlyUTC(joiningDate) < today) throw ApiError.badRequest('The joining date is in the past');
  if (validUntil && dateOnlyUTC(validUntil) < today) throw ApiError.badRequest('The offer validity date is in the past');
}

/** Snapshot of the terms kept in `revisions` before a change. */
const snapshot = (o: { ctcAnnual: number; joiningDate: Date; designation: string; workLocation: string; validUntil: Date | null; counterCtc: number | null; status: string }, note: string) => ({
  ctcAnnual: o.ctcAnnual,
  joiningDate: o.joiningDate.toISOString().slice(0, 10),
  designation: o.designation,
  workLocation: o.workLocation,
  validUntil: o.validUntil ? o.validUntil.toISOString().slice(0, 10) : null,
  counterCtc: o.counterCtc,
  status: o.status,
  changedAt: new Date().toISOString(),
  note,
});

const revisionsOf = (v: Prisma.JsonValue | null): Prisma.InputJsonValue[] => (Array.isArray(v) ? (v as Prisma.InputJsonValue[]) : []);

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listOffers(companyId: string, filter: { status?: string; q?: string }) {
  const where: Prisma.OfferWhereInput = { companyId };
  if (filter.status) where.status = filter.status;
  if (filter.q) {
    where.OR = [
      { code: { contains: filter.q, mode: 'insensitive' } },
      { application: { candidate: { name: { contains: filter.q, mode: 'insensitive' } } } },
    ];
  }
  const rows = await prisma.offer.findMany({
    where,
    include: {
      application: {
        select: {
          id: true, code: true, stage: true,
          job: { select: { id: true, code: true, title: true } },
          candidate: { select: { id: true, code: true, name: true, email: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const pending = await prisma.approvalStep.findMany({
    where: { companyId, module: 'OFFER', status: 'PENDING', requestId: { in: rows.map((r) => r.id) } },
    orderBy: { level: 'asc' },
  });
  return rows.map((r) => {
    const step = pending.find((s) => s.requestId === r.id);
    return { ...r, signedFileKey: undefined, hasSignedCopy: !!r.signedFileKey, pendingWith: step ? (step.approverRole ?? 'Approver') : null };
  });
}

export async function getOffer(companyId: string, id: string, actor: Actor) {
  const offer = await getOfferOrThrow(companyId, id);
  const step = await approvalService.currentStep(companyId, 'OFFER', id);
  const { candidate, job } = offer.application;
  return {
    ...plain(offer),
    signedFileKey: undefined,
    hasSignedCopy: !!offer.signedFileKey,
    application: { id: offer.application.id, code: offer.application.code, stage: offer.application.stage },
    candidate: { id: candidate.id, code: candidate.code, name: candidate.name, email: candidate.email, expectedCtc: candidate.expectedCtc },
    job: { id: job.id, code: job.code, title: job.title },
    budgetWarnings: await budgetWarnings(job, offer.ctcAnnual),
    canDecide: step ? approvalService.canAct(step, actor) : false,
    trail: await approvalService.trail(companyId, 'OFFER', id),
  };
}

// ---------------------------------------------------------------------------
// Create / edit / approve
// ---------------------------------------------------------------------------

export async function createOffer(companyId: string, actor: Actor, input: OfferInput) {
  const app = await getApplicationOrThrow(companyId, input.applicationId);
  if (['CLOSED', 'CANCELLED', 'FILLED'].includes(app.job.status)) throw ApiError.badRequest(`The job is ${app.job.status.toLowerCase()}`);
  const reissue = !!app.offer && REISSUABLE.includes(app.offer.status);
  if (app.offer && !reissue) throw ApiError.conflict(`An offer is already ${statusText(app.offer.status)} for this candidate — edit or withdraw it instead`);
  const allowed = reissue ? ['SELECTED', 'OFFER_DECLINED', 'OFFERED'] : ['SELECTED', 'OFFER', 'INTERVIEW_COMPLETED'];
  if (!allowed.includes(app.stage)) throw ApiError.badRequest('Select the candidate (proposed salary and joining date) before creating an offer');
  assertDates(input.joiningDate, input.validUntil);

  const { applicationId, ...fields } = input;
  const data = {
    designation: fields.designation,
    department: fields.department ?? app.job.department,
    ctcAnnual: fields.ctcAnnual,
    joiningDate: dateOnlyUTC(fields.joiningDate),
    workLocation: fields.workLocation ?? app.job.location,
    employmentType: fields.employmentType ?? app.job.employmentType,
    probationMonths: fields.probationMonths ?? 6,
    noticePeriodDays: fields.noticePeriodDays ?? 30,
    terms: fields.terms ?? '',
    validUntil: fields.validUntil ? dateOnlyUTC(fields.validUntil) : new Date(dateOnlyUTC().getTime() + 7 * 86_400_000),
  };
  const offer = await prisma.$transaction(async (tx) => {
    if (app.offer && reissue) {
      return tx.offer.update({
        where: { id: app.offer.id },
        data: {
          ...data,
          status: 'DRAFT', sentAt: null, respondedAt: null, approvedAt: null, letterDocumentId: null, counterCtc: null,
          negotiationNote: '', declineReason: '', acceptedVia: '', signedFileKey: null, signedFileName: '',
          revisions: [...revisionsOf(app.offer.revisions), snapshot(app.offer, `Re-issued after ${statusText(app.offer.status)}`)],
          code: app.offer.code ?? (await nextCode(companyId, 'OFFER', tx)),
        },
      });
    }
    return tx.offer.create({ data: { ...data, companyId, applicationId, code: await nextCode(companyId, 'OFFER', tx) } });
  });
  if (app.stage !== 'SELECTED') await setStage(prisma, companyId, app, 'SELECTED', { actorId: actor.employeeId, note: 'Offer re-issued' });
  return { offer, warnings: await budgetWarnings(app.job, offer.ctcAnnual) };
}

export async function updateOffer(companyId: string, id: string, input: Partial<Omit<OfferInput, 'applicationId'>>) {
  const before = await getOfferOrThrow(companyId, id);
  if (before.status !== 'DRAFT') throw ApiError.badRequest('Only a draft offer can be edited — use "revise" after it was sent');
  assertDates(input.joiningDate ?? before.joiningDate, input.validUntil !== undefined ? input.validUntil : null);
  const after = await prisma.offer.update({
    where: { id },
    data: {
      ...input,
      ...(input.joiningDate ? { joiningDate: dateOnlyUTC(input.joiningDate) } : {}),
      ...(input.validUntil !== undefined ? { validUntil: input.validUntil ? dateOnlyUTC(input.validUntil) : null } : {}),
    },
  });
  return { before: plain(before), after, warnings: await budgetWarnings(before.application.job, after.ctcAnnual) };
}

export async function submitOffer(companyId: string, id: string, actor: Actor) {
  const offer = await getOfferOrThrow(companyId, id);
  if (offer.status !== 'DRAFT') throw ApiError.badRequest(`The offer is ${statusText(offer.status)}`);
  assertDates(offer.joiningDate, offer.validUntil);
  const flipped = await prisma.offer.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'PENDING_APPROVAL' } });
  if (flipped.count === 0) throw ApiError.conflict('The offer was just submitted');
  await approvalService.start(companyId, 'OFFER', id, actor.employeeId ?? '');
  return prisma.offer.findUniqueOrThrow({ where: { id } });
}

/** The employee who submitted the offer (approval requester). */
async function requesterOf(companyId: string, id: string): Promise<string> {
  const step = await prisma.approvalStep.findFirst({ where: { companyId, module: 'OFFER', requestId: id }, orderBy: { createdAt: 'desc' } });
  return step?.requesterId ?? '';
}

export async function decideOffer(companyId: string, id: string, actor: Actor, decision: 'APPROVED' | 'REJECTED', remarks?: string) {
  const offer = await getOfferOrThrow(companyId, id);
  if (offer.status !== 'PENDING_APPROVAL') throw ApiError.badRequest(`The offer is ${statusText(offer.status)}`);
  const requester = await requesterOf(companyId, id);
  const result = await approvalService.act(companyId, 'OFFER', id, requester, actor, decision, remarks);
  if (result.outcome === 'PENDING') return { offer: plain(offer), outcome: result.outcome };
  const approved = result.outcome === 'APPROVED';
  const after = await prisma.offer.update({
    where: { id },
    data: approved ? { status: 'APPROVED', approvedAt: new Date() } : { status: 'DRAFT' },
  });
  await notify(companyId, [requester || null, ...(await hrEmployeeIds(companyId))], {
    event: approved ? 'recruitment.offer_approved' : 'recruitment.offer_rejected',
    title: approved ? `Offer ${offer.code ?? ''} approved` : `Offer ${offer.code ?? ''} sent back`,
    body: approved
      ? `${offer.application.candidate.name} · ${offer.designation} · ${inr(offer.ctcAnnual)} — ready to send.`
      : `${offer.application.candidate.name}: ${remarks ?? 'changes requested'}. The offer is back in draft.`,
    link: `/recruitment/applications/${offer.applicationId}`,
  });
  return { offer: after, outcome: result.outcome };
}

// ---------------------------------------------------------------------------
// Letter & sending
// ---------------------------------------------------------------------------

/** Renders the company's OFFER template with every offer term. */
export async function generateOfferLetter(companyId: string, id: string, createdById: string | null) {
  const offer = await getOfferOrThrow(companyId, id);
  if (!['APPROVED', 'SENT', 'NEGOTIATING', 'ACCEPTED'].includes(offer.status)) {
    throw ApiError.badRequest(`The offer is ${statusText(offer.status)} — it must be approved before the letter is generated`);
  }
  const { candidate, job } = offer.application;
  const manager = job.hiringManagerId ? (await employeeNames(companyId, [job.hiringManagerId])).get(job.hiringManagerId) : null;
  // Same structure the employee gets on joining (company standard, Salary → Components), with the company's ESI settings.
  const cfg = await getConfig(companyId);
  const monthly = breakupFromComponents(await standardSalaryColumns(companyId, offer.ctcAnnual), cfg);
  const letter = await generateLetter(companyId, {
    type: 'OFFER',
    candidateId: candidate.id,
    createdById,
    render: (head, meta) =>
      buildOfferLetterPdf(head, {
        reference: offer.code ?? meta.reference,
        date: meta.date,
        candidateName: candidate.name,
        designation: offer.designation,
        workLocation: offer.workLocation || job.location,
        joiningDate: longDate(offer.joiningDate),
        validUntil: offer.validUntil ? longDate(offer.validUntil) : '',
        ctcAnnual: Math.round(offer.ctcAnnual),
        probationMonths: offer.probationMonths,
        noticePeriodDays: offer.noticePeriodDays,
        terms: offer.terms,
        monthly,
        esiEmployeeRate: cfg.esiEmployeeRate,
        esiEmployerRate: cfg.esiEmployerRate,
      }),
    vars: {
      name: candidate.name,
      designation: offer.designation,
      department: offer.department || job.department,
      joiningDate: longDate(offer.joiningDate),
      ctc: inr(Math.round(offer.ctcAnnual)),
      workLocation: offer.workLocation || job.location,
      employmentType: offer.employmentType,
      // Plain numbers, like the employee letters' {{noticePeriodDays}} (templates add the unit).
      probationMonths: String(offer.probationMonths),
      noticePeriodDays: String(offer.noticePeriodDays),
      offerValidUntil: offer.validUntil ? longDate(offer.validUntil) : '',
      offerCode: offer.code ?? '',
      terms: offer.terms,
      address: '',
      managerName: manager?.name ?? '',
    },
  });
  return prisma.offer.update({ where: { id }, data: { letterDocumentId: letter.id } });
}

/** Presigned URL for the offer letter (a GeneratedLetter id, or a Document id for older hires). */
/** "Offer Letter Ravikant Sharma.pdf" — safe on Windows / macOS file systems. */
export const offerLetterFileName = (candidateName: string) =>
  `Offer Letter ${candidateName.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Candidate'}.pdf`;

/** Opens in a browser tab; saving from the viewer keeps the "Offer Letter <name>.pdf" name. */
export async function offerLetterUrl(companyId: string, id: string) {
  const offer = await getOfferOrThrow(companyId, id);
  if (!offer.letterDocumentId) throw ApiError.notFound('No offer letter has been generated yet');
  const fileName = offerLetterFileName(offer.application.candidate.name);
  return { url: await letterFileUrl(companyId, offer.letterDocumentId, fileName), fileName };
}

export async function letterFileUrl(
  companyId: string,
  letterId: string,
  fileName: string,
  disposition: 'attachment' | 'inline' = 'inline'
): Promise<string> {
  const letter = await prisma.generatedLetter.findFirst({ where: { id: letterId, companyId } });
  if (letter?.fileKey) return presignedGetUrl(letter.fileKey, fileName, disposition);
  const doc = await prisma.document.findFirst({ where: { id: letterId, companyId } });
  if (!doc) throw ApiError.notFound('Offer letter file not found');
  return presignedGetUrl(doc.fileKey, fileName, disposition);
}

/**
 * Sends an approved offer: generates the letter if needed, issues a fresh
 * candidate-portal link (returned once so HR can share it) and moves the
 * application to OFFERED. Re-sending an already sent offer rotates the link.
 */
export async function sendOffer(companyId: string, id: string, actor: Actor, opts: { portalDays?: number } = {}) {
  let offer = await getOfferOrThrow(companyId, id);
  if (!['APPROVED', 'SENT', 'NEGOTIATING'].includes(offer.status)) {
    throw ApiError.badRequest(offer.status === 'DRAFT' || offer.status === 'PENDING_APPROVAL' ? 'The offer must be approved before it is sent' : `The offer is ${statusText(offer.status)}`);
  }
  if (offer.validUntil && dateOnlyUTC(offer.validUntil) < dateOnlyUTC()) throw ApiError.badRequest('The offer validity date has passed — revise it first');
  if (!offer.letterDocumentId) {
    await generateOfferLetter(companyId, id, actor.employeeId);
    offer = await getOfferOrThrow(companyId, id);
  }
  const days = opts.portalDays ?? Math.max(30, offer.validUntil ? Math.ceil((offer.validUntil.getTime() - Date.now()) / 86_400_000) + 14 : 30);
  const portal = await issuePortalLink(companyId, offer.applicationId, days);
  const after = await prisma.offer.update({ where: { id }, data: { status: offer.status === 'NEGOTIATING' ? 'NEGOTIATING' : 'SENT', sentAt: new Date() } });
  if (offer.application.stage !== 'OFFERED') {
    await setStage(prisma, companyId, offer.application, 'OFFERED', { actorId: actor.employeeId, note: `Offer ${offer.code ?? ''} sent` });
    await notifyReferrer(companyId, offer.application.candidate, offer.application.job.title, 'OFFERED');
  }
  await notifyCandidate(companyId, offer.application.candidate, {
    event: 'recruitment.offer_sent',
    title: `Your offer from us — ${offer.designation}`,
    body:
      `Congratulations! Please review your offer${offer.validUntil ? ` (valid until ${longDate(offer.validUntil)})` : ''}, ` +
      `download the letter and accept, decline or discuss it here: ${portal.url}`,
    link: portal.url,
  });
  return { offer: after, portalUrl: portal.url, portalExpiresAt: portal.expiresAt };
}

// ---------------------------------------------------------------------------
// Candidate response
// ---------------------------------------------------------------------------

export interface OfferResponse {
  response: 'ACCEPT' | 'DECLINE' | 'NEGOTIATE';
  reason?: string;
  counterCtc?: number;
  note?: string;
}

/** Accept / decline / negotiate — from the portal (PORTAL) or recorded by HR (HR_RECORDED). */
export async function respond(companyId: string, id: string, input: OfferResponse, by: { via: 'PORTAL' | 'HR_RECORDED'; actorId: string | null }) {
  const offer = await getOfferOrThrow(companyId, id);
  if (!OPEN_FOR_RESPONSE.includes(offer.status)) throw ApiError.badRequest(`This offer is ${statusText(offer.status)}`);
  if (offer.validUntil && dateOnlyUTC(offer.validUntil) < dateOnlyUTC()) throw ApiError.badRequest('This offer has expired');
  const { candidate, job } = offer.application;
  const team = [job.hiringManagerId, offer.application.assignedToId, ...(await hrEmployeeIds(companyId))];
  const now = new Date();

  if (input.response === 'NEGOTIATE') {
    if (!input.note?.trim() && !input.counterCtc) throw ApiError.badRequest('Tell us what you would like to discuss');
    const after = await prisma.offer.update({
      where: { id },
      data: { status: 'NEGOTIATING', counterCtc: input.counterCtc ?? null, negotiationNote: input.note ?? '' },
    });
    await prisma.applicationStageHistory.create({
      data: { companyId, applicationId: offer.applicationId, fromStage: offer.application.stage, toStage: offer.application.stage, note: `Negotiation: ${input.counterCtc ? `counter ${inr(input.counterCtc)} · ` : ''}${input.note ?? ''}`.slice(0, 2000), actorId: by.actorId },
    });
    await notify(companyId, team, {
      event: 'recruitment.offer_negotiation',
      title: 'Offer negotiation',
      body: `${candidate.name} wants to discuss the offer${input.counterCtc ? ` (counter: ${inr(input.counterCtc)})` : ''}: ${input.note ?? ''}`,
      link: `/recruitment/applications/${offer.applicationId}`,
    });
    return { before: plain(offer), after };
  }

  if (input.response === 'DECLINE') {
    const after = await prisma.offer.update({ where: { id }, data: { status: 'DECLINED', respondedAt: now, declineReason: input.reason ?? '' } });
    await setStage(prisma, companyId, offer.application, 'OFFER_DECLINED', {
      actorId: by.actorId,
      rejectionReason: input.reason ? `Offer declined: ${input.reason}` : 'Offer declined',
      data: { portalTokenHash: null, portalExpiresAt: null },
    });
    await notify(companyId, team, {
      event: 'recruitment.offer_declined',
      title: 'Offer declined',
      body: `${candidate.name} declined the offer for ${offer.designation}${input.reason ? `: ${input.reason}` : '.'}`,
      link: `/recruitment/applications/${offer.applicationId}`,
    });
    await notifyReferrer(companyId, candidate, job.title, 'OFFER_DECLINED');
    return { before: plain(offer), after };
  }

  const after = await prisma.offer.update({
    where: { id },
    data: { status: 'ACCEPTED', respondedAt: now, acceptedVia: by.via, counterCtc: null },
  });
  await setStage(prisma, companyId, offer.application, 'OFFER_ACCEPTED', {
    actorId: by.actorId,
    note: by.via === 'PORTAL' ? `Accepted on the candidate portal at ${now.toISOString()}` : 'Acceptance recorded by HR',
  });
  await notify(companyId, team, {
    event: 'recruitment.offer_accepted',
    title: 'Offer accepted',
    body: `${candidate.name} accepted the offer for ${offer.designation} (joining ${longDate(offer.joiningDate)}). Pre-joining has started.`,
    link: `/recruitment/applications/${offer.applicationId}`,
  });
  await initiatePreOnboarding(companyId, offer.applicationId, by.actorId);
  return { before: plain(offer), after };
}

/** HR revises a sent / negotiated offer. A higher CTC goes back for approval. */
export async function reviseOffer(
  companyId: string,
  id: string,
  actor: Actor,
  input: { ctcAnnual?: number; joiningDate?: Date; designation?: string; workLocation?: string; validUntil?: Date | null; terms?: string; note: string }
) {
  const before = await getOfferOrThrow(companyId, id);
  if (!['SENT', 'NEGOTIATING', 'APPROVED'].includes(before.status)) throw ApiError.badRequest(`A ${statusText(before.status)} offer cannot be revised`);
  const joiningDate = input.joiningDate ? dateOnlyUTC(input.joiningDate) : before.joiningDate;
  const validUntil = input.validUntil !== undefined ? (input.validUntil ? dateOnlyUTC(input.validUntil) : null) : before.validUntil;
  assertDates(joiningDate, validUntil);
  const ctcAnnual = input.ctcAnnual ?? before.ctcAnnual;
  const needsApproval = ctcAnnual > before.ctcAnnual;
  const after = await prisma.offer.update({
    where: { id },
    data: {
      ctcAnnual,
      joiningDate,
      validUntil,
      ...(input.designation ? { designation: input.designation } : {}),
      ...(input.workLocation !== undefined ? { workLocation: input.workLocation } : {}),
      ...(input.terms !== undefined ? { terms: input.terms } : {}),
      revisions: [...revisionsOf(before.revisions), snapshot(before, input.note)],
      status: needsApproval ? 'PENDING_APPROVAL' : 'APPROVED',
      ...(needsApproval ? { approvedAt: null } : {}),
      counterCtc: null,
      letterDocumentId: null,
    },
  });
  if (needsApproval) {
    await approvalService.cancel(companyId, 'OFFER', id);
    await approvalService.start(companyId, 'OFFER', id, actor.employeeId ?? '');
  }
  await prisma.applicationStageHistory.create({
    data: { companyId, applicationId: before.applicationId, fromStage: before.application.stage, toStage: before.application.stage, note: `Offer revised: ${input.note}`.slice(0, 2000), actorId: actor.employeeId },
  });
  return { before: plain(before), after, needsApproval, warnings: await budgetWarnings(before.application.job, ctcAnnual) };
}

/**
 * Company withdraws the offer. Before it reached the candidate the application
 * goes back to SELECTED (re-issue possible); after that it ends as WITHDRAWN.
 */
export async function withdrawOffer(companyId: string, id: string, actor: Actor, reason: string) {
  const before = await getOfferOrThrow(companyId, id);
  if (['DECLINED', 'EXPIRED', 'WITHDRAWN'].includes(before.status)) throw ApiError.badRequest(`The offer is already ${statusText(before.status)}`);
  if (before.employeeId) throw ApiError.badRequest('The candidate has already joined');
  const wasSent = ['SENT', 'NEGOTIATING', 'ACCEPTED'].includes(before.status);
  const after = await prisma.offer.update({ where: { id }, data: { status: 'WITHDRAWN' } });
  await approvalService.cancel(companyId, 'OFFER', id);
  const po = before.application.preOnboarding;
  if (po && !['JOINED', 'CANCELLED'].includes(po.status)) await prisma.preOnboarding.update({ where: { id: po.id }, data: { status: 'CANCELLED' } });
  await setStage(prisma, companyId, before.application, wasSent ? 'WITHDRAWN' : 'SELECTED', {
    actorId: actor.employeeId,
    note: `Offer withdrawn: ${reason}`,
    ...(wasSent ? { rejectionReason: `Offer withdrawn: ${reason}`, data: { portalTokenHash: null, portalExpiresAt: null } } : {}),
  });
  if (wasSent) {
    await notifyCandidate(companyId, before.application.candidate, {
      event: 'recruitment.offer_withdrawn',
      title: `Update on your offer — ${before.designation}`,
      body: 'We regret to inform you that the offer extended to you has been withdrawn. Our HR team will reach out with details.',
    });
    await notifyReferrer(companyId, before.application.candidate, before.application.job.title, 'WITHDRAWN');
  }
  return { before: plain(before), after };
}

// ---------------------------------------------------------------------------
// Signed copy
// ---------------------------------------------------------------------------

export async function uploadSigned(companyId: string, id: string, file: UploadedFile | undefined, by: { via: 'HR' | 'PORTAL' }) {
  assertDocumentFile(file);
  const offer = await getOfferOrThrow(companyId, id);
  if (!['SENT', 'NEGOTIATING', 'ACCEPTED'].includes(offer.status)) throw ApiError.badRequest(`The offer is ${statusText(offer.status)}`);
  if (offer.employeeId) throw ApiError.badRequest('The candidate has already joined');
  const key = objectKey(companyId, 'offers', file.originalname);
  await putObject(key, file.buffer, file.mimetype);
  const after = await prisma.offer.update({ where: { id }, data: { signedFileKey: key, signedFileName: file.originalname } });
  if (offer.signedFileKey) await removeObject(offer.signedFileKey).catch(() => undefined);
  if (by.via === 'PORTAL') {
    await notify(companyId, await hrEmployeeIds(companyId), {
      event: 'recruitment.offer_signed_uploaded',
      title: 'Signed offer uploaded',
      body: `${offer.application.candidate.name} uploaded the signed offer letter.`,
      link: `/recruitment/applications/${offer.applicationId}`,
    });
  }
  return { ...after, signedFileKey: undefined, hasSignedCopy: true };
}

export async function signedUrl(companyId: string, id: string) {
  const offer = await getOfferOrThrow(companyId, id);
  if (!offer.signedFileKey) throw ApiError.notFound('No signed copy has been uploaded');
  return { url: await presignedGetUrl(offer.signedFileKey, offer.signedFileName || 'signed-offer', 'inline') };
}

// ---------------------------------------------------------------------------
// Daily job
// ---------------------------------------------------------------------------

/** Sent / negotiating offers past validUntil → EXPIRED; the application ends as OFFER_DECLINED. */
export async function expireOffers(companyId: string, today = dateOnlyUTC()): Promise<number> {
  const due = await prisma.offer.findMany({
    where: { companyId, status: { in: OPEN_FOR_RESPONSE }, validUntil: { lt: today } },
    include: { application: { include: { candidate: true, job: true } } },
  });
  for (const offer of due) {
    const flipped = await prisma.offer.updateMany({ where: { id: offer.id, status: { in: OPEN_FOR_RESPONSE } }, data: { status: 'EXPIRED' } });
    if (flipped.count === 0) continue;
    await setStage(prisma, companyId, offer.application, 'OFFER_DECLINED', {
      rejectionReason: 'Offer expired without a response',
      data: { portalTokenHash: null, portalExpiresAt: null },
    });
    await notify(companyId, [offer.application.job.hiringManagerId, ...(await hrEmployeeIds(companyId))], {
      event: 'recruitment.offer_expired',
      title: 'Offer expired',
      body: `The offer to ${offer.application.candidate.name} (${offer.designation}) expired without a response.`,
      link: `/recruitment/applications/${offer.applicationId}`,
    });
  }
  return due.length;
}

/** HR-only guard used by the controller for actions on offers. */
export const assertHr = (actor: Actor) => {
  if (!isHrAdmin(actor.role)) throw ApiError.forbidden('Only HR can manage offers');
};
