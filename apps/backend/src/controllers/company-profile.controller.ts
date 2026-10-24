import { h, ok } from '../utils/http';
import { ctx } from '../middleware/auth';
import { audit, diff } from '../lib/audit';
import * as profileService from '../services/company-profile.service';
import type { CompanyProfileInput } from '../services/company-profile.service';

export const getProfile = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await profileService.getProfile(tenantId));
});

export const updateProfile = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await profileService.updateProfile(tenantId, req.body as CompanyProfileInput);
  await audit(req, { entity: 'Company', entityId: tenantId, action: 'UPDATE', ...diff(before, after) });
  ok(res, after);
});

export const setLogo = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const profile = await profileService.setLogo(tenantId, req.file);
  await audit(req, { entity: 'Company', entityId: tenantId, action: 'LOGO', after: { logo: 'updated' } });
  ok(res, profile);
});

export const removeLogo = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const profile = await profileService.removeLogo(tenantId);
  await audit(req, { entity: 'Company', entityId: tenantId, action: 'LOGO', after: { logo: 'removed' } });
  ok(res, profile);
});
