import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/survey.controller';
import { respondSchema, resultsQuerySchema, surveySchema, surveyUpdateSchema } from '../validations/survey.validation';

export const surveysRouter = Router();
surveysRouter.use(authenticate, tenant);

const HR = requireRole('ADMIN', 'HR');

// Employees: open surveys (with "responded" flag), view, respond once.
surveysRouter.get('/open', controller.open);
surveysRouter.get('/', HR, controller.list);
surveysRouter.post('/', HR, validate(surveySchema), controller.create);
surveysRouter.get('/:id', controller.get);
surveysRouter.patch('/:id', HR, validate(surveyUpdateSchema), controller.update);
surveysRouter.delete('/:id', HR, controller.remove);
surveysRouter.post('/:id/open', HR, controller.openSurvey);
surveysRouter.post('/:id/close', HR, controller.closeSurvey);
surveysRouter.post('/:id/respond', validate(respondSchema), controller.respond);
surveysRouter.get('/:id/results', HR, validate(resultsQuerySchema, 'query'), controller.results);
