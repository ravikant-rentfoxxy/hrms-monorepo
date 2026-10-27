import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/statutory.controller';
import {
  lwfRuleSchema, ptListQuerySchema, ptSlabSchema, ptSlabUpdateSchema, ptStateSlabsSchema, statutoryConfigSchema,
  taxRuleQuerySchema, taxRuleSchema,
} from '../validations/statutory.validation';

/** Statutory payroll settings (PF / ESI / PT / LWF / income tax) — ADMIN, HR and FINANCE read and edit. */
export const statutoryRouter = Router();
statutoryRouter.use(authenticate, tenant, requireRole('ADMIN', 'HR', 'FINANCE'));

statutoryRouter.get('/config', controller.getConfig);
statutoryRouter.patch('/config', validate(statutoryConfigSchema), controller.updateConfig);
statutoryRouter.get('/states', controller.states);

statutoryRouter.get('/pt-slabs', validate(ptListQuerySchema, 'query'), controller.listPtSlabs);
statutoryRouter.post('/pt-slabs', validate(ptSlabSchema), controller.createPtSlab);
statutoryRouter.put('/pt-slabs/state', validate(ptStateSlabsSchema), controller.replaceStatePtSlabs);
statutoryRouter.patch('/pt-slabs/:id', validate(ptSlabUpdateSchema), controller.updatePtSlab);
statutoryRouter.delete('/pt-slabs/:id', controller.deletePtSlab);

statutoryRouter.get('/lwf-rules', controller.listLwfRules);
statutoryRouter.put('/lwf-rules', validate(lwfRuleSchema), controller.upsertLwfRule);
statutoryRouter.delete('/lwf-rules/:id', controller.deleteLwfRule);

statutoryRouter.get('/tax-rules', validate(taxRuleQuerySchema, 'query'), controller.listTaxRules);
statutoryRouter.put('/tax-rules', validate(taxRuleSchema), controller.upsertTaxRule);
statutoryRouter.delete('/tax-rules/:id', controller.deleteTaxRule);
