import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/statutory.controller';
import {
  lwfRuleSchema, ptListQuerySchema, ptSlabSchema, ptSlabUpdateSchema, ptStateSlabsSchema, statutoryConfigSchema,
  taxRuleQuerySchema, taxRuleSchema,
} from '../validations/statutory.validation';

/** Statutory payroll settings (PF / ESI / PT / LWF / income tax) — company admins only. */
export const statutoryRouter = Router();
statutoryRouter.use(authenticate, tenant, requireRole('ADMIN', 'HR'));

statutoryRouter.get('/config', controller.getConfig);
statutoryRouter.patch('/config', requireRole('ADMIN'), validate(statutoryConfigSchema), controller.updateConfig);
statutoryRouter.get('/states', controller.states);

statutoryRouter.get('/pt-slabs', validate(ptListQuerySchema, 'query'), controller.listPtSlabs);
statutoryRouter.post('/pt-slabs', requireRole('ADMIN'), validate(ptSlabSchema), controller.createPtSlab);
statutoryRouter.put('/pt-slabs/state', requireRole('ADMIN'), validate(ptStateSlabsSchema), controller.replaceStatePtSlabs);
statutoryRouter.patch('/pt-slabs/:id', requireRole('ADMIN'), validate(ptSlabUpdateSchema), controller.updatePtSlab);
statutoryRouter.delete('/pt-slabs/:id', requireRole('ADMIN'), controller.deletePtSlab);

statutoryRouter.get('/lwf-rules', controller.listLwfRules);
statutoryRouter.put('/lwf-rules', requireRole('ADMIN'), validate(lwfRuleSchema), controller.upsertLwfRule);
statutoryRouter.delete('/lwf-rules/:id', requireRole('ADMIN'), controller.deleteLwfRule);

statutoryRouter.get('/tax-rules', validate(taxRuleQuerySchema, 'query'), controller.listTaxRules);
statutoryRouter.put('/tax-rules', requireRole('ADMIN'), validate(taxRuleSchema), controller.upsertTaxRule);
statutoryRouter.delete('/tax-rules/:id', requireRole('ADMIN'), controller.deleteTaxRule);
