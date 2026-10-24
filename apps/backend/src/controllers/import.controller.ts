import { ApiError, h, ok } from '../utils/http';
import { sendCsv } from '../utils/csv';
import { ctx } from '../middleware/auth';
import { audit } from '../lib/audit';
import * as importService from '../services/import.service';

export const templates = h(async (_req, res) => {
  ok(res, importService.templateInfo());
});

/** GET /imports/templates/:type.csv — header row + one example row. */
export const template = h(async (req, res) => {
  const raw = (req.params.type as string).replace(/\.csv$/i, '');
  const { fileName, csv } = importService.template(importService.parseType(raw));
  sendCsv(res, fileName, csv);
});

export const preview = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const type = importService.parseType(req.params.type as string);
  const file = req.file;
  if (!file) throw ApiError.badRequest('Attach the CSV as the "file" field');
  const { overwrite } = req.body as { overwrite: boolean };
  ok(
    res,
    await importService.preview(tenantId, type, { name: file.originalname, buffer: file.buffer }, {
      overwrite,
      createdById: auth.employeeId ?? auth.userId,
    }),
    201
  );
});

export const commit = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(
    res,
    await importService.commit(tenantId, req.params.id as string, {
      actorEmployeeId: auth.employeeId,
      audit: (entry) => audit(req, entry),
    })
  );
});

export const list = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await importService.list(tenantId));
});

export const get = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await importService.get(tenantId, req.params.id as string));
});
