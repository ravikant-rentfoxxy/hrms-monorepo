import { h, ok } from '../utils/http';
import { ctx } from '../middleware/auth';
import { audit } from '../lib/audit';
import * as billingService from '../services/billing.service';
import type { PlanInput, SubscriptionInput } from '../services/billing.service';

// ---- Platform (SUPER_ADMIN) ----

export const listPlans = h(async (_req, res) => {
  ok(res, await billingService.listPlans());
});

export const createPlan = h(async (req, res) => {
  const plan = await billingService.createPlan(req.body as PlanInput);
  await audit(req, { entity: 'Plan', entityId: plan.id, action: 'CREATE', after: plan, companyId: null });
  ok(res, plan, 201);
});

export const updatePlan = h(async (req, res) => {
  const before = await billingService.getPlan(req.params.id as string);
  const after = await billingService.updatePlan(before.id, req.body as Partial<PlanInput>);
  await audit(req, { entity: 'Plan', entityId: before.id, action: 'UPDATE', before, after, companyId: null });
  ok(res, after);
});

export const deletePlan = h(async (req, res) => {
  const plan = await billingService.deletePlan(req.params.id as string);
  await audit(req, { entity: 'Plan', entityId: plan.id, action: 'DELETE', before: plan, companyId: null });
  ok(res, { deleted: true });
});

export const listSubscriptions = h(async (_req, res) => {
  ok(res, await billingService.listSubscriptions());
});

export const assignSubscription = h(async (req, res) => {
  const companyId = req.params.companyId as string;
  const { before, subscription } = await billingService.assignSubscription(companyId, req.body as SubscriptionInput);
  await audit(req, { entity: 'Subscription', entityId: subscription.id, action: before ? 'UPDATE' : 'CREATE', before, after: subscription, companyId });
  ok(res, subscription);
});

export const updateSubscription = h(async (req, res) => {
  const companyId = req.params.companyId as string;
  const { before, subscription } = await billingService.updateSubscription(companyId, req.body as Partial<SubscriptionInput>);
  await audit(req, { entity: 'Subscription', entityId: subscription.id, action: 'UPDATE', before, after: subscription, companyId });
  ok(res, subscription);
});

export const listInvoices = h(async (req, res) => {
  ok(res, await billingService.listInvoices(req.query as { companyId?: string; status?: string }));
});

export const setInvoiceStatus = h(async (req, res) => {
  const { status, paidOn } = req.body as { status: 'PAID' | 'VOID' | 'DUE'; paidOn?: Date };
  const { before, invoice } = await billingService.setInvoiceStatus(req.params.id as string, status, paidOn);
  await audit(req, {
    entity: 'Invoice',
    entityId: invoice.id,
    action: status === 'PAID' ? 'PAID' : 'UPDATE',
    before: { status: before.status, paidOn: before.paidOn },
    after: { status: invoice.status, paidOn: invoice.paidOn, amount: invoice.amount },
    companyId: invoice.companyId,
  });
  ok(res, invoice);
});

export const generateInvoices = h(async (req, res) => {
  const { month } = req.body as { month?: string };
  const result = await billingService.generateInvoices(month);
  await audit(req, { entity: 'Invoice', entityId: result.period, action: 'GENERATE', after: result, companyId: null });
  ok(res, result);
});

// ---- Company ADMIN ----

export const myBilling = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await billingService.companyBilling(tenantId));
});
