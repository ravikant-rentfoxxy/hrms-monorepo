/**
 * Interviews: rounds (technical / HR / managerial / culture / assignment) with
 * a panel of one or more interviewers. Each panelist submits their own
 * feedback (InterviewFeedback); the round completes when every panelist has.
 * The application moves INTERVIEW_SCHEDULED ↔ INTERVIEW_COMPLETED with its rounds.
 *
 * Interview.interviewerId keeps the lead (first) panelist for older clients.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify, notifyCandidate } from '../lib/notify';
import { ApiError } from '../utils/http';
import {
  CLOSED_STAGES, POST_OFFER_STAGES, assertManageApplication, canManageApplication, getApplicationOrThrow, setStage,
} from './recruitment.helpers';
import { type Actor, assertEmployee, employeeNames, hrEmployeeIds, isHrAdmin, requireEmployee } from './talent.helpers';

export const INTERVIEW_TYPES = ['TECHNICAL', 'HR', 'MANAGERIAL', 'CULTURE', 'ASSIGNMENT', 'OTHER'] as const;
export const INTERVIEW_MODES = ['ONSITE', 'VIDEO', 'PHONE'] as const;
export const RECOMMENDATIONS = ['STRONG_HIRE', 'HIRE', 'NO_HIRE', 'STRONG_NO_HIRE'] as const;

/** Stages from which a (further) round can be scheduled. */
const SCHEDULABLE = new Set(['APPLIED', 'SHORTLISTED', 'HR_SCREENED', 'ON_HOLD', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED', 'SCREENING', 'INTERVIEW']);
/** Stages the interview sync may move between. */
const INTERVIEW_STAGES = new Set(['INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED', 'INTERVIEW']);

export interface InterviewInput {
  applicationId: string;
  round: string;
  interviewType?: string;
  scheduledAt: Date;
  durationMinutes?: number;
  mode?: string;
  location?: string;
  panelIds: string[];
}

const when = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const modeText = (mode: string, location: string) =>
  mode === 'VIDEO' ? `Video call${location ? `: ${location}` : ''}` : mode === 'PHONE' ? 'Phone call' : `In person${location ? ` at ${location}` : ''}`;

async function getInterviewOrThrow(companyId: string, id: string) {
  const interview = await prisma.interview.findFirst({
    where: { id, companyId },
    include: { application: { include: { job: true, candidate: true } }, panel: true },
  });
  if (!interview) throw ApiError.notFound('Interview not found');
  return interview;
}

const panelOf = (i: { interviewerId: string | null; panel: { interviewerId: string }[] }) =>
  i.panel.length ? i.panel.map((p) => p.interviewerId) : i.interviewerId ? [i.interviewerId] : [];

async function assertPanel(companyId: string, panelIds: string[]) {
  const unique = [...new Set(panelIds)];
  if (unique.length === 0) throw ApiError.badRequest('Add at least one interviewer');
  for (const id of unique) await assertEmployee(companyId, id, 'Interviewer');
  return unique;
}

// ---------------------------------------------------------------------------
// Stage sync
// ---------------------------------------------------------------------------

/** Keeps the application stage in line with its rounds (scheduled → completed, or back when all are cancelled). */
export async function syncInterviewStage(companyId: string, applicationId: string, actorId: string | null) {
  const app = await prisma.application.findFirst({ where: { id: applicationId, companyId }, select: { id: true, stage: true } });
  if (!app || !INTERVIEW_STAGES.has(app.stage)) return;
  const rounds = await prisma.interview.findMany({ where: { applicationId }, select: { status: true } });
  const scheduled = rounds.filter((r) => r.status === 'SCHEDULED').length;
  const completed = rounds.filter((r) => r.status === 'COMPLETED').length;
  let target: string;
  if (scheduled > 0) target = 'INTERVIEW_SCHEDULED';
  else if (completed > 0) target = 'INTERVIEW_COMPLETED';
  else {
    // Every round was cancelled / a no-show: back to where the candidate was before interviews.
    const entry = await prisma.applicationStageHistory.findFirst({
      where: { applicationId, toStage: 'INTERVIEW_SCHEDULED' },
      orderBy: { createdAt: 'asc' },
    });
    target = entry?.fromStage && !INTERVIEW_STAGES.has(entry.fromStage) ? entry.fromStage : 'SHORTLISTED';
  }
  if (target !== app.stage) {
    await setStage(prisma, companyId, app, target, {
      actorId,
      note: target === 'INTERVIEW_COMPLETED' ? 'All scheduled rounds completed' : target === 'INTERVIEW_SCHEDULED' ? '' : 'No interview rounds remain',
    });
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type Tally = Record<(typeof RECOMMENDATIONS)[number], number>;

/**
 * Rounds of one application with panel feedback. Managers of the application
 * see every panelist's feedback plus the aggregate; a panelist sees only their own.
 */
export async function applicationInterviews(companyId: string, applicationId: string, actor: Actor, canSeeAll: boolean) {
  const rows = await prisma.interview.findMany({
    where: { companyId, applicationId },
    include: { panel: true },
    orderBy: { scheduledAt: 'asc' },
  });
  const people = await employeeNames(companyId, rows.flatMap((r) => [r.interviewerId, ...r.panel.map((p) => p.interviewerId)]));
  const me = actor.employeeId;
  const interviews = rows.map((r) => {
    const panel = r.panel.length
      ? r.panel
      : r.interviewerId
        ? [{ id: '', interviewerId: r.interviewerId, rating: r.rating, recommendation: r.recommendation, feedback: r.feedback, submittedAt: r.status === 'COMPLETED' ? r.scheduledAt : null }]
        : [];
    return {
      ...r,
      rating: canSeeAll ? r.rating : null,
      recommendation: canSeeAll ? r.recommendation : '',
      feedback: canSeeAll ? r.feedback : '',
      panel: panel
        .filter((p) => canSeeAll || p.interviewerId === me)
        .map((p) => ({
          id: p.id,
          interviewerId: p.interviewerId,
          interviewer: people.get(p.interviewerId) ?? null,
          rating: p.rating,
          recommendation: p.recommendation,
          feedback: p.feedback,
          submittedAt: p.submittedAt,
        })),
      panelNames: panel.map((p) => people.get(p.interviewerId)?.name ?? '—'),
    };
  });
  if (!canSeeAll) return { interviews, summary: null };

  const submitted = interviews.flatMap((i) => (i.status === 'CANCELLED' ? [] : i.panel.filter((p) => p.submittedAt && p.rating)));
  const tally: Tally = { STRONG_HIRE: 0, HIRE: 0, NO_HIRE: 0, STRONG_NO_HIRE: 0 };
  for (const p of submitted) if (p.recommendation in tally) tally[p.recommendation as keyof Tally] += 1;
  const ratings = submitted.map((p) => p.rating ?? 0);
  const pending = interviews.flatMap((i) => (i.status === 'SCHEDULED' ? i.panel.filter((p) => !p.submittedAt) : [])).length;
  return {
    interviews,
    summary: {
      rounds: interviews.filter((i) => i.status !== 'CANCELLED').length,
      completedRounds: interviews.filter((i) => i.status === 'COMPLETED').length,
      feedbackSubmitted: submitted.length,
      feedbackPending: pending,
      averageRating: ratings.length ? Math.round((ratings.reduce((s, x) => s + x, 0) / ratings.length) * 10) / 10 : null,
      tally,
      perRound: interviews
        .filter((i) => i.status !== 'CANCELLED')
        .map((i) => {
          const rs = i.panel.filter((p) => p.submittedAt && p.rating).map((p) => p.rating ?? 0);
          return {
            id: i.id,
            round: i.round,
            interviewType: i.interviewType,
            status: i.status,
            averageRating: rs.length ? Math.round((rs.reduce((s, x) => s + x, 0) / rs.length) * 10) / 10 : null,
          };
        }),
    },
  };
}

export async function listInterviews(
  companyId: string,
  actor: Actor,
  filter: { scope: 'mine' | 'all'; upcoming?: string; applicationId?: string; from?: Date; to?: Date; status?: string }
) {
  const where: Prisma.InterviewWhereInput = { companyId };
  const me = actor.employeeId;
  if (filter.scope === 'all') {
    if (!isHrAdmin(actor.role)) {
      const id = requireEmployee(actor);
      where.application = { OR: [{ job: { hiringManagerId: id } }, { assignedToId: id }] };
    }
  } else {
    const id = requireEmployee(actor);
    where.OR = [{ interviewerId: id }, { panel: { some: { interviewerId: id } } }];
  }
  if (filter.applicationId) where.applicationId = filter.applicationId;
  if (filter.status) where.status = filter.status;
  if (filter.upcoming === 'true') {
    where.status = 'SCHEDULED';
    where.scheduledAt = { gte: new Date(Date.now() - 2 * 3600_000) };
  } else if (filter.from || filter.to) {
    where.scheduledAt = { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) };
  }
  const rows = await prisma.interview.findMany({
    where,
    include: {
      panel: true,
      application: {
        select: {
          id: true, code: true, stage: true, assignedToId: true,
          job: { select: { id: true, code: true, title: true, hiringManagerId: true, skills: true } },
          candidate: {
            select: { id: true, code: true, name: true, email: true, phone: true, experienceYears: true, currentCompany: true, skills: true, resumeKey: true },
          },
        },
      },
    },
    orderBy: { scheduledAt: filter.upcoming === 'true' ? 'asc' : 'desc' },
    take: 300,
  });
  const people = await employeeNames(companyId, rows.flatMap((r) => [r.interviewerId, ...r.panel.map((p) => p.interviewerId)]));
  return rows.map((r) => {
    const { resumeKey, ...candidate } = r.application.candidate;
    const manage = canManageApplication(r.application, actor);
    const panel = panelOf(r);
    const mine = r.panel.find((p) => p.interviewerId === me) ?? null;
    const legacyMine = !r.panel.length && r.interviewerId === me;
    return {
      ...r,
      rating: manage ? r.rating : (mine?.rating ?? (legacyMine ? r.rating : null)),
      recommendation: manage ? r.recommendation : (mine?.recommendation ?? (legacyMine ? r.recommendation : '')),
      feedback: manage ? r.feedback : (mine?.feedback ?? (legacyMine ? r.feedback : '')),
      panel: r.panel
        .filter((p) => manage || p.interviewerId === me)
        .map((p) => ({ ...p, interviewer: people.get(p.interviewerId) ?? null })),
      panelNames: panel.map((id) => people.get(id)?.name ?? '—'),
      interviewer: r.interviewerId ? (people.get(r.interviewerId) ?? null) : null,
      isPanelist: !!me && panel.includes(me),
      myFeedback: mine
        ? { rating: mine.rating, recommendation: mine.recommendation, feedback: mine.feedback, submittedAt: mine.submittedAt }
        : legacyMine
          ? { rating: r.rating, recommendation: r.recommendation, feedback: r.feedback, submittedAt: r.status === 'COMPLETED' ? r.scheduledAt : null }
          : null,
      application: { ...r.application, candidate: { ...candidate, hasResume: !!resumeKey } },
    };
  });
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

export async function scheduleInterview(companyId: string, actor: Actor, input: InterviewInput) {
  const application = await getApplicationOrThrow(companyId, input.applicationId);
  assertManageApplication(application, actor);
  if (CLOSED_STAGES.has(application.stage) || POST_OFFER_STAGES.has(application.stage) || !SCHEDULABLE.has(application.stage)) {
    throw ApiError.badRequest(`Interviews cannot be scheduled — the application is ${application.stage.toLowerCase().replace(/_/g, ' ')}`);
  }
  if (input.scheduledAt.getTime() < Date.now() - 5 * 60_000) throw ApiError.badRequest('The interview time is in the past');
  const panelIds = await assertPanel(companyId, input.panelIds);

  const interview = await prisma.$transaction(async (tx) => {
    const created = await tx.interview.create({
      data: {
        companyId,
        applicationId: input.applicationId,
        round: input.round,
        interviewType: input.interviewType ?? 'TECHNICAL',
        scheduledAt: input.scheduledAt,
        durationMinutes: input.durationMinutes ?? 60,
        mode: input.mode ?? 'VIDEO',
        location: input.location ?? '',
        interviewerId: panelIds[0] ?? null,
      },
    });
    await tx.interviewFeedback.createMany({ data: panelIds.map((interviewerId) => ({ companyId, interviewId: created.id, interviewerId })) });
    if (application.stage !== 'INTERVIEW_SCHEDULED') {
      await setStage(tx, companyId, application, 'INTERVIEW_SCHEDULED', { actorId: actor.employeeId, note: `${input.round} scheduled` });
    }
    return created;
  });

  const at = when(input.scheduledAt);
  await notify(companyId, panelIds, {
    event: 'recruitment.interview_scheduled',
    title: 'Interview scheduled',
    body: `${input.round} with ${application.candidate.name} for "${application.job.title}" on ${at} (${modeText(interview.mode, interview.location)}).`,
    link: '/recruitment/interviews',
    email: true,
  });
  await notifyCandidate(companyId, application.candidate, {
    event: 'recruitment.interview_invitation',
    title: `Interview invitation — ${application.job.title}`,
    body: `Your ${input.round} interview is scheduled on ${at} for ${interview.durationMinutes} minutes. ${modeText(interview.mode, interview.location)}.`,
  });
  return interview;
}

export async function updateInterview(
  companyId: string,
  id: string,
  actor: Actor,
  input: Partial<Omit<InterviewInput, 'applicationId'>>
) {
  const before = await getInterviewOrThrow(companyId, id);
  assertManageApplication(before.application, actor);
  if (before.status !== 'SCHEDULED') throw ApiError.badRequest(`This interview is ${before.status.toLowerCase().replace(/_/g, ' ')}`);
  if (input.scheduledAt && input.scheduledAt.getTime() < Date.now() - 5 * 60_000) throw ApiError.badRequest('The interview time is in the past');

  const oldPanel = panelOf(before);
  let panelIds = oldPanel;
  if (input.panelIds) {
    panelIds = await assertPanel(companyId, input.panelIds);
    const removed = before.panel.filter((p) => !panelIds.includes(p.interviewerId));
    if (removed.some((p) => p.submittedAt)) throw ApiError.badRequest('A panelist who already gave feedback cannot be removed');
  }
  const { panelIds: _p, ...fields } = input;
  const after = await prisma.$transaction(async (tx) => {
    if (input.panelIds) {
      await tx.interviewFeedback.deleteMany({ where: { interviewId: id, interviewerId: { notIn: panelIds } } });
      await tx.interviewFeedback.createMany({
        data: panelIds.map((interviewerId) => ({ companyId, interviewId: id, interviewerId })),
        skipDuplicates: true,
      });
    }
    return tx.interview.update({ where: { id }, data: { ...fields, interviewerId: panelIds[0] ?? before.interviewerId } });
  });

  const rescheduled = !!input.scheduledAt && input.scheduledAt.getTime() !== before.scheduledAt.getTime();
  const venueChanged = (input.mode && input.mode !== before.mode) || (input.location !== undefined && input.location !== before.location);
  const added = panelIds.filter((p) => !oldPanel.includes(p));
  const removed = oldPanel.filter((p) => !panelIds.includes(p));
  const at = when(after.scheduledAt);
  if (rescheduled || venueChanged) {
    await notify(companyId, panelIds.filter((p) => !added.includes(p)), {
      event: 'recruitment.interview_rescheduled',
      title: 'Interview rescheduled',
      body: `${after.round} with ${before.application.candidate.name} is now on ${at} (${modeText(after.mode, after.location)}).`,
      link: '/recruitment/interviews',
      email: true,
    });
    await notifyCandidate(companyId, before.application.candidate, {
      event: 'recruitment.interview_rescheduled',
      title: `Interview rescheduled — ${before.application.job.title}`,
      body: `Your ${after.round} interview is now on ${at}. ${modeText(after.mode, after.location)}.`,
    });
  }
  if (added.length) {
    await notify(companyId, added, {
      event: 'recruitment.interview_scheduled',
      title: 'You were added to an interview panel',
      body: `${after.round} with ${before.application.candidate.name} for "${before.application.job.title}" on ${at}.`,
      link: '/recruitment/interviews',
      email: true,
    });
  }
  if (removed.length) {
    await notify(companyId, removed, {
      event: 'recruitment.interview_cancelled',
      title: 'Removed from an interview panel',
      body: `You are no longer on the panel for ${after.round} with ${before.application.candidate.name}.`,
      link: '/recruitment/interviews',
    });
  }
  const { application: _a, panel: _panel, ...plain } = before;
  return { before: plain, after };
}

export async function cancelInterview(companyId: string, id: string, actor: Actor, reason?: string) {
  const before = await getInterviewOrThrow(companyId, id);
  assertManageApplication(before.application, actor);
  if (before.status !== 'SCHEDULED') throw ApiError.badRequest(`This interview is ${before.status.toLowerCase().replace(/_/g, ' ')}`);
  const after = await prisma.interview.update({ where: { id }, data: { status: 'CANCELLED' } });
  await syncInterviewStage(companyId, before.applicationId, actor.employeeId);
  await notify(companyId, panelOf(before), {
    event: 'recruitment.interview_cancelled',
    title: 'Interview cancelled',
    body: `${before.round} with ${before.application.candidate.name} on ${when(before.scheduledAt)} was cancelled${reason ? `: ${reason}` : ''}.`,
    link: '/recruitment/interviews',
  });
  await notifyCandidate(companyId, before.application.candidate, {
    event: 'recruitment.interview_cancelled',
    title: `Interview cancelled — ${before.application.job.title}`,
    body: `Your ${before.round} interview on ${when(before.scheduledAt)} has been cancelled. We will be in touch about next steps.`,
  });
  const { application: _a, panel: _panel, ...plain } = before;
  return { before: plain, after };
}

/** Attendance: attended (feedback can follow) or no-show (round closes). */
export async function recordAttendance(companyId: string, id: string, actor: Actor, attended: boolean) {
  const before = await getInterviewOrThrow(companyId, id);
  const isPanelist = !!actor.employeeId && panelOf(before).includes(actor.employeeId);
  if (!isPanelist && !canManageApplication(before.application, actor)) throw ApiError.forbidden('Only the panel, HR or the hiring manager can record attendance');
  if (before.status === 'CANCELLED') throw ApiError.badRequest('This interview was cancelled');
  if (before.scheduledAt.getTime() > Date.now() + 15 * 60_000) throw ApiError.badRequest('Attendance can be recorded once the interview has started');
  if (!attended && before.panel.some((p) => p.submittedAt)) throw ApiError.badRequest('Feedback was already submitted for this round');
  const status = attended ? (before.status === 'NO_SHOW' ? 'SCHEDULED' : before.status) : 'NO_SHOW';
  const after = await prisma.interview.update({ where: { id }, data: { attended, status } });
  await syncInterviewStage(companyId, before.applicationId, actor.employeeId);
  if (!attended) {
    await notify(companyId, [before.application.job.hiringManagerId, before.application.assignedToId, ...(await hrEmployeeIds(companyId))], {
      event: 'recruitment.interview_no_show',
      title: 'Candidate did not attend',
      body: `${before.application.candidate.name} missed ${before.round} (${when(before.scheduledAt)}). Reschedule or close the application.`,
      link: `/recruitment/applications/${before.applicationId}`,
    });
  }
  const { application: _a, panel: _panel, ...plain } = before;
  return { before: plain, after };
}

/** Most common recommendation (ties → the more cautious one). */
function consensus(recs: string[]): string {
  const order = ['STRONG_NO_HIRE', 'NO_HIRE', 'HIRE', 'STRONG_HIRE'];
  const counts = new Map<string, number>();
  for (const r of recs) counts.set(r, (counts.get(r) ?? 0) + 1);
  let best = '';
  let bestCount = 0;
  for (const r of order) {
    const c = counts.get(r) ?? 0;
    if (c > bestCount) {
      best = r;
      bestCount = c;
    }
  }
  return best;
}

/**
 * A panelist's feedback (HR may record it on behalf of a panelist via
 * interviewerId). When the whole panel has submitted, the round is COMPLETED.
 */
export async function submitFeedback(
  companyId: string,
  id: string,
  actor: Actor,
  input: { rating: number; recommendation: string; feedback: string; interviewerId?: string }
) {
  const interview = await getInterviewOrThrow(companyId, id);
  const onBehalf = input.interviewerId && input.interviewerId !== actor.employeeId;
  if (onBehalf && !isHrAdmin(actor.role)) throw ApiError.forbidden('Only HR can record feedback for another interviewer');
  const interviewerId = input.interviewerId ?? requireEmployee(actor);
  const panel = panelOf(interview);
  if (!panel.includes(interviewerId)) throw ApiError.forbidden('Only the interview panel can submit feedback');
  if (interview.status === 'CANCELLED' || interview.status === 'NO_SHOW') {
    throw ApiError.badRequest(`This interview was ${interview.status === 'NO_SHOW' ? 'a no-show' : 'cancelled'}`);
  }
  if (interview.scheduledAt.getTime() > Date.now() + 15 * 60_000) throw ApiError.badRequest('Feedback can be submitted once the interview has started');
  if (CLOSED_STAGES.has(interview.application.stage) && interview.status !== 'COMPLETED') {
    throw ApiError.badRequest('The application is closed');
  }

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    await tx.interviewFeedback.upsert({
      where: { interviewId_interviewerId: { interviewId: id, interviewerId } },
      create: { companyId, interviewId: id, interviewerId, rating: input.rating, recommendation: input.recommendation, feedback: input.feedback, submittedAt: now },
      update: { rating: input.rating, recommendation: input.recommendation, feedback: input.feedback, submittedAt: now },
    });
    const rows = await tx.interviewFeedback.findMany({ where: { interviewId: id } });
    const done = rows.filter((r) => r.submittedAt);
    const complete = done.length >= rows.length;
    const ratings = done.map((r) => r.rating ?? 0).filter((r) => r > 0);
    const lead = rows.find((r) => r.interviewerId === interview.interviewerId) ?? done[0];
    const updated = await tx.interview.update({
      where: { id },
      data: {
        attended: true,
        ...(complete
          ? {
              status: 'COMPLETED',
              rating: ratings.length ? Math.round(ratings.reduce((s, x) => s + x, 0) / ratings.length) : null,
              recommendation: consensus(done.map((r) => r.recommendation)),
              feedback: lead?.feedback ?? '',
            }
          : {}),
      },
    });
    return { updated, complete, wasComplete: interview.status === 'COMPLETED' };
  });
  await syncInterviewStage(companyId, interview.applicationId, actor.employeeId);
  if (result.complete && !result.wasComplete) {
    await notify(companyId, [interview.application.job.hiringManagerId, interview.application.assignedToId, ...(await hrEmployeeIds(companyId))], {
      event: 'recruitment.interview_feedback',
      title: 'Interview feedback complete',
      body: `${interview.round} for ${interview.application.candidate.name}: ${result.updated.recommendation.replace(/_/g, ' ').toLowerCase()} (${result.updated.rating ?? '—'}/5).`,
      link: `/recruitment/applications/${interview.applicationId}`,
    });
  }
  return result.updated;
}

// ---------------------------------------------------------------------------
// Reminders (daily job)
// ---------------------------------------------------------------------------

/** Reminds the panel and the candidate of tomorrow's (IST) interviews. */
export async function sendReminders(companyId: string, now = new Date()): Promise<number> {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const start = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1) - 330 * 60_000);
  const end = new Date(start.getTime() + 86_400_000);
  const rows = await prisma.interview.findMany({
    where: { companyId, status: 'SCHEDULED', scheduledAt: { gte: start, lt: end } },
    include: { panel: { select: { interviewerId: true } }, application: { include: { candidate: true, job: { select: { title: true } } } } },
  });
  for (const r of rows) {
    if (CLOSED_STAGES.has(r.application.stage)) continue;
    const at = when(r.scheduledAt);
    await notify(companyId, panelOf(r), {
      event: 'recruitment.interview_reminder',
      title: 'Interview tomorrow',
      body: `${r.round} with ${r.application.candidate.name} for "${r.application.job.title}" at ${at}.`,
      link: '/recruitment/interviews',
      email: true,
    });
    await notifyCandidate(companyId, r.application.candidate, {
      event: 'recruitment.interview_reminder',
      title: `Reminder: interview tomorrow — ${r.application.job.title}`,
      body: `Your ${r.round} interview is on ${at}. ${modeText(r.mode, r.location)}.`,
    });
  }
  return rows.length;
}
