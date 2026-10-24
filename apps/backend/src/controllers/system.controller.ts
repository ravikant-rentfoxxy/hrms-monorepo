import { ApiError, h, ok } from '../utils/http';
import { audit } from '../lib/audit';
import * as systemService from '../services/system.service';

export const jobs = h(async (_req, res) => {
  ok(res, await systemService.jobs());
});

export const runJob = h(async (req, res) => {
  const name = req.params.name as string;
  if (systemService.isPlatformJob(name) && req.auth?.role !== 'SUPER_ADMIN') {
    throw ApiError.forbidden('Platform jobs can only be run by the super admin');
  }
  const result = await systemService.runNow(name);
  await audit(req, { entity: 'JobRun', entityId: name, action: 'RUN', after: result, companyId: req.auth?.companyId ?? null });
  ok(res, result);
});
