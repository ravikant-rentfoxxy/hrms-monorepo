/** Offers, pre-joining and the joining step (recruitment stages 8–10). */
import type { Request } from 'express';
import { h, ok } from '../utils/http';
import { ctx } from '../middleware/auth';
import { audit, diff } from '../lib/audit';
import * as offerService from '../services/offer.service';
import * as preOnboardingService from '../services/pre-onboarding.service';
import type { JoinInput, PreOnboardingInput } from '../services/pre-onboarding.service';
import type { OfferInput, OfferResponse } from '../services/offer.service';
import type { Actor } from '../services/talent.helpers';

const actorOf = (req: Request): Actor => {
  const { auth } = ctx(req);
  return { role: auth.role, employeeId: auth.employeeId };
};
const id = (req: Request): string => req.params.id as string;
const docId = (req: Request): string => req.params.docId as string;
const money = (o: { ctcAnnual: number; status: string; joiningDate: Date; designation: string }) => ({
  ctcAnnual: o.ctcAnnual, status: o.status, joiningDate: o.joiningDate, designation: o.designation,
});

// ---- Offers ----

export const listOffers = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await offerService.listOffers(tenantId, req.query as { status?: string; q?: string }));
});

export const getOffer = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await offerService.getOffer(tenantId, id(req), actorOf(req)));
});

export const createOffer = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { offer, warnings } = await offerService.createOffer(tenantId, actorOf(req), req.body as OfferInput);
  await audit(req, { entity: 'Offer', entityId: offer.id, action: 'CREATE', after: { ...offer, warnings } });
  ok(res, { offer, warnings }, 201);
});

export const updateOffer = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after, warnings } = await offerService.updateOffer(tenantId, id(req), req.body as Partial<OfferInput>);
  await audit(req, { entity: 'Offer', entityId: after.id, action: 'UPDATE', ...diff(before, after) });
  ok(res, { offer: after, warnings });
});

export const submitOffer = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const offer = await offerService.submitOffer(tenantId, id(req), actorOf(req));
  await audit(req, { entity: 'Offer', entityId: offer.id, action: 'SUBMIT', after: money(offer) });
  ok(res, offer);
});

/** Approvals-inbox decide endpoint (no requireRole — the approval engine decides who may act). */
export const decideOffer = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { decision, remarks } = req.body as { decision: 'APPROVED' | 'REJECTED'; remarks?: string };
  const result = await offerService.decideOffer(tenantId, id(req), actorOf(req), decision, remarks);
  await audit(req, {
    entity: 'Offer',
    entityId: id(req),
    action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
    after: { outcome: result.outcome, remarks, ...money(result.offer) },
  });
  ok(res, result);
});

export const generateOfferLetter = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const offer = await offerService.generateOfferLetter(tenantId, id(req), auth.employeeId);
  await audit(req, { entity: 'Offer', entityId: offer.id, action: 'LETTER', after: { letterId: offer.letterDocumentId } });
  ok(res, offer, 201);
});

export const offerLetter = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await offerService.offerLetterUrl(tenantId, id(req)));
});

export const sendOffer = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const result = await offerService.sendOffer(tenantId, id(req), actorOf(req), req.body as { portalDays?: number });
  await audit(req, { entity: 'Offer', entityId: id(req), action: 'SEND', after: { status: result.offer.status, portalExpiresAt: result.portalExpiresAt } });
  ok(res, result);
});

/** HR records the candidate's answer (phone / email). */
export const respondOffer = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const body = req.body as OfferResponse;
  const { before, after } = await offerService.respond(tenantId, id(req), body, { via: 'HR_RECORDED', actorId: auth.employeeId });
  await audit(req, {
    entity: 'Offer',
    entityId: after.id,
    action: `RESPONSE_${body.response}`,
    before: { status: before.status },
    after: { status: after.status, counterCtc: after.counterCtc, declineReason: after.declineReason || undefined, acceptedVia: after.acceptedVia || undefined },
  });
  ok(res, after);
});

export const reviseOffer = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const result = await offerService.reviseOffer(
    tenantId,
    id(req),
    actorOf(req),
    req.body as { ctcAnnual?: number; joiningDate?: Date; designation?: string; workLocation?: string; validUntil?: Date | null; terms?: string; note: string }
  );
  await audit(req, { entity: 'Offer', entityId: id(req), action: 'REVISE', before: money(result.before), after: { ...money(result.after), warnings: result.warnings } });
  ok(res, result);
});

