import type { Request } from 'express';
import { h, ok } from '../utils/http';
import { ApiError } from '../utils/http';
import { ctx, employeeIdOrThrow } from '../middleware/auth';
import { audit, diff } from '../lib/audit';
import * as recruitmentService from '../services/recruitment.service';
import * as candidateService from '../services/candidate.service';
import * as postingService from '../services/job-posting.service';
import * as interviewService from '../services/interview.service';
import type { JobInput, HrScreeningInput, ReferralInput } from '../services/recruitment.service';
import type { CandidateInput, IntakeInput } from '../services/candidate.service';
import type { PostingInput } from '../services/job-posting.service';
import type { InterviewInput } from '../services/interview.service';
import type { Actor } from '../services/talent.helpers';

const actorOf = (req: Request): Actor => {
  const { auth } = ctx(req);
  return { role: auth.role, employeeId: auth.employeeId };
};
const id = (req: Request): string => req.params.id as string;

// ---- Jobs (created only from approved requisitions) ----

export const listJobs = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await recruitmentService.listJobs(tenantId, actorOf(req), req.query as { status?: string; q?: string }));
});

export const openJobs = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await recruitmentService.listOpenJobs(tenantId));
});

export const getJob = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await recruitmentService.getJob(tenantId, id(req), actorOf(req)));
});

export const updateJob = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await recruitmentService.updateJob(tenantId, id(req), req.body as JobInput);
  await audit(req, { entity: 'JobOpening', entityId: after.id, action: 'UPDATE', ...diff(before, after) });
  ok(res, after);
});

export const setJobStatus = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { status } = req.body as { status: string };
  const { before, after } = await recruitmentService.setJobStatus(tenantId, id(req), status);
  await audit(req, { entity: 'JobOpening', entityId: after.id, action: 'STATUS', before: { status: before.status }, after: { status: after.status } });
  ok(res, after);
});

export const deleteJob = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const job = await recruitmentService.deleteJob(tenantId, id(req));
  await audit(req, { entity: 'JobOpening', entityId: job.id, action: 'DELETE', before: job });
  ok(res, { deleted: true });
});

// ---- Postings ----

export const listPostings = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await postingService.list(tenantId, req.query as { jobId?: string; status?: string; platform?: string }));
});

export const jobPostings = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await postingService.listForJob(tenantId, id(req)));
});

export const postingStats = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await postingService.platformStats(tenantId, req.query as { from?: Date; to?: Date }));
});

export const createPosting = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const posting = await postingService.create(tenantId, id(req), auth.employeeId, req.body as PostingInput);
  await audit(req, { entity: 'JobPosting', entityId: posting.id, action: 'CREATE', after: posting });
  ok(res, posting, 201);
});

export const updatePosting = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await postingService.update(tenantId, id(req), req.body as Partial<PostingInput>);
  await audit(req, { entity: 'JobPosting', entityId: after.id, action: 'UPDATE', ...diff(before, after) });
  ok(res, after);
});

export const setPostingStatus = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await postingService.setStatus(tenantId, id(req), (req.body as { status: string }).status);
  await audit(req, { entity: 'JobPosting', entityId: after.id, action: 'STATUS', before: { status: before.status }, after: { status: after.status } });
  ok(res, after);
});

export const renewPosting = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await postingService.renew(tenantId, id(req), (req.body as { expiresOn: Date }).expiresOn);
  await audit(req, {
    entity: 'JobPosting',
    entityId: after.id,
    action: 'RENEW',
    before: { status: before.status, expiresOn: before.expiresOn },
    after: { status: after.status, expiresOn: after.expiresOn },
  });
  ok(res, after);
});

export const deletePosting = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const posting = await postingService.remove(tenantId, id(req));
  await audit(req, { entity: 'JobPosting', entityId: posting.id, action: 'DELETE', before: { platform: posting.platform, jobId: posting.jobId } });
  ok(res, { deleted: true });
});

// ---- Candidates ----

export const listCandidates = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await candidateService.listCandidates(tenantId, actorOf(req), req.query as { q?: string; source?: string; jobId?: string; stage?: string }));
});

export const checkDuplicate = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await candidateService.checkDuplicate(tenantId, req.query as { email?: string; phone?: string }));
});

export const getCandidate = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await candidateService.getCandidate(tenantId, id(req), actorOf(req)));
});

