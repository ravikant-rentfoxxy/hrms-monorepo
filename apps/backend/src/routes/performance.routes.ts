import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/performance.controller';
import { feedbackSchema, goalSchema, goalUpdateSchema, teamGoalsQuerySchema } from '../validations/performance.validation';

export const performanceRouter = Router();
performanceRouter.use(authenticate, tenant);

performanceRouter.get('/goals', controller.listGoals);
performanceRouter.post('/goals', validate(goalSchema), controller.createGoal);
performanceRouter.patch('/goals/:id', validate(goalUpdateSchema), controller.updateGoal);
performanceRouter.delete('/goals/:id', controller.deleteGoal);
// Managers: direct reports' goals and weighted progress (ADMIN/HR: everyone, optional department).
performanceRouter.get('/team-goals', requireRole('ADMIN', 'HR', 'MANAGER'), validate(teamGoalsQuerySchema, 'query'), controller.teamGoals);

performanceRouter.get('/feedback', controller.listFeedback);
performanceRouter.post('/feedback', validate(feedbackSchema), controller.giveFeedback);
