import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/master.controller';
import {
  departmentSchema, departmentUpdateSchema, designationSchema, designationUpdateSchema, gradeSchema, gradeUpdateSchema,
  masterListQuerySchema,
} from '../validations/master.validation';

/** Departments / designations / grades: everyone reads, ADMIN/HR write. */
export const mastersRouter = Router();
mastersRouter.use(authenticate, tenant);

const write = requireRole('ADMIN', 'HR');

mastersRouter.get('/departments', validate(masterListQuerySchema, 'query'), controller.listDepartments);
mastersRouter.post('/departments', write, validate(departmentSchema), controller.createDepartment);
mastersRouter.patch('/departments/:id', write, validate(departmentUpdateSchema), controller.updateDepartment);
mastersRouter.delete('/departments/:id', write, controller.deleteDepartment);

mastersRouter.get('/designations', validate(masterListQuerySchema, 'query'), controller.listDesignations);
mastersRouter.post('/designations', write, validate(designationSchema), controller.createDesignation);
mastersRouter.patch('/designations/:id', write, validate(designationUpdateSchema), controller.updateDesignation);
mastersRouter.delete('/designations/:id', write, controller.deleteDesignation);

mastersRouter.get('/grades', validate(masterListQuerySchema, 'query'), controller.listGrades);
mastersRouter.post('/grades', write, validate(gradeSchema), controller.createGrade);
mastersRouter.patch('/grades/:id', write, validate(gradeUpdateSchema), controller.updateGrade);
mastersRouter.delete('/grades/:id', write, controller.deleteGrade);

// One-shot migration of the free-text department / designation values.
mastersRouter.post('/sync-from-employees', requireRole('ADMIN'), controller.syncFromEmployees);
