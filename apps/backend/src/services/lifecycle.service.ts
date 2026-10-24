/**
 * Hire-to-retire overview, computed from the data every module already keeps:
 *
 *   pipeline()  — counts for the 16 company-wide lifecycle stages (Job
 *                 Requisition → ... → Employee Archived) + a drill-down list
 *                 per stage. ADMIN/HR.
 *   timeline()  — one employee's chronological story: requisition → posting →
 *                 application stages → interviews → offer → pre-onboarding →
 *                 joined + career history → transfers → reviews → salary →
 *                 resignation → handover → clearances → F&F → letters → archive.
 *                 Self, reporting manager or ADMIN/HR.
 *
 * Read-only: nothing here writes.
 */
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/http';
import { isCompanyAdmin, longDate } from '../utils/lifecycle';
import { platformLabel } from './recruitment.helpers';

export interface Actor {
  role: Role;
  employeeId: string | null;
}

export const LIFECYCLE_STAGES = [
  { key: 'REQUISITION', label: 'Job Requisition' },
  { key: 'POSTING', label: 'External Job Posting' },
  { key: 'APPLICATIONS', label: 'Applications Received' },
  { key: 'SCREENING', label: 'Candidate Screening' },
  { key: 'INTERVIEW', label: 'Interview Process' },
  { key: 'SELECTED', label: 'Candidate Selected' },
  { key: 'OFFER_ACCEPTED', label: 'Offer Accepted' },
  { key: 'PRE_ONBOARDING', label: 'Pre-Onboarding' },
  { key: 'JOINED', label: 'Employee Joined' },
  { key: 'ACTIVE', label: 'Active Employee' },
  { key: 'PERFORMANCE_PAYROLL', label: 'Performance & Payroll' },
  { key: 'RESIGNATION', label: 'Resignation / Separation' },
  { key: 'NOTICE', label: 'Notice Period & Handover' },
  { key: 'CLEARANCE', label: 'Exit Clearance' },
  { key: 'SETTLEMENT', label: 'Full & Final Settlement' },
  { key: 'ARCHIVED', label: 'Employee Archived' },
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number]['key'];

/** Application stages grouped into the overall pipeline stages. */
const APPLICATION_GROUPS: Partial<Record<LifecycleStage, string[]>> = {
  APPLICATIONS: ['APPLIED'],
  SCREENING: ['SHORTLISTED', 'ON_HOLD', 'HR_SCREENED'],
  INTERVIEW: ['INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED'],
  SELECTED: ['SELECTED', 'OFFERED'],
  OFFER_ACCEPTED: ['OFFER_ACCEPTED'],
  PRE_ONBOARDING: ['PRE_ONBOARDING', 'DOCUMENTS_VERIFIED', 'READY_TO_JOIN'],
};

const monthStartUTC = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const formerWhere: Prisma.EmployeeWhereInput = { OR: [{ employmentStatus: 'SEPARATED' }, { isActive: false }] };
const OPEN_REVIEW_CYCLES = ['SELF_REVIEW', 'MANAGER_REVIEW', 'CALIBRATION'];

// ---- Pipeline ----

export interface StageSummary {
  key: LifecycleStage;
  label: string;
  count: number;
  breakdown: Record<string, number>;
}

