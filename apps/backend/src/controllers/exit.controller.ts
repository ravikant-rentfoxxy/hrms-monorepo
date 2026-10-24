import { h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow } from '../middleware/auth';
import { audit } from '../lib/audit';
import * as exitService from '../services/exit.service';
import * as handoverService from '../services/exit-handover.service';
import * as clearanceService from '../services/exit-clearance.service';
import * as settlementService from '../services/settlement.service';
import { EXIT_LETTER_TYPES, EXIT_STAGES, type ClearanceDept, type ExitLetterType, type ExitType } from '../services/exit.helpers';
import type { HandoverInput } from '../services/exit-handover.service';
import type { PaymentInput, SettlementItem } from '../services/settlement.service';

const p = (v: unknown) => v as string;

export const questions = h(async (_req, res) => {
  ok(res, {
    questions: exitService.EXIT_INTERVIEW_QUESTIONS,
    exitTypes: exitService.EXIT_TYPES,
    departments: exitService.CLEARANCE_DEPARTMENTS,
    clearanceItems: clearanceService.DEFAULT_CLEARANCE_ITEMS,
    stages: EXIT_STAGES,
    letterTypes: EXIT_LETTER_TYPES,
    paymentModes: settlementService.PAYMENT_MODES,
  });
});

export const list = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await exitService.list(tenantId, auth, req.query as { status?: string; scope?: 'me' | 'team' | 'company'; fnfOverdue?: boolean; q?: string }));
});

export const mine = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await exitService.mine(tenantId, employeeIdOrThrow(req)));
});

export const detail = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await exitService.detail(tenantId, p(req.params.id), auth));
});

export const resign = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const r = await exitService.resign(tenantId, employeeIdOrThrow(req), req.body as { reason: string; requestedLastDay?: Date });
  await audit(req, { entity: 'Resignation', entityId: r.id, action: 'CREATE', after: r });
  ok(res, r, 201);
});

export const initiate = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const body = req.body as { employeeId: string; exitType: ExitType; reason: string; lastWorkingDay: Date; noticeWaived?: boolean };
  const r = await exitService.initiateExit(tenantId, auth, body);
  await audit(req, { entity: 'Resignation', entityId: r.id, action: 'CREATE', after: r });
  ok(res, r, 201);
});

export const withdraw = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const r = await exitService.withdraw(tenantId, employeeIdOrThrow(req), p(req.params.id));
  await audit(req, { entity: 'Resignation', entityId: r.id, action: 'WITHDRAW' });
  ok(res, r);
});

export const decide = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const body = req.body as { decision: 'APPROVED' | 'REJECTED'; remarks?: string; approvedLastDay?: Date; noticeWaived?: boolean };
  const r = await exitService.decide(tenantId, p(req.params.id), auth, body);
  await audit(req, { entity: 'Resignation', entityId: r.id, action: body.decision === 'APPROVED' ? 'APPROVE' : 'REJECT', after: { status: r.status, ...body } });
  ok(res, r);
});

// ---- Notice period ----

export const noticeSummary = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await handoverService.noticeSummary(tenantId, p(req.params.id), auth));
});

export const requestLastDayChange = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { before, after: r } = await exitService.requestLastDayChange(tenantId, p(req.params.id), auth, req.body as { lastDay: Date; reason: string });
  await audit(req, {
    entity: 'Resignation',
    entityId: r.id,
    action: r.lastDayChangeStatus === 'APPROVED' ? 'LAST_DAY_CHANGE' : 'LAST_DAY_CHANGE_REQUEST',
    before,
    after: { lastDayChangeTo: r.lastDayChangeTo, lastDayChangeStatus: r.lastDayChangeStatus, approvedLastDay: r.approvedLastDay, shortfallDays: r.shortfallDays },
  });
  ok(res, r);
});

export const decideLastDayChange = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const body = req.body as { decision: 'APPROVED' | 'REJECTED'; remarks?: string; noticeWaived?: boolean };
  const r = await exitService.decideLastDayChange(tenantId, p(req.params.id), auth, body);
  await audit(req, {
    entity: 'Resignation',
    entityId: r.id,
    action: body.decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
    after: { lastDayChangeTo: r.lastDayChangeTo, lastDayChangeStatus: r.lastDayChangeStatus, approvedLastDay: r.approvedLastDay, shortfallDays: r.shortfallDays, noticeWaived: r.noticeWaived },
  });
  ok(res, r);
});

// ---- Handover ----

export const createHandover = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const t = await handoverService.createTask(tenantId, p(req.params.id), auth, req.body as HandoverInput);
  await audit(req, { entity: 'HandoverTask', entityId: t.id, action: 'CREATE', after: t });
  ok(res, t, 201);
});

export const updateHandover = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { before, after } = await handoverService.updateTask(tenantId, p(req.params.id), p(req.params.taskId), auth, req.body as Partial<HandoverInput>);
  await audit(req, { entity: 'HandoverTask', entityId: after.id, action: 'UPDATE', before, after });
  ok(res, after);
});

export const deleteHandover = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const t = await handoverService.deleteTask(tenantId, p(req.params.id), p(req.params.taskId), auth);
  await audit(req, { entity: 'HandoverTask', entityId: t.id, action: 'DELETE', before: t });
  ok(res, { id: t.id });
});

