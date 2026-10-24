import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/recognition.controller';
import { kudosSchema, leaderboardQuerySchema, wallQuerySchema } from '../validations/recognition.validation';

export const recognitionRouter = Router();
recognitionRouter.use(authenticate, tenant);

recognitionRouter.get('/', validate(wallQuerySchema, 'query'), controller.wall);
recognitionRouter.get('/leaderboard', validate(leaderboardQuerySchema, 'query'), controller.leaderboard);
recognitionRouter.get('/me', controller.mine);
recognitionRouter.post('/', validate(kudosSchema), controller.give);
recognitionRouter.delete('/:id', requireRole('ADMIN'), controller.remove);
