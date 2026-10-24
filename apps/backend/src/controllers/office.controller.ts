import { h, ok } from '../utils/http';
import { ctx } from '../middleware/auth';
import { audit, diff } from '../lib/audit';
import { prisma } from '../lib/prisma';
import * as officeService from '../services/office.service';
import type { OfficeInput } from '../services/office.service';

export const list = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await officeService.listOffices(tenantId));
});

export const create = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await officeService.createOffice(tenantId, req.body as OfficeInput), 201);
});

export const update = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const id = req.params.id as string;
  const before = await prisma.office.findFirst({ where: { id, companyId: tenantId } });
  const after = await officeService.updateOffice(tenantId, id, req.body as Partial<OfficeInput>);
  // State / metro drive PT, LWF and HRA exemption — keep a trail.
  if (before && after) {
    await audit(req, { entity: 'Office', entityId: id, action: 'UPDATE', ...diff(before, after) });
  }
  ok(res, after);
});

export const remove = h(async (req, res) => {
  const { tenantId } = ctx(req);
  await officeService.deleteOffice(tenantId, req.params.id as string);
  ok(res, { deleted: true });
});
