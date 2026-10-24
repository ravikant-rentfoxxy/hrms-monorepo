import { Router } from 'express';
import { authenticate, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { upload } from '../middleware/upload';
import * as controller from '../controllers/expense.controller';
import { expenseDecideSchema, expenseSchema, listExpensesQuerySchema } from '../validations/expense.validation';

export const expensesRouter = Router();
expensesRouter.use(authenticate, tenant);

expensesRouter.get('/', validate(listExpensesQuerySchema, 'query'), controller.list);
// Receipt goes in multipart field `receipt` (any file format).
expensesRouter.post('/', upload.single('receipt'), validate(expenseSchema), controller.create);
expensesRouter.get('/:id/receipt', controller.receipt);
// No role gate: the approval engine decides who may act (named approvers such
// as a department head can be plain EMPLOYEEs).
expensesRouter.post('/:id/decide', validate(expenseDecideSchema), controller.decide);
expensesRouter.post('/:id/cancel', controller.cancel);
