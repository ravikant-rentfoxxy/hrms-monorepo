import { h, ok } from '../utils/http';
import { ctx } from '../middleware/auth';
import * as masterService from '../services/master.service';
import type { DepartmentInput, DesignationInput, GradeInput } from '../services/master.service';

const listOpts = (q: unknown) => ({ includeInactive: (q as { includeInactive?: boolean }).includeInactive ?? false });

export const listDepartments = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await masterService.listDepartments(tenantId, listOpts(req.query)));
});

export const createDepartment = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await masterService.createDepartment(tenantId, req.body as DepartmentInput, req), 201);
});

export const updateDepartment = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await masterService.updateDepartment(tenantId, req.params.id as string, req.body as Partial<DepartmentInput>, req));
});

export const deleteDepartment = h(async (req, res) => {
  const { tenantId } = ctx(req);
  await masterService.deleteDepartment(tenantId, req.params.id as string, req);
  ok(res, { deleted: true });
});

export const listDesignations = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await masterService.listDesignations(tenantId, listOpts(req.query)));
});

export const createDesignation = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await masterService.createDesignation(tenantId, req.body as DesignationInput, req), 201);
});

export const updateDesignation = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await masterService.updateDesignation(tenantId, req.params.id as string, req.body as Partial<DesignationInput>, req));
});

export const deleteDesignation = h(async (req, res) => {
  const { tenantId } = ctx(req);
  await masterService.deleteDesignation(tenantId, req.params.id as string, req);
  ok(res, { deleted: true });
});

export const listGrades = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await masterService.listGrades(tenantId, listOpts(req.query)));
});

export const createGrade = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await masterService.createGrade(tenantId, req.body as GradeInput, req), 201);
});

export const updateGrade = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await masterService.updateGrade(tenantId, req.params.id as string, req.body as Partial<GradeInput>, req));
});

export const deleteGrade = h(async (req, res) => {
  const { tenantId } = ctx(req);
  await masterService.deleteGrade(tenantId, req.params.id as string, req);
  ok(res, { deleted: true });
});

export const syncFromEmployees = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await masterService.syncFromEmployees(tenantId, req));
});
