import { h, ok } from '../utils/http';
import { ctx } from '../middleware/auth';
import * as holidayService from '../services/holiday.service';
import type { HolidayInput } from '../services/holiday.service';

export const list = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { year } = req.query as unknown as { year?: number };
  ok(res, await holidayService.listHolidays(tenantId, year));
});

export const create = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const body = req.body as HolidayInput | HolidayInput[];
  ok(res, await holidayService.createHolidays(tenantId, Array.isArray(body) ? body : [body]), 201);
});

export const update = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await holidayService.updateHoliday(tenantId, req.params.id as string, req.body as Partial<HolidayInput>));
});

export const remove = h(async (req, res) => {
  const { tenantId } = ctx(req);
  await holidayService.deleteHoliday(tenantId, req.params.id as string);
  ok(res, { deleted: true });
});
