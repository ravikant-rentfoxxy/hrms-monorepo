import type { Request } from 'express';
import { h, ok } from '../utils/http';
import { audit, diff } from '../lib/audit';
import * as companyService from '../services/company.service';
import type { CompanyInput, GrantMembershipInput } from '../services/company.service';

// Company lifecycle events are platform-level (companyId null in the trail);
// membership grants / revokes are recorded against the company they affect,
// so that company's ADMIN / HR see them in their own audit log too.

export const list = h(async (_req, res) => {
  ok(res, await companyService.listCompanies());
});

export const create = h(async (req, res) => {
  const company = await companyService.createCompany(req.body as CompanyInput);
  await audit(req, { entity: 'Company', entityId: company.id, action: 'CREATE', after: company, companyId: null });
  ok(res, company, 201);
});

export const get = h(async (req, res) => {
  ok(res, await companyService.getCompany(req.params.id as string));
});

export const update = h(async (req, res) => {
  const id = req.params.id as string;
  const { _count: _c, ...before } = await companyService.getCompany(id);
  const after = await companyService.updateCompany(id, req.body as Partial<CompanyInput>);
  const changes = diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
  delete changes.before.updatedAt;
  delete changes.after.updatedAt;
  if (Object.keys(changes.after).length > 0) {
    await audit(req, { entity: 'Company', entityId: id, action: 'UPDATE', ...changes, companyId: null });
  }
  ok(res, after);
});

export const remove = h(async (req, res) => {
  const id = req.params.id as string;
  const { _count: counts, ...before } = await companyService.getCompany(id);
  await companyService.deleteCompany(id);
  await audit(req, { entity: 'Company', entityId: id, action: 'DELETE', before: { ...before, counts }, companyId: null });
  ok(res, { deleted: true });
});

async function grant(req: Request, body: GrantMembershipInput) {
  const companyId = req.params.id as string;
  const result = await companyService.grantMembership(companyId, body);
  await audit(req, {
    entity: 'Membership',
    entityId: result.membership.id,
    action: 'GRANT',
    after: { email: result.user.email, userId: result.user.id, role: result.membership.role, employeeId: result.employee.id },
    companyId,
  });
  return result;
}

export const grantMember = h(async (req, res) => {
  ok(res, await grant(req, req.body as GrantMembershipInput), 201);
});

/** Back-compat alias: always grants ADMIN. */
export const grantAdmin = h(async (req, res) => {
  ok(res, await grant(req, { ...(req.body as GrantMembershipInput), role: 'ADMIN' as const }), 201);
});

export const listMembers = h(async (req, res) => {
  ok(res, await companyService.listMembers(req.params.id as string));
});

export const revokeMember = h(async (req, res) => {
  const companyId = req.params.id as string;
  const userId = req.params.userId as string;
  const membership = await companyService.revokeMembership(companyId, userId);
  await audit(req, {
    entity: 'Membership',
    entityId: membership.id,
    action: 'REVOKE',
    before: { userId, role: membership.role, isActive: true },
    after: { userId, role: membership.role, isActive: false },
    companyId,
  });
  ok(res, { revoked: true });
});

export const stats = h(async (_req, res) => {
  ok(res, await companyService.platformStats());
});