export async function pipeline(companyId: string): Promise<{ stages: StageSummary[] }> {
  const [
    reqPending, reqApprovedOpen, postingsByPlatform, appStages, joinedThisMonth, byStatus, confirmations, transfers,
    revisions, reviews, resignationsPending, handoverOpen, clearancePending, settlements, former, archived,
  ] = await Promise.all([
    prisma.jobRequisition.count({ where: { companyId, status: 'PENDING_APPROVAL' } }),
    prisma.jobRequisition.count({ where: { companyId, status: 'APPROVED', job: { is: null } } }),
    prisma.jobPosting.groupBy({ by: ['platform'], where: { companyId, status: { in: ['PUBLISHED', 'ACTIVE'] } }, _count: { _all: true } }),
    prisma.application.groupBy({ by: ['stage'], where: { companyId }, _count: { _all: true } }),
    prisma.employee.count({ where: { companyId, joiningDate: { gte: monthStartUTC(), lte: new Date() } } }),
    prisma.employee.groupBy({ by: ['employmentStatus'], where: { companyId, isActive: true }, _count: { _all: true } }),
    prisma.confirmationRequest.count({ where: { companyId, status: 'PENDING' } }),
    prisma.transferRequest.count({ where: { companyId, status: { in: ['PENDING', 'APPROVED'] } } }),
    prisma.salaryRevision.count({ where: { companyId, status: { in: ['PENDING', 'APPROVED'] } } }),
    prisma.review.count({ where: { companyId, status: 'PENDING', cycle: { status: { in: OPEN_REVIEW_CYCLES } } } }),
    prisma.resignation.count({ where: { companyId, status: 'PENDING' } }),
    prisma.handoverTask.count({ where: { companyId, status: { not: 'VERIFIED' }, resignation: { status: 'APPROVED' } } }),
    prisma.resignation.count({ where: { companyId, status: 'APPROVED', clearances: { some: { status: { not: 'CLEARED' } } } } }),
    prisma.finalSettlement.groupBy({ by: ['status'], where: { companyId, status: { in: ['DRAFT', 'APPROVED'] } }, _count: { _all: true } }),
    prisma.employee.count({ where: { companyId, ...formerWhere } }),
    prisma.employee.count({ where: { companyId, ...formerWhere, archivedAt: { not: null } } }),
  ]);
  const stageCount = (stages: string[]) =>
    Object.fromEntries(stages.map((s) => [s, appStages.find((a) => a.stage === s)?._count._all ?? 0]));
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  const statusCount = (s: string) => byStatus.find((b) => b.employmentStatus === s)?._count._all ?? 0;

  const breakdowns: Record<LifecycleStage, Record<string, number>> = {
    REQUISITION: { PENDING_APPROVAL: reqPending, APPROVED_NOT_POSTED: reqApprovedOpen },
    POSTING: Object.fromEntries(postingsByPlatform.map((p) => [p.platform, p._count._all])),
    APPLICATIONS: stageCount(APPLICATION_GROUPS.APPLICATIONS ?? []),
    SCREENING: stageCount(APPLICATION_GROUPS.SCREENING ?? []),
    INTERVIEW: stageCount(APPLICATION_GROUPS.INTERVIEW ?? []),
    SELECTED: stageCount(APPLICATION_GROUPS.SELECTED ?? []),
    OFFER_ACCEPTED: stageCount(APPLICATION_GROUPS.OFFER_ACCEPTED ?? []),
    PRE_ONBOARDING: stageCount(APPLICATION_GROUPS.PRE_ONBOARDING ?? []),
    JOINED: { THIS_MONTH: joinedThisMonth },
    ACTIVE: { PROBATION: statusCount('PROBATION'), ACTIVE: statusCount('ACTIVE') },
    PERFORMANCE_PAYROLL: { CONFIRMATIONS: confirmations, TRANSFERS: transfers, SALARY_REVISIONS: revisions, REVIEWS: reviews },
    RESIGNATION: { PENDING: resignationsPending },
    NOTICE: { SERVING_NOTICE: statusCount('NOTICE_PERIOD'), HANDOVER_OPEN: handoverOpen },
    CLEARANCE: { PENDING: clearancePending },
    SETTLEMENT: Object.fromEntries(['DRAFT', 'APPROVED'].map((s) => [s, settlements.find((x) => x.status === s)?._count._all ?? 0])),
    ARCHIVED: { SEPARATED: former, ARCHIVED: archived },
  };
  // Headline count per stage (the number on the pipeline card).
  const headline: Record<LifecycleStage, number> = {
    REQUISITION: reqPending + reqApprovedOpen,
    POSTING: sum(breakdowns.POSTING),
    APPLICATIONS: sum(breakdowns.APPLICATIONS),
    SCREENING: sum(breakdowns.SCREENING),
    INTERVIEW: sum(breakdowns.INTERVIEW),
    SELECTED: sum(breakdowns.SELECTED),
    OFFER_ACCEPTED: sum(breakdowns.OFFER_ACCEPTED),
    PRE_ONBOARDING: sum(breakdowns.PRE_ONBOARDING),
    JOINED: joinedThisMonth,
    ACTIVE: statusCount('PROBATION') + statusCount('ACTIVE'),
    PERFORMANCE_PAYROLL: sum(breakdowns.PERFORMANCE_PAYROLL),
    RESIGNATION: resignationsPending,
    NOTICE: statusCount('NOTICE_PERIOD'),
    CLEARANCE: clearancePending,
    SETTLEMENT: sum(breakdowns.SETTLEMENT),
    ARCHIVED: former,
  };
  return { stages: LIFECYCLE_STAGES.map((s) => ({ key: s.key, label: s.label, count: headline[s.key], breakdown: breakdowns[s.key] })) };
}

export interface StageItem {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  date: Date | null;
  refType: string;
  refId: string;
  employeeId?: string | null;
  link: string;
}

const LIST_LIMIT = 300;

/** Drill-down list for one pipeline stage. */
export async function stageItems(companyId: string, stage: LifecycleStage): Promise<{ stage: LifecycleStage; label: string; items: StageItem[] }> {
  const label = LIFECYCLE_STAGES.find((s) => s.key === stage)?.label ?? stage;
  const items = await loadStage(companyId, stage);
  return { stage, label, items };
}

