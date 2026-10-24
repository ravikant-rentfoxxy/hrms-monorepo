/**
 * Auth business logic. No Express types here — every function takes plain
 * input and returns plain data (or throws ApiError), so it can be reused
 * from controllers, scripts, jobs or tests.
 */
import { randomInt, timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import type { Role, User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { notify } from '../lib/notify';
import { env, isProd } from '../config/env';
import { ApiError } from '../utils/http';
import {
  hashPassword,
  sha256,
  signAccessToken,
  signRefreshToken,
  verifyPassword,
  verifyToken,
} from '../utils/crypto';
import { decryptField, encryptField, revealEmployeeSecrets } from '../utils/fieldCrypto';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../utils/totp';

/** Failed logins (password or 2FA code) before the account is locked. */
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const RESET_OTP_MINUTES = 15;
const CHALLENGE_TTL = '5m';

export interface ActiveContext {
  role: Role;
  companyId: string | null;
  employeeId: string | null;
  company: { id: string; name: string; code: string } | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Active companies for the login screen's company-code dropdown (public).
 * Deliberately exposes only the code — never the company name.
 */
export async function publicCompanies() {
  return prisma.company.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
    orderBy: { code: 'asc' },
  });
}

/** All active memberships of a user (active companies only). */
export async function listMemberships(userId: string) {
  return prisma.membership.findMany({
    where: { userId, isActive: true, company: { isActive: true } },
    select: {
      companyId: true,
      role: true,
      company: { select: { id: true, name: true, code: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Resolves which company a session acts in. Only SUPER_ADMIN may sign in
 * without a company code — every other user must select the company they
 * belong to (tokens are then scoped to it).
 */
export async function resolveContext(
  user: { id: string; role: Role },
  companyId?: string | null
): Promise<ActiveContext> {
  if (user.role === 'SUPER_ADMIN') return { role: 'SUPER_ADMIN', companyId: null, employeeId: null, company: null };
  if (!companyId) throw ApiError.badRequest('Please select your company code');
  const memberships = await listMemberships(user.id);
  if (memberships.length === 0) throw ApiError.forbidden('No company access. Ask your administrator.');
  const active = memberships.find((m) => m.companyId === companyId);
  if (!active) throw ApiError.forbidden('You do not have access to this company');
  const employee = await prisma.employee.findUnique({
    where: { userId_companyId: { userId: user.id, companyId: active.companyId } },
    select: { id: true, isActive: true },
  });
  if (employee && !employee.isActive) throw ApiError.forbidden('Your profile in this company is deactivated');
  return { role: active.role, companyId: active.companyId, employeeId: employee?.id ?? null, company: active.company };
}

/** Signs an access+refresh pair and stores the refresh hash (rotation). */
export async function issueTokens(userId: string, context: ActiveContext): Promise<TokenPair> {
  const payload = { sub: userId, role: context.role, companyId: context.companyId, employeeId: context.employeeId };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  await prisma.user.update({
    where: { id: userId },
    data: { refreshTokenHash: sha256(refreshToken), lastLoginAt: new Date() },
  });
  return { accessToken, refreshToken };
}

/** 423 while the account is locked after repeated failures. */
function assertNotLocked(user: Pick<User, 'lockedUntil'>): void {
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000));
    throw new ApiError(423, `Account locked after too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }
}

/** Counts a failed attempt; the 5th locks the account for 15 minutes. Returns true when it just locked. */
async function registerFailure(user: Pick<User, 'id' | 'failedLogins' | 'lockedUntil'>): Promise<boolean> {
  // A lock that has already expired starts a fresh count.
  const base = user.lockedUntil && user.lockedUntil <= new Date() ? 0 : user.failedLogins;
  const failed = base + 1;
  const lock = failed >= MAX_FAILED_LOGINS;
  await prisma.user.update({
    where: { id: user.id },
    data: lock
      ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) }
      : { failedLogins: failed, ...(user.lockedUntil ? { lockedUntil: null } : {}) },
  });
  return lock;
}

async function clearFailures(user: Pick<User, 'id' | 'failedLogins' | 'lockedUntil'>): Promise<void> {
  if (user.failedLogins === 0 && !user.lockedUntil) return;
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
}

/** Short-lived token proving the password step passed; only `/auth/login/2fa` accepts it. */
function signChallenge(userId: string, companyId?: string): string {
  return jwt.sign({ sub: userId, companyId: companyId ?? null, type: '2fa' }, env.JWT_ACCESS_SECRET, {
    expiresIn: CHALLENGE_TTL,
    audience: 'hrms-2fa',
  } as jwt.SignOptions);
}

function verifyChallenge(token: string): { sub: string; companyId: string | null } {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { audience: 'hrms-2fa' }) as {
      sub: string; companyId: string | null; type: string;
    };
    if (payload.type !== '2fa') throw new Error('wrong type');
    return payload;
  } catch {
    throw ApiError.unauthorized('Sign-in challenge expired. Please sign in again.');
  }
}

/** Issues the session after every factor has passed. */
async function completeLogin(user: User, companyId?: string | null) {
  const context = await resolveContext(user, companyId);
  const tokens = await issueTokens(user.id, context);
  const employee = context.employeeId ? await prisma.employee.findUnique({ where: { id: context.employeeId } }) : null;
  return {
    ...tokens,
    user: { id: user.id, email: user.email },
    role: context.role,
    activeCompany: context.company,
    // The employee's own profile: identity numbers in full.
    employee: revealEmployeeSecrets(employee),
    memberships: user.role === 'SUPER_ADMIN' ? [] : await listMemberships(user.id),
  };
}

export type LoginResult =
  | Awaited<ReturnType<typeof completeLogin>>
  | { twoFactorRequired: true; challengeToken: string };

/**
 * Password step. With 2FA enabled the response is `{ twoFactorRequired,
 * challengeToken }` and the session comes from `loginWithTwoFactor`.
 */
export async function login(email: string, password: string, companyId?: string): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) assertNotLocked(user);
  // Constant-ish time: verify against a dummy hash when the user is unknown.
  const hash = user?.passwordHash ?? '$2a$12$C6UzMDM.H6dfI/f/IKcEeO7ZF0sHdOF8xMBWzkxVYUDxAMiCCbLO2';
  const valid = await verifyPassword(password, hash);
  if (user && !valid) {
    if (await registerFailure(user)) {
      throw new ApiError(423, `Too many failed attempts. Account locked for ${LOCK_MINUTES} minutes.`);
    }
  }
  if (!user || !valid || !user.isActive) throw ApiError.unauthorized('Invalid email or password');
  await clearFailures(user);

  // Validate the company choice before asking for the code (clear errors early).
  await resolveContext(user, companyId);
  if (user.totpEnabled && user.totpSecret) {
    return { twoFactorRequired: true, challengeToken: signChallenge(user.id, companyId) };
  }
  return completeLogin(user, companyId);
}

/** Second step: authenticator code for the challenge issued by `login`. */
export async function loginWithTwoFactor(challengeToken: string, code: string) {
  const { sub, companyId } = verifyChallenge(challengeToken);
  const user = await prisma.user.findUnique({ where: { id: sub } });
  if (!user || !user.isActive) throw ApiError.unauthorized('Invalid email or password');
  assertNotLocked(user);
  if (!user.totpEnabled || !user.totpSecret) return completeLogin(user, companyId);
  if (!verifyTotp(decryptField(user.totpSecret), code)) {
    if (await registerFailure(user)) {
      throw new ApiError(423, `Too many failed attempts. Account locked for ${LOCK_MINUTES} minutes.`);
    }
    throw ApiError.unauthorized('Invalid authentication code');
  }
  await clearFailures(user);
  return completeLogin(user, companyId);
}

export async function switchCompany(userId: string, companyId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.role === 'SUPER_ADMIN') {
    throw ApiError.badRequest('Super admin uses the X-Company-Id header instead of switching');
  }
  const context = await resolveContext(user, companyId);
  const tokens = await issueTokens(user.id, context);
  return { ...tokens, role: context.role, activeCompany: context.company };
}

export async function refresh(refreshToken: string): Promise<TokenPair> {
  let payload;
  try {
    payload = verifyToken(refreshToken, 'refresh');
  } catch {
    throw ApiError.unauthorized('Invalid refresh token');
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive || user.refreshTokenHash !== sha256(refreshToken)) {
    throw ApiError.unauthorized('Refresh token revoked');
  }
  // Re-resolve so a revoked membership or changed role takes effect here.
  const context = await resolveContext(user, payload.companyId);
  // Rotation: the old refresh token is invalidated by storing the new hash.
  return issueTokens(user.id, context);
}

export async function logout(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { refreshTokenHash: null } });
}

export async function getMe(auth: { userId: string; role: Role; companyId: string | null; employeeId: string | null }) {
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { id: true, email: true, role: true, lastLoginAt: true, totpEnabled: true },
  });
  if (!user) throw ApiError.notFound('User not found');
  const [activeCompany, employee, memberships] = await Promise.all([
    auth.companyId
      ? prisma.company.findUnique({
          where: { id: auth.companyId },
          select: { id: true, name: true, code: true, timezone: true },
        })
      : null,
    auth.employeeId
      ? prisma.employee.findUnique({
          where: { id: auth.employeeId },
          include: { manager: { select: { id: true, name: true } } },
        })
      : null,
    user.role === 'SUPER_ADMIN' ? [] : listMemberships(user.id),
  ]);
  // /me is always the caller's own profile: identity numbers in full.
  return { ...user, role: auth.role, activeCompany, employee: revealEmployeeSecrets(employee), memberships };
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw ApiError.unauthorized('Current password is incorrect');
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), refreshTokenHash: null },
  });
}

// ---- Two-factor authentication (TOTP) ----

export async function twoFactorStatus(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpEnabled: true } });
  return { enabled: user.totpEnabled };
}

/**
 * Starts enrolment: a fresh secret is stored (encrypted, not yet active) and
 * returned once with the otpauth URI for the authenticator app.
 */
export async function setupTwoFactor(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.totpEnabled) throw ApiError.badRequest('Two-factor authentication is already enabled. Disable it first to re-enrol.');
  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: user.id }, data: { totpSecret: encryptField(secret) } });
  return { secret, otpauthUri: otpauthUri(secret, user.email, 'HRMS') };
}

/** Confirms enrolment with a code from the app; from now on login asks for a code. */
export async function enableTwoFactor(userId: string, code: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.totpEnabled) throw ApiError.badRequest('Two-factor authentication is already enabled');
  if (!user.totpSecret) throw ApiError.badRequest('Start the setup first');
  if (!verifyTotp(decryptField(user.totpSecret), code)) throw ApiError.badRequest('Invalid code — check the time on your phone and try again');
  await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
}

/** Turns 2FA off; requires the account password. */
export async function disableTwoFactor(userId: string, password: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(password, user.passwordHash))) throw ApiError.unauthorized('Password is incorrect');
  if (!user.totpEnabled && !user.totpSecret) throw ApiError.badRequest('Two-factor authentication is not enabled');
  await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecret: null } });
}

// ---- Forgot / reset password (OTP) ----

const otpDigest = (userId: string, otp: string): string => sha256(`${userId}:${otp}`);

/**
 * Creates a 6-digit reset OTP (stored hashed, valid 15 minutes). Always
 * resolves without revealing whether the email exists.
 */
export async function forgotPassword(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) return;
  const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await prisma.user.update({
    where: { id: user.id },
    data: { resetOtpHash: otpDigest(user.id, otp), resetOtpExpires: new Date(Date.now() + RESET_OTP_MINUTES * 60000) },
  });
  const profiles = await prisma.employee.findMany({ where: { userId: user.id, isActive: true }, select: { id: true, companyId: true } });
  for (const p of profiles.slice(0, 1)) {
    await notify(p.companyId, [p.id], {
      event: 'auth.password_reset_otp',
      title: 'Your password reset code',
      body: `Use ${otp} to reset your password. It expires in ${RESET_OTP_MINUTES} minutes.`,
      email: true,
    });
  }
  if (!isProd) logger.info({ email: user.email, otp }, 'password reset OTP (dev only — not logged in production)');
}

export async function resetPassword(email: string, otp: string, newPassword: string): Promise<{ userId: string }> {
  const invalid = ApiError.badRequest('Invalid or expired code');
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive || !user.resetOtpHash || !user.resetOtpExpires) throw invalid;
  assertNotLocked(user);
  if (user.resetOtpExpires < new Date()) throw invalid;
  const given = Buffer.from(otpDigest(user.id, otp.trim()));
  const stored = Buffer.from(user.resetOtpHash);
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
    // Guessing codes counts towards the same lockout as guessing passwords.
    if (await registerFailure(user)) {
      await prisma.user.update({ where: { id: user.id }, data: { resetOtpHash: null, resetOtpExpires: null } });
    }
    throw invalid;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(newPassword),
      resetOtpHash: null,
      resetOtpExpires: null,
      refreshTokenHash: null, // sign out everywhere
      failedLogins: 0,
      lockedUntil: null,
    },
  });
  return { userId: user.id };
}
