import { h, ok } from '../utils/http';
import { ctx } from '../middleware/auth';
import * as transferService from '../services/transfer.service';
import type { TransferFilter, TransferInput } from '../services/transfer.service';

export const list = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await transferService.list(tenantId, auth, req.query as unknown as TransferFilter));
});

/** The caller's own transfer / promotion history. */
export const mine = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await transferService.list(tenantId, auth, { mine: true }));
});

export const detail = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await transferService.detail(tenantId, req.params.id as string, auth));
});

export const create = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await transferService.create(tenantId, auth, req.body as TransferInput, req), 201);
});

export const decide = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { decision, remarks } = req.body as { decision: 'APPROVED' | 'REJECTED'; remarks?: string };
  ok(res, await transferService.decide(tenantId, req.params.id as string, auth, decision, remarks, req));
});

export const cancel = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { remarks } = req.body as { remarks?: string };
  ok(res, await transferService.cancel(tenantId, req.params.id as string, auth, remarks, req));
});

/** ADMIN/HR: apply an approved request now (normally the daily job does it on the effective date). */
export const applyNow = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await transferService.applyTransfer(tenantId, req.params.id as string, auth.employeeId, req));
});
