import { ApiError, h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow } from '../middleware/auth';
import { audit, diff } from '../lib/audit';
import { prisma } from '../lib/prisma';
import { sendCsv, toCsv } from '../utils/csv';
import { isCompanyAdmin } from '../utils/lifecycle';
import * as assetService from '../services/asset.service';
import type { AssetInput, AssignInput, AssignmentDatesInput, ReturnInput } from '../services/asset.service';

export const meta = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, { categories: assetService.ASSET_CATEGORIES, statuses: assetService.ASSET_STATUSES, summary: await assetService.summary(tenantId) });
});

export const list = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await assetService.listAssets(tenantId, req.query as { status?: string; category?: string; q?: string }));
});

export const get = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await assetService.getAsset(tenantId, req.params.id as string));
});

export const create = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const asset = await assetService.createAsset(tenantId, req.body as AssetInput);
  await audit(req, { entity: 'Asset', entityId: asset.id, action: 'CREATE', after: asset });
  ok(res, asset, 201);
});

export const update = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await assetService.updateAsset(tenantId, req.params.id as string, req.body as Partial<AssetInput>);
  const changes = diff(before as unknown as Record<string, unknown>, req.body as Record<string, unknown>);
  await audit(req, { entity: 'Asset', entityId: after.id, action: 'UPDATE', ...changes });
  ok(res, after);
});

/** Creates new assets and issues them to one employee (employee profile → Assets → Add). */
export const issueToEmployee = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const employeeId = req.params.employeeId as string;
  const { items, issuedOn } = req.body as { items: assetService.NewAssetItem[]; issuedOn?: Date | null };
  const assets = await assetService.issueNewAssets(tenantId, employeeId, items, {
    issuedById: auth.employeeId,
    issuedOn,
    notes: 'Issued from the employee profile',
  });
  await audit(req, { entity: 'Employee', entityId: employeeId, action: 'ISSUE_ASSETS', after: { assets: assets.map((a) => `${a.tag} ${a.name}`) } });
  ok(res, assets, 201);
});

export const remove = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const withHistory = req.query.withHistory === 'true';
  const { asset, history } = await assetService.deleteAsset(tenantId, req.params.id as string, { withHistory });
  // The issue history is gone from the database; the audit row keeps it.
  await audit(req, { entity: 'Asset', entityId: asset.id, action: 'DELETE', before: { ...asset, issueHistory: history } });
  ok(res, { deleted: true });
});

export const assign = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const assignment = await assetService.assignAsset(tenantId, req.params.id as string, req.body as AssignInput, auth.employeeId);
  await audit(req, { entity: 'Asset', entityId: assignment.assetId, action: 'ASSIGN', after: assignment });
  ok(res, assignment, 201);
});

export const giveBack = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const assignment = await assetService.returnAsset(tenantId, req.params.id as string, req.body as ReturnInput);
  await audit(req, { entity: 'Asset', entityId: assignment.assetId, action: 'RETURN', after: assignment });
  ok(res, assignment);
});

export const updateAssignmentDates = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await assetService.updateAssignmentDates(tenantId, req.params.assignmentId as string, req.body as AssignmentDatesInput);
  await audit(req, {
    entity: 'Asset',
    entityId: after.assetId,
    action: 'ASSIGNMENT_DATES',
    ...diff(
      { issuedOn: before.issuedOn, expectedReturn: before.expectedReturn, returnedOn: before.returnedOn },
      { issuedOn: after.issuedOn, expectedReturn: after.expectedReturn, returnedOn: after.returnedOn }
    ),
  });
  ok(res, after);
});

export const history = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await assetService.assetHistory(tenantId, req.params.id as string));
});

/** An employee's assets: own, or anyone's for ADMIN/HR (and a manager for direct reports). */
export const employeeAssets = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const employeeId = req.params.employeeId as string;
  if (!isCompanyAdmin(auth.role) && employeeId !== auth.employeeId) {
    const isReport = await prisma.employee.count({ where: { id: employeeId, companyId: tenantId, managerId: auth.employeeId ?? '' } });
    if (!isReport) throw ApiError.forbidden();
  }
  const includeReturned = req.query.includeReturned === 'true' || req.query.includeReturned === '1';
  ok(res, await assetService.employeeAssets(tenantId, employeeId, { includeReturned }));
});

export const mine = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const includeReturned = req.query.includeReturned === 'true' || req.query.includeReturned === '1';
  ok(res, await assetService.employeeAssets(tenantId, employeeIdOrThrow(req), { includeReturned }));
});

export const exportCsv = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const csv = toCsv(
    ['Tag', 'Name', 'Category', 'Brand', 'Model', 'Serial number', 'Purchase date', 'Cost', 'Status', 'Assigned to', 'Employee ID', 'Issued on', 'Notes'],
    await assetService.exportRows(tenantId)
  );
  sendCsv(res, `assets-${new Date().toISOString().slice(0, 10)}.csv`, csv);
});
