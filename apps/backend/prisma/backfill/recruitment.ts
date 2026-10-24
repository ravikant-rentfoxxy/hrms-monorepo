/**
 * Recruitment backfill (idempotent, never deletes):
 *  - Job / Candidate / Application / Offer IDs for rows created before codes existed (createdAt order).
 *  - Legacy application stages → the new stage machine (with a stage-history row each):
 *      SCREENING → SHORTLISTED; INTERVIEW → INTERVIEW_COMPLETED (all rounds completed) or INTERVIEW_SCHEDULED;
 *      OFFER → OFFER_ACCEPTED (offer accepted) or OFFERED; HIRED → JOINED.
 *  - Application.source from the candidate when empty.
 *  - Interview panel rows (InterviewFeedback) for single-interviewer interviews, attendance from status.
 *  - Employees hired from an offer get sourceApplicationId / hireSource.
 * Job statuses are left as they are (OPEN stays OPEN, DRAFT stays DRAFT); legacy offer statuses stay valid.
 */
import type { PrismaClient } from '@prisma/client';
import { nextCode } from '../../src/utils/codes';

export async function backfillRecruitment(prisma: PrismaClient): Promise<string[]> {
  const log: string[] = [];
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });

  for (const company of companies) {
    const companyId = company.id;
    let jobs = 0;
    let candidates = 0;
    let applications = 0;
    let offers = 0;

    // ---- Codes (createdAt order so the oldest record gets the lowest number) ----
    for (const j of await prisma.jobOpening.findMany({ where: { companyId, code: null }, orderBy: { createdAt: 'asc' }, select: { id: true, createdAt: true } })) {
      await prisma.jobOpening.update({ where: { id: j.id }, data: { code: await nextCode(companyId, 'JOB', prisma, j.createdAt) } });
      jobs++;
    }
    for (const c of await prisma.candidate.findMany({ where: { companyId, code: null }, orderBy: { createdAt: 'asc' }, select: { id: true, createdAt: true } })) {
      await prisma.candidate.update({ where: { id: c.id }, data: { code: await nextCode(companyId, 'CANDIDATE', prisma, c.createdAt) } });
      candidates++;
    }
    for (const a of await prisma.application.findMany({ where: { companyId, code: null }, orderBy: { appliedOn: 'asc' }, select: { id: true, appliedOn: true } })) {
      await prisma.application.update({ where: { id: a.id }, data: { code: await nextCode(companyId, 'APPLICATION', prisma, a.appliedOn) } });
      applications++;
    }
    for (const o of await prisma.offer.findMany({ where: { companyId, code: null }, orderBy: { createdAt: 'asc' }, select: { id: true, createdAt: true } })) {
      await prisma.offer.update({ where: { id: o.id }, data: { code: await nextCode(companyId, 'OFFER', prisma, o.createdAt) } });
      offers++;
    }

    // ---- Legacy stages ----
    const legacy = await prisma.application.findMany({
      where: { companyId, stage: { in: ['SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'] } },
      include: { interviews: { select: { status: true } }, offer: { select: { status: true } } },
    });
    for (const a of legacy) {
      let to: string;
      if (a.stage === 'SCREENING') to = 'SHORTLISTED';
      else if (a.stage === 'HIRED') to = 'JOINED';
      else if (a.stage === 'OFFER') to = a.offer?.status === 'ACCEPTED' ? 'OFFER_ACCEPTED' : 'OFFERED';
      else {
        const live = a.interviews.filter((i) => i.status !== 'CANCELLED');
        to = live.length > 0 && live.every((i) => i.status === 'COMPLETED') ? 'INTERVIEW_COMPLETED' : 'INTERVIEW_SCHEDULED';
      }
      await prisma.application.update({ where: { id: a.id }, data: { stage: to } });
      await prisma.applicationStageHistory.create({
        data: { companyId, applicationId: a.id, fromStage: a.stage, toStage: to, note: `Backfill: legacy stage ${a.stage}` },
      });
    }

    // ---- Application source ----
    const unsourced = await prisma.application.findMany({ where: { companyId, source: '' }, select: { id: true, candidate: { select: { source: true } } } });
    for (const a of unsourced) await prisma.application.update({ where: { id: a.id }, data: { source: a.candidate.source } });

    // ---- Interview panels ----
    const interviews = await prisma.interview.findMany({ where: { companyId, interviewerId: { not: null }, panel: { none: {} } } });
    for (const i of interviews) {
      await prisma.interviewFeedback.createMany({
        data: [{
          companyId,
          interviewId: i.id,
          interviewerId: i.interviewerId as string,
          rating: i.rating,
          recommendation: i.recommendation,
          feedback: i.feedback,
          submittedAt: i.status === 'COMPLETED' ? i.scheduledAt : null,
        }],
        skipDuplicates: true,
      });
    }
    await prisma.interview.updateMany({ where: { companyId, status: 'COMPLETED', attended: null }, data: { attended: true } });
    await prisma.interview.updateMany({ where: { companyId, status: 'NO_SHOW', attended: null }, data: { attended: false } });

    // ---- Hire source on employees created by the old hire step ----
    const hired = await prisma.offer.findMany({
      where: { companyId, employeeId: { not: null } },
      select: { employeeId: true, applicationId: true, application: { select: { source: true, candidate: { select: { source: true } } } } },
    });
    let linked = 0;
    for (const o of hired) {
      if (!o.employeeId) continue;
      const taken = await prisma.employee.findFirst({ where: { sourceApplicationId: o.applicationId }, select: { id: true } });
      if (taken) continue;
      const r = await prisma.employee.updateMany({
        where: { id: o.employeeId, companyId, sourceApplicationId: null },
        data: { sourceApplicationId: o.applicationId, hireSource: o.application.source || o.application.candidate.source },
      });
      linked += r.count;
    }

    if (jobs || candidates || applications || offers || legacy.length || unsourced.length || interviews.length || linked) {
      log.push(
        `[recruitment] ${company.name}: codes jobs=${jobs} candidates=${candidates} applications=${applications} offers=${offers}; ` +
          `legacy stages=${legacy.length}; sources=${unsourced.length}; panels=${interviews.length}; hires linked=${linked}`
      );
    }
  }
  if (log.length === 0) log.push('[recruitment] nothing to backfill');
  return log;
}
