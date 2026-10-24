/**
 * TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30 s step) for authenticator apps —
 * Google Authenticator, Microsoft Authenticator, Authy, 1Password, ...
 * Pure node `crypto`; secrets are RFC 4648 base32 without padding.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** New random 160-bit secret (base32, 32 chars). */
export const generateTotpSecret = (): string => base32Encode(randomBytes(20));

/** HOTP value (RFC 4226) for a counter. */
function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(msg).digest();
  const offset = (hmac[hmac.length - 1] as number) & 0x0f;
  const code =
    (((hmac[offset] as number) & 0x7f) << 24) |
    ((hmac[offset + 1] as number) << 16) |
    ((hmac[offset + 2] as number) << 8) |
    (hmac[offset + 3] as number);
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** Current code for a base32 secret (handy for tests / scripts). */
export function totpCode(secretBase32: string, at = Date.now()): string {
  return hotp(base32Decode(secretBase32), Math.floor(at / 1000 / STEP_SECONDS));
}

/**
 * Checks a 6-digit code, accepting ±`window` steps of clock drift (default
 * ±30 s). Constant-time comparison per candidate.
 */
export function verifyTotp(secretBase32: string, code: string, window = 1, at = Date.now()): boolean {
  const clean = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  let secret: Buffer;
  try {
    secret = base32Decode(secretBase32);
  } catch {
    return false;
  }
  const counter = Math.floor(at / 1000 / STEP_SECONDS);
  const given = Buffer.from(clean);
  let ok = false;
  for (let w = -window; w <= window; w++) {
    if (timingSafeEqual(Buffer.from(hotp(secret, counter + w)), given)) ok = true;
  }
  return ok;
}

/** `otpauth://` URI that authenticator apps import (as a QR code or pasted). */
export function otpauthUri(secretBase32: string, account: string, issuer = 'HRMS'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
