/**
 * Human-readable record IDs per company: REQ-2026-0004, JOB-2026-0012,
 * CAN-000045, APP-000123, OFF-2026-0003, EXIT-2026-0007.
 *
 * Counters live in the Sequence table and are incremented atomically, so
 * concurrent creates never get the same number. Pass the transaction client
 * when creating the record inside a transaction.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';

type Db = PrismaClient | Prisma.TransactionClient;

export const CODE_FORMATS = {
  REQUISITION: { prefix: 'REQ', yearly: true, pad: 4 },
  JOB: { prefix: 'JOB', yearly: true, pad: 4 },
  CANDIDATE: { prefix: 'CAN', yearly: false, pad: 6 },
  APPLICATION: { prefix: 'APP', yearly: false, pad: 6 },
  OFFER: { prefix: 'OFF', yearly: true, pad: 4 },
  EXIT: { prefix: 'EXIT', yearly: true, pad: 4 },
  /** Asset tags generated when assets are issued from an onboarding task. */
  ASSET: { prefix: 'AST', yearly: false, pad: 5 },
} as const;

export type CodeKind = keyof typeof CODE_FORMATS;

export async function nextCode(companyId: string, kind: CodeKind, db: Db = prisma, now = new Date()): Promise<string> {
  const fmt = CODE_FORMATS[kind];
  const year = now.getUTCFullYear();
  // Yearly series restart every January (REQ-2026-0001, REQ-2027-0001, ...).
  const name = fmt.yearly ? `${kind}:${year}` : kind;
  const seq = await db.sequence.upsert({
    where: { companyId_name: { companyId, name } },
    create: { companyId, name, value: 1 },
    update: { value: { increment: 1 } },
  });
  const n = String(seq.value).padStart(fmt.pad, '0');
  return fmt.yearly ? `${fmt.prefix}-${year}-${n}` : `${fmt.prefix}-${n}`;
}
