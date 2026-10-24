/**
 * Recruitment (ATS) core: job openings (created from approved requisitions),
 * applications and their screening / selection stages, referrals and the
 * funnel report. Requisitions, postings, candidates, interviews, offers,
 * pre-joining and the candidate portal live in their own services.
 *
 * Application stages (every change is written to ApplicationStageHistory):
 *   APPLIED → SHORTLISTED | ON_HOLD → HR_SCREENED → INTERVIEW_SCHEDULED → INTERVIEW_COMPLETED
 *   → SELECTED → OFFERED → OFFER_ACCEPTED → PRE_ONBOARDING → DOCUMENTS_VERIFIED → READY_TO_JOIN → JOINED
 *   terminal: REJECTED | WITHDRAWN | OFFER_DECLINED
 *
 * Access model (enforced here, so every caller gets the same rules):
 *   - ADMIN / HR: everything.
 *   - Hiring manager: their jobs, the applications in them, screening, interviews, recommendation.
 *   - Assigned recruiter (Application.assignedToId): that application.
 *   - Interviewer: their interviews (and the candidate behind them).
 *   - Everyone: the open-jobs board, referrals and "my referrals".
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify, notifyCandidate } from '../lib/notify';
import { ApiError } from '../utils/http';
import { dateOnlyUTC } from '../utils/geo';
import * as approvalService from './approval.service';
import { assertJobAccepting, createApplication, findDuplicate, intake } from './candidate.service';
import { applicationInterviews } from './interview.service';
import { closeAllForJob, listForJob } from './job-posting.service';
import {
  type UploadedFile, CLOSED_STAGES, JOINED_STAGES, PIPELINE_STAGES, POST_OFFER_STAGES, PRE_OFFER_STAGES, TERMINAL_STAGES,
  applicationScope, assertJobAccess, assertManageApplication, canManageApplication, getApplicationOrThrow, issuePortalLink,
  matchScore, notifyReferrer, platformLabel, publicStatus, setStage, sourceForPlatform,
} from './recruitment.helpers';
import { type Actor, assertEmployee, daysBetween, employeeNames, hrEmployeeIds, isHrAdmin, requireEmployee } from './talent.helpers';

export const JOB_STATUSES = ['DRAFT', 'APPROVED', 'OPEN', 'ON_HOLD', 'FILLED', 'CLOSED', 'CANCELLED'] as const;
const ENDED_JOB = ['FILLED', 'CLOSED', 'CANCELLED'];

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

async function getJobOrThrow(companyId: string, id: string) {
  const job = await prisma.jobOpening.findFirst({ where: { id, companyId } });
  if (!job) throw ApiError.notFound('Job opening not found');
  return job;
}

export interface JobInput {
  title?: string;
  department?: string;
  designation?: string;
  location?: string;
  employmentType?: string;
  openings?: number;
  minExperience?: number;
  maxExperience?: number;
  minCtc?: number;
  maxCtc?: number;
  description?: string;
  skills?: string;
  qualifications?: string;
  status?: string;
  hiringManagerId?: string | null;
}

/** Per-stage application counts for the given jobs: { jobId: { APPLIED: 3, ... } }. */
async function pipelineCounts(companyId: string, jobIds: string[]) {
  const rows = await prisma.application.groupBy({
    by: ['jobId', 'stage'],
    where: { companyId, jobId: { in: jobIds } },
    _count: { _all: true },
  });
  const map = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const counts = map.get(r.jobId) ?? {};
    counts[r.stage] = r._count._all;
    map.set(r.jobId, counts);
  }
  return map;
}

const sumStages = (pipeline: Record<string, number>, stages: Iterable<string>) => [...stages].reduce((s, st) => s + (pipeline[st] ?? 0), 0);

