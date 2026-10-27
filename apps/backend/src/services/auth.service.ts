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
import { sendMail, isMailConfigured } from '../lib/mailer';
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
import { revealEmployeeSecrets } from '../utils/fieldCrypto';

/** Failed logins (password or reset code) before the account is locked. */
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const RESET_OTP_MINUTES = 15;
/** How long the company picker stays valid after the password step. */
const SELECTION_TTL = '5m';

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

/**
 * Short-lived token proving the password step passed for a user who belongs
 * to several companies; only `/auth/login/company` accepts it.
 */
function signCompanySelection(userId: string): string {
  return jwt.sign({ sub: userId, type: 'company-select' }, env.JWT_ACCESS_SECRET, {
    expiresIn: SELECTION_TTL,
    audience: 'hrms-company-select',
  } as jwt.SignOptions);
}

function verifyCompanySelection(token: string): string {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { audience: 'hrms-company-select' }) as { sub: string; type: string };
    if (payload.type !== 'company-select') throw new Error('wrong type');
    return payload.sub;
  } catch {
    throw ApiError.unauthorized('Sign-in expired. Please sign in again.');
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
  | {
      companySelectionRequired: true;
      selectionToken: string;
      companies: { id: string; name: string; code: string; role: Role }[];
    };


/**
 * Password step — the company is found from the email, not typed in:
 *   one company       → signed straight into it
 *   several companies → `{ companySelectionRequired, selectionToken, companies }`;
 *                       the client calls `selectCompany` with the choice
 *   super admin       → no company
 * `companyId` is still accepted for clients that pick the company up front.
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

  if (user.role === 'SUPER_ADMIN' || companyId) return completeLogin(user, companyId ?? null);
  const memberships = await listMemberships(user.id);
  if (memberships.length === 0) throw ApiError.forbidden('No company access. Ask your administrator.');
  if (memberships.length === 1) return completeLogin(user, memberships[0]!.companyId);
  return {
    companySelectionRequired: true,
    selectionToken: signCompanySelection(user.id),
    companies: memberships.map((m) => ({ ...m.company, role: m.role })),
  };
}

/** Company chosen after the password step (users in several companies). */
export async function selectCompany(selectionToken: string, companyId: string): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { id: verifyCompanySelection(selectionToken) } });
  if (!user || !user.isActive) throw ApiError.unauthorized('Invalid email or password');
  assertNotLocked(user);
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
    select: { id: true, email: true, role: true, lastLoginAt: true },
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
  if (!isProd) logger.info({ email: user.email, otp }, 'password reset OTP (dev only — not logged in production)');
  if (!isMailConfigured()) {
    logger.warn({ email: user.email }, 'password reset code not emailed — SMTP is not set up');
    return;
  }
  // Failures are logged, not returned: the response must not reveal whether the email exists.
  await sendMail({
    to: user.email,
    subject: 'Your HRMS password reset code',
    text: [
      `Your password reset code is ${otp}.`,
      '',
      `It expires in ${RESET_OTP_MINUTES} minutes. If you did not ask to reset your password, ignore this email — your password stays the same.`,
    ].join('\n'),
  }).catch((err: unknown) => logger.error({ err, email: user.email }, 'password reset email failed'));
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