async function loadStage(companyId: string, stage: LifecycleStage): Promise<StageItem[]> {
  const appStages = APPLICATION_GROUPS[stage];
  if (appStages) {
    const rows = await prisma.application.findMany({
      where: { companyId, stage: { in: appStages } },
      include: {
        candidate: { select: { name: true, code: true } },
        job: { select: { title: true, code: true } },
        posting: { select: { platform: true, platformName: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: LIST_LIMIT,
    });
    return rows.map((a) => ({
      id: a.id,
      title: a.candidate.name,
      subtitle: [a.job.title, a.job.code, a.code, platformName(a.posting) || a.source].filter(Boolean).join(' · '),
      status: a.stage,
      date: a.updatedAt,
      refType: 'Application',
      refId: a.id,
      link: '/recruitment',
    }));
  }
  switch (stage) {
    case 'REQUISITION': {
      const rows = await prisma.jobRequisition.findMany({
        where: { companyId, OR: [{ status: 'PENDING_APPROVAL' }, { status: 'APPROVED', job: { is: null } }] },
        orderBy: { createdAt: 'desc' },
        take: LIST_LIMIT,
      });
      return rows.map((r) => ({
        id: r.id, title: `${r.title} (${r.vacancies})`, subtitle: [r.code, r.department, r.priority].filter(Boolean).join(' · '),
        status: r.status === 'APPROVED' ? 'APPROVED_NOT_POSTED' : r.status, date: r.submittedAt ?? r.createdAt,
        refType: 'JobRequisition', refId: r.id, link: '/recruitment',
      }));
    }
    case 'POSTING': {
      const rows = await prisma.jobPosting.findMany({
        where: { companyId, status: { in: ['PUBLISHED', 'ACTIVE'] } },
        include: { job: { select: { title: true, code: true } }, _count: { select: { applications: true } } },
        orderBy: { postedOn: { sort: 'desc', nulls: 'last' } },
        take: LIST_LIMIT,
      });
      return rows.map((p) => ({
        id: p.id, title: `${p.job.title} on ${platformName(p)}`,
        subtitle: [p.job.code, `${p._count.applications} applications`, p.expiresOn ? `expires ${longDate(p.expiresOn)}` : ''].filter(Boolean).join(' · '),
        status: p.status, date: p.postedOn, refType: 'JobPosting', refId: p.id, link: '/recruitment',
      }));
    }
    case 'JOINED': {
      const rows = await prisma.employee.findMany({
        where: { companyId, joiningDate: { gte: monthStartUTC(), lte: new Date() } },
        select: { id: true, name: true, employeeCode: true, designation: true, department: true, joiningDate: true, employmentStatus: true, hireSource: true },
        orderBy: { joiningDate: 'desc' },
      });
      return rows.map((e) => employeeItem(e, e.joiningDate, [e.hireSource && `via ${sourceName(e.hireSource)}`]));
    }
    case 'ACTIVE':
    case 'NOTICE': {
      const rows = await prisma.employee.findMany({
        where: { companyId, isActive: true, employmentStatus: stage === 'NOTICE' ? 'NOTICE_PERIOD' : { in: ['PROBATION', 'ACTIVE'] } },
        select: {
          id: true, name: true, employeeCode: true, designation: true, department: true, joiningDate: true, employmentStatus: true,
          leavingDate: true, probationEndDate: true,
        },
        orderBy: stage === 'NOTICE' ? { leavingDate: 'asc' } : { name: 'asc' },
        take: stage === 'NOTICE' ? LIST_LIMIT : 1000,
      });
      return rows.map((e) =>
        stage === 'NOTICE'
          ? employeeItem(e, e.leavingDate, [e.leavingDate && `last day ${longDate(e.leavingDate)}`])
          : employeeItem(e, e.joiningDate, [e.employmentStatus === 'PROBATION' && e.probationEndDate && `probation till ${longDate(e.probationEndDate)}`])
      );
    }
    case 'PERFORMANCE_PAYROLL':
      return performanceItems(companyId);
    case 'RESIGNATION':
    case 'CLEARANCE': {
      const rows = await prisma.resignation.findMany({
        where: stage === 'RESIGNATION'
          ? { companyId, status: 'PENDING' }
          : { companyId, status: 'APPROVED', clearances: { some: { status: { not: 'CLEARED' } } } },
        include: {
          employee: { select: { id: true, name: true, employeeCode: true, designation: true } },
          clearances: { select: { department: true, status: true } },
        },
        orderBy: { appliedOn: 'desc' },
        take: LIST_LIMIT,
      });
      return rows.map((r) => ({
        id: r.id,
        title: `${r.employee.name} (${r.employee.employeeCode})`,
        subtitle: stage === 'RESIGNATION'
          ? [r.code, r.exitType, `requested last day ${longDate(r.requestedLastDay)}`].filter(Boolean).join(' · ')
          : `Pending: ${r.clearances.filter((c) => c.status !== 'CLEARED').map((c) => c.department).join(', ')}`,
        status: stage === 'RESIGNATION' ? r.status : 'CLEARANCE_PENDING',
        date: stage === 'RESIGNATION' ? r.appliedOn : (r.approvedLastDay ?? r.requestedLastDay),
        refType: 'Resignation', refId: r.id, employeeId: r.employeeId, link: '/exits',
      }));
    }
    case 'SETTLEMENT': {
      const rows = await prisma.finalSettlement.findMany({
        where: { companyId, status: { in: ['DRAFT', 'APPROVED'] } },
        include: { employee: { select: { name: true, employeeCode: true } } },
        orderBy: { lastWorkingDay: 'asc' },
        take: LIST_LIMIT,
      });
      return rows.map((f) => ({
        id: f.id, title: `${f.employee.name} (${f.employee.employeeCode})`,
        subtitle: [`Net ₹${f.netAmount.toLocaleString('en-IN')}`, `LWD ${longDate(f.lastWorkingDay)}`, f.dueDate ? `pay by ${longDate(f.dueDate)}` : ''].filter(Boolean).join(' · '),
        status: f.status, date: f.lastWorkingDay, refType: 'FinalSettlement', refId: f.id, employeeId: f.employeeId, link: '/exits',
      }));
    }
    case 'ARCHIVED': {
      const rows = await prisma.employee.findMany({
        where: { companyId, ...formerWhere },
        select: {
          id: true, name: true, employeeCode: true, designation: true, department: true, employmentStatus: true,
          separatedOn: true, leavingDate: true, separationReason: true, archivedAt: true, updatedAt: true,
        },
        orderBy: [{ separatedOn: { sort: 'desc', nulls: 'last' } }],
        take: LIST_LIMIT,
      });
      return rows.map((e) => ({
        ...employeeItem(e, e.separatedOn ?? e.leavingDate ?? e.updatedAt, [e.separationReason]),
        status: e.archivedAt ? 'ARCHIVED' : 'SEPARATED',
      }));
    }
    default:
      return [];
  }
}

function employeeItem(
  e: { id: string; name: string; employeeCode: string; designation: string; department: string; employmentStatus: string },
  date: Date | null,
  extra: (string | false | null | undefined | 0)[] = []
): StageItem {
  return {
    id: e.id,
    title: `${e.name} (${e.employeeCode})`,
    subtitle: [e.designation, e.department, ...extra].filter(Boolean).join(' · '),
    status: e.employmentStatus,
    date,
    refType: 'Employee',
    refId: e.id,
    employeeId: e.id,
    link: `/employees/${e.id}`,
  };
}

async function performanceItems(companyId: string): Promise<StageItem[]> {
  const emp = { select: { id: true, name: true, employeeCode: true } } as const;
  const [confirmations, transfers, revisions, reviews] = await Promise.all([
    prisma.confirmationRequest.findMany({ where: { companyId, status: 'PENDING' }, include: { employee: emp }, take: LIST_LIMIT }),
    prisma.transferRequest.findMany({ where: { companyId, status: { in: ['PENDING', 'APPROVED'] } }, include: { employee: emp }, take: LIST_LIMIT }),
    prisma.salaryRevision.findMany({ where: { companyId, status: { in: ['PENDING', 'APPROVED'] } }, include: { employee: emp }, take: LIST_LIMIT }),
    prisma.review.findMany({
      where: { companyId, status: 'PENDING', cycle: { status: { in: OPEN_REVIEW_CYCLES } } },
      include: { employee: emp, cycle: { select: { name: true, managerReviewDue: true, selfReviewDue: true } } },
      take: LIST_LIMIT,
    }),
  ]);
  const who = (e: { name: string; employeeCode: string }) => `${e.name} (${e.employeeCode})`;
  const items: StageItem[] = [
    ...confirmations.map((c) => ({
      id: c.id, title: who(c.employee), subtitle: `Probation review${c.recommendation ? ` — recommended ${c.recommendation}` : ''}`,
      status: c.recommendation ? 'AWAITING_APPROVAL' : 'AWAITING_RECOMMENDATION', date: c.dueDate,
      refType: 'ConfirmationRequest', refId: c.id, employeeId: c.employeeId, link: '/confirmations',
    })),
    ...transfers.map((t) => ({
      id: t.id, title: who(t.employee), subtitle: `${t.type.replace(/_/g, ' ').toLowerCase()} effective ${longDate(t.effectiveDate)}`,
      status: t.status, date: t.effectiveDate, refType: 'TransferRequest', refId: t.id, employeeId: t.employeeId, link: '/transfers',
    })),
    ...revisions.map((r) => ({
      id: r.id, title: who(r.employee), subtitle: `Salary revision effective ${longDate(r.effectiveFrom)}`,
      status: r.status, date: r.effectiveFrom, refType: 'SalaryRevision', refId: r.id, employeeId: r.employeeId, link: '/salary',
    })),
    ...reviews.map((r) => ({
      id: r.id, title: who(r.employee), subtitle: `${r.cycle.name} — ${r.type.toLowerCase()} review pending`,
      status: 'REVIEW_PENDING', date: (r.type === 'SELF' ? r.cycle.selfReviewDue : r.cycle.managerReviewDue) ?? null,
      refType: 'Review', refId: r.id, employeeId: r.employeeId, link: '/reviews',
    })),
  ];
  return items.sort((a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity));
}

const platformName = (p: { platform: string; platformName: string } | null | undefined): string =>
  !p ? '' : p.platform === 'OTHER' && p.platformName ? p.platformName : sourceName(p.platform);

/** "LinkedIn" / "Careers page" / "Referral" for a platform or hire-source code. */
function sourceName(code: string): string {
  const label = platformLabel({ platform: code === 'CAREERS' ? 'CAREERS_PAGE' : code, platformName: '' });
  return label === code ? titleCase(code) : label;
}

const titleCase = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// ---- Employee timeline ----

export interface TimelineItem {
  date: Date;
  /** One of the 16 lifecycle stage keys. */
  stage: LifecycleStage;
  title: string;
  detail: string;
  refType: string;
  refId: string;
}

/**
 * The full story of one employee, oldest first. Salary amounts and
 * recruitment notes / interview feedback are shown to ADMIN/HR (and the
 * employee for their own pay) only.
 */
export async function timeline(companyId: string, viewer: Actor, employeeId: string) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    select: {
      id: true, name: true, employeeCode: true, designation: true, department: true, joiningDate: true, managerId: true,
      employmentStatus: true, separatedOn: true, separationReason: true, leavingDate: true, archivedAt: true,
      rehireEligible: true, hireSource: true, sourceApplicationId: true, isActive: true, updatedAt: true, avatarColor: true,
    },
  });
  if (!employee) throw ApiError.notFound('Employee not found');
  const hr = isCompanyAdmin(viewer.role);
  const self = viewer.employeeId === employee.id;
  if (!hr && !self && viewer.employeeId !== employee.managerId) {
    throw ApiError.forbidden("You can only view your own or your direct reports' timeline");
  }
  const seesPay = hr || self;
  const items: TimelineItem[] = [];
  const push = (date: Date | null | undefined, stage: LifecycleStage, title: string, detail: string, refType: string, refId: string) => {
    if (date) items.push({ date, stage, title, detail, refType, refId });
  };

  // --- Recruitment (application this employee was hired through) ---
  const offerByEmployee = employee.sourceApplicationId
    ? null
    : await prisma.offer.findFirst({ where: { companyId, employeeId: employee.id }, select: { applicationId: true } });
  const applicationId = employee.sourceApplicationId ?? offerByEmployee?.applicationId ?? null;
  let hiredVia: string | null = null;
  if (applicationId) {
    const app = await prisma.application.findFirst({
      where: { id: applicationId, companyId },
      include: {
        candidate: { select: { id: true, code: true, source: true, createdAt: true } },
        job: { include: { requisition: true } },
        posting: true,
        stageHistory: { orderBy: { createdAt: 'asc' } },
        interviews: { orderBy: { scheduledAt: 'asc' } },
        offer: true,
        preOnboarding: { include: { documents: { select: { status: true } } } },
      },
    });
    if (app) {
      const req = app.job.requisition;
      if (req) {
        push(req.createdAt, 'REQUISITION', `Job requisition ${req.code} raised`, `${req.title} — ${req.vacancies} position(s), ${titleCase(req.reason)}`, 'JobRequisition', req.id);
        push(req.approvedAt, 'REQUISITION', `Requisition ${req.code} approved`, req.department, 'JobRequisition', req.id);
      }
      push(app.job.createdAt, 'POSTING', `Job opened: ${app.job.title}`, app.job.code ?? '', 'JobOpening', app.job.id);
      if (app.posting) {
        push(app.posting.postedOn ?? app.posting.createdAt, 'POSTING', `Posted on ${platformName(app.posting)}`,
          [app.posting.externalId && `Ref ${app.posting.externalId}`, app.posting.url].filter(Boolean).join(' · '), 'JobPosting', app.posting.id);
      }
      push(app.appliedOn, 'APPLICATIONS', `Applied for ${app.job.title}`,
        [app.code, app.candidate.code, app.source || app.candidate.source].filter(Boolean).join(' · '), 'Application', app.id);
      for (const h of app.stageHistory) {
        if (h.toStage === 'APPLIED') continue;
        push(h.createdAt, stageForApplication(h.toStage), `Candidate status: ${titleCase(h.toStage)}`, hr ? h.note : '', 'Application', app.id);
      }
      for (const iv of app.interviews) {
        const outcome = iv.status === 'COMPLETED' ? (hr && iv.recommendation ? ` — ${titleCase(iv.recommendation)}` : '') : '';
        push(iv.scheduledAt, 'INTERVIEW', `Interview: ${iv.round} (${titleCase(iv.interviewType)})`,
          `${titleCase(iv.status)}${outcome}${hr && iv.rating ? ` · rating ${iv.rating}/5` : ''}`, 'Interview', iv.id);
      }
      const offer = app.offer;
      if (offer) {
        const revisions = Array.isArray(offer.revisions) ? (offer.revisions as { changedAt?: string; ctcAnnual?: number; note?: string }[]) : [];
        push(offer.createdAt, 'SELECTED', `Offer ${offer.code ?? ''} created`.trim(),
          `${offer.designation}${seesPay ? ` · CTC ₹${offer.ctcAnnual.toLocaleString('en-IN')}` : ''} · joining ${longDate(offer.joiningDate)}`, 'Offer', offer.id);
        for (const r of revisions) {
          if (!r.changedAt) continue;
          push(new Date(r.changedAt), 'SELECTED', 'Offer revised',
            [seesPay && r.ctcAnnual ? `previous CTC ₹${r.ctcAnnual.toLocaleString('en-IN')}` : '', r.note].filter(Boolean).join(' · '), 'Offer', offer.id);
        }
        push(offer.sentAt, 'SELECTED', 'Offer sent', '', 'Offer', offer.id);
        if (offer.status === 'ACCEPTED' || offer.employeeId) {
          push(offer.respondedAt ?? offer.sentAt, 'OFFER_ACCEPTED', 'Offer accepted', offer.acceptedVia ? titleCase(offer.acceptedVia) : '', 'Offer', offer.id);
        }
      }
      const pre = app.preOnboarding;
      if (pre) {
        const verified = pre.documents.filter((d) => d.status === 'VERIFIED').length;
        push(pre.createdAt, 'PRE_ONBOARDING', 'Pre-onboarding started', `Expected joining ${longDate(pre.expectedJoiningDate)}`, 'PreOnboarding', pre.id);
        push(pre.bgvCompletedAt, 'PRE_ONBOARDING', 'Background verification completed', titleCase(pre.bgvStatus), 'PreOnboarding', pre.id);
        if (pre.documents.length) {
          push(pre.updatedAt, 'PRE_ONBOARDING', `Pre-joining documents: ${verified}/${pre.documents.length} verified`, titleCase(pre.status), 'PreOnboarding', pre.id);
        }
      }
      const where = app.posting ? platformName(app.posting) : sourceName(app.source || app.candidate.source || employee.hireSource || 'DIRECT');
      hiredVia = `Hired via ${where}${app.posting?.externalId ? ` (posting ${app.posting.externalId}` : app.posting ? ' (posting' : ''}${
        app.posting ? `, Job ID ${app.job.code ?? app.job.title})` : app.job.code ? ` — Job ID ${app.job.code}` : ''}${app.code ? `, application ${app.code}` : ''}`;
    }
  }
  if (!hiredVia && employee.hireSource) hiredVia = `Hired via ${sourceName(employee.hireSource)}`;

  // --- Career history (JOINED, CONFIRMED, promotions, transfers, status changes, salary) ---
  const history = await prisma.employeeHistory.findMany({ where: { companyId, employeeId }, orderBy: { effectiveDate: 'asc' } });
  const historyRefs = new Set(history.map((h) => h.refId).filter(Boolean));
  for (const h of history) {
    const hidePay = h.type === 'SALARY_REVISION' && !seesPay;
    push(h.effectiveDate, stageForHistory(h.type), hidePay ? 'Salary revised' : h.title, h.reason, h.refType ?? 'EmployeeHistory', h.refId ?? h.id);
  }
  if (!history.some((h) => h.type === 'JOINED')) {
    push(employee.joiningDate, 'JOINED', `Joined${employee.designation ? ` as ${employee.designation}` : ''}`, employee.department, 'Employee', employee.id);
  }

  const [onboarding, confirmations, transfers, outcomes, revisions, resignations, letters] = await Promise.all([
    prisma.onboardingCase.findMany({ where: { companyId, employeeId }, select: { id: true, status: true, startedOn: true, completedOn: true } }),
    prisma.confirmationRequest.findMany({ where: { companyId, employeeId } }),
    prisma.transferRequest.findMany({ where: { companyId, employeeId } }),
    prisma.reviewOutcome.findMany({ where: { companyId, employeeId }, include: { cycle: { select: { name: true, periodEnd: true } } } }),
    prisma.salaryRevision.findMany({ where: { companyId, employeeId, status: 'APPLIED' } }),
    prisma.resignation.findMany({
      where: { companyId, employeeId },
      include: { handoverTasks: { select: { status: true } }, clearances: true, settlement: true, interview: { select: { submittedAt: true } } },
      orderBy: { appliedOn: 'asc' },
    }),
    prisma.generatedLetter.findMany({ where: { companyId, employeeId }, select: { id: true, title: true, type: true, createdAt: true } }),
  ]);
  for (const o of onboarding) {
    push(o.startedOn, 'JOINED', 'Onboarding started', '', 'OnboardingCase', o.id);
    push(o.completedOn, 'ACTIVE', 'Onboarding completed', '', 'OnboardingCase', o.id);
  }
  for (const c of confirmations) {
    push(c.createdAt, 'PERFORMANCE_PAYROLL', 'Probation review raised', `Due ${longDate(c.dueDate)}`, 'ConfirmationRequest', c.id);
    if (c.status !== 'PENDING' && !historyRefs.has(c.id)) {
      push(c.decidedAt, 'PERFORMANCE_PAYROLL', `Probation review ${c.status.toLowerCase()}`, c.recommendation ? `Recommendation: ${titleCase(c.recommendation)}` : '', 'ConfirmationRequest', c.id);
    }
  }
  for (const t of transfers) {
    push(t.createdAt, 'PERFORMANCE_PAYROLL', `${titleCase(t.type)} requested`, `Effective ${longDate(t.effectiveDate)} · ${t.reason}`, 'TransferRequest', t.id);
    if (['REJECTED', 'CANCELLED'].includes(t.status)) {
      push(t.createdAt, 'PERFORMANCE_PAYROLL', `${titleCase(t.type)} ${t.status.toLowerCase()}`, t.remarks ?? '', 'TransferRequest', t.id);
    }
  }
  for (const o of outcomes) {
    const bits = [
      o.finalRating !== null ? `rating ${o.normalizedRating ?? o.finalRating}` : '',
      seesPay && o.incrementPercent ? `${o.incrementPercent}% increment` : '',
      o.promotion ? `promotion${o.newDesignation ? ` to ${o.newDesignation}` : ''}` : '',
    ].filter(Boolean);
    push(o.cycle.periodEnd, 'PERFORMANCE_PAYROLL', `Performance review: ${o.cycle.name}`, `${titleCase(o.status)}${bits.length ? ` — ${bits.join(', ')}` : ''}`, 'ReviewOutcome', o.id);
  }
  for (const r of revisions) {
    if (historyRefs.has(r.id)) continue; // already in the career history
    push(r.effectiveFrom, 'PERFORMANCE_PAYROLL', seesPay ? `Salary revised: CTC ₹${r.ctcAnnual.toLocaleString('en-IN')}` : 'Salary revised', r.reason, 'SalaryRevision', r.id);
  }
  let left: string | null = null;
  for (const r of resignations) {
    const exitLabel = titleCase(r.exitType);
    push(r.appliedOn, 'RESIGNATION', `${exitLabel}${r.code ? ` ${r.code}` : ''} submitted`, hr || self ? r.reason : '', 'Resignation', r.id);
    push(r.acknowledgedAt, 'RESIGNATION', `${exitLabel} acknowledged`, '', 'Resignation', r.id);
    if (['REJECTED', 'WITHDRAWN'].includes(r.status)) push(r.acknowledgedAt ?? r.appliedOn, 'RESIGNATION', `${exitLabel} ${r.status.toLowerCase()}`, r.remarks ?? '', 'Resignation', r.id);
    if (r.status === 'APPROVED' || r.status === 'COMPLETED') {
      const lwd = r.approvedLastDay ?? r.requestedLastDay;
      if (!historyRefs.has(r.id)) push(r.appliedOn, 'NOTICE', 'Notice period started', `Last working day ${longDate(lwd)}`, 'Resignation', r.id);
      if (r.handoverTasks.length) {
        const done = r.handoverTasks.filter((t) => t.status !== 'PENDING').length;
        push(lwd, 'NOTICE', `Handover: ${done}/${r.handoverTasks.length} tasks done`, '', 'Resignation', r.id);
      }
      push(r.interview?.submittedAt ?? r.exitInterviewAt, 'NOTICE', 'Exit interview', '', 'Resignation', r.id);
      for (const c of r.clearances) {
        push(c.clearedAt, 'CLEARANCE', `${titleCase(c.department)} clearance ${c.status === 'CLEARED' ? 'cleared' : titleCase(c.status).toLowerCase()}`,
          seesPay && c.dues ? `Dues ₹${c.dues.toLocaleString('en-IN')}` : c.remarks, 'ExitClearance', c.id);
      }
      const fnf = r.settlement;
      if (fnf) {
        const amt = seesPay ? ` · net ₹${fnf.netAmount.toLocaleString('en-IN')}` : '';
        push(fnf.createdAt, 'SETTLEMENT', 'Full & final settlement prepared', `${titleCase(fnf.status)}${amt}`, 'FinalSettlement', fnf.id);
        push(fnf.approvedAt, 'SETTLEMENT', 'Full & final settlement approved', '', 'FinalSettlement', fnf.id);
        push(fnf.paidOn, 'SETTLEMENT', 'Full & final settlement paid', seesPay ? [fnf.paymentMode, fnf.paymentReference].filter(Boolean).join(' · ') : '', 'FinalSettlement', fnf.id);
      }
      push(r.closedAt, 'ARCHIVED', 'Exit case closed', '', 'Resignation', r.id);
      if (!left) left = r.reason;
    }
  }
  for (const l of letters) push(l.createdAt, stageForLetter(l.type), `Letter issued: ${l.title}`, titleCase(l.type), 'GeneratedLetter', l.id);
  push(employee.archivedAt, 'ARCHIVED', 'Profile archived', 'Kept read-only for the retention period', 'Employee', employee.id);

  const order = new Map(LIFECYCLE_STAGES.map((s, i) => [s.key, i]));
  // Day first: many dates are date-only (midnight UTC: joining, effective dates, postings), so within one
  // day the lifecycle stage decides the order, then the time.
  const day = (d: Date) => Math.floor(d.getTime() / 86_400_000);
  items.sort((a, b) => day(a.date) - day(b.date) || (order.get(a.stage) ?? 0) - (order.get(b.stage) ?? 0) || a.date.getTime() - b.date.getTime());

  const separated = employee.employmentStatus === 'SEPARATED' || !employee.isActive;
  const leftOn = employee.separatedOn ?? employee.leavingDate ?? (separated ? employee.updatedAt : null);
  const reason = employee.separationReason || left;
  const leftSummary = separated && leftOn ? `Left on ${longDate(leftOn)}${reason && (hr || self) ? ` because ${reason}` : ''}` : null;
  return {
    employee: {
      id: employee.id, name: employee.name, employeeCode: employee.employeeCode, designation: employee.designation,
      department: employee.department, avatarColor: employee.avatarColor, joiningDate: employee.joiningDate,
      employmentStatus: employee.employmentStatus, separatedOn: employee.separatedOn, archivedAt: employee.archivedAt,
      hireSource: employee.hireSource, ...(hr ? { rehireEligible: employee.rehireEligible } : {}),
    },
    summary: { hiredVia, left: leftSummary, currentStage: currentStage(employee.employmentStatus, separated, employee.archivedAt) },
    items,
  };
}

