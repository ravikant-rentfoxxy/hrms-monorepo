import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/review.controller';
import {
  applyOutcomeSchema, bulkApproveSchema, cycleReviewsQuerySchema, cycleSchema, cycleUpdateSchema, outcomeUpdateSchema, peerSchema, submitReviewSchema,
} from '../validations/review.validation';

export const reviewsRouter = Router();
reviewsRouter.use(authenticate, tenant);

const HR = requireRole('ADMIN', 'HR');
const STAFF = requireRole('ADMIN', 'HR', 'MANAGER');

// Everyone: cycles (non-draft), reviews to write, own outcomes.
reviewsRouter.get('/cycles', controller.listCycles);
reviewsRouter.get('/my', controller.myReviews);

// Cycle administration (ADMIN/HR).
reviewsRouter.post('/cycles', HR, validate(cycleSchema), controller.createCycle);
reviewsRouter.get('/cycles/:id', HR, controller.getCycle);
reviewsRouter.patch('/cycles/:id', HR, validate(cycleUpdateSchema), controller.updateCycle);
reviewsRouter.delete('/cycles/:id', HR, controller.deleteCycle);
reviewsRouter.post('/cycles/:id/launch', HR, controller.launchCycle);
reviewsRouter.post('/cycles/:id/advance', HR, controller.advanceCycle);
reviewsRouter.post('/cycles/:id/sync', HR, controller.syncCycle);
reviewsRouter.get('/cycles/:id/reviews', HR, validate(cycleReviewsQuerySchema, 'query'), controller.cycleReviews);
// Peer reviewers: HR or the employee's manager (checked in the service).
reviewsRouter.post('/cycles/:id/peers', STAFF, validate(peerSchema), controller.addPeers);

// Calibration & outcomes.
reviewsRouter.get('/cycles/:id/calibration', HR, controller.calibration);
reviewsRouter.post('/cycles/:id/outcomes/approve', HR, validate(bulkApproveSchema), controller.approveOutcomes);
reviewsRouter.patch('/outcomes/:id', HR, validate(outcomeUpdateSchema), controller.updateOutcome);
reviewsRouter.post('/outcomes/:id/apply', HR, validate(applyOutcomeSchema), controller.applyOutcome);

// Individual reviews (access checked in the service).
reviewsRouter.get('/:id', controller.getReview);
reviewsRouter.post('/:id/submit', validate(submitReviewSchema), controller.submitReview);
reviewsRouter.delete('/:id', STAFF, controller.removePeer);
