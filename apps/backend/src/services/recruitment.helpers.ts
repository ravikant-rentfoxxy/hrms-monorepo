/**
 * Shared pieces of the recruitment-to-joining flow: the application stage
 * machine (+ stage history), access rules, candidate normalisation and the
 * resume-vs-job match score. Used by every recruitment service.
 */
import { createHash, randomBytes } from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { objectKey, putObject } from '../lib/storage';
import { ApiError } from '../utils/http';
import { type Actor, isHrAdmin, requireEmployee } from './talent.helpers';

export type Db = PrismaClient | Prisma.TransactionClient;
export type UploadedFile = { buffer: Buffer; originalname: string; mimetype: string; size: number };

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

/** Pipeline order (kanban columns). */
export const PIPELINE_STAGES = [
  'APPLIED', 'SHORTLISTED', 'ON_HOLD', 'HR_SCREENED', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED', 'SELECTED',
  'OFFERED', 'OFFER_ACCEPTED', 'PRE_ONBOARDING', 'DOCUMENTS_VERIFIED', 'READY_TO_JOIN', 'JOINED',
] as const;
export const TERMINAL_STAGES = ['REJECTED', 'WITHDRAWN', 'OFFER_DECLINED'] as const;
export const ALL_STAGES = [...PIPELINE_STAGES, ...TERMINAL_STAGES] as const;