export const completeHandover = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { after } = await handoverService.completeTask(tenantId, p(req.params.id), p(req.params.taskId), auth, req.body as { notes?: string });
  ok(res, after);
});

export const verifyHandover = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const body = req.body as { decision: 'VERIFIED' | 'REOPEN'; notes?: string };
  const { before, after } = await handoverService.verifyTask(tenantId, p(req.params.id), p(req.params.taskId), auth, body);
  await audit(req, { entity: 'HandoverTask', entityId: after.id, action: body.decision === 'VERIFIED' ? 'APPROVE' : 'REOPEN', before, after });
  ok(res, after);
});

// ---- Clearance ----

export const clearance = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { before, after } = await clearanceService.actClearance(
    tenantId,
    p(req.params.id),
    req.params.department as ClearanceDept,
    auth,
    req.body as { status: 'CLEARED' | 'PENDING'; dues?: number; remarks?: string; assetsNotReturned?: boolean; force?: boolean }
  );
  await audit(req, { entity: 'ExitClearance', entityId: after.id, action: after.status === 'CLEARED' ? 'APPROVE' : 'UPDATE', before, after });
  ok(res, after);
});

export const clearanceItems = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { before, after } = await clearanceService.updateItems(
    tenantId,
    p(req.params.id),
    req.params.department as ClearanceDept,
    auth,
    req.body as { items: { label: string; done: boolean }[] }
  );
  await audit(req, { entity: 'ExitClearance', entityId: after.id, action: 'UPDATE', before: { items: before.items, status: before.status }, after: { items: after.items, status: after.status } });
  ok(res, after);
});

// ---- Exit interview ----

export const scheduleInterview = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { before, after } = await exitService.scheduleInterview(tenantId, p(req.params.id), auth, req.body as { at: Date; interviewerId?: string | null });
  await audit(req, {
    entity: 'Resignation',
    entityId: after.id,
    action: 'SCHEDULE_INTERVIEW',
    before,
    after: { exitInterviewAt: after.exitInterviewAt, exitInterviewerId: after.exitInterviewerId },
  });
  ok(res, after);
});

export const interview = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await exitService.submitInterview(tenantId, auth, p(req.params.id), req.body), 201);
});

// ---- Full & final ----

export const computeSettlement = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const s = await settlementService.computeSettlement(tenantId, p(req.params.id));
  await audit(req, { entity: 'FinalSettlement', entityId: s.id, action: 'COMPUTE', after: { items: s.items, netAmount: s.netAmount, dueDate: s.dueDate } });
  ok(res, s);
});

export const updateSettlement = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { items } = req.body as { items: SettlementItem[] };
  const { before, after } = await settlementService.updateSettlement(tenantId, p(req.params.id), items);
  await audit(req, {
    entity: 'FinalSettlement',
    entityId: after.id,
    action: 'UPDATE',
    before: { items: before.items, netAmount: before.netAmount },
    after: { items: after.items, netAmount: after.netAmount },
  });
  ok(res, after);
});

export const settlementDueDate = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await settlementService.setDueDate(tenantId, p(req.params.id), (req.body as { dueDate: Date }).dueDate);
  await audit(req, { entity: 'FinalSettlement', entityId: after.id, action: 'UPDATE', before: { dueDate: before.dueDate }, after: { dueDate: after.dueDate } });
  ok(res, after);
});

export const approveSettlement = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const s = await settlementService.approveSettlement(tenantId, p(req.params.id), auth);
  await audit(req, { entity: 'FinalSettlement', entityId: s.id, action: 'APPROVE', after: { netAmount: s.netAmount, approvedAt: s.approvedAt } });
  ok(res, s);
});

export const paySettlement = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const s = await settlementService.markSettlementPaid(tenantId, p(req.params.id), auth, req.body as PaymentInput);
  await audit(req, {
    entity: 'FinalSettlement',
    entityId: s.id,
    action: 'PAY',
    after: { netAmount: s.netAmount, paidOn: s.paidOn, paymentMode: s.paymentMode, paymentReference: s.paymentReference },
  });
  ok(res, s);
});

export const settlementPdf = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const inline = req.query.inline === 'true' || req.query.inline === '1';
  ok(res, await settlementService.settlementPdfUrl(tenantId, p(req.params.id), auth, { inline }));
});

// ---- Letters, close, rehire ----

export const issueLetter = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const body = req.body as { type: ExitLetterType; reissue?: boolean };
  const letter = await exitService.issueLetter(tenantId, p(req.params.id), auth, body);
  await audit(req, { entity: 'GeneratedLetter', entityId: letter.id, action: 'CREATE', after: { type: letter.type, title: letter.title, resignationId: req.params.id } });
  ok(res, letter, 201);
});

export const close = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { before, after, resignation } = await exitService.closeCase(tenantId, p(req.params.id), auth, req.body as { rehireEligible: boolean; rehireNote: string });
  await audit(req, { entity: 'Resignation', entityId: resignation.id, action: 'CLOSE', before, after });
  ok(res, resignation);
});

export const rehire = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const { employeeId, before, after } = await exitService.updateRehire(tenantId, p(req.params.id), auth, req.body as { rehireEligible: boolean; rehireNote: string });
  await audit(req, { entity: 'Employee', entityId: employeeId, action: 'REHIRE_ELIGIBILITY', before, after });
  ok(res, after);
});
