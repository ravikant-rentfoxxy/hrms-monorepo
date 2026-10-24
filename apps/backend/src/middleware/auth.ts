import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { verifyToken, type JwtPayload } from '../utils/crypto';
import { ApiError } from '../utils/http';
import { prisma } from '../lib/prisma';

export interface AuthContext {
  userId: string;
  role: Role;
  companyId: string | null;
  employeeId: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
    /** Resolved tenant id — always set by `tenant` middleware on tenant-scoped routes. */
    tenantId?: string;
  }
}

/** Verifies the Bearer access token and attaches `req.auth`. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(ApiError.unauthorized('Missing Bearer token'));
  let payload: JwtPayload;
  try {
    payload = verifyToken(header.slice(7), 'access');
  } catch {
    return next(ApiError.unauthorized('Invalid or expired token'));
  }
  req.auth = {
    userId: payload.sub,
    role: payload.role,
    companyId: payload.companyId,
    employeeId: payload.employeeId,
  };
  next();
}

/** Allows only the given roles (SUPER_ADMIN is always allowed unless excluded explicitly). */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.auth;
    if (!auth) return next(ApiError.unauthorized());
    if (auth.role === 'SUPER_ADMIN' || roles.includes(auth.role)) return next();
    next(ApiError.forbidden('Insufficient permissions'));
  };
}

/**
 * Resolves the tenant for the request. Company users are locked to their own
 * company; a SUPER_ADMIN must pass `X-Company-Id` to act within a tenant.
 */
export async function tenant(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const auth = req.auth;
  if (!auth) return next(ApiError.unauthorized());
  if (auth.role === 'SUPER_ADMIN') {
    const headerId = req.headers['x-company-id'];
    const companyId = typeof headerId === 'string' ? headerId : undefined;
    if (!companyId) return next(ApiError.badRequest('X-Company-Id header required for super admin'));
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, isActive: true } });
    if (!company) return next(ApiError.notFound('Company not found'));
    req.tenantId = company.id;
    return next();
  }
  if (!auth.companyId) return next(ApiError.forbidden('No company associated with this account'));
  // Access tokens live up to JWT_ACCESS_TTL; re-check the membership so a
  // separated / terminated employee is cut off immediately, not at expiry.
  const membership = await prisma.membership.findUnique({
    where: { userId_companyId: { userId: auth.userId, companyId: auth.companyId } },
    select: { isActive: true },
  });
  if (!membership?.isActive) return next(ApiError.unauthorized('Your access to this company has ended'));
  req.tenantId = auth.companyId;
  next();
}

/** Helpers for controllers. */
export function ctx(req: Request): { auth: AuthContext; tenantId: string } {
  if (!req.auth || !req.tenantId) throw ApiError.unauthorized();
  return { auth: req.auth, tenantId: req.tenantId };
}

/** The acting employee id, or 403 when the account has no employee profile. */
export function employeeIdOrThrow(req: Request): string {
  const { auth } = ctx(req);
  if (!auth.employeeId) throw ApiError.forbidden('This account has no employee profile');
  return auth.employeeId;
}

export const isManagerial = (role: Role): boolean =>
  role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR' || role === 'MANAGER';
