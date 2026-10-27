import type { Request } from 'express';
import { h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow } from '../middleware/auth';
import { audit, diff } from '../lib/audit';
import * as cardService from '../services/id-card.service';
import type { CardSettingsInput } from '../services/id-card.service';

/** `me` = the signed-in employee; any other id is HR / Admin only (enforced in the routes). */
const target = (req: Request): string => (req.params.employeeId === 'me' ? employeeIdOrThrow(req) : (req.params.employeeId as string));

export const getSettings = h(async (req, res) => {
  ok(res, await cardService.getSettings(ctx(req).tenantId));
});

export const updateSettings = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await cardService.updateSettings(tenantId, req.body as CardSettingsInput);
  await audit(req, { entity: 'Company', entityId: tenantId, action: 'ID_CARD_DESIGN', ...diff(before, after) });
  ok(res, after);
});

export const card = h(async (req, res) => {
  ok(res, await cardService.card(ctx(req).tenantId, target(req)));
});

export const setPhoto = h(async (req, res) => {
  const id = target(req);
  const result = await cardService.setPhoto(ctx(req).tenantId, id, req.file);
  await audit(req, { entity: 'Employee', entityId: id, action: 'PHOTO', after: { photo: 'updated' } });
  ok(res, result);
});

export const removePhoto = h(async (req, res) => {
  const id = target(req);
  const result = await cardService.removePhoto(ctx(req).tenantId, id);
  await audit(req, { entity: 'Employee', entityId: id, action: 'PHOTO', after: { photo: 'removed' } });
  ok(res, result);
});

export const reissue = h(async (req, res) => {
  const id = target(req);
  const result = await cardService.reissue(ctx(req).tenantId, id);
  await audit(req, { entity: 'Employee', entityId: id, action: 'ID_CARD_REISSUE', after: { reissued: true } });
  ok(res, result);
});

/** Public — the page behind the card's QR code. */
export const verify = h(async (req, res) => {
  ok(res, await cardService.verify(req.params.token as string));
});
