/** Thin HTTP layer: parse request, call the service, shape the response. */
import { h, ok } from '../utils/http';
import { audit } from '../lib/audit';
import * as authService from '../services/auth.service';

/** Public: company codes for the login screen dropdown. */
export const companies = h(async (_req, res) => {
  ok(res, await authService.publicCompanies());
});

export const login = h(async (req, res) => {
  const { email, password, companyId } = req.body as { email: string; password: string; companyId?: string };
  ok(res, await authService.login(email, password, companyId));
});

/** Company choice for users in several companies: `{ selectionToken, companyId }`. */
export const loginCompany = h(async (req, res) => {
  const { selectionToken, companyId } = req.body as { selectionToken: string; companyId: string };
  ok(res, await authService.selectCompany(selectionToken, companyId));
});

export const switchCompany = h(async (req, res) => {
  const { companyId } = req.body as { companyId: string };
  ok(res, await authService.switchCompany(req.auth!.userId, companyId));
});

export const refresh = h(async (req, res) => {
  const { refreshToken } = req.body as { refreshToken: string };
  ok(res, await authService.refresh(refreshToken));
});

export const logout = h(async (req, res) => {
  await authService.logout(req.auth!.userId);
  ok(res, { loggedOut: true });
});

export const me = h(async (req, res) => {
  ok(res, await authService.getMe(req.auth!));
});

export const changePassword = h(async (req, res) => {
  const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
  await authService.changePassword(req.auth!.userId, currentPassword, newPassword);
  await audit(req, { entity: 'User', entityId: req.auth!.userId, action: 'PASSWORD_CHANGE' });
  ok(res, { changed: true });
});

/** Always the same answer, whether or not the email exists. */
export const forgotPassword = h(async (req, res) => {
  const { email } = req.body as { email: string };
  await authService.forgotPassword(email);
  ok(res, { sent: true, message: 'If the email belongs to an account, a 6-digit reset code has been sent to it.' });
});

export const resetPassword = h(async (req, res) => {
  const { email, otp, newPassword } = req.body as { email: string; otp: string; newPassword: string };
  const { userId } = await authService.resetPassword(email, otp, newPassword);
  await audit(req, { entity: 'User', entityId: userId, action: 'PASSWORD_RESET', companyId: null });
  ok(res, { reset: true });
});
