import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/billing.controller';
import {
  generateInvoicesSchema, invoiceQuerySchema, invoiceStatusSchema, planSchema, planUpdateSchema, subscriptionSchema,
  subscriptionUpdateSchema,
} from '../validations/billing.validation';

/** Platform billing — SUPER_ADMIN only. Mount at /superadmin/billing on the admin (web) surface only. */
export const billingRouter = Router();
billingRouter.use(authenticate, requireRole('SUPER_ADMIN'));

billingRouter.get('/plans', controller.listPlans);
billingRouter.post('/plans', validate(planSchema), controller.createPlan);
billingRouter.patch('/plans/:id', validate(planUpdateSchema), controller.updatePlan);
billingRouter.delete('/plans/:id', controller.deletePlan);

billingRouter.get('/subscriptions', controller.listSubscriptions);
billingRouter.put('/subscriptions/:companyId', validate(subscriptionSchema), controller.assignSubscription);
billingRouter.patch('/subscriptions/:companyId', validate(subscriptionUpdateSchema), controller.updateSubscription);

billingRouter.get('/invoices', validate(invoiceQuerySchema, 'query'), controller.listInvoices);
billingRouter.post('/invoices/generate', validate(generateInvoicesSchema), controller.generateInvoices);
billingRouter.patch('/invoices/:id/status', validate(invoiceStatusSchema), controller.setInvoiceStatus);

/** A company ADMIN's own plan, seats and invoices. Mount at /billing. */
export const companyBillingRouter = Router();
companyBillingRouter.use(authenticate, tenant);

companyBillingRouter.get('/', requireRole('ADMIN'), controller.myBilling);
