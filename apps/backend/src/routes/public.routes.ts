/**
 * Public (unauthenticated) endpoints. Mounted at `/public` WITHOUT
 * authenticate / tenant — every handler resolves its own scope (the candidate
 * portal resolves the company from the token).
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../middleware/validate';
import { upload } from '../middleware/upload';
import * as portal from '../controllers/candidate-portal.controller';
import { portalDeclineSchema, portalNegotiateSchema } from '../validations/recruitment.validation';

/** Strict per-IP limit for the token-link portal (guessing tokens / hammering uploads). */
export const candidatePortalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again in a few minutes.' },
});

export const publicRouter = Router();

const candidate = Router({ mergeParams: true });
candidate.use(candidatePortalLimiter);
candidate.get('/', portal.view);
candidate.post('/offer/accept', portal.accept);
candidate.post('/offer/decline', validate(portalDeclineSchema), portal.decline);
candidate.post('/offer/negotiate', validate(portalNegotiateSchema), portal.negotiate);
candidate.post('/offer/signed', upload.single('file'), portal.uploadSigned);
candidate.post('/documents/:docId', upload.single('file'), portal.uploadDocument);

publicRouter.use('/candidate/:token', candidate);
