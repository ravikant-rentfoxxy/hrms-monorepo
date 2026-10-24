import { ApiError, h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow } from '../middleware/auth';
import { audit } from '../lib/audit';
import { sendCsv, toCsv } from '../utils/csv';
import * as careerService from '../services/career.service';
import type { CertificationFilter, CertificationInput, SkillInput, SkillSearch } from '../services/career.service';

// ---- History ----

export const myHistory = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await careerService.history(tenantId, auth, employeeIdOrThrow(req)));
});

export const history = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await careerService.history(tenantId, auth, req.params.employeeId as string));
});

// ---- Skills ----

export const mySkills = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await careerService.listSkills(tenantId, auth, employeeIdOrThrow(req)));
});

export const employeeSkills = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await careerService.listSkills(tenantId, auth, req.params.employeeId as string));
});

export const addSkill = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await careerService.upsertSkill(tenantId, auth, req.body as SkillInput & { employeeId?: string }), 201);
});

export const updateSkill = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await careerService.updateSkill(tenantId, auth, req.params.id as string, req.body as Partial<SkillInput>));
});

export const deleteSkill = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  await careerService.deleteSkill(tenantId, auth, req.params.id as string);
  ok(res, { deleted: true });
});

export const endorseSkill = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { endorse } = req.body as { endorse: boolean };
  ok(res, await careerService.endorseSkill(tenantId, auth, req.params.id as string, endorse));
});

export const searchSkills = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await careerService.searchSkills(tenantId, req.query as unknown as SkillSearch));
});

export const skillNames = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await careerService.skillNames(tenantId));
});

export const exportSkills = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { items } = await careerService.searchSkills(tenantId, req.query as unknown as SkillSearch);
  sendCsv(res, 'skills.csv', toCsv(
    ['Employee ID', 'Name', 'Department', 'Designation', 'Skill', 'Level', 'Years', 'Endorsed by'],
    items.map((r) => [r.employee.employeeCode, r.employee.name, r.employee.department, r.employee.designation, r.skill, r.level, r.years, r.endorsedByName ?? ''])
  ));
});

// ---- Certifications ----

export const myCertifications = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await careerService.listCertifications(tenantId, auth, employeeIdOrThrow(req)));
});

export const employeeCertifications = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await careerService.listCertifications(tenantId, auth, req.params.employeeId as string));
});

export const companyCertifications = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await careerService.companyCertifications(tenantId, req.query as unknown as CertificationFilter));
});

export const exportCertifications = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const rows = await careerService.companyCertifications(tenantId, req.query as unknown as CertificationFilter);
  sendCsv(res, 'certifications.csv', toCsv(
    ['Employee ID', 'Name', 'Department', 'Certification', 'Issuer', 'Credential ID', 'Credential URL', 'Issued on', 'Expires on', 'Status', 'Verified', 'Internal course'],
    rows.map((r) => [
      r.employee.employeeCode, r.employee.name, r.employee.department, r.name, r.issuer, r.credentialId, r.credentialUrl,
      r.issuedOn, r.expiresOn, r.status, r.verified ? 'Yes' : 'No', r.courseId ? 'Yes' : 'No',
    ])
  ));
});

export const expiring = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { days } = req.query as unknown as { days: number };
  ok(res, await careerService.expiringCertifications(tenantId, auth, days));
});

export const addCertification = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const created = await careerService.createCertification(
    tenantId, auth, req.body as CertificationInput & { employeeId?: string }, req.file ?? undefined
  );
  await audit(req, { entity: 'EmployeeCertification', entityId: created.id, action: 'CREATE', after: created });
  ok(res, created, 201);
});

export const updateCertification = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await careerService.updateCertification(tenantId, auth, req.params.id as string, req.body as Partial<CertificationInput>, req.file ?? undefined));
});

export const deleteCertification = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const row = await careerService.deleteCertification(tenantId, auth, req.params.id as string);
  await audit(req, { entity: 'EmployeeCertification', entityId: row.id, action: 'DELETE', before: row });
  ok(res, { deleted: true });
});

export const verifyCertification = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { verified } = req.body as { verified: boolean };
  const { before, after } = await careerService.verifyCertification(tenantId, auth, req.params.id as string, verified);
  await audit(req, { entity: 'EmployeeCertification', entityId: after.id, action: verified ? 'VERIFY' : 'UNVERIFY', before: { verified: before.verified }, after: { verified } });
  ok(res, after);
});

export const certificationFile = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  if (!req.params.id) throw ApiError.badRequest('id is required');
  ok(res, await careerService.certificationFileUrl(tenantId, auth, req.params.id as string));
});
