/** Public candidate portal (token link, no login). Audit rows are written as "System" with the company id. */
import type { Request } from 'express';
import { h, ok } from '../utils/http';
import { audit } from '../lib/audit';
import * as portalService from '../services/candidate-portal.service';

const token = (req: Request): string => req.params.token as string;

export const view = h(async (req, res) => {
  ok(res, await portalService.view(token(req)));
});

export const accept = h(async (req, res) => {
  const { app, offer } = await portalService.accept(token(req));
  await audit(req, { companyId: app.companyId, entity: 'Offer', entityId: offer.id, action: 'RESPONSE_ACCEPT', after: { status: 'ACCEPTED', acceptedVia: 'PORTAL' } });
  ok(res, await portalService.view(token(req)));
});

export const decline = h(async (req, res) => {
  const reason = (req.body as { reason: string }).reason;
  const { app, offer } = await portalService.decline(token(req), reason);
  await audit(req, { companyId: app.companyId, entity: 'Offer', entityId: offer.id, action: 'RESPONSE_DECLINE', after: { status: 'DECLINED', reason, via: 'PORTAL' } });
  // The link stops working once the offer is declined.
  ok(res, { declined: true });
});

export const negotiate = h(async (req, res) => {
  const body = req.body as { counterCtc?: number; note: string };
  const { app, offer } = await portalService.negotiate(token(req), body);
  await audit(req, { companyId: app.companyId, entity: 'Offer', entityId: offer.id, action: 'RESPONSE_NEGOTIATE', after: { counterCtc: body.counterCtc, via: 'PORTAL' } });
  ok(res, await portalService.view(token(req)));
});

export const uploadSigned = h(async (req, res) => {
  const { app, offer } = await portalService.uploadSigned(token(req), req.file);
  await audit(req, { companyId: app.companyId, entity: 'Offer', entityId: offer.id, action: 'SIGNED_COPY', after: { via: 'PORTAL', fileName: req.file?.originalname } });
  ok(res, await portalService.view(token(req)), 201);
});

export const uploadDocument = h(async (req, res) => {
  const docId = req.params.docId as string;
  const { app } = await portalService.uploadDocument(token(req), docId, req.file);
  await audit(req, { companyId: app.companyId, entity: 'PreJoiningDocument', entityId: docId, action: 'UPLOAD', after: { via: 'PORTAL', fileName: req.file?.originalname } });
  ok(res, await portalService.view(token(req)), 201);
});
