import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { upload } from '../middleware/upload';
import * as controller from '../controllers/recruitment.controller';
import * as requisitions from '../controllers/requisition.controller';
import * as offers from '../controllers/offer.controller';
import {
  applicationListQuerySchema, applicationSchema, applicationUpdateSchema, attendanceSchema, cancelSchema, candidateListQuerySchema,
  candidateSchema, candidateUpdateSchema, confirmJoiningSchema, duplicateCheckQuerySchema, hrScreeningSchema, importQuerySchema,
  interviewCancelSchema, interviewFeedbackSchema, interviewListQuerySchema, interviewSchema, interviewUpdateSchema, jobListQuerySchema,
  jobStatusSchema, jobUpdateSchema, joinSchema, offerDecideSchema, offerListQuerySchema, offerReviseSchema, offerRespondSchema,
  offerSchema, offerSendSchema, offerUpdateSchema, offerWithdrawSchema, portalLinkSchema, postingListQuerySchema, postingRenewSchema,
  postingSchema, postingStatusSchema, postingUpdateSchema, preJoiningDocSchema, preJoiningDocUpdateSchema, preOnboardingCancelSchema,
  preOnboardingListQuerySchema, preOnboardingUpdateSchema, rangeQuerySchema, recommendSchema, referralSchema, requisitionDecideSchema,
  requisitionListQuerySchema, requisitionReviewSchema, requisitionSchema, requisitionUpdateSchema, screenSchema, selectSchema,
  stageSchema, statsQuerySchema, verifyDocSchema,
} from '../validations/recruitment.validation';

export const recruitmentRouter = Router();
recruitmentRouter.use(authenticate, tenant);

const HR = requireRole('ADMIN', 'HR');
const STAFF = requireRole('ADMIN', 'HR', 'MANAGER');

// Careers board + referrals — every employee.
recruitmentRouter.get('/jobs/open', controller.openJobs);
// Multipart: candidate fields + optional resume in field `file`.
recruitmentRouter.post('/referrals', upload.single('file'), validate(referralSchema), controller.refer);
recruitmentRouter.get('/referrals/mine', controller.myReferrals);

// 1. Requisitions: managers raise / track their own; HR & ADMIN see all. Decide is guarded by the approval engine.
recruitmentRouter.get('/requisitions', STAFF, validate(requisitionListQuerySchema, 'query'), requisitions.list);
recruitmentRouter.post('/requisitions', STAFF, validate(requisitionSchema), requisitions.create);
recruitmentRouter.get('/requisitions/:id', STAFF, requisitions.get);
recruitmentRouter.patch('/requisitions/:id', STAFF, validate(requisitionUpdateSchema), requisitions.update);
recruitmentRouter.post('/requisitions/:id/submit', STAFF, requisitions.submit);
recruitmentRouter.post('/requisitions/:id/review', HR, validate(requisitionReviewSchema), requisitions.review);
recruitmentRouter.post('/requisitions/:id/decide', validate(requisitionDecideSchema), requisitions.decide);
recruitmentRouter.post('/requisitions/:id/cancel', STAFF, validate(cancelSchema), requisitions.cancel);

// Jobs (created only from approved requisitions). Managers see the jobs they are hiring manager for.
recruitmentRouter.get('/jobs', STAFF, validate(jobListQuerySchema, 'query'), controller.listJobs);
recruitmentRouter.get('/jobs/:id', STAFF, controller.getJob);
recruitmentRouter.patch('/jobs/:id', HR, validate(jobUpdateSchema), controller.updateJob);
recruitmentRouter.post('/jobs/:id/status', HR, validate(jobStatusSchema), controller.setJobStatus);
recruitmentRouter.delete('/jobs/:id', HR, controller.deleteJob);

// 2. Postings on job boards.
recruitmentRouter.get('/postings', HR, validate(postingListQuerySchema, 'query'), controller.listPostings);
recruitmentRouter.get('/postings/stats', HR, validate(rangeQuerySchema, 'query'), controller.postingStats);
recruitmentRouter.get('/jobs/:id/postings', STAFF, controller.jobPostings);
recruitmentRouter.post('/jobs/:id/postings', HR, validate(postingSchema), controller.createPosting);
recruitmentRouter.patch('/postings/:id', HR, validate(postingUpdateSchema), controller.updatePosting);
recruitmentRouter.post('/postings/:id/status', HR, validate(postingStatusSchema), controller.setPostingStatus);
recruitmentRouter.post('/postings/:id/renew', HR, validate(postingRenewSchema), controller.renewPosting);
recruitmentRouter.delete('/postings/:id', HR, controller.deletePosting);

// 3. Candidates (multipart create/update with optional resume in field `file`) + CSV import per job.
recruitmentRouter.get('/candidates', STAFF, validate(candidateListQuerySchema, 'query'), controller.listCandidates);
recruitmentRouter.get('/candidates/check', HR, validate(duplicateCheckQuerySchema, 'query'), controller.checkDuplicate);
recruitmentRouter.post('/candidates', HR, upload.single('file'), validate(candidateSchema), controller.createCandidate);
recruitmentRouter.get('/candidates/:id', STAFF, controller.getCandidate);
recruitmentRouter.patch('/candidates/:id', HR, upload.single('file'), validate(candidateUpdateSchema), controller.updateCandidate);
recruitmentRouter.delete('/candidates/:id', HR, controller.deleteCandidate);
recruitmentRouter.get('/candidates/:id/resume', STAFF, controller.resume);
recruitmentRouter.post('/jobs/:id/candidates/import', HR, validate(importQuerySchema, 'query'), upload.single('file'), controller.importCandidates);

