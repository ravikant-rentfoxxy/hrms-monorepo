/**
 * Candidates & application intake: the talent pool, duplicate detection
 * (email OR mobile), adding a candidate to a job (Application ID), CSV import
 * of applicants for a job and resumes.
 *
 * One candidate can apply to many jobs; an application is unique per
 * job + candidate. Adding someone who is already in the pool reuses their
 * record (and reports `duplicateOf`) instead of creating a second one.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { presignedGetUrl, removeObject } from '../lib/storage';
import { ApiError } from '../utils/http';
import { parseCsvObjects } from '../utils/csv';
import { nextCode } from '../utils/codes';
import { importRowSchema } from '../validations/recruitment.validation';
import {
  type Db, type UploadedFile, CLOSED_STAGES, POST_OFFER_STAGES, applicationScope, normEmail, normPhone, sourceForPlatform, storeResume,
} from './recruitment.helpers';
import { type Actor, employeeNames, isHrAdmin } from './talent.helpers';

export interface CandidateInput {
  name: string;
  email: string;
  phone?: string;
  currentCompany?: string;
  currentDesignation?: string;
  currentLocation?: string;
  currentCtc?: number;
  expectedCtc?: number;
  noticePeriodDays?: number;
  experienceYears?: number;
  qualifications?: string;
  source?: string;
  skills?: string;
  notes?: string;
}

export interface IntakeInput extends CandidateInput {
  /** Also apply the candidate to this job. */
  jobId?: string;
  postingId?: string;
  externalRef?: string;
}

/** Jobs that still accept applications. */
const CLOSED_JOB = ['CLOSED', 'FILLED', 'CANCELLED'];

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

export interface DuplicateMatch {
  id: string;
  code: string | null;
  name: string;
  email: string;
  phone: string;
  matchedOn: 'email' | 'phone';
}

