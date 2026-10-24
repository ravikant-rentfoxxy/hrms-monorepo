import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { upload } from '../middleware/upload';
import * as controller from '../controllers/payroll-input.controller';
import {
  csvUploadSchema, importExpensesSchema, inputSchema, inputUpdateSchema, listInputsQuerySchema,
} from '../validations/payroll-input.validation';

export const payrollInputsRouter = Router();
payrollInputsRouter.use(authenticate, tenant, requireRole('ADMIN', 'HR'));

payrollInputsRouter.get('/', validate(listInputsQuerySchema, 'query'), controller.list);
payrollInputsRouter.get('/template.csv', controller.csvTemplate);
payrollInputsRouter.post('/', validate(inputSchema), controller.create);
// CSV in multipart field `file`; body: month, dryRun.
payrollInputsRouter.post('/upload', upload.single('file'), validate(csvUploadSchema), controller.uploadCsv);
payrollInputsRouter.post('/import-expenses', validate(importExpensesSchema), controller.importExpenses);
payrollInputsRouter.patch('/:id', validate(inputUpdateSchema), controller.update);
payrollInputsRouter.delete('/:id', controller.remove);
