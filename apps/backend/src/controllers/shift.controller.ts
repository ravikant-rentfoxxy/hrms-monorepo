import { h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow, isManagerial } from '../middleware/auth';
import { audit, diff } from '../lib/audit';
import * as shiftService from '../services/shift.service';
import type { AssignInput, ShiftInput } from '../services/shift.service';

export const list = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { includeInactive } = req.query as unknown as { includeInactive: boolean };
  ok(res, await shiftService.listShifts(tenantId, includeInactive));
});

export const create = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const shift = await shiftService.createShift(tenantId, req.body as ShiftInput);
  await audit(req, { entity: 'Shift', entityId: shift.id, action: 'CREATE', after: shift });
  ok(res, shift, 201);
});

export const update = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await shiftService.updateShift(tenantId, req.params.id as string, req.body as Partial<ShiftInput>);
  const changes = diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
  await audit(req, { entity: 'Shift', entityId: after.id, action: 'UPDATE', ...changes });
  ok(res, after);
});

export const remove = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const result = await shiftService.deleteShift(tenantId, req.params.id as string);
  await audit(req, {
    entity: 'Shift',
    entityId: result.shift.id,
    action: result.deleted ? 'DELETE' : 'DEACTIVATE',
    before: result.shift,
  });
  ok(res, { deleted: result.deleted, deactivated: result.deactivated });
});

export const assign = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const input = req.body as AssignInput;
  const result = await shiftService.assignShift(tenantId, input);
  await audit(req, { entity: 'ShiftAssignment', entityId: input.shiftId, action: 'ASSIGN', after: { ...input } });
  ok(res, result, 201);
});

export const assignments = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const q = req.query as unknown as { employeeId?: string; shiftId?: string; from?: Date; to?: Date };
  // Non-managerial users only see their own assignments.
  if (!isManagerial(auth.role)) q.employeeId = employeeIdOrThrow(req);
  ok(res, await shiftService.listAssignments(tenantId, q));
});

export const removeAssignment = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const removed = await shiftService.deleteAssignment(tenantId, req.params.id as string);
  await audit(req, { entity: 'ShiftAssignment', entityId: removed.id, action: 'DELETE', before: removed });
  ok(res, { deleted: true });
});