export async function listJobs(companyId: string, actor: Actor, filter: { status?: string; q?: string }) {
  const where: Prisma.JobOpeningWhereInput = { companyId };
  if (!isHrAdmin(actor.role)) where.hiringManagerId = requireEmployee(actor);
  if (filter.status) where.status = filter.status;
  if (filter.q) {
    where.OR = [
      { title: { contains: filter.q, mode: 'insensitive' } },
      { code: { contains: filter.q, mode: 'insensitive' } },
      { department: { contains: filter.q, mode: 'insensitive' } },
    ];
  }
  const jobs = await prisma.jobOpening.findMany({
    where,
    include: {
      requisition: { select: { id: true, code: true } },
      postings: { select: { id: true, status: true, platform: true, platformName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  const [counts, managers] = await Promise.all([
    pipelineCounts(companyId, jobs.map((j) => j.id)),
    employeeNames(companyId, jobs.map((j) => j.hiringManagerId)),
  ]);
  return jobs.map(({ postings, ...j }) => {
    const pipeline = counts.get(j.id) ?? {};
    return {
      ...j,
      hiringManager: j.hiringManagerId ? (managers.get(j.hiringManagerId) ?? null) : null,
      pipeline,
      hired: sumStages(pipeline, JOINED_STAGES),
      active: sumStages(pipeline, [...PIPELINE_STAGES].filter((s) => s !== 'JOINED')),
      livePostings: postings.filter((p) => p.status === 'PUBLISHED' || p.status === 'ACTIVE').map((p) => platformLabel(p)),
      postingsCount: postings.length,
    };
  });
}

/** Careers board for every employee (no salary bands, no pipeline). */
export async function listOpenJobs(companyId: string) {
  return prisma.jobOpening.findMany({
    where: { companyId, status: 'OPEN' },
    select: {
      id: true, code: true, title: true, department: true, designation: true, location: true, employmentType: true, openings: true,
      minExperience: true, maxExperience: true, description: true, skills: true, qualifications: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getJob(companyId: string, id: string, actor: Actor) {
  const job = await getJobOrThrow(companyId, id);
  assertJobAccess(job, actor);
  const [applications, requisition, postings] = await Promise.all([
    prisma.application.findMany({
      where: { companyId, jobId: id },
      include: {
        candidate: {
          select: {
            id: true, code: true, name: true, email: true, phone: true, source: true, experienceYears: true, currentCompany: true,
            currentLocation: true, skills: true, resumeName: true, referredById: true,
          },
        },
        posting: { select: { id: true, platform: true, platformName: true } },
        offer: { select: { id: true, code: true, status: true } },
        interviews: { select: { id: true, round: true, scheduledAt: true, status: true, rating: true } },
      },
      orderBy: { appliedOn: 'asc' },
    }),
    job.requisitionId
      ? prisma.jobRequisition.findFirst({
          where: { id: job.requisitionId },
          select: { id: true, code: true, reason: true, priority: true, targetDate: true, justification: true, requestedById: true, budgetMinCtc: true, budgetMaxCtc: true },
        })
      : null,
    listForJob(companyId, id),
  ]);
  const pipeline: Record<string, number> = {};
  for (const a of applications) pipeline[a.stage] = (pipeline[a.stage] ?? 0) + 1;
  const people = await employeeNames(companyId, [job.hiringManagerId, requisition?.requestedById, ...applications.map((a) => a.assignedToId)]);
  const hr = isHrAdmin(actor.role);
  return {
    ...job,
    // Salary band is HR-only.
    minCtc: hr ? job.minCtc : undefined,
    maxCtc: hr ? job.maxCtc : undefined,
    hiringManager: job.hiringManagerId ? (people.get(job.hiringManagerId) ?? null) : null,
    requisition: requisition
      ? { ...requisition, requestedBy: people.get(requisition.requestedById) ?? null, budgetMinCtc: hr ? requisition.budgetMinCtc : undefined, budgetMaxCtc: hr ? requisition.budgetMaxCtc : undefined }
      : null,
    postings: hr ? postings : postings.map((p) => ({ ...p, cost: undefined, costPerApplication: undefined, costPerHire: undefined })),
    pipeline,
    hired: sumStages(pipeline, JOINED_STAGES),
    applications: applications.map((a) => ({
      id: a.id,
      code: a.code,
      stage: a.stage,
      rating: a.rating,
      rejectionReason: a.rejectionReason,
      source: a.source,
      appliedOn: a.appliedOn,
      updatedAt: a.updatedAt,
      assignedTo: a.assignedToId ? (people.get(a.assignedToId) ?? null) : null,
      posting: a.posting ? { id: a.posting.id, label: platformLabel(a.posting) } : null,
      candidate: a.candidate,
      offer: a.offer,
      interviews: a.interviews,
      match: matchScore(job, a.candidate).score,
    })),
  };
}

/** Applies a status change with its side effects (closedAt, postings). */
async function applyJobStatus(companyId: string, job: { id: string; status: string }, status: string) {
  if (status === job.status) return;
  if (status === 'CANCELLED') {
    const committed = await prisma.application.count({
      where: { companyId, jobId: job.id, stage: { in: [...POST_OFFER_STAGES, ...JOINED_STAGES] } },
    });
    if (committed > 0) throw ApiError.badRequest('Candidates have offers or have joined — close the job instead of cancelling it');
  }
  const ending = ENDED_JOB.includes(status);
  const reopening = ENDED_JOB.includes(job.status) && !ending;
  await prisma.jobOpening.update({
    where: { id: job.id },
    data: { status, ...(ending ? { closedAt: new Date() } : reopening ? { closedAt: null } : {}) },
  });
  if (ending) await closeAllForJob(companyId, job.id);
}

export async function updateJob(companyId: string, id: string, input: JobInput) {
  const before = await getJobOrThrow(companyId, id);
  if (input.hiringManagerId) await assertEmployee(companyId, input.hiringManagerId, 'Hiring manager');
  const minExp = input.minExperience ?? before.minExperience;
  const maxExp = input.maxExperience ?? before.maxExperience;
  if (maxExp && maxExp < minExp) throw ApiError.badRequest('Max experience cannot be below the minimum');
  const minCtc = input.minCtc ?? before.minCtc;
  const maxCtc = input.maxCtc ?? before.maxCtc;
  if (maxCtc && maxCtc < minCtc) throw ApiError.badRequest('Max CTC cannot be below the minimum');
  const { status, ...fields } = input;
  if (status) await applyJobStatus(companyId, before, status);
  const after = await prisma.jobOpening.update({ where: { id }, data: fields });
  if (input.hiringManagerId && input.hiringManagerId !== before.hiringManagerId) {
    await notify(companyId, [input.hiringManagerId], {
      event: 'recruitment.hiring_manager_assigned',
      title: 'You are the hiring manager',
      body: `You have been made the hiring manager for ${after.code ?? ''} "${after.title}".`,
      link: `/recruitment/jobs/${id}`,
    });
  }
  return { before, after };
}

export async function setJobStatus(companyId: string, id: string, status: string) {
  const before = await getJobOrThrow(companyId, id);
  await applyJobStatus(companyId, before, status);
  return { before, after: await getJobOrThrow(companyId, id) };
}

export async function deleteJob(companyId: string, id: string) {
  const job = await getJobOrThrow(companyId, id);
  const apps = await prisma.application.count({ where: { companyId, jobId: id } });
  if (apps > 0) throw ApiError.conflict('This job has applications — close or cancel it instead of deleting');
  await prisma.jobOpening.delete({ where: { id } });
  return job;
}

/** Job → FILLED once joiners reach the number of openings (the requisition stays APPROVED). */
export async function fillJobIfComplete(companyId: string, jobId: string): Promise<boolean> {
  const job = await getJobOrThrow(companyId, jobId);
  const joined = await prisma.application.count({ where: { companyId, jobId, stage: { in: JOINED_STAGES } } });
  if (joined < job.openings || ENDED_JOB.includes(job.status)) return false;
  await applyJobStatus(companyId, job, 'FILLED');
  return true;
}

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------

export interface ReferralInput {
  jobId: string;
  name: string;
  email: string;
  phone?: string;
  currentCompany?: string;
  currentLocation?: string;
  experienceYears?: number;
  skills?: string;
  notes?: string;
}

export async function refer(companyId: string, referrerId: string, input: ReferralInput, file?: UploadedFile) {
  const job = await getJobOrThrow(companyId, input.jobId);
  if (job.status !== 'OPEN') throw ApiError.badRequest('Referrals are only accepted for open jobs');
  const self = await prisma.employee.findFirst({ where: { id: referrerId, companyId }, include: { user: { select: { email: true } } } });
  if (!self) throw ApiError.forbidden();
  if (self.user.email.toLowerCase() === input.email.toLowerCase()) throw ApiError.badRequest('You cannot refer yourself');
  // Fair referral credit: the first person to bring a candidate in owns the referral.
  if (await findDuplicate(companyId, input)) throw ApiError.conflict('This candidate is already in our talent pool — thanks for thinking of them!');
  const { jobId, ...data } = input;
  const result = await intake(companyId, { ...data, jobId, source: 'REFERRAL' }, { file, actorId: referrerId, referredById: referrerId });
  await notify(companyId, [...(await hrEmployeeIds(companyId)), job.hiringManagerId], {
    event: 'recruitment.referral',
    title: 'New referral',
    body: `${self.name} referred ${input.name} for ${job.code ?? ''} "${job.title}".`,
    link: result.application ? `/recruitment/applications/${result.application.id}` : '/recruitment',
  });
  return result;
}

/** The referrer's view: status only (rejection reasons and compensation stay internal). */
export async function myReferrals(companyId: string, employeeId: string) {
  const rows = await prisma.candidate.findMany({
    where: { companyId, referredById: employeeId },
    select: {
      id: true, name: true, email: true, createdAt: true,
      applications: { select: { id: true, stage: true, updatedAt: true, job: { select: { id: true, code: true, title: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    ...r,
    applications: r.applications.map(({ stage, ...a }) => ({ ...a, status: publicStatus(stage) })),
  }));
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export async function addApplication(
  companyId: string,
  actorId: string | null,
  input: { jobId: string; candidateId: string; postingId?: string; source?: string; externalRef?: string }
) {
  const { posting } = await assertJobAccepting(companyId, input.jobId, input.postingId);
  const candidate = await prisma.candidate.findFirst({ where: { id: input.candidateId, companyId } });
  if (!candidate) throw ApiError.badRequest('Candidate not found in this company');
  const existing = await prisma.application.findUnique({ where: { jobId_candidateId: { jobId: input.jobId, candidateId: input.candidateId } } });
  if (existing) throw ApiError.conflict(`${candidate.name} has already applied to this job (${existing.code ?? existing.stage})`);
  return prisma.$transaction((tx) =>
    createApplication(tx, companyId, {
      jobId: input.jobId,
      candidateId: input.candidateId,
      postingId: posting?.id ?? null,
      source: input.source ?? (posting ? sourceForPlatform(posting.platform) : candidate.source),
      externalRef: input.externalRef,
      actorId,
    })
  );
}

export async function listApplications(
  companyId: string,
  actor: Actor,
  filter: { jobId?: string; stage?: string; assigned?: 'me'; q?: string; open?: string }
) {
  const and: Prisma.ApplicationWhereInput[] = [applicationScope(actor)];
  if (filter.jobId) and.push({ jobId: filter.jobId });
  if (filter.stage) and.push({ stage: filter.stage });
  if (filter.open === 'true') and.push({ stage: { notIn: [...CLOSED_STAGES] } });
  if (filter.assigned === 'me') and.push({ assignedToId: requireEmployee(actor) });
  if (filter.q) {
    and.push({
      OR: [
        { code: { contains: filter.q, mode: 'insensitive' } },
        { candidate: { name: { contains: filter.q, mode: 'insensitive' } } },
        { candidate: { email: { contains: filter.q, mode: 'insensitive' } } },
      ],
    });
  }
  const rows = await prisma.application.findMany({
    where: { companyId, AND: and },
    include: {
      job: { select: { id: true, code: true, title: true, hiringManagerId: true } },
      candidate: { select: { id: true, code: true, name: true, email: true, phone: true, experienceYears: true, currentCompany: true } },
      posting: { select: { id: true, platform: true, platformName: true } },
      offer: { select: { id: true, code: true, status: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  });
  const people = await employeeNames(companyId, rows.map((r) => r.assignedToId));
  return rows.map(({ portalTokenHash: _t, hrScreening: _h, proposedCtc, ...r }) => ({
    ...r,
    proposedCtc: isHrAdmin(actor.role) ? proposedCtc : undefined,
    posting: r.posting ? { id: r.posting.id, label: platformLabel(r.posting) } : null,
    assignedTo: r.assignedToId ? (people.get(r.assignedToId) ?? null) : null,
  }));
}

/** Everything HR / the hiring manager needs on one screen: candidate vs job, interviews, feedback, offer, pre-joining, history. */
export async function getApplication(companyId: string, id: string, actor: Actor) {
  const visible = await prisma.application.count({ where: { id, companyId, ...applicationScope(actor) } });
  if (!visible) {
    const exists = await prisma.application.count({ where: { id, companyId } });
    throw exists ? ApiError.forbidden('You do not have access to this application') : ApiError.notFound('Application not found');
  }
  const app = await getApplicationOrThrow(companyId, id);
  const hr = isHrAdmin(actor.role);
  const manage = canManageApplication(app, actor);
  const [history, interviews, preOnboarding] = await Promise.all([
    prisma.applicationStageHistory.findMany({ where: { applicationId: id }, orderBy: { createdAt: 'asc' } }),
    applicationInterviews(companyId, id, actor, manage),
    hr && app.preOnboarding
      ? prisma.preOnboarding.findUnique({ where: { id: app.preOnboarding.id }, include: { documents: { select: { id: true, status: true, required: true } } } })
      : null,
  ]);
  const people = await employeeNames(companyId, [
    app.assignedToId, app.recommendedById, app.job.hiringManagerId, app.candidate.referredById, ...history.map((h) => h.actorId),
  ]);
  const { resumeKey, ...candidate } = app.candidate;
  const { portalTokenHash, hrScreening, proposedCtc, ...rest } = app;
  const offerTrail = hr && app.offer ? await approvalService.trail(companyId, 'OFFER', app.offer.id) : [];
  // Who the offer is waiting on, and whether this viewer may approve it (never the submitter; ADMIN steps need ADMIN).
  const offerStep = hr && app.offer ? await approvalService.currentStep(companyId, 'OFFER', app.offer.id) : null;
  const offerApproval = {
    canDecide: offerStep ? approvalService.canAct(offerStep, actor) : false,
    pendingWith: offerStep ? (offerStep.approverRole ?? 'Approver') : null,
  };
  return {
    ...rest,
    hrScreening: manage ? hrScreening : null,
    proposedCtc: hr ? proposedCtc : undefined,
    candidate: {
      ...candidate,
      currentCtc: hr ? candidate.currentCtc : undefined,
      expectedCtc: hr ? candidate.expectedCtc : undefined,
      hasResume: !!resumeKey,
      referredBy: candidate.referredById ? (people.get(candidate.referredById) ?? null) : null,
    },
    job: { ...app.job, minCtc: hr ? app.job.minCtc : undefined, maxCtc: hr ? app.job.maxCtc : undefined },
    posting: app.posting ? { ...app.posting, cost: hr ? app.posting.cost : undefined, label: platformLabel(app.posting) } : null,
    match: matchScore(app.job, app.candidate),
    assignedTo: app.assignedToId ? (people.get(app.assignedToId) ?? null) : null,
    recommendedBy: app.recommendedById ? (people.get(app.recommendedById) ?? null) : null,
    hiringManager: app.job.hiringManagerId ? (people.get(app.job.hiringManagerId) ?? null) : null,
    interviews: interviews.interviews,
    feedbackSummary: interviews.summary,
    offer: hr ? (app.offer ? { ...app.offer, ...offerApproval, trail: offerTrail } : null) : app.offer ? { id: app.offer.id, code: app.offer.code, status: app.offer.status } : null,
    preOnboarding: preOnboarding
      ? {
          id: preOnboarding.id,
          status: preOnboarding.status,
          confirmedJoiningDate: preOnboarding.confirmedJoiningDate,
          expectedJoiningDate: preOnboarding.expectedJoiningDate,
          documents: preOnboarding.documents.length,
          verified: preOnboarding.documents.filter((d) => d.status === 'VERIFIED').length,
        }
      : app.preOnboarding
        ? { id: app.preOnboarding.id, status: app.preOnboarding.status }
        : null,
    portal: hr ? { active: !!portalTokenHash && !!app.portalExpiresAt && app.portalExpiresAt > new Date(), expiresAt: app.portalExpiresAt } : null,
    history: history.map((h) => ({ ...h, actor: h.actorId ? (people.get(h.actorId) ?? null) : null })),
    permissions: { manage, hr, hiringManager: !!actor.employeeId && app.job.hiringManagerId === actor.employeeId },
  };
}

export async function updateApplication(
  companyId: string,
  id: string,
  actor: Actor,
  input: { assignedToId?: string | null; postingId?: string | null; source?: string; externalRef?: string; screeningNotes?: string; rating?: number | null }
) {
  const before = await getApplicationOrThrow(companyId, id);
  assertManageApplication(before, actor);
  const hrOnly = input.assignedToId !== undefined || input.postingId !== undefined || input.source !== undefined || input.externalRef !== undefined;
  if (hrOnly && !isHrAdmin(actor.role)) throw ApiError.forbidden('Only HR can change the owner or source of an application');
  if (input.assignedToId) await assertEmployee(companyId, input.assignedToId, 'Assignee');
  if (input.postingId) await assertJobAccepting(companyId, before.jobId, input.postingId).catch(async (err: unknown) => {
    // A closed job can still have its applications re-attributed.
    const posting = await prisma.jobPosting.findFirst({ where: { id: input.postingId ?? '', companyId, jobId: before.jobId } });
    if (!posting) throw err;
  });
  const after = await prisma.application.update({ where: { id }, data: input });
  if (input.assignedToId && input.assignedToId !== before.assignedToId) {
    await notify(companyId, [input.assignedToId], {
      event: 'recruitment.application_assigned',
      title: 'Application assigned to you',
      body: `${before.candidate.name} for ${before.job.code ?? ''} "${before.job.title}".`,
      link: `/recruitment/applications/${id}`,
    });
  }
  return { before, after };
}

/** Withdraws everything in flight when an application ends (interviews, offer, pre-joining). */
async function closeOutApplication(companyId: string, app: Awaited<ReturnType<typeof getApplicationOrThrow>>) {
  await prisma.interview.updateMany({ where: { applicationId: app.id, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } });
  if (app.offer && ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'NEGOTIATING'].includes(app.offer.status)) {
    await prisma.offer.update({ where: { id: app.offer.id }, data: { status: 'WITHDRAWN' } });
    await approvalService.cancel(companyId, 'OFFER', app.offer.id);
  }
  if (app.preOnboarding && !['JOINED', 'CANCELLED'].includes(app.preOnboarding.status)) {
    await prisma.preOnboarding.update({ where: { id: app.preOnboarding.id }, data: { status: 'CANCELLED' } });
  }
  // The portal link dies with the application.
  await prisma.application.update({ where: { id: app.id }, data: { portalTokenHash: null, portalExpiresAt: null } });
}

/**
 * Manual stage moves: shortlist / hold / reject / withdraw, and reopening a
 * closed application (HR). Interview, selection, offer and joining stages
 * move through their own actions.
 */
export async function moveStage(companyId: string, id: string, actor: Actor, input: { stage: string; reason?: string }) {
  const app = await getApplicationOrThrow(companyId, id);
  assertManageApplication(app, actor);
  if (JOINED_STAGES.includes(app.stage)) throw ApiError.badRequest('This candidate has already joined');
  if (app.stage === input.stage) return { before: app, after: app };
  const ending = input.stage === 'REJECTED' || input.stage === 'WITHDRAWN';
  const reopening = CLOSED_STAGES.has(app.stage);

  if (reopening && !isHrAdmin(actor.role)) throw ApiError.forbidden('Only HR can reopen a closed application');
  if (reopening && ending) throw ApiError.badRequest(`Application is already ${app.stage.toLowerCase().replace(/_/g, ' ')}`);
  if (!ending && !reopening && !PRE_OFFER_STAGES.has(app.stage) && !['SCREENING', 'INTERVIEW', 'APPLIED'].includes(app.stage)) {
    throw ApiError.badRequest('An offer is in progress — withdraw the offer or reject the candidate instead');
  }
  if ((POST_OFFER_STAGES.has(app.stage) || app.stage === 'OFFER') && ending && !isHrAdmin(actor.role)) {
    throw ApiError.forbidden('Only HR can drop a candidate who has an offer');
  }
  if (reopening && ENDED_JOB.includes(app.job.status)) throw ApiError.badRequest(`The job is ${app.job.status.toLowerCase()}`);

  if (ending) await closeOutApplication(companyId, app);
  const after = await setStage(prisma, companyId, app, input.stage, {
    actorId: actor.employeeId,
    note: input.reason ?? (reopening ? 'Reopened' : ''),
    ...(ending ? { rejectionReason: input.reason ?? '' } : {}),
  });
  if (ending) {
    await notifyReferrer(companyId, app.candidate, app.job.title, input.stage);
    if (input.stage === 'REJECTED') {
      await notifyCandidate(companyId, app.candidate, {
        event: 'recruitment.candidate_rejected',
        title: `Your application for ${app.job.title}`,
        body: 'Thank you for your interest. After careful consideration we will not be moving forward with your application at this time.',
      });
    }
  }
  return { before: app, after };
}

/** Resume screening: shortlist / hold / reject with notes and a rating. */
export async function screen(
  companyId: string,
  id: string,
  actor: Actor,
  input: { decision: 'SHORTLISTED' | 'ON_HOLD' | 'REJECTED'; notes?: string; rating?: number; rejectionReason?: string }
) {
  const app = await getApplicationOrThrow(companyId, id);
  assertManageApplication(app, actor);
  if (!['APPLIED', 'ON_HOLD', 'SHORTLISTED', 'HR_SCREENED', 'SCREENING'].includes(app.stage)) {
    throw ApiError.badRequest(`Screening is done — the application is ${app.stage.toLowerCase().replace(/_/g, ' ')}`);
  }
  const data: Prisma.ApplicationUncheckedUpdateInput = {
    ...(input.notes !== undefined ? { screeningNotes: input.notes } : {}),
    ...(input.rating !== undefined ? { rating: input.rating } : {}),
  };
  const after = await setStage(prisma, companyId, app, input.decision, {
    actorId: actor.employeeId,
    note: input.decision === 'REJECTED' ? (input.rejectionReason ?? '') : (input.notes ?? ''),
    data,
    ...(input.decision === 'REJECTED' ? { rejectionReason: input.rejectionReason ?? '' } : {}),
  });
  if (input.decision === 'SHORTLISTED' && app.stage !== 'SHORTLISTED') {
    await notifyCandidate(companyId, app.candidate, {
      event: 'recruitment.candidate_shortlisted',
      title: `You have been shortlisted for ${app.job.title}`,
      body: 'Our HR team will contact you shortly to discuss the next steps.',
    });
  }
  if (input.decision === 'REJECTED') {
    await closeOutApplication(companyId, app);
    await notifyReferrer(companyId, app.candidate, app.job.title, 'REJECTED');
    await notifyCandidate(companyId, app.candidate, {
      event: 'recruitment.candidate_rejected',
      title: `Your application for ${app.job.title}`,
      body: 'Thank you for your interest. After careful consideration we will not be moving forward with your application at this time.',
    });
  }
  return { before: app, after };
}

export interface HrScreeningInput {
  experienceVerified: boolean;
  experienceYears?: number;
  currentCtc?: number;
  expectedCtc?: number;
  noticePeriodDays?: number;
  availableFrom?: Date | null;
  interested: boolean;
  notes?: string;
}

/** The initial HR call: verifies experience, availability, salary and notice; not interested → withdrawn. */
export async function hrScreening(companyId: string, id: string, actor: Actor, input: HrScreeningInput) {
  const app = await getApplicationOrThrow(companyId, id);
  assertManageApplication(app, actor);
  if (!['APPLIED', 'SHORTLISTED', 'ON_HOLD', 'HR_SCREENED', 'SCREENING'].includes(app.stage)) {
    throw ApiError.badRequest(`The application is ${app.stage.toLowerCase().replace(/_/g, ' ')} — the screening call is already done`);
  }
  const screening = {
    experienceVerified: input.experienceVerified,
    experienceYears: input.experienceYears ?? app.candidate.experienceYears,
    currentCtc: input.currentCtc ?? app.candidate.currentCtc,
    expectedCtc: input.expectedCtc ?? app.candidate.expectedCtc,
    noticePeriodDays: input.noticePeriodDays ?? app.candidate.noticePeriodDays,
    availableFrom: input.availableFrom ? dateOnlyUTC(input.availableFrom).toISOString().slice(0, 10) : null,
    interested: input.interested,
    notes: input.notes ?? '',
    screenedById: actor.employeeId,
    screenedAt: new Date().toISOString(),
  };
  // The call is the most recent source of truth for the candidate's numbers.
  await prisma.candidate.update({
    where: { id: app.candidateId },
    data: {
      ...(input.experienceYears !== undefined ? { experienceYears: input.experienceYears } : {}),
      ...(input.currentCtc !== undefined ? { currentCtc: input.currentCtc } : {}),
      ...(input.expectedCtc !== undefined ? { expectedCtc: input.expectedCtc } : {}),
      ...(input.noticePeriodDays !== undefined ? { noticePeriodDays: input.noticePeriodDays } : {}),
    },
  });
  const to = input.interested ? 'HR_SCREENED' : 'WITHDRAWN';
  if (!input.interested) await closeOutApplication(companyId, app);
  const after = await setStage(prisma, companyId, app, to, {
    actorId: actor.employeeId,
    note: input.interested ? 'HR screening call done' : 'Not interested (HR screening call)',
    data: { hrScreening: screening },
    ...(input.interested ? {} : { rejectionReason: 'Candidate not interested (HR screening call)' }),
  });
  if (!input.interested) await notifyReferrer(companyId, app.candidate, app.job.title, 'WITHDRAWN');
  return { before: app, after };
}

/** Hiring manager's recommendation to hire (after reviewing the interview feedback). */
export async function recommend(companyId: string, id: string, actor: Actor, note: string) {
  const app = await getApplicationOrThrow(companyId, id);
  assertManageApplication(app, actor);
  if (!PRE_OFFER_STAGES.has(app.stage)) throw ApiError.badRequest(`The application is ${app.stage.toLowerCase().replace(/_/g, ' ')}`);
  const after = await prisma.application.update({
    where: { id },
    data: { recommendedById: requireEmployee(actor), recommendationNote: note },
  });
  await prisma.applicationStageHistory.create({
    data: { companyId, applicationId: id, fromStage: app.stage, toStage: app.stage, note: `Recommended for hire: ${note}`.slice(0, 2000), actorId: actor.employeeId },
  });
  await notify(companyId, await hrEmployeeIds(companyId), {
    event: 'recruitment.recommended',
    title: 'Candidate recommended for hire',
    body: `${app.candidate.name} for ${app.job.code ?? ''} "${app.job.title}".`,
    link: `/recruitment/applications/${id}`,
  });
  return { before: app, after };
}

/** HR selection: proposed salary + joining date → SELECTED. Warns when outside the job's budget. */
export async function select(
  companyId: string,
  id: string,
  actor: Actor,
  input: { proposedCtc: number; proposedJoiningDate: Date; note?: string }
) {
  const app = await getApplicationOrThrow(companyId, id);
  if (!isHrAdmin(actor.role)) throw ApiError.forbidden('Only HR can select a candidate');
  if (!['INTERVIEW_COMPLETED', 'HR_SCREENED', 'SHORTLISTED', 'ON_HOLD', 'SELECTED', 'INTERVIEW', 'SCREENING'].includes(app.stage)) {
    throw ApiError.badRequest(`The application is ${app.stage.toLowerCase().replace(/_/g, ' ')}`);
  }
  const scheduled = await prisma.interview.count({ where: { applicationId: id, status: 'SCHEDULED' } });
  if (scheduled > 0) throw ApiError.badRequest('Complete or cancel the scheduled interviews first');
  const joining = dateOnlyUTC(input.proposedJoiningDate);
  if (joining < dateOnlyUTC()) throw ApiError.badRequest('The proposed joining date is in the past');

  const warnings: string[] = [];
  const req = app.job.requisitionId
    ? await prisma.jobRequisition.findUnique({ where: { id: app.job.requisitionId }, select: { budgetMinCtc: true, budgetMaxCtc: true } })
    : null;
  const max = req?.budgetMaxCtc || app.job.maxCtc;
  const min = req?.budgetMinCtc || app.job.minCtc;
  if (max > 0 && input.proposedCtc > max) warnings.push(`Proposed CTC is above the approved budget (max ₹${Math.round(max).toLocaleString('en-IN')})`);
  if (min > 0 && input.proposedCtc < min) warnings.push(`Proposed CTC is below the budget band (min ₹${Math.round(min).toLocaleString('en-IN')})`);

  const after = await setStage(prisma, companyId, app, 'SELECTED', {
    actorId: actor.employeeId,
    note: input.note ?? 'Selected',
    data: { proposedCtc: input.proposedCtc, proposedJoiningDate: joining },
  });
  await notify(companyId, [app.job.hiringManagerId, app.assignedToId], {
    event: 'recruitment.selected',
    title: 'Candidate selected',
    body: `${app.candidate.name} has been selected for ${app.job.code ?? ''} "${app.job.title}". The offer is being prepared.`,
    link: `/recruitment/applications/${id}`,
  });
  return { before: app, after, warnings };
}

export async function deleteApplication(companyId: string, id: string) {
  const application = await getApplicationOrThrow(companyId, id);
  if (application.offer || POST_OFFER_STAGES.has(application.stage) || JOINED_STAGES.includes(application.stage)) {
    throw ApiError.conflict('An application with an offer is kept for history — reject or withdraw it instead');
  }
  await prisma.application.delete({ where: { id } });
  return application;
}

// ---------------------------------------------------------------------------
// Candidate portal link (HR)
// ---------------------------------------------------------------------------

export async function createPortalLink(companyId: string, id: string, days: number) {
  const app = await getApplicationOrThrow(companyId, id);
  if (CLOSED_STAGES.has(app.stage)) throw ApiError.badRequest(`The application is ${app.stage.toLowerCase().replace(/_/g, ' ')}`);
  return issuePortalLink(companyId, id, days);
}

export async function revokePortalLink(companyId: string, id: string) {
  await getApplicationOrThrow(companyId, id);
  await prisma.application.update({ where: { id }, data: { portalTokenHash: null, portalExpiresAt: null } });
  return { revoked: true };
}

// ---------------------------------------------------------------------------
// Funnel stats
// ---------------------------------------------------------------------------

const FUNNEL = ['APPLIED', 'SHORTLISTED', 'INTERVIEWED', 'SELECTED', 'OFFERED', 'ACCEPTED', 'JOINED'] as const;
const STAGE_RANK: Record<string, number> = {
  APPLIED: 0, ON_HOLD: 0, SHORTLISTED: 1, HR_SCREENED: 1, SCREENING: 1, INTERVIEW_SCHEDULED: 2, INTERVIEW_COMPLETED: 2, INTERVIEW: 2,
  SELECTED: 3, OFFERED: 4, OFFER: 4, OFFER_ACCEPTED: 5, PRE_ONBOARDING: 5, DOCUMENTS_VERIFIED: 5, READY_TO_JOIN: 5, JOINED: 6, HIRED: 6,
};

export async function stats(companyId: string, filter: { from?: Date; to?: Date; jobId?: string }) {
  const where: Prisma.ApplicationWhereInput = { companyId };
  if (filter.jobId) where.jobId = filter.jobId;
  if (filter.from || filter.to) where.appliedOn = { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) };
  const [applications, jobs] = await Promise.all([
    prisma.application.findMany({
      where,
      select: {
        stage: true, appliedOn: true, updatedAt: true, source: true,
        job: { select: { createdAt: true } },
        candidate: { select: { source: true } },
        posting: { select: { platform: true, platformName: true } },
        _count: { select: { interviews: true } },
        offer: { select: { status: true, respondedAt: true } },
        stageHistory: { select: { toStage: true, createdAt: true } },
      },
    }),
    prisma.jobOpening.groupBy({ by: ['status'], where: { companyId }, _count: { _all: true }, _sum: { openings: true } }),
  ]);

  // Furthest stage reached: current stage, any earlier stage in the history, or evidence (interviews / offer).
  const reachedIndex = (a: (typeof applications)[number]): number => {
    let r = STAGE_RANK[a.stage] ?? 0;
    for (const h of a.stageHistory) r = Math.max(r, STAGE_RANK[h.toStage] ?? 0);
    if (a.offer) r = Math.max(r, a.offer.status === 'ACCEPTED' ? 5 : ['SENT', 'NEGOTIATING', 'DECLINED', 'EXPIRED'].includes(a.offer.status) ? 4 : 3);
    if (a._count.interviews > 0) r = Math.max(r, 2);
    return r;
  };

  const byStage: Record<string, number> = {};
  for (const s of [...PIPELINE_STAGES, ...TERMINAL_STAGES]) byStage[s] = 0;
  const funnel = FUNNEL.map((stage) => ({ stage, reached: 0 }));
  const sources = new Map<string, { source: string; applications: number; interviewed: number; offered: number; hired: number }>();
  const hireDays: number[] = [];
  const fillDays: number[] = [];

  for (const a of applications) {
    byStage[a.stage] = (byStage[a.stage] ?? 0) + 1;
    const reached = reachedIndex(a);
    for (let i = 0; i <= reached; i++) funnel[i]!.reached += 1;
    const key = a.posting ? platformLabel(a.posting) : a.source || a.candidate.source;
    const src = sources.get(key) ?? { source: key, applications: 0, interviewed: 0, offered: 0, hired: 0 };
    src.applications += 1;
    if (reached >= 2) src.interviewed += 1;
    if (reached >= 4) src.offered += 1;
    if (JOINED_STAGES.includes(a.stage)) {
      src.hired += 1;
      const joinedOn = a.stageHistory.find((h) => JOINED_STAGES.includes(h.toStage))?.createdAt ?? a.offer?.respondedAt ?? a.updatedAt;
      hireDays.push(Math.max(0, daysBetween(a.appliedOn, joinedOn)));
      fillDays.push(Math.max(0, daysBetween(a.job.createdAt, joinedOn)));
    }
    sources.set(key, src);
  }
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
  const total = applications.length;
  const offers = applications.filter((a) => a.offer && ['SENT', 'NEGOTIATING', 'ACCEPTED', 'DECLINED', 'EXPIRED'].includes(a.offer.status));
  const accepted = offers.filter((a) => a.offer?.status === 'ACCEPTED').length;

  return {
    totalApplications: total,
    byStage,
    funnel: funnel.map((f, i) => ({
      ...f,
      conversionFromPrevious: i === 0 ? 1 : funnel[i - 1]!.reached ? f.reached / funnel[i - 1]!.reached : 0,
      conversionFromApplied: total ? f.reached / total : 0,
    })),
    avgTimeToHireDays: avg(hireDays),
    avgTimeToFillDays: avg(fillDays),
    offerAcceptanceRate: offers.length ? accepted / offers.length : null,
    sources: [...sources.values()]
      .map((s) => ({ ...s, hireRate: s.applications ? s.hired / s.applications : 0 }))
      .sort((a, b) => b.hired - a.hired || b.applications - a.applications),
    jobs: Object.fromEntries(jobs.map((j) => [j.status, { count: j._count._all, openings: j._sum.openings ?? 0 }])),
  };
}