/** Stages before an offer exists — the screening / interview part of the pipeline. */
export const PRE_OFFER_STAGES = new Set(['APPLIED', 'SHORTLISTED', 'ON_HOLD', 'HR_SCREENED', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED', 'SELECTED']);
/** Stages driven by the offer / pre-joining flow (not moved by hand). */
export const POST_OFFER_STAGES = new Set(['OFFERED', 'OFFER_ACCEPTED', 'PRE_ONBOARDING', 'DOCUMENTS_VERIFIED', 'READY_TO_JOIN']);
export const CLOSED_STAGES = new Set<string>([...TERMINAL_STAGES, 'JOINED', 'HIRED']);
/** Counted as a hire (HIRED = legacy value before the backfill). */
export const JOINED_STAGES = ['JOINED', 'HIRED'];

/**
 * Moves an application to a new stage and records the change in
 * ApplicationStageHistory. Every stage change goes through here.
 */
export async function setStage(
  db: Db,
  companyId: string,
  application: { id: string; stage: string },
  toStage: string,
  opts: { note?: string; actorId?: string | null; rejectionReason?: string; data?: Prisma.ApplicationUncheckedUpdateInput } = {}
) {
  const updated = await db.application.update({
    where: { id: application.id },
    data: {
      ...(opts.data ?? {}),
      stage: toStage,
      ...(opts.rejectionReason !== undefined
        ? { rejectionReason: opts.rejectionReason }
        : !TERMINAL_STAGES.includes(toStage as (typeof TERMINAL_STAGES)[number])
          ? { rejectionReason: '' }
          : {}),
    },
  });
  if (application.stage !== toStage) {
    await db.applicationStageHistory.create({
      data: {
        companyId,
        applicationId: application.id,
        fromStage: application.stage,
        toStage,
        note: (opts.note ?? opts.rejectionReason ?? '').slice(0, 2000),
        actorId: opts.actorId ?? null,
      },
    });
  }
  return updated;
}

/** Tells the referring employee about milestones of their referral (never internal reasons). */
export async function notifyReferrer(
  companyId: string,
  candidate: { name: string; referredById: string | null },
  jobTitle: string,
  stage: string
) {
  if (!candidate.referredById) return;
  const body =
    stage === 'JOINED'
      ? `${candidate.name} has joined for "${jobTitle}". Thank you for the referral!`
      : TERMINAL_STAGES.includes(stage as (typeof TERMINAL_STAGES)[number])
        ? `Your referral ${candidate.name} (${jobTitle}) is no longer being considered for this role.`
        : stage === 'OFFERED'
          ? `Your referral ${candidate.name} (${jobTitle}) has received an offer.`
          : null;
  if (!body) return;
  await notify(companyId, [candidate.referredById], {
    event: stage === 'JOINED' ? 'recruitment.referral_hired' : 'recruitment.referral_update',
    title: stage === 'JOINED' ? 'Your referral joined!' : 'Referral update',
    body,
    link: '/recruitment',
  });
}

/** Collapses internal stages into what a referrer / candidate needs to know. */
export function publicStatus(stage: string): 'IN_PROCESS' | 'OFFERED' | 'HIRED' | 'NOT_SELECTED' {
  if (JOINED_STAGES.includes(stage)) return 'HIRED';
  if (CLOSED_STAGES.has(stage)) return 'NOT_SELECTED';
  if (POST_OFFER_STAGES.has(stage) || stage === 'OFFER') return 'OFFERED';
  return 'IN_PROCESS';
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

export function assertJobAccess(job: { hiringManagerId: string | null }, actor: Actor): void {
  if (isHrAdmin(actor.role)) return;
  if (actor.employeeId && job.hiringManagerId === actor.employeeId) return;
  throw ApiError.forbidden('Only HR or the hiring manager can manage this job');
}

/** HR, the job's hiring manager or the application's owner (assignedTo) may act on an application. */
export function canManageApplication(
  app: { assignedToId: string | null; job: { hiringManagerId: string | null } },
  actor: Actor
): boolean {
  if (isHrAdmin(actor.role)) return true;
  const me = actor.employeeId;
  return !!me && (app.job.hiringManagerId === me || app.assignedToId === me);
}

export function assertManageApplication(app: { assignedToId: string | null; job: { hiringManagerId: string | null } }, actor: Actor) {
  if (!canManageApplication(app, actor)) throw ApiError.forbidden('Only HR, the hiring manager or the assigned recruiter can do this');
}

/** Where-clause for applications a non-HR actor may see (hiring manager, owner or panelist). */
export function applicationScope(actor: Actor): Prisma.ApplicationWhereInput {
  if (isHrAdmin(actor.role)) return {};
  const me = requireEmployee(actor);
  return {
    OR: [
      { job: { hiringManagerId: me } },
      { assignedToId: me },
      { interviews: { some: { OR: [{ interviewerId: me }, { panel: { some: { interviewerId: me } } }] } } },
    ],
  };
}

export async function getApplicationOrThrow(companyId: string, id: string, db: Db = prisma) {
  const application = await db.application.findFirst({
    where: { id, companyId },
    include: { job: true, candidate: true, offer: true, posting: true, preOnboarding: true },
  });
  if (!application) throw ApiError.notFound('Application not found');
  return application;
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export const normEmail = (email: string): string => email.trim().toLowerCase();
/** Digits only, last 10 (drops +91 / leading 0 / spaces). */
export const normPhone = (phone: string): string => phone.replace(/\D/g, '').slice(-10);

const RESUME_TYPES = /pdf|msword|officedocument|rtf|text\/plain|opendocument/i;

export async function storeResume(companyId: string, file: UploadedFile) {
  if (!RESUME_TYPES.test(file.mimetype)) throw ApiError.badRequest('Resume must be a PDF, Word, RTF, ODT or text file');
  const key = objectKey(companyId, 'resumes', file.originalname);
  await putObject(key, file.buffer, file.mimetype);
  return { resumeKey: key, resumeName: file.originalname };
}

/** Files candidates / HR may upload for offers and pre-joining documents. */
const DOC_EXT = /\.(pdf|jpe?g|png|webp|heic)$/i;
const DOC_MIME = /^(application\/pdf|image\/(jpeg|jpg|png|webp|heic|heif))$/i;

export function assertDocumentFile(file: UploadedFile | undefined): asserts file is UploadedFile {
  if (!file) throw ApiError.badRequest('Attach the file in field "file"');
  if (!DOC_EXT.test(file.originalname) || !DOC_MIME.test(file.mimetype)) {
    throw ApiError.badRequest('Only PDF, JPG, PNG, WEBP or HEIC files are accepted');
  }
  if (file.size === 0) throw ApiError.badRequest('The file is empty');
}

/** Candidate sources (candidate record and per-application). */
export const SOURCES = [
  'CAREERS', 'REFERRAL', 'LINKEDIN', 'NAUKRI', 'INDEED', 'INTERNSHALA', 'FOUNDIT', 'INSTAHYRE', 'JOB_BOARD', 'EMAIL', 'DIRECT',
  'AGENCY', 'WALK_IN', 'OTHER',
] as const;

export const PLATFORMS = ['LINKEDIN', 'NAUKRI', 'INDEED', 'INTERNSHALA', 'FOUNDIT', 'INSTAHYRE', 'CAREERS_PAGE', 'OTHER'] as const;

/** Application source for a posting platform. */
export const sourceForPlatform = (platform: string): string => (platform === 'CAREERS_PAGE' ? 'CAREERS' : platform);

/** "Naukri" / "LinkedIn" / custom name — what HR sees for a posting. */
export function platformLabel(p: { platform: string; platformName: string }): string {
  if (p.platform === 'OTHER') return p.platformName || 'Other';
  const names: Record<string, string> = {
    LINKEDIN: 'LinkedIn', NAUKRI: 'Naukri', INDEED: 'Indeed', INTERNSHALA: 'Internshala', FOUNDIT: 'Foundit',
    INSTAHYRE: 'Instahyre', CAREERS_PAGE: 'Careers page',
  };
  return names[p.platform] ?? p.platform;
}

// ---------------------------------------------------------------------------
// Match score (resume vs job requirements)
// ---------------------------------------------------------------------------

const tokens = (csv: string): string[] =>
  [...new Set(csv.split(/[,;\n|/]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];

export interface MatchScore {
  score: number;
  skills: { matched: string[]; missing: string[]; percent: number | null };
  experience: { years: number; min: number; max: number; fit: 'IN_RANGE' | 'BELOW' | 'ABOVE' | 'ANY' };
  location: { candidate: string; job: string; match: boolean | null };
}

/**
 * Simple, explainable fit score (0–100): skills overlap 60%, experience in
 * range 25%, location 15%. Criteria the job does not specify count as met.
 */
export function matchScore(
  job: { skills: string; minExperience: number; maxExperience: number; location: string },
  candidate: { skills: string; experienceYears: number; currentLocation: string }
): MatchScore {
  const want = tokens(job.skills);
  const have = tokens(candidate.skills);
  const matched = want.filter((w) => have.some((h) => h === w || h.includes(w) || w.includes(h)));
  const skillPct = want.length ? matched.length / want.length : null;

  const years = candidate.experienceYears;
  const min = job.minExperience;
  const max = job.maxExperience;
  const fit: MatchScore['experience']['fit'] =
    !min && !max ? 'ANY' : years < min ? 'BELOW' : max > 0 && years > max ? 'ABOVE' : 'IN_RANGE';
  // Slightly under / over still earns partial credit.
  const expScore = fit === 'ANY' || fit === 'IN_RANGE' ? 1 : fit === 'BELOW' ? Math.max(0, 1 - (min - years) / Math.max(min, 1)) : 0.6;

  const jobLoc = job.location.trim().toLowerCase();
  const candLoc = candidate.currentLocation.trim().toLowerCase();
  const remote = /remote|anywhere|wfh/.test(jobLoc);
  const locMatch = !jobLoc || remote ? true : !candLoc ? null : jobLoc.split(/[,/]+/).some((l) => l.trim() && candLoc.includes(l.trim()));
  const locScore = locMatch === null ? 0.5 : locMatch ? 1 : 0;

  const score = Math.round(((skillPct ?? 1) * 0.6 + expScore * 0.25 + locScore * 0.15) * 100);
  return {
    score,
    skills: { matched, missing: want.filter((w) => !matched.includes(w)), percent: skillPct === null ? null : Math.round(skillPct * 100) },
    experience: { years, min, max, fit },
    location: { candidate: candidate.currentLocation, job: job.location, match: locMatch },
  };
}

// ---------------------------------------------------------------------------
// Candidate portal tokens
// ---------------------------------------------------------------------------

export const hashToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');
export const portalBaseUrl = (): string => (process.env.WEB_PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, '');
export const portalUrl = (token: string): string => `${portalBaseUrl()}/candidate/${token}`;

/**
 * Issues (or rotates) the candidate's portal link: a random 32-byte token of
 * which only the sha256 is stored. The raw link is returned once — any older
 * link stops working.
 */
export async function issuePortalLink(companyId: string, applicationId: string, days = 30, db: Db = prisma) {
  const application = await db.application.findFirst({ where: { id: applicationId, companyId }, select: { id: true, stage: true } });
  if (!application) throw ApiError.notFound('Application not found');
  if (application.stage === 'JOINED' || application.stage === 'HIRED') throw ApiError.badRequest('The candidate has already joined');
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  await db.application.update({ where: { id: applicationId }, data: { portalTokenHash: hashToken(token), portalExpiresAt: expiresAt } });
  return { url: portalUrl(token), expiresAt };
}