/** Existing candidate with the same email (case-insensitive) or the same mobile (last 10 digits). */
export async function findDuplicate(
  companyId: string,
  input: { email?: string; phone?: string },
  excludeId?: string,
  db: Db = prisma
): Promise<DuplicateMatch | null> {
  const select = { id: true, code: true, name: true, email: true, phone: true } as const;
  if (input.email?.trim()) {
    const byEmail = await db.candidate.findFirst({
      where: { companyId, email: { equals: normEmail(input.email), mode: 'insensitive' }, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select,
    });
    if (byEmail) return { ...byEmail, matchedOn: 'email' };
  }
  const phone = normPhone(input.phone ?? '');
  if (phone.length === 10) {
    const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM "Candidate"
      WHERE "companyId" = ${companyId}
        AND right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = ${phone}
        ${excludeId ? Prisma.sql`AND id <> ${excludeId}` : Prisma.empty}
      ORDER BY "createdAt" ASC
      LIMIT 1`);
    const id = rows[0]?.id;
    if (id) {
      const byPhone = await db.candidate.findUnique({ where: { id }, select });
      if (byPhone) return { ...byPhone, matchedOn: 'phone' };
    }
  }
  return null;
}

/** Duplicate check for the add-candidate form, with the jobs the match already applied to. */
export async function checkDuplicate(companyId: string, input: { email?: string; phone?: string }) {
  const match = await findDuplicate(companyId, input);
  if (!match) return { exists: false, candidate: null };
  const applications = await prisma.application.findMany({
    where: { companyId, candidateId: match.id },
    select: { id: true, code: true, stage: true, job: { select: { id: true, code: true, title: true } } },
  });
  return { exists: true, candidate: { ...match, applications } };
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

/** Creates an application (Application ID, stage APPLIED + first history row). */
export async function createApplication(
  db: Db,
  companyId: string,
  input: { jobId: string; candidateId: string; postingId?: string | null; source?: string; externalRef?: string; actorId?: string | null; appliedOn?: Date }
) {
  const application = await db.application.create({
    data: {
      companyId,
      jobId: input.jobId,
      candidateId: input.candidateId,
      postingId: input.postingId ?? null,
      source: input.source ?? '',
      externalRef: input.externalRef ?? '',
      code: await nextCode(companyId, 'APPLICATION', db),
      ...(input.appliedOn ? { appliedOn: input.appliedOn } : {}),
    },
  });
  await db.applicationStageHistory.create({
    data: { companyId, applicationId: application.id, fromStage: '', toStage: 'APPLIED', note: 'Application received', actorId: input.actorId ?? null },
  });
  return application;
}

/** Validates that the job accepts applications and the posting (if any) belongs to it. */
export async function assertJobAccepting(companyId: string, jobId: string, postingId?: string | null) {
  const job = await prisma.jobOpening.findFirst({ where: { id: jobId, companyId } });
  if (!job) throw ApiError.badRequest('Job not found in this company');
  if (CLOSED_JOB.includes(job.status)) throw ApiError.badRequest(`Job ${job.code ?? job.title} is ${job.status.toLowerCase()}`);
  let posting = null;
  if (postingId) {
    posting = await prisma.jobPosting.findFirst({ where: { id: postingId, companyId, jobId } });
    if (!posting) throw ApiError.badRequest('That posting does not belong to this job');
  }
  return { job, posting };
}

// ---------------------------------------------------------------------------
// Intake (manual form, CSV, referral)
// ---------------------------------------------------------------------------

const FILLABLE: (keyof CandidateInput)[] = [
  'phone', 'currentCompany', 'currentDesignation', 'currentLocation', 'currentCtc', 'expectedCtc', 'noticePeriodDays',
  'experienceYears', 'qualifications', 'skills', 'notes',
];

/** Fields the existing record is missing that the new submission provides. */
function gapFill(existing: Record<string, unknown>, input: CandidateInput) {
  const data: Record<string, unknown> = {};
  for (const key of FILLABLE) {
    const incoming = input[key];
    const current = existing[key];
    if (incoming === undefined || incoming === '' || incoming === 0) continue;
    if (current === '' || current === 0 || current === null || current === undefined) data[key] = incoming;
  }
  return data;
}

export interface IntakeResult {
  candidate: { id: string; code: string | null; name: string; email: string };
  application: { id: string; code: string | null; stage: string } | null;
  duplicateOf: DuplicateMatch | null;
  alreadyApplied: boolean;
}

/**
 * Adds a candidate (or reuses the existing one matched by email / mobile) and
 * optionally applies them to a job. Used by the HR form, CSV import and referrals.
 */
export async function intake(
  companyId: string,
  input: IntakeInput,
  opts: { file?: UploadedFile; actorId?: string | null; referredById?: string | null } = {}
): Promise<IntakeResult> {
  const { jobId, postingId, externalRef, ...fields } = input;
  const data: CandidateInput = { ...fields, email: normEmail(fields.email), phone: (fields.phone ?? '').trim() };
  const accepting = jobId ? await assertJobAccepting(companyId, jobId, postingId) : null;
  const duplicateOf = await findDuplicate(companyId, data);
  const resume = opts.file ? await storeResume(companyId, opts.file) : null;

  try {
    const result = await prisma.$transaction(async (tx) => {
      let candidate;
      let oldResume: string | null = null;
      if (duplicateOf) {
        const existing = await tx.candidate.findUniqueOrThrow({ where: { id: duplicateOf.id } });
        oldResume = resume ? existing.resumeKey : null;
        candidate = await tx.candidate.update({
          where: { id: existing.id },
          data: { ...gapFill(existing, data), ...(resume ?? {}) },
        });
      } else {
        candidate = await tx.candidate.create({
          data: {
            ...data,
            companyId,
            code: await nextCode(companyId, 'CANDIDATE', tx),
            source: data.source ?? 'OTHER',
            referredById: opts.referredById ?? null,
            ...(resume ?? {}),
          },
        });
      }
      let application = null;
      let alreadyApplied = false;
      if (jobId) {
        const existingApp = await tx.application.findUnique({ where: { jobId_candidateId: { jobId, candidateId: candidate.id } } });
        if (existingApp) {
          application = existingApp;
          alreadyApplied = true;
        } else {
          application = await createApplication(tx, companyId, {
            jobId,
            candidateId: candidate.id,
            postingId: accepting?.posting?.id ?? null,
            source: accepting?.posting ? sourceForPlatform(accepting.posting.platform) : (data.source ?? candidate.source),
            externalRef: externalRef ?? '',
            actorId: opts.actorId,
          });
        }
      }
      return { candidate, application, alreadyApplied, oldResume };
    });
    if (result.oldResume) await removeObject(result.oldResume).catch(() => undefined);
    const c = result.candidate;
    return {
      candidate: { id: c.id, code: c.code, name: c.name, email: c.email },
      application: result.application ? { id: result.application.id, code: result.application.code, stage: result.application.stage } : null,
      duplicateOf,
      alreadyApplied: result.alreadyApplied,
    };
  } catch (err) {
    if (resume) await removeObject(resume.resumeKey).catch(() => undefined);
    if ((err as { code?: string }).code === 'P2002') throw ApiError.conflict('This candidate was just added by someone else — refresh and try again');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

export const IMPORT_COLUMNS = [
  'name', 'email', 'phone', 'skills', 'experienceYears', 'currentCtc', 'expectedCtc', 'noticePeriodDays', 'currentCompany',
  'currentLocation', 'source', 'externalRef', 'postingId',
] as const;

export interface ImportRowResult {
  row: number;
  name: string;
  email: string;
  status: 'CREATED' | 'EXISTING_CANDIDATE' | 'ALREADY_APPLIED' | 'ERROR';
  message: string;
  candidateCode?: string | null;
  applicationCode?: string | null;
}

/**
 * Imports applicants for a job from CSV (header row, IMPORT_COLUMNS; header
 * case and spaces are ignored). With dryRun nothing is written — each row is
 * validated and checked for duplicates so HR can preview first.
 */
export async function importForJob(companyId: string, jobId: string, csv: string, opts: { dryRun: boolean; actorId: string | null }) {
  await assertJobAccepting(companyId, jobId);
  const canonical = new Map<string, string>(IMPORT_COLUMNS.map((c) => [c.toLowerCase(), c]));
  const rows = parseCsvObjects(csv).map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [canonical.get(k.replace(/[\s_]/g, '').toLowerCase()) ?? k, v]))
  );
  if (rows.length === 0) throw ApiError.badRequest('The CSV has no data rows');
  if (rows.length > 1000) throw ApiError.badRequest('Import at most 1000 rows at a time');

  const results: ImportRowResult[] = [];
  const seen = new Map<string, number>(); // dry run: duplicates within the file
  for (const [i, raw] of rows.entries()) {
    const rowNo = i + 2; // + header, 1-based
    const parsed = importRowSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((e) => `${e.path.join('.') || 'row'}: ${e.message}`).join('; ');
      results.push({ row: rowNo, name: raw.name ?? '', email: raw.email ?? '', status: 'ERROR', message: issues });
      continue;
    }
    const { postingId, externalRef, ...fields } = parsed.data;
    try {
      if (opts.dryRun) {
        if (postingId) await assertJobAccepting(companyId, jobId, postingId);
        const keys = [normEmail(fields.email), normPhone(fields.phone)].filter((k) => k.length >= 10 || k.includes('@'));
        const inFile = keys.map((k) => seen.get(k)).find((r) => r !== undefined);
        keys.forEach((k) => seen.set(k, rowNo));
        const dup = await findDuplicate(companyId, fields);
        const applied = dup ? await prisma.application.findUnique({ where: { jobId_candidateId: { jobId, candidateId: dup.id } } }) : null;
        results.push({
          row: rowNo,
          name: fields.name,
          email: fields.email,
          status: applied ? 'ALREADY_APPLIED' : dup || inFile ? 'EXISTING_CANDIDATE' : 'CREATED',
          message: applied
            ? `Already applied (${applied.code ?? applied.stage})`
            : dup
              ? `Matches ${dup.code ?? dup.name} by ${dup.matchedOn} — will be linked`
              : inFile
                ? `Same person as row ${inFile} — will be linked`
                : 'New candidate',
          candidateCode: dup?.code ?? null,
        });
        continue;
      }
      const r = await intake(companyId, { ...fields, jobId, postingId: postingId || undefined, externalRef }, { actorId: opts.actorId });
      results.push({
        row: rowNo,
        name: fields.name,
        email: fields.email,
        status: r.alreadyApplied ? 'ALREADY_APPLIED' : r.duplicateOf ? 'EXISTING_CANDIDATE' : 'CREATED',
        message: r.alreadyApplied
          ? 'Already applied to this job'
          : r.duplicateOf
            ? `Linked to existing ${r.duplicateOf.code ?? r.duplicateOf.name} (matched by ${r.duplicateOf.matchedOn})`
            : 'Created',
        candidateCode: r.candidate.code,
        applicationCode: r.application?.code ?? null,
      });
    } catch (err) {
      results.push({ row: rowNo, name: fields.name, email: fields.email, status: 'ERROR', message: err instanceof Error ? err.message : 'Failed' });
    }
  }
  const count = (s: ImportRowResult['status']) => results.filter((r) => r.status === s).length;
  return {
    dryRun: opts.dryRun,
    total: results.length,
    created: count('CREATED'),
    linked: count('EXISTING_CANDIDATE'),
    alreadyApplied: count('ALREADY_APPLIED'),
    errors: count('ERROR'),
    rows: results,
  };
}

// ---------------------------------------------------------------------------
// Talent pool
// ---------------------------------------------------------------------------

export async function listCandidates(companyId: string, actor: Actor, filter: { q?: string; source?: string; jobId?: string; stage?: string }) {
  const where: Prisma.CandidateWhereInput = { companyId };
  const and: Prisma.CandidateWhereInput[] = [];
  if (!isHrAdmin(actor.role)) and.push({ applications: { some: applicationScope(actor) } });
  if (filter.q) {
    const digits = normPhone(filter.q);
    and.push({
      OR: [
        { name: { contains: filter.q, mode: 'insensitive' } },
        { email: { contains: filter.q, mode: 'insensitive' } },
        { code: { contains: filter.q, mode: 'insensitive' } },
        { skills: { contains: filter.q, mode: 'insensitive' } },
        ...(digits.length >= 4 ? [{ phone: { contains: digits.slice(-4) } }] : []),
      ],
    });
  }
  if (filter.source) where.source = filter.source;
  if (filter.jobId || filter.stage) {
    and.push({ applications: { some: { ...(filter.jobId ? { jobId: filter.jobId } : {}), ...(filter.stage ? { stage: filter.stage } : {}) } } });
  }
  if (and.length) where.AND = and;
  const rows = await prisma.candidate.findMany({
    where,
    include: { applications: { select: { id: true, code: true, stage: true, job: { select: { id: true, code: true, title: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const referrers = await employeeNames(companyId, rows.map((r) => r.referredById));
  const hr = isHrAdmin(actor.role);
  return rows.map(({ resumeKey, ...c }) => ({
    ...c,
    currentCtc: hr ? c.currentCtc : undefined,
    expectedCtc: hr ? c.expectedCtc : undefined,
    hasResume: !!resumeKey,
    referredBy: c.referredById ? (referrers.get(c.referredById) ?? null) : null,
  }));
}

export async function getCandidate(companyId: string, id: string, actor: Actor) {
  const candidate = await prisma.candidate.findFirst({
    where: { id, companyId },
    include: {
      applications: {
        where: applicationScope(actor),
        include: {
          job: { select: { id: true, code: true, title: true, department: true, status: true, hiringManagerId: true } },
          posting: { select: { id: true, platform: true, platformName: true } },
          offer: { select: { id: true, code: true, status: true } },
          interviews: { select: { id: true, round: true, status: true, scheduledAt: true } },
        },
        orderBy: { appliedOn: 'desc' },
      },
    },
  });
  if (!candidate) throw ApiError.notFound('Candidate not found');
  if (!isHrAdmin(actor.role) && candidate.applications.length === 0) throw ApiError.forbidden('You do not have access to this candidate');
  const people = await employeeNames(companyId, [candidate.referredById]);
  const { resumeKey, ...rest } = candidate;
  const hr = isHrAdmin(actor.role);
  return {
    ...rest,
    // Compensation is HR-only.
    currentCtc: hr ? rest.currentCtc : undefined,
    expectedCtc: hr ? rest.expectedCtc : undefined,
    hasResume: !!resumeKey,
    referredBy: rest.referredById ? (people.get(rest.referredById) ?? null) : null,
  };
}

export async function updateCandidate(companyId: string, id: string, input: Partial<CandidateInput>, file?: UploadedFile) {
  const before = await prisma.candidate.findFirst({ where: { id, companyId } });
  if (!before) throw ApiError.notFound('Candidate not found');
  const data: Partial<CandidateInput> = { ...input, ...(input.email ? { email: normEmail(input.email) } : {}) };
  const emailChanged = data.email !== undefined && data.email !== before.email;
  const phoneChanged = data.phone !== undefined && normPhone(data.phone) !== normPhone(before.phone);
  if (emailChanged || phoneChanged) {
    const dup = await findDuplicate(companyId, { email: emailChanged ? data.email : undefined, phone: phoneChanged ? data.phone : undefined }, id);
    if (dup) throw ApiError.conflict(`Another candidate (${dup.code ?? dup.name}) already uses this ${dup.matchedOn}`);
  }
  const resume = file ? await storeResume(companyId, file) : {};
  const after = await prisma.candidate.update({ where: { id }, data: { ...data, ...resume } });
  if (file && before.resumeKey) await removeObject(before.resumeKey).catch(() => undefined);
  return { before, after };
}

export async function deleteCandidate(companyId: string, id: string) {
  const candidate = await prisma.candidate.findFirst({ where: { id, companyId }, include: { applications: { include: { offer: true } } } });
  if (!candidate) throw ApiError.notFound('Candidate not found');
  if (candidate.applications.some((a) => a.offer || POST_OFFER_STAGES.has(a.stage) || (CLOSED_STAGES.has(a.stage) && a.stage !== 'REJECTED' && a.stage !== 'WITHDRAWN'))) {
    throw ApiError.conflict('This candidate has an offer or has joined — the record is kept for history');
  }
  await prisma.candidate.delete({ where: { id } });
  if (candidate.resumeKey) await removeObject(candidate.resumeKey).catch(() => undefined);
  return candidate;
}

export async function resumeUrl(companyId: string, id: string, actor: Actor, inline: boolean) {
  const candidate = await prisma.candidate.findFirst({ where: { id, companyId } });
  if (!candidate) throw ApiError.notFound('Candidate not found');
  if (!isHrAdmin(actor.role)) {
    const linked = await prisma.application.count({ where: { companyId, candidateId: id, ...applicationScope(actor) } });
    if (!linked) throw ApiError.forbidden('You do not have access to this candidate');
  }
  if (!candidate.resumeKey) throw ApiError.notFound('No resume uploaded for this candidate');
  return { url: await presignedGetUrl(candidate.resumeKey, candidate.resumeName || 'resume', inline ? 'inline' : 'attachment') };
}