// 4–7. Applications: screening, HR call, stage moves, recommendation, selection, portal link.
recruitmentRouter.get('/applications', STAFF, validate(applicationListQuerySchema, 'query'), controller.listApplications);
recruitmentRouter.post('/applications', HR, validate(applicationSchema), controller.addApplication);
recruitmentRouter.get('/applications/:id', controller.getApplication);
recruitmentRouter.patch('/applications/:id', STAFF, validate(applicationUpdateSchema), controller.updateApplication);
recruitmentRouter.post('/applications/:id/screen', STAFF, validate(screenSchema), controller.screen);
recruitmentRouter.post('/applications/:id/hr-screening', STAFF, validate(hrScreeningSchema), controller.hrScreening);
recruitmentRouter.post('/applications/:id/stage', STAFF, validate(stageSchema), controller.moveStage);
recruitmentRouter.post('/applications/:id/recommend', STAFF, validate(recommendSchema), controller.recommend);
recruitmentRouter.post('/applications/:id/select', HR, validate(selectSchema), controller.select);
recruitmentRouter.post('/applications/:id/portal-link', HR, validate(portalLinkSchema), controller.portalLink);
recruitmentRouter.delete('/applications/:id/portal-link', HR, controller.revokePortalLink);
recruitmentRouter.post('/applications/:id/pre-onboarding', HR, offers.initiatePreOnboarding);
recruitmentRouter.delete('/applications/:id', HR, controller.deleteApplication);

// 6. Interviews: any employee can be a panelist (scope=mine); the service scopes the rest.
recruitmentRouter.get('/interviews', validate(interviewListQuerySchema, 'query'), controller.listInterviews);
recruitmentRouter.post('/interviews', STAFF, validate(interviewSchema), controller.scheduleInterview);
recruitmentRouter.patch('/interviews/:id', STAFF, validate(interviewUpdateSchema), controller.updateInterview);
recruitmentRouter.post('/interviews/:id/cancel', STAFF, validate(interviewCancelSchema), controller.cancelInterview);
recruitmentRouter.post('/interviews/:id/attendance', validate(attendanceSchema), controller.attendance);
recruitmentRouter.post('/interviews/:id/feedback', validate(interviewFeedbackSchema), controller.interviewFeedback);

// 8. Offers. Decide is guarded by the approval engine (default: ADMIN).
recruitmentRouter.get('/offers', HR, validate(offerListQuerySchema, 'query'), offers.listOffers);
recruitmentRouter.post('/offers', HR, validate(offerSchema), offers.createOffer);
recruitmentRouter.get('/offers/:id', HR, offers.getOffer);
recruitmentRouter.patch('/offers/:id', HR, validate(offerUpdateSchema), offers.updateOffer);
recruitmentRouter.post('/offers/:id/submit', HR, offers.submitOffer);
recruitmentRouter.post('/offers/:id/decide', validate(offerDecideSchema), offers.decideOffer);
recruitmentRouter.post('/offers/:id/letter', HR, offers.generateOfferLetter);
recruitmentRouter.get('/offers/:id/letter', HR, offers.offerLetter);
recruitmentRouter.post('/offers/:id/send', HR, validate(offerSendSchema), offers.sendOffer);
recruitmentRouter.post('/offers/:id/respond', HR, validate(offerRespondSchema), offers.respondOffer);
recruitmentRouter.post('/offers/:id/revise', HR, validate(offerReviseSchema), offers.reviseOffer);
recruitmentRouter.post('/offers/:id/withdraw', HR, validate(offerWithdrawSchema), offers.withdrawOffer);
recruitmentRouter.post('/offers/:id/signed', HR, upload.single('file'), offers.uploadSigned);
recruitmentRouter.get('/offers/:id/signed', HR, offers.signedCopy);

// 9–10. Pre-joining and joining.
recruitmentRouter.get('/pre-onboarding', HR, validate(preOnboardingListQuerySchema, 'query'), offers.listPreOnboarding);
recruitmentRouter.get('/pre-onboarding/:id', HR, offers.getPreOnboarding);
recruitmentRouter.patch('/pre-onboarding/:id', HR, validate(preOnboardingUpdateSchema), offers.updatePreOnboarding);
recruitmentRouter.post('/pre-onboarding/:id/confirm-joining', HR, validate(confirmJoiningSchema), offers.confirmJoining);
recruitmentRouter.post('/pre-onboarding/:id/documents', HR, validate(preJoiningDocSchema), offers.addDocument);
recruitmentRouter.patch('/pre-onboarding/:id/documents/:docId', HR, validate(preJoiningDocUpdateSchema), offers.updateDocument);
recruitmentRouter.delete('/pre-onboarding/:id/documents/:docId', HR, offers.removeDocument);
recruitmentRouter.post('/pre-onboarding/:id/documents/:docId/upload', HR, upload.single('file'), offers.uploadDocument);
recruitmentRouter.post('/pre-onboarding/:id/documents/:docId/verify', HR, validate(verifyDocSchema), offers.verifyDocument);
recruitmentRouter.get('/pre-onboarding/:id/documents/:docId/file', HR, offers.documentFile);
recruitmentRouter.post('/pre-onboarding/:id/cancel', HR, validate(preOnboardingCancelSchema), offers.cancelPreOnboarding);
recruitmentRouter.post('/pre-onboarding/:id/join', HR, validate(joinSchema), offers.join);

recruitmentRouter.get('/stats', HR, validate(statsQuerySchema, 'query'), controller.stats);
