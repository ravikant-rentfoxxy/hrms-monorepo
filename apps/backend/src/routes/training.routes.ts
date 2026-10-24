import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/training.controller';
import {
  assignSchema, completeSchema, courseListQuerySchema, courseSchema, courseUpdateSchema, matrixQuerySchema, progressSchema,
} from '../validations/training.validation';

export const trainingRouter = Router();
trainingRouter.use(authenticate, tenant);

const HR = requireRole('ADMIN', 'HR');

// Catalog (everyone sees active courses; HR also sees enrollment stats).
trainingRouter.get('/courses', validate(courseListQuerySchema, 'query'), controller.listCourses);
trainingRouter.post('/courses', HR, validate(courseSchema), controller.createCourse);
trainingRouter.patch('/courses/:id', HR, validate(courseUpdateSchema), controller.updateCourse);
trainingRouter.delete('/courses/:id', HR, controller.deleteCourse);
trainingRouter.post('/courses/:id/assign', HR, validate(assignSchema), controller.assign);
trainingRouter.post('/courses/:id/enroll', controller.selfEnroll);

// Learner.
trainingRouter.get('/my', controller.myCourses);
trainingRouter.post('/enrollments/:id/start', controller.start);
trainingRouter.patch('/enrollments/:id/progress', validate(progressSchema), controller.progress);
trainingRouter.post('/enrollments/:id/complete', validate(completeSchema), controller.complete);
trainingRouter.delete('/enrollments/:id', HR, controller.unassign);

// HR reports.
trainingRouter.get('/matrix', HR, validate(matrixQuerySchema, 'query'), controller.matrix);
trainingRouter.get('/matrix/export', HR, validate(matrixQuerySchema, 'query'), controller.matrixCsv);
trainingRouter.get('/overdue', HR, validate(matrixQuerySchema, 'query'), controller.overdue);
trainingRouter.get('/overdue/export', HR, validate(matrixQuerySchema, 'query'), controller.overdueCsv);