/** Adds a candidate (or reuses the duplicate) and optionally applies them to a job. */
export const createCandidate = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const result = await candidateService.intake(tenantId, req.body as IntakeInput, { file: req.file, actorId: auth.employeeId });
  await audit(req, {
    entity: 'Candidate',
    entityId: result.candidate.id,
    action: result.duplicateOf ? 'REUSE' : 'CREATE',
    after: { code: result.candidate.code, applicationCode: result.application?.code ?? null, duplicateOf: result.duplicateOf?.id ?? null },
  });
  ok(res, result, result.duplicateOf ? 200 : 201);
});

export const importCandidates = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  if (!req.file) throw ApiError.badRequest('Attach the CSV file in field "file"');
  const dryRun = (req.query as { dryRun?: string }).dryRun === 'true';
  const result = await candidateService.importForJob(tenantId, id(req), req.file.buffer.toString('utf8'), { dryRun, actorId: auth.employeeId });
  if (!dryRun) {
    await audit(req, {
      entity: 'JobOpening',
      entityId: id(req),
      action: 'IMPORT_CANDIDATES',
      after: { total: result.total, created: result.created, linked: result.linked, errors: result.errors },
    });
  }
  ok(res, result, dryRun ? 200 : 201);
});

export const updateCandidate = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await candidateService.updateCandidate(tenantId, id(req), req.body as Partial<CandidateInput>, req.file);
  const keys = ['name', 'email', 'phone', 'currentCtc', 'expectedCtc'] as const;
  const pick = (o: Record<string, unknown>) => Object.fromEntries(keys.map((k) => [k, o[k]]));
  await audit(req, { entity: 'Candidate', entityId: after.id, action: 'UPDATE', ...diff(pick(before), pick(after)) });
  ok(res, { ...after, resumeKey: undefined });
});

export const deleteCandidate = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const candidate = await candidateService.deleteCandidate(tenantId, id(req));
  await audit(req, { entity: 'Candidate', entityId: candidate.id, action: 'DELETE', before: { name: candidate.name, email: candidate.email } });
  ok(res, { deleted: true });
});

export const resume = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const inline = req.query.inline === 'true' || req.query.inline === '1';
  ok(res, await candidateService.resumeUrl(tenantId, id(req), actorOf(req), inline));
});

// ---- Referrals ----

export const refer = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await recruitmentService.refer(tenantId, employeeIdOrThrow(req), req.body as ReferralInput, req.file), 201);
});

export const myReferrals = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await recruitmentService.myReferrals(tenantId, employeeIdOrThrow(req)));
});

// ---- Applications ----

export const listApplications = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await recruitmentService.listApplications(tenantId, actorOf(req), req.query as { jobId?: string; stage?: string; assigned?: 'me'; q?: string }));
});

export const getApplication = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await recruitmentService.getApplication(tenantId, id(req), actorOf(req)));
});

export const addApplication = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const application = await recruitmentService.addApplication(
    tenantId,
    auth.employeeId,
    req.body as { jobId: string; candidateId: string; postingId?: string; source?: string; externalRef?: string }
  );
  await audit(req, { entity: 'Application', entityId: application.id, action: 'CREATE', after: { code: application.code, jobId: application.jobId } });
  ok(res, application, 201);
});

export const updateApplication = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await recruitmentService.updateApplication(tenantId, id(req), actorOf(req), req.body as Record<string, never>);
  const keys = ['assignedToId', 'postingId', 'source', 'externalRef', 'rating'] as const;
  const pick = (o: Record<string, unknown>) => Object.fromEntries(keys.map((k) => [k, o[k]]));
  await audit(req, { entity: 'Application', entityId: after.id, action: 'UPDATE', ...diff(pick(before), pick(after)) });
  ok(res, { ...after, portalTokenHash: undefined });
});

const stageAudit = async (req: Request, before: { id: string; stage: string }, after: { stage: string; rejectionReason: string }, action = 'STAGE') => {
  if (before.stage === after.stage && action === 'STAGE') return;
  await audit(req, {
    entity: 'Application',
    entityId: before.id,
    action,
    before: { stage: before.stage },
    after: { stage: after.stage, rejectionReason: after.rejectionReason || undefined },
  });
};

export const moveStage = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await recruitmentService.moveStage(tenantId, id(req), actorOf(req), req.body as { stage: string; reason?: string });
  await stageAudit(req, before, after);
  ok(res, { ...after, portalTokenHash: undefined });
});

