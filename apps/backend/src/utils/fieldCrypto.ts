/**
 * Field-level encryption at rest for identity / bank numbers (PAN, Aadhaar,
 * bank account, UAN) and other small secrets (TOTP seeds).
 *
 * Stored format: `enc:v1:<base64(iv[12] | authTag[16] | ciphertext)>` using
 * AES-256-GCM. Values without the prefix are legacy plaintext and are
 * returned unchanged by `decryptField`, so old rows keep reading fine until
 * `POST /employees/encrypt-existing` rewrites them.
 *
 * Key: env FIELD_ENCRYPTION_KEY (64 hex chars / 32-byte base64 / any passphrase,
 * hashed), else derived from JWT_ACCESS_SECRET. Rotating the key makes
 * existing ciphertext unreadable — re-encrypt before rotating.
 *
 * Every reader of Employee.pan / aadhaarNumber / accountNumber / uan must call
 * `revealEmployeeSecrets(emp)` (or `decryptField(v)`) before using the value.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { logger } from '../lib/logger';

const PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Employee columns encrypted at rest. */
export const EMPLOYEE_SECRET_FIELDS = ['pan', 'aadhaarNumber', 'accountNumber', 'uan'] as const;
export type EmployeeSecretField = (typeof EMPLOYEE_SECRET_FIELDS)[number];

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const configured = process.env.FIELD_ENCRYPTION_KEY?.trim();
  if (configured) {
    if (/^[0-9a-fA-F]{64}$/.test(configured)) cachedKey = Buffer.from(configured, 'hex');
    else {
      const b64 = Buffer.from(configured, 'base64');
      cachedKey = b64.length === 32 ? b64 : createHash('sha256').update(configured).digest();
    }
  } else {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error('FIELD_ENCRYPTION_KEY or JWT_ACCESS_SECRET must be set for field encryption');
    cachedKey = createHash('sha256').update(`hrms-field-encryption:${secret}`).digest();
  }
  return cachedKey;
}

export const isEncrypted = (value: string | null | undefined): boolean => !!value && value.startsWith(PREFIX);

/** Encrypts a value; empty strings and already-encrypted values are returned as-is. */
export function encryptField(value: string): string;
export function encryptField(value: string | null | undefined): string | null | undefined;
export function encryptField(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined || value === '' || isEncrypted(value)) return value;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

/**
 * Plaintext of a stored value. Legacy plaintext passes through; a value that
 * cannot be decrypted (wrong key / tampered) yields '' — never ciphertext.
 */
export function decryptField(value: string): string;
export function decryptField(value: string | null | undefined): string | null | undefined;
export function decryptField(value: string | null | undefined): string | null | undefined {
  if (!isEncrypted(value)) return value;
  try {
    const raw = Buffer.from((value as string).slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
  } catch (err) {
    logger.error({ err }, 'field decryption failed (wrong FIELD_ENCRYPTION_KEY?)');
    return '';
  }
}

/** `XXXXXX1234` — last four characters visible. */
export function maskValue(value: string | null | undefined): string {
  const plain = (value ?? '').replace(/\s+/g, '');
  if (!plain) return '';
  if (plain.length <= 4) return 'X'.repeat(plain.length);
  return 'X'.repeat(Math.max(6, plain.length - 4)) + plain.slice(-4);
}

/** True for a masked echo (e.g. a client posting back `XXXXXX1234`). */
export const isMaskedValue = (value: unknown): boolean => typeof value === 'string' && /^X{4,}[0-9A-Za-z]{0,4}$/.test(value);

type WithSecrets = Partial<Record<EmployeeSecretField, string | null>>;

/** Copy of `data` with every secret field present encrypted (for create/update payloads). */
export function encryptEmployeeSecrets<T extends object>(data: T): T {
  const out = { ...data } as T & WithSecrets;
  for (const f of EMPLOYEE_SECRET_FIELDS) {
    const v = out[f];
    if (typeof v === 'string') out[f] = encryptField(v.trim());
  }
  return out;
}

/** Copy of an employee row with the secret fields decrypted (null/undefined passes through). */
export function revealEmployeeSecrets<T extends object>(emp: T): T;
export function revealEmployeeSecrets<T extends object>(emp: T | null): T | null;
export function revealEmployeeSecrets<T extends object>(emp: T | null): T | null {
  if (!emp) return emp;
  const out = { ...emp } as T & WithSecrets;
  for (const f of EMPLOYEE_SECRET_FIELDS) {
    const v = out[f];
    if (typeof v === 'string') out[f] = decryptField(v);
  }
  return out;
}

/** Copy of an employee row with the secret fields decrypted and masked. */
export function maskEmployeeSecrets<T extends object>(emp: T): T {
  const out = { ...emp } as T & WithSecrets;
  for (const f of EMPLOYEE_SECRET_FIELDS) {
    const v = out[f];
    if (typeof v === 'string') out[f] = maskValue(decryptField(v));
  }
  return out;
}