function currentStage(status: string, separated: boolean, archivedAt: Date | null): LifecycleStage {
  if (archivedAt) return 'ARCHIVED';
  if (separated) return 'SETTLEMENT';
  return status === 'NOTICE_PERIOD' ? 'NOTICE' : 'ACTIVE';
}

function stageForApplication(stage: string): LifecycleStage {
  for (const [key, stages] of Object.entries(APPLICATION_GROUPS)) if (stages?.includes(stage)) return key as LifecycleStage;
  if (stage === 'JOINED') return 'JOINED';
  return 'SCREENING'; // REJECTED / WITHDRAWN / OFFER_DECLINED etc.
}

function stageForHistory(type: string): LifecycleStage {
  switch (type) {
    case 'JOINED':
    case 'REHIRED':
      return 'JOINED';
    case 'CONFIRMED':
    case 'STATUS_CHANGE':
      return 'ACTIVE';
    case 'RESIGNED':
      return 'RESIGNATION';
    case 'NOTICE_PERIOD':
      return 'NOTICE';
    case 'SEPARATED':
      return 'ARCHIVED';
    default:
      return 'PERFORMANCE_PAYROLL';
  }
}

function stageForLetter(type: string): LifecycleStage {
  const t = type.toUpperCase();
  if (t.includes('OFFER')) return 'SELECTED';
  if (t.includes('APPOINT') || t.includes('JOIN')) return 'JOINED';
  if (t.includes('RELIEV') || t.includes('EXPERIENCE') || t.includes('SERVICE')) return 'SETTLEMENT';
  if (t.includes('RESIGN') || t.includes('ACCEPT') || t.includes('TERMIN')) return 'RESIGNATION';
  return 'PERFORMANCE_PAYROLL';
}
