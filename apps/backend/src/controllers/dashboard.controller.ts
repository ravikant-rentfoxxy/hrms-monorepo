import { ApiError, h, ok } from '../utils/http';
import { ctx } from '../middleware/auth';
import * as dashboardService from '../services/dashboard.service';

export const get = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await dashboardService.dashboard(tenantId, { role: auth.role, employeeId: auth.employeeId }));
});

/** Manager's team today (also usable by ADMIN/HR who have direct reports). */
export const team = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  if (!auth.employeeId) throw ApiError.forbidden('This account has no employee profile');
  ok(res, await dashboardService.teamToday(tenantId, auth.employeeId));
});
