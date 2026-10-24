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

/** Second factor: `{ challengeToken, code }` from the password step. */
export const login2fa = h(async (req, res) => {
  const { challengeToken, code } = req.body as { challengeToken: string; code: string };
  ok(res, await authService.loginWithTwoFactor(challengeToken, code));
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

export const twoFactorStatus = h(async (req, res) => {
  ok(res, await authService.twoFactorStatus(req.auth!.userId));
});

export const setupTwoFactor = h(async (req, res) => {
  ok(res, await authService.setupTwoFactor(req.auth!.userId));
});

export const enableTwoFactor = h(async (req, res) => {
  const { code } = req.body as { code: string };
  await authService.enableTwoFactor(req.auth!.userId, code);
  await audit(req, { entity: 'User', entityId: req.auth!.userId, action: '2FA_ENABLE' });
  ok(res, { enabled: true });
});

export const disableTwoFactor = h(async (req, res) => {
  const { password } = req.body as { password: string };
  await authService.disableTwoFactor(req.auth!.userId, password);
  await audit(req, { entity: 'User', entityId: req.auth!.userId, action: '2FA_DISABLE' });
  ok(res, { enabled: false });
});
