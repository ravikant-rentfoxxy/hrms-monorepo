/**
 * Audit trail for sensitive changes (salary, bank details, roles, approvals,
 * payslips, ...). Never throws — a failed audit write is logged, not surfaced.
 *
 *   await audit(req, { entity: 'Employee', entityId: id, action: 'UPDATE', before, after });
 */
import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';

export interface AuditEntry {
  entity: string;
  entityId: string;
  /** CREATE | UPDATE | DELETE | APPROVE | REJECT | PUBLISH | LOGIN | ... */
  action: string;
  before?: unknown;
  after?: unknown;
  /** Overrides the request's tenant (e.g. platform events → null). */
  companyId?: string | null;
}

/** Fields never written to the audit log. */
const REDACT = new Set(['passwordHash', 'refreshTokenHash', 'totpSecret', 'resetOtpHash']);

function clean(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (key, v: unknown) => (REDACT.has(key) ? undefined : v))
  ) as Prisma.InputJsonValue;
}

/** Only the keys whose values differ — keeps UPDATE entries small and readable. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return { before: b, after: a };
}

export async function audit(req: Request | null, entry: AuditEntry): Promise<void> {
  try {
    const auth = req?.auth;
    let actorName = '';
    if (auth?.employeeId) {
      const emp = await prisma.employee.findUnique({ where: { id: auth.employeeId }, select: { name: true } });
      actorName = emp?.name ?? '';
    } else if (auth?.role === 'SUPER_ADMIN') {
      actorName = 'Super Admin';
    } else if (!auth) {
      actorName = 'System';
    }
    await prisma.auditLog.create({
      data: {
        companyId: entry.companyId !== undefined ? entry.companyId : (req?.tenantId ?? auth?.companyId ?? null),
        actorUserId: auth?.userId ?? null,
        actorEmployeeId: auth?.employeeId ?? null,
        actorName,
        entity: entry.entity,
        entityId: entry.entityId,
        action: entry.action,
        before: clean(entry.before),
        after: clean(entry.after),
        ip: req?.ip ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, entry: { entity: entry.entity, entityId: entry.entityId, action: entry.action } }, 'audit write failed');
  }
}
