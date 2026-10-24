import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { createHash, randomUUID } from 'crypto';
import { env } from '../config/env';
import type { Role } from '@prisma/client';

const ROUNDS = 12;

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, ROUNDS);
export const verifyPassword = (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash);

export interface JwtPayload {
  sub: string; // user id
  role: Role;
  companyId: string | null;
  employeeId: string | null;
  type: 'access' | 'refresh';
}

export function signAccessToken(p: Omit<JwtPayload, 'type'>): string {
  return jwt.sign({ ...p, type: 'access' }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
  } as SignOptions);
}

export function signRefreshToken(p: Omit<JwtPayload, 'type'>): string {
  // jti guarantees uniqueness even for tokens issued within the same second,
  // so rotation always invalidates the previous token.
  return jwt.sign({ ...p, type: 'refresh', jti: randomUUID() }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL,
  } as SignOptions);
}

export function verifyToken(token: string, type: 'access' | 'refresh'): JwtPayload {
  const secret = type === 'access' ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET;
  const payload = jwt.verify(token, secret) as JwtPayload;
  if (payload.type !== type) throw new Error('Wrong token type');
  return payload;
}

/** Refresh tokens are stored only as a SHA-256 digest. */
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
