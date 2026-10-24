import { h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow } from '../middleware/auth';
import { audit } from '../lib/audit';
import * as recognitionService from '../services/recognition.service';
import type { KudosInput } from '../services/recognition.service';

export const wall = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await recognitionService.wall(tenantId, req.query as unknown as { page: number; pageSize: number; employeeId?: string }));
});

export const leaderboard = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await recognitionService.leaderboard(tenantId, req.query as unknown as { month?: string; limit: number }));
});

export const mine = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await recognitionService.mine(tenantId, employeeIdOrThrow(req)));
});

export const give = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await recognitionService.giveKudos(tenantId, employeeIdOrThrow(req), req.body as KudosInput), 201);
});

export const remove = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const kudos = await recognitionService.deleteKudos(tenantId, req.params.id as string);
  await audit(req, { entity: 'Recognition', entityId: kudos.id, action: 'DELETE', before: kudos });
  ok(res, { deleted: true });
});
