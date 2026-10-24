/**
 * Unified approvals inbox: the engine's pending steps (approval.service)
 * enriched with a readable summary of each underlying request, plus the
 * endpoint that decides it. Deciding stays in each module's own decide
 * endpoint so module side effects (balances, payroll inputs, ...) run there.
 */
import type { ApprovalStep, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/http';
import * as approvalService from './approval.service';
import type { Actor, ApprovalModule, FlowStep } from './approval.service';

/** Module → decide endpoint (POST, body `{ decision, remarks? }`). */
export const DECIDE_PATHS: Record<ApprovalModule, (id: string) => string> = {
  LEAVE: (id) => `/leaves/${id}/decide`,
  EXPENSE: (id) => `/expenses/${id}/decide`,
  REGULARIZATION: (id) => `/attendance/regularizations/${id}/decide`,
  OVERTIME: (id) => `/overtime/${id}/decide`,
  COMP_OFF: (id) => `/leaves/comp-off/${id}/decide`,
  ENCASHMENT: (id) => `/leaves/encashments/${id}/decide`,
  LOAN: (id) => `/loans/${id}/decide`,
  RESIGNATION: (id) => `/exits/${id}/decide`,
  TRAVEL: (id) => `/travel/${id}/decide`,
  TIMESHEET: (id) => `/timesheets/${id}/decide`,
  CONFIRMATION: (id) => `/confirmations/${id}/decide`,
  SALARY_REVISION: (id) => `/salary/revisions/${id}/decide`,
  REQUISITION: (id) => `/recruitment/requisitions/${id}/decide`,
  OFFER: (id) => `/recruitment/offers/${id}/decide`,
  TRANSFER: (id) => `/transfers/${id}/decide`,
};

export const MODULE_LABELS: Record<ApprovalModule, string> = {
  LEAVE: 'Leave',
  EXPENSE: 'Expense',
  REGULARIZATION: 'Attendance regularization',
  OVERTIME: 'Overtime',
  COMP_OFF: 'Comp-off',
  ENCASHMENT: 'Leave encashment',
  LOAN: 'Loan / advance',
  RESIGNATION: 'Resignation',
  TRAVEL: 'Travel',
  TIMESHEET: 'Timesheet',
  CONFIRMATION: 'Probation confirmation',
  SALARY_REVISION: 'Salary revision',
  REQUISITION: 'Hiring requisition',
  OFFER: 'Offer approval',
  TRANSFER: 'Transfer / promotion',
};

export interface RequestSummary {
  requesterId: string;
  /** Status in the module's own table — used to drop stale steps. */
  status: string;
  title: string;
  description: string;
  amount: number | null;
  fromDate: Date | null;
  toDate: Date | null;
  submittedAt: Date | null;
  /** A file is attached (expense receipt) — fetch it via the module's own endpoint. */
  hasAttachment?: boolean;
}

const PENDING_STATUSES = new Set(['PENDING', 'SUBMITTED', 'PENDING_APPROVAL']);
const fmt = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Batch-loads summaries for one module's request ids. */
async function summaries(companyId: string, module: ApprovalModule, ids: string[]): Promise<Map<string, RequestSummary>> {
  const out = new Map<string, RequestSummary>();
  if (ids.length === 0) return out;
  const where = { companyId, id: { in: ids } };
  switch (module) {
    case 'LEAVE': {
      const rows = await prisma.leaveRequest.findMany({ where, include: { leaveType: { select: { name: true } } } });
      for (const r of rows) out.set(r.id, {
        requesterId: r.employeeId, status: r.status,
        title: `${r.leaveType.name} · ${plural(r.days, 'day')}${r.halfDay ? ' (half day)' : ''}`,
        description: r.reason, amount: null, fromDate: r.fromDate, toDate: r.toDate, submittedAt: r.appliedOn,
      });
      break;
    }
    case 'EXPENSE': {
      const rows = await prisma.expenseClaim.findMany({ where });
      for (const r of rows) out.set(r.id, {
        requesterId: r.employeeId, status: r.status, title: `${r.category} · ${fmt(r.amount)}`,
        description: r.description, amount: r.amount, fromDate: r.date, toDate: null, submittedAt: r.createdAt,
        hasAttachment: !!r.receiptKey,
      });
      break;
    }
    case 'REGULARIZATION': {
      const rows = await prisma.regularizationRequest.findMany({ where });
      for (const r of rows) out.set(r.id, {
        requesterId: r.employeeId, status: r.status, title: `Attendance correction · ${r.reason}`,
        description: r.note ?? r.reason, amount: null, fromDate: r.date, toDate: null, submittedAt: r.appliedOn,
      });
      break;
    }
    case 'OVERTIME': {
      const rows = await prisma.overtimeRequest.findMany({ where });
      for (const r of rows) out.set(r.id, {
        requesterId: r.employeeId, status: r.status,
        title: `Overtime · ${Math.floor(r.minutes / 60)}h ${String(r.minutes % 60).padStart(2, '0')}m`,
        description: r.reason, amount: null, fromDate: r.date, toDate: null, submittedAt: r.appliedOn,
      });
      break;
    }
    case 'COMP_OFF': {
      const rows = await prisma.compOffRequest.findMany({ where });
      for (const r of rows) out.set(r.id, {
        requesterId: r.employeeId, status: r.status, title: `Comp-off credit · ${plural(r.days, 'day')}`,
        description: r.reason, amount: null, fromDate: r.workDate, toDate: null, submittedAt: r.appliedOn,
      });
      break;
    }
    case 'ENCASHMENT': {
      const rows = await prisma.leaveEncashment.findMany({ where, include: { leaveType: { select: { name: true } } } });
      for (const r of rows) out.set(r.id, {
        requesterId: r.employeeId, status: r.status, title: `Encash ${plural(r.days, 'day')} of ${r.leaveType.name}`,
        description: r.amount > 0 ? `Estimated ${fmt(r.amount)}` : '', amount: r.amount || null,
        fromDate: null, toDate: null, submittedAt: r.appliedOn,
      });
      break;
    }
    case 'LOAN': {
      const rows = await prisma.loan.findMany({ where });
      for (const r of rows) out.set(r.id, {
        requesterId: r.employeeId, status: r.status,
        title: `${r.type === 'SALARY_ADVANCE' ? 'Salary advance' : 'Loan'} · ${fmt(r.principal)}`,
        description: `${r.reason} — ${plural(r.tenureMonths, 'month')} @ ${r.interestRate}% · EMI ${fmt(r.emi)}`,
        amount: r.principal, fromDate: r.startMonth, toDate: null, submittedAt: r.appliedOn,
      });
      break;
    }
    case 'RESIGNATION': {
      const rows = await prisma.resignation.findMany({ where });
      for (const r of rows) out.set(r.id, {
        requesterId: r.employeeId, status: r.status,
        title: `${r.exitType.charAt(0)}${r.exitType.slice(1).toLowerCase().replace(/_/g, ' ')} · notice ${plural(r.noticePeriodDays, 'day')}`,
        description: r.reason, amount: null, fromDate: r.appliedOn, toDate: r.requestedLastDay, submittedAt: r.appliedOn,
      });
      break;
    }
    case 'TRAVEL': {
      const rows = await prisma.travelRequest.findMany({ where });
      for (const r of rows) out.set(r.id, {
        requesterId: r.employeeId, status: r.status, title: `${r.fromCity} → ${r.toCity} · ${r.mode.toLowerCase()}`,
        description: `${r.purpose} — est. ${fmt(r.estimatedCost)}${r.advanceAmount > 0 ? `, advance ${fmt(r.advanceAmount)}` : ''}`,
        amount: r.estimatedCost, fromDate: r.departDate, toDate: r.returnDate, submittedAt: r.appliedOn,
      });
      break;
    }
    case 'TIMESHEET': {
      const rows = await prisma.timesheetWeek.findMany({ where });
      for (const r of rows) out.set(r.id, {
        requesterId: r.employeeId, status: r.status, title: `Timesheet · ${r.totalHours} h`,
        description: `Week of ${r.weekStart.toISOString().slice(0, 10)}`, amount: null,
        fromDate: r.weekStart, toDate: new Date(r.weekStart.getTime() + 6 * 86400000), submittedAt: r.submittedAt,
      });
      break;
    }
    case 'CONFIRMATION': {
      const rows = await prisma.confirmationRequest.findMany({ where });
      for (const r of rows) out.set(r.id, {
        requesterId: r.employeeId, status: r.status,
        title: `Probation review${r.recommendation ? ` · ${r.recommendation.toLowerCase()}` : ''}${r.extendByDays ? ` by ${plural(r.extendByDays, 'day')}` : ''}`,
        description: r.comments, amount: null, fromDate: r.dueDate, toDate: null, submittedAt: r.createdAt,
      });
      break;
    }
    case 'SALARY_REVISION': {
      const rows = await prisma.salaryRevision.findMany({ where });
      for (const r of rows) out.set(r.id, {
        requesterId: r.employeeId, status: r.status, title: `Salary revision · CTC ${fmt(r.ctcAnnual)} / yr`,
        description: r.reason, amount: r.ctcAnnual, fromDate: r.effectiveFrom, toDate: null, submittedAt: r.createdAt,
      });
      break;
    }
    case 'REQUISITION': {
      const rows = await prisma.jobRequisition.findMany({ where });
      for (const r of rows) out.set(r.id, {
        requesterId: r.requestedById, status: r.status,
        title: `${r.code} · ${plural(r.vacancies, 'vacancy').replace('vacancys', 'vacancies')} · ${r.title}`,
        description: [r.department, r.location, r.justification].filter(Boolean).join(' · '),
        amount: r.budgetMaxCtc || null, fromDate: r.targetDate, toDate: null, submittedAt: r.submittedAt ?? r.createdAt,
      });
      break;
    }
    case 'OFFER': {
      const rows = await prisma.offer.findMany({
        where,
        include: { application: { select: { candidate: { select: { name: true } }, job: { select: { title: true } } } } },
      });
      for (const r of rows) out.set(r.id, {
        // Offers are raised by HR on a candidate's behalf; the requester shown is the HR user from the step.
        requesterId: '', status: r.status,
        title: `${r.code ?? 'Offer'} · ${r.application.candidate.name} · ${r.designation}`,
        description: `${r.application.job.title}${r.workLocation ? ` · ${r.workLocation}` : ''}`,
        amount: r.ctcAnnual, fromDate: r.joiningDate, toDate: null, submittedAt: r.createdAt,
      });
      break;
    }
    case 'TRANSFER': {
      const rows = await prisma.transferRequest.findMany({ where });
      for (const r of rows) out.set(r.id, {
        requesterId: r.employeeId, status: r.status,
        title: `${r.type.charAt(0)}${r.type.slice(1).toLowerCase().replace(/_/g, ' ')}${r.incrementPercent ? ` · +${r.incrementPercent}%` : ''}`,
        description: r.reason, amount: null, fromDate: r.effectiveDate, toDate: null, submittedAt: r.createdAt,
      });
      break;
    }
  }
  return out;
}

const isCompanyAdmin = (role: Role) => role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR';

/**
 * The actor's inbox. ADMIN / HR may pass `all` to see every request waiting
 * at any level in the company (they can override any step).
 */
export async function inbox(companyId: string, actor: Actor, opts: { module?: ApprovalModule; all?: boolean } = {}) {
  let steps: ApprovalStep[];
  if (opts.all && isCompanyAdmin(actor.role)) {
    const pending = await prisma.approvalStep.findMany({
      where: { companyId, status: 'PENDING', ...(opts.module ? { module: opts.module } : {}) },
      orderBy: [{ requestId: 'asc' }, { level: 'asc' }],
    });
    const current = new Map<string, ApprovalStep>();
    for (const s of pending) if (!current.has(`${s.module}:${s.requestId}`)) current.set(`${s.module}:${s.requestId}`, s);
    steps = [...current.values()].filter((s) => s.requesterId !== actor.employeeId);
  } else {
    steps = await approvalService.pendingFor(companyId, actor, opts.module);
  }
  if (steps.length === 0) return [];

  const byModule = new Map<ApprovalModule, string[]>();
  for (const s of steps) {
    const m = s.module as ApprovalModule;
    if (!DECIDE_PATHS[m]) continue;
    byModule.set(m, [...(byModule.get(m) ?? []), s.requestId]);
  }
  const loaded = new Map<string, RequestSummary>();
  await Promise.all(
    [...byModule.entries()].map(async ([module, ids]) => {
      for (const [id, summary] of await summaries(companyId, module, ids)) loaded.set(`${module}:${id}`, summary);
    })
  );

  const requestIds = [...new Set(steps.map((s) => s.requestId))];
  const [levels, people] = await Promise.all([
    prisma.approvalStep.groupBy({
      by: ['module', 'requestId'],
      where: { companyId, requestId: { in: requestIds } },
      _max: { level: true },
    }),
    prisma.employee.findMany({
      where: { companyId, id: { in: [...new Set(steps.map((s) => s.requesterId))] } },
      select: { id: true, name: true, employeeCode: true, designation: true, department: true, avatarColor: true, managerId: true },
    }),
  ]);

  return steps
    .map((s) => {
      const module = s.module as ApprovalModule;
      const summary = loaded.get(`${module}:${s.requestId}`);
      // Request deleted, cancelled or decided outside the engine: not actionable.
      if (!summary || !PENDING_STATUSES.has(summary.status)) return null;
      return {
        stepId: s.id,
        module,
        moduleLabel: MODULE_LABELS[module],
        requestId: s.requestId,
        level: s.level,
        totalLevels: levels.find((l) => l.module === s.module && l.requestId === s.requestId)?._max.level ?? s.level,
        approverType: s.approverType,
        approverRole: s.approverRole,
        approverEmployeeId: s.approverEmployeeId,
        canAct: approvalService.canAct(s, actor),
        waitingSince: s.createdAt,
        requester: people.find((p) => p.id === s.requesterId) ?? null,
        summary,
        decidePath: DECIDE_PATHS[module](s.requestId),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.waitingSince.getTime() - b.waitingSince.getTime());
}

/** Inbox counts per module (badge numbers). */
export async function inboxCounts(companyId: string, actor: Actor) {
  const items = await inbox(companyId, actor);
  const counts: Record<string, number> = {};
  for (const i of items) counts[i.module] = (counts[i.module] ?? 0) + 1;
  return { total: items.length, byModule: counts };
}

/**
 * Timeline of a request. Visible to the requester, anyone named in the chain,
 * holders of a ROLE step's role, and company admins.
 */
export async function trailFor(companyId: string, module: ApprovalModule, requestId: string, actor: Actor) {
  const steps = await approvalService.trail(companyId, module, requestId);
  if (!isCompanyAdmin(actor.role)) {
    const involved = steps.some(
      (s) =>
        (actor.employeeId && (s.requesterId === actor.employeeId || s.approverEmployeeId === actor.employeeId || s.actedById === actor.employeeId)) ||
        (s.approverRole && s.approverRole === actor.role)
    );
    if (steps.length > 0 && !involved) {
      // Managers may follow their direct reports' requests.
      const requester = await prisma.employee.findFirst({ where: { id: steps[0]!.requesterId, companyId }, select: { managerId: true } });
      if (!actor.employeeId || requester?.managerId !== actor.employeeId) throw ApiError.forbidden();
    }
  }
  return steps;
}

/** Flows with names resolved for EMPLOYEE steps (for the flow builder UI). */
export async function flowsWithNames(companyId: string) {
  const flows = await approvalService.listFlows(companyId);
  const ids = [...new Set(flows.flatMap((f) => f.steps.map((s) => s.employeeId)).filter((x): x is string => !!x))];
  const people = ids.length
    ? await prisma.employee.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, name: true, isActive: true } })
    : [];
  return flows.map((f) => ({
    ...f,
    label: MODULE_LABELS[f.module],
    steps: f.steps.map((s) => ({
      ...s,
      employeeName: s.employeeId ? (people.find((p) => p.id === s.employeeId)?.name ?? null) : null,
      employeeInactive: s.employeeId ? !people.find((p) => p.id === s.employeeId)?.isActive : false,
    })),
  }));
}

/** Validates named approvers belong to the tenant, then saves the flow. */
export async function saveFlowChecked(companyId: string, module: ApprovalModule, steps: FlowStep[]) {
  const ids = steps.map((s) => s.employeeId).filter((x): x is string => !!x);
  if (ids.length) {
    const found = await prisma.employee.count({ where: { companyId, isActive: true, id: { in: ids } } });
    if (found !== new Set(ids).size) throw ApiError.badRequest('Every named approver must be an active employee of this company');
  }
  const clean = steps.map((s) =>
    s.type === 'ROLE' ? { type: s.type, role: s.role } : s.type === 'EMPLOYEE' ? { type: s.type, employeeId: s.employeeId } : { type: s.type }
  ) as FlowStep[];
  return approvalService.saveFlow(companyId, module, clean);
}
