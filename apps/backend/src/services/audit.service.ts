/** Read side of the audit trail (writes go through `audit()` in lib/audit.ts). */
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export interface AuditQuery {
  entity?: string;
  entityId?: string;
  actorEmployeeId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

/**
 * Paged log for one tenant, newest first. `companyId === null` lists
 * platform-level events (company create / delete, password resets, ...).
 */
export async function listAudit(companyId: string | null, q: AuditQuery) {
  const to = q.to ? new Date(q.to.getTime() + 86400000) : undefined; // `to` is inclusive (whole day)
  const where: Prisma.AuditLogWhereInput = {
    companyId,
    ...(q.entity ? { entity: q.entity } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
    ...(q.actorEmployeeId ? { actorEmployeeId: q.actorEmployeeId } : {}),
    ...(q.action ? { action: q.action } : {}),
    ...(q.from || to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(to ? { lt: to } : {}) } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);
  const labels = await entityLabels(companyId, items);
  return {
    items: items.map((i) => ({ ...i, entityLabel: labels.get(`${i.entity}:${i.entityId}`) ?? null })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

/** Human names for the rows' subjects (employee name, company name, ...), best effort. */
async function entityLabels(companyId: string | null, items: { entity: string; entityId: string }[]) {
  const labels = new Map<string, string>();
  const ids = (entity: string) => [...new Set(items.filter((i) => i.entity === entity).map((i) => i.entityId))];
  const employeeIds = ids('Employee');
  const userIds = ids('User');
  const companyIds = ids('Company');
  const [employees, users, companies] = await Promise.all([
    employeeIds.length
      ? prisma.employee.findMany({ where: { id: { in: employeeIds }, ...(companyId ? { companyId } : {}) }, select: { id: true, name: true, employeeCode: true } })
      : [],
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } }) : [],
    companyIds.length ? prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }) : [],
  ]);
  for (const e of employees) labels.set(`Employee:${e.id}`, `${e.name} (${e.employeeCode})`);
  for (const u of users) labels.set(`User:${u.id}`, u.email);
  for (const c of companies) labels.set(`Company:${c.id}`, c.name);
  return labels;
}

/** Distinct entity / action values present, for the viewer's filter dropdowns. */
export async function auditFacets(companyId: string | null) {
  const [entities, actions] = await Promise.all([
    prisma.auditLog.groupBy({ by: ['entity'], where: { companyId }, orderBy: { entity: 'asc' } }),
    prisma.auditLog.groupBy({ by: ['action'], where: { companyId }, orderBy: { action: 'asc' } }),
  ]);
  return { entities: entities.map((e) => e.entity), actions: actions.map((a) => a.action) };
}