export const withdrawOffer = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await offerService.withdrawOffer(tenantId, id(req), actorOf(req), (req.body as { reason: string }).reason);
  await audit(req, { entity: 'Offer', entityId: after.id, action: 'WITHDRAW', before: { status: before.status }, after: { status: after.status, reason: (req.body as { reason: string }).reason } });
  ok(res, after);
});

export const uploadSigned = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const offer = await offerService.uploadSigned(tenantId, id(req), req.file, { via: 'HR' });
  await audit(req, { entity: 'Offer', entityId: offer.id, action: 'SIGNED_COPY', after: { fileName: offer.signedFileName } });
  ok(res, offer, 201);
});

export const signedCopy = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await offerService.signedUrl(tenantId, id(req)));
});

// ---- Pre-onboarding ----

export const listPreOnboarding = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await preOnboardingService.list(tenantId, req.query as { status?: string }));
});

export const getPreOnboarding = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await preOnboardingService.get(tenantId, id(req)));
});

/** Manual start for an accepted offer (normally automatic on acceptance). */
export const initiatePreOnboarding = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const po = await preOnboardingService.initiate(tenantId, id(req), auth.employeeId);
  await audit(req, { entity: 'PreOnboarding', entityId: po.id, action: 'CREATE', after: { applicationId: id(req) } });
  ok(res, po, 201);
});

export const updatePreOnboarding = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await preOnboardingService.update(tenantId, id(req), actorOf(req), req.body as PreOnboardingInput);
  const keys = ['status', 'bgvRequired', 'bgvStatus', 'bgvVendor', 'expectedJoiningDate'] as const;
  const pick = (o: Record<string, unknown>) => Object.fromEntries(keys.map((k) => [k, o[k]]));
  await audit(req, { entity: 'PreOnboarding', entityId: after.id, action: 'UPDATE', ...diff(pick(before), pick(after)) });
  ok(res, after);
});

export const confirmJoining = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await preOnboardingService.confirmJoining(
    tenantId,
    id(req),
    actorOf(req),
    (req.body as { confirmedJoiningDate: Date }).confirmedJoiningDate
  );
  await audit(req, {
    entity: 'PreOnboarding',
    entityId: after.id,
    action: 'CONFIRM_JOINING',
    before: { confirmedJoiningDate: before.confirmedJoiningDate },
    after: { confirmedJoiningDate: after.confirmedJoiningDate, status: after.status },
  });
  ok(res, after);
});

export const addDocument = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await preOnboardingService.addDocument(tenantId, id(req), actorOf(req), req.body as { type: string; name: string; required?: boolean }), 201);
});

export const updateDocument = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await preOnboardingService.updateDocument(tenantId, id(req), docId(req), actorOf(req), req.body as { name?: string; required?: boolean }));
});

export const removeDocument = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await preOnboardingService.removeDocument(tenantId, id(req), docId(req), actorOf(req)));
});

export const uploadDocument = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await preOnboardingService.uploadDocument(tenantId, id(req), docId(req), req.file, { actorId: auth.employeeId, via: 'HR' }), 201);
});

export const verifyDocument = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const body = req.body as { decision: 'VERIFIED' | 'REJECTED'; remarks?: string };
  const { before, after } = await preOnboardingService.verifyDocument(tenantId, id(req), docId(req), actorOf(req), body);
  await audit(req, {
    entity: 'PreJoiningDocument',
    entityId: before.id,
    action: body.decision === 'VERIFIED' ? 'VERIFY' : 'REJECT',
    before: { status: before.status },
    after: { status: body.decision, remarks: body.remarks, preOnboardingStatus: after.status },
  });
  ok(res, after);
});

export const documentFile = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const inline = req.query.inline === 'true' || req.query.inline === '1';
  ok(res, await preOnboardingService.documentUrl(tenantId, id(req), docId(req), inline));
});

export const cancelPreOnboarding = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const reason = (req.body as { reason: string }).reason;
  const po = await preOnboardingService.cancel(tenantId, id(req), actorOf(req), reason);
  await audit(req, { entity: 'PreOnboarding', entityId: po.id, action: 'CANCEL', before: { status: po.status }, after: { status: 'CANCELLED', reason } });
  ok(res, { cancelled: true });
});

/** "HR confirms actual joining": creates the employee. */
export const join = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const result = await preOnboardingService.join(tenantId, id(req), actorOf(req), req.body as JoinInput, req);
  await audit(req, {
    entity: 'PreOnboarding',
    entityId: id(req),
    action: 'JOINED',
    after: { employeeId: result.employee.id, employeeCode: result.employee.employeeCode, jobFilled: result.jobFilled, warnings: result.warnings },
  });
  ok(res, result, 201);
});
