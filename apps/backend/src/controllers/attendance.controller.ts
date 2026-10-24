import { ApiError, h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow, isManagerial } from '../middleware/auth';
import { audit } from '../lib/audit';
import { sendCsv } from '../utils/csv';
import * as attendanceService from '../services/attendance.service';
import type { PunchInput } from '../services/attendance.service';

const isCompanyAdmin = (role: string) => role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR';

export const checkIn = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await attendanceService.checkIn(tenantId, employeeIdOrThrow(req), req.body as PunchInput), 201);
});

export const checkOut = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await attendanceService.checkOut(tenantId, employeeIdOrThrow(req), req.body as PunchInput));
});

export const today = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await attendanceService.todayRecord(employeeIdOrThrow(req), tenantId));
});

/** Today's shift, window, weekly-off / holiday / leave and record. */
export const todaySummary = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await attendanceService.todaySummary(tenantId, employeeIdOrThrow(req)));
});

/**
 * Monthly list: own records; ADMIN/HR/MANAGER can pass ?employeeId= for others.
 * `?view=calendar` returns { records, days (shift / weekly off / holiday / leave), summary }.
 */
export const monthly = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { year, month, employeeId, view } = req.query as unknown as {
    year: number; month: number; employeeId?: string; view: 'list' | 'calendar';
  };
  let target = auth.employeeId;
  if (employeeId && employeeId !== auth.employeeId) {
    if (!isManagerial(auth.role)) throw ApiError.forbidden();
    target = employeeId;
  }
  if (!target) throw ApiError.badRequest('employeeId required');
  ok(
    res,
    view === 'calendar'
      ? await attendanceService.monthCalendar(tenantId, target, year, month)
      : await attendanceService.monthlyRecords(tenantId, target, year, month)
  );
});

/** Same as GET /?view=calendar. */
export const calendar: typeof monthly = (req, res, next) => {
  (req.query as Record<string, unknown>).view = 'calendar';
  return monthly(req, res, next);
};

/** Company-wide view for a single day (ADMIN/HR; MANAGER sees direct reports). */
export const companyDay = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  if (!isManagerial(auth.role)) throw ApiError.forbidden();
  const { date } = req.query as unknown as { date: Date };
  ok(res, await attendanceService.companyDay(tenantId, date, auth));
});

// ---- Regularization ----

export const requestRegularization = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const body = req.body as { date: Date; reason: string; note?: string };
  ok(res, await attendanceService.requestRegularization(tenantId, employeeIdOrThrow(req), body), 201);
});

export const listRegularizations = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { scope, status } = req.query as unknown as { scope: 'me' | 'company'; status?: string };
  if (scope === 'company' && !isManagerial(auth.role)) throw ApiError.forbidden();
  ok(res, await attendanceService.listRegularizations(tenantId, { scope, status, actor: auth }));
});

export const regularizationTrail = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await attendanceService.regularizationTrail(tenantId, req.params.id as string));
});

export const cancelRegularization = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await attendanceService.cancelRegularization(tenantId, employeeIdOrThrow(req), req.params.id as string));
});

/** Any role may call; the approval engine decides whether this actor can act on the current level. */
export const decideRegularization = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { decision, remarks } = req.body as { decision: 'APPROVED' | 'REJECTED'; remarks?: string };
  const result = await attendanceService.decideRegularization(tenantId, req.params.id as string, { decision, remarks, actor: auth });
  await audit(req, {
    entity: 'RegularizationRequest',
    entityId: result.id,
    action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
    after: { status: result.status, outcome: result.outcome, remarks },
  });
  ok(res, result);
});

/** Per-employee payable days (worked + approved leave) for a month. */
export const workingDays = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { year, month } = req.query as unknown as { year: number; month: number };
  ok(res, await attendanceService.payableDaysForMonth(tenantId, year, month));
});

/** Month CSV export (ADMIN/HR). Streams text/csv instead of the JSON envelope. */
export const exportCsv = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  if (!isCompanyAdmin(auth.role)) throw ApiError.forbidden();
  const { year, month } = req.query as unknown as { year: number; month: number };
  const csv = await attendanceService.exportMonthCsv(tenantId, year, month);
  res
    .type('text/csv')
    .setHeader('Content-Disposition', `attachment; filename="attendance-${year}-${String(month).padStart(2, '0')}.csv"`)
    .send(csv);
});

/** Monthly muster roll CSV (employees × days, P/A/L/H/WO/HD + totals). */
export const musterCsv = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { year, month } = req.query as unknown as { year: number; month: number };
  sendCsv(res, `muster-${year}-${String(month).padStart(2, '0')}.csv`, await attendanceService.musterCsv(tenantId, year, month));
});

/** Runs the daily auto-marking for one past date (ADMIN/HR "re-run"). */
export const autoMark = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { date } = req.body as { date: Date };
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const todayLocal = new Date();
  if (day.getTime() >= Date.UTC(todayLocal.getFullYear(), todayLocal.getMonth(), todayLocal.getDate())) {
    throw ApiError.badRequest('Only past dates can be auto-marked');
  }
  const closed = await attendanceService.closeMissedCheckouts(tenantId);
  const result = await attendanceService.autoMarkDay(tenantId, day);
  await audit(req, { entity: 'Attendance', entityId: result.date, action: 'AUTO_MARK', after: { ...result, ...closed } });
  ok(res, { ...result, ...closed });
});