export const screen = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await recruitmentService.screen(
    tenantId,
    id(req),
    actorOf(req),
    req.body as { decision: 'SHORTLISTED' | 'ON_HOLD' | 'REJECTED'; notes?: string; rating?: number; rejectionReason?: string }
  );
  await stageAudit(req, before, after, 'SCREEN');
  ok(res, { ...after, portalTokenHash: undefined });
});

export const hrScreening = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await recruitmentService.hrScreening(tenantId, id(req), actorOf(req), req.body as HrScreeningInput);
  await stageAudit(req, before, after, 'HR_SCREENING');
  ok(res, { ...after, portalTokenHash: undefined });
});

export const recommend = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { after } = await recruitmentService.recommend(tenantId, id(req), actorOf(req), (req.body as { note: string }).note);
  await audit(req, { entity: 'Application', entityId: after.id, action: 'RECOMMEND', after: { note: after.recommendationNote } });
  ok(res, { ...after, portalTokenHash: undefined });
});

export const select = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after, warnings } = await recruitmentService.select(
    tenantId,
    id(req),
    actorOf(req),
    req.body as { proposedCtc: number; proposedJoiningDate: Date; note?: string }
  );
  await audit(req, {
    entity: 'Application',
    entityId: after.id,
    action: 'SELECT',
    before: { stage: before.stage, proposedCtc: before.proposedCtc },
    after: { stage: after.stage, proposedCtc: after.proposedCtc, proposedJoiningDate: after.proposedJoiningDate, warnings },
  });
  ok(res, { application: { ...after, portalTokenHash: undefined }, warnings });
});

export const portalLink = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const link = await recruitmentService.createPortalLink(tenantId, id(req), (req.body as { days: number }).days);
  await audit(req, { entity: 'Application', entityId: id(req), action: 'PORTAL_LINK', after: { expiresAt: link.expiresAt } });
  ok(res, link, 201);
});

export const revokePortalLink = h(async (req, res) => {
  const { tenantId } = ctx(req);
  await recruitmentService.revokePortalLink(tenantId, id(req));
  await audit(req, { entity: 'Application', entityId: id(req), action: 'PORTAL_LINK_REVOKED' });
  ok(res, { revoked: true });
});

export const deleteApplication = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const application = await recruitmentService.deleteApplication(tenantId, id(req));
  await audit(req, { entity: 'Application', entityId: application.id, action: 'DELETE', before: { code: application.code, stage: application.stage } });
  ok(res, { deleted: true });
});

// ---- Interviews ----

export const listInterviews = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(
    res,
    await interviewService.listInterviews(
      tenantId,
      actorOf(req),
      req.query as unknown as { scope: 'mine' | 'all'; upcoming?: string; applicationId?: string; from?: Date; to?: Date; status?: string }
    )
  );
});

export const scheduleInterview = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const interview = await interviewService.scheduleInterview(tenantId, actorOf(req), req.body as InterviewInput);
  await audit(req, { entity: 'Interview', entityId: interview.id, action: 'CREATE', after: interview });
  ok(res, interview, 201);
});

export const updateInterview = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await interviewService.updateInterview(tenantId, id(req), actorOf(req), req.body as Partial<InterviewInput>);
  await audit(req, { entity: 'Interview', entityId: after.id, action: 'UPDATE', ...diff(before, after) });
  ok(res, after);
});

export const cancelInterview = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { after } = await interviewService.cancelInterview(tenantId, id(req), actorOf(req), (req.body as { reason?: string }).reason);
  await audit(req, { entity: 'Interview', entityId: after.id, action: 'CANCEL', after: { status: after.status } });
  ok(res, after);
});

export const attendance = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { after } = await interviewService.recordAttendance(tenantId, id(req), actorOf(req), (req.body as { attended: boolean }).attended);
  await audit(req, { entity: 'Interview', entityId: after.id, action: 'ATTENDANCE', after: { attended: after.attended, status: after.status } });
  ok(res, after);
});

export const interviewFeedback = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(
    res,
    await interviewService.submitFeedback(
      tenantId,
      id(req),
      actorOf(req),
      req.body as { rating: number; recommendation: string; feedback: string; interviewerId?: string }
    )
  );
});

// ---- Stats ----

export const stats = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await recruitmentService.stats(tenantId, req.query as { from?: Date; to?: Date; jobId?: string }));
});
