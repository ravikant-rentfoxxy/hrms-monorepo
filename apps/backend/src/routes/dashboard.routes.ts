import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import * as controller from '../controllers/dashboard.controller';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate, tenant);

dashboardRouter.get('/', controller.get);
dashboardRouter.get('/team', requireRole('ADMIN', 'HR', 'MANAGER'), controller.team);
