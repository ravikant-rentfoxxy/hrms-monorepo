/**
 * Probation confirmation: a request is raised 15 days before the probation
 * end date (daily job, or HR manually) → the manager recommends CONFIRM /
 * EXTEND / TERMINATE → approval module CONFIRMATION (requester = the
 * employee being confirmed) → the outcome is applied on final approval.
 */
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';
import { addDays, employeeIdsWithRoles, isCompanyAdmin, longDate, todayUTC } from '../utils/lifecycle';
import * as approvalService from './approval.service';
import { tryGenerateLetter } from './letter.service';
import { onExitApproved } from './exit.service';
import { recordHistory, setEmploymentStatus } from './employee-history.service';

/** Days before the probation end date that the request is raised. */
export const LEAD_DAYS = 15;

export type Recommendation = 'CONFIRM' | 'EXTEND' | 'TERMINATE';

export interface Actor {
  role: Role;
  employeeId: string | null;
}

const employeeSelect = {
  id: true, name: true, employeeCode: true, designation: true, department: true, joiningDate: true,
  probationEndDate: true, confirmedOn: true, managerId: true, avatarColor: true,
  manager: { select: { id: true, name: true } },
} satisfies Prisma.EmployeeSelect;

export async function list(companyId: string, viewer: Actor, filter: { status?: string }) {
  const where: Prisma.ConfirmationRequestWhereInput = { companyId, ...(filter.status ? { status: filter.status } : {}) };
  if (!isCompanyAdmin(viewer.role)) {
    if (!viewer.employeeId) throw ApiError.forbidden();
    where.employee = { managerId: viewer.employeeId };
  }
  const rows = await prisma.confirmationRequest.findMany({
    where,
    include: { employee: { select: employeeSelect } },
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    take: 300,
  });
  // Current approval step, so the UI knows whether the viewer can decide.
  const steps = await prisma.approvalStep.findMany({
    where: { companyId, module: 'CONFIRMATION', requestId: { in: rows.map((r) => r.id) }, status: 'PENDING' },
    orderBy: { level: 'asc' },
  });
  return rows.map((r) => {
    const step = steps.find((s) => s.requestId === r.id) ?? null;
    return {
      ...r,
      awaiting: !r.recommendation ? 'RECOMMENDATION' : step ? 'APPROVAL' : null,
      canDecide: !!step && approvalService.canAct(step, viewer),
    };
  });
}

export async function detail(companyId: string, id: string, viewer: Actor) {
  const r = await prisma.confirmationRequest.findFirst({ where: { id, companyId }, include: { employee: { select: employeeSelect } } });
  if (!r) throw ApiError.notFound('Confirmation request not found');
  if (!isCompanyAdmin(viewer.role) && r.employee.managerId !== viewer.employeeId) throw ApiError.forbidden();
  return { ...r, trail: await approvalService.trail(companyId, 'CONFIRMATION', r.id) };
}

/** Raises a request (idempotent per employee: one PENDING at a time). */
export async function createRequest(companyId: string, employeeId: string, dueDate?: Date) {
  const e = await prisma.employee.findFirst({ where: { id: employeeId, companyId, isActive: true }, select: employeeSelect });
  if (!e) throw ApiError.notFound('Active employee not found');
  if (e.confirmedOn) throw ApiError.badRequest(`${e.name} was already confirmed on ${longDate(e.confirmedOn)}`);
  const pending = await prisma.confirmationRequest.findFirst({ where: { companyId, employeeId, status: 'PENDING' } });
  if (pending) throw ApiError.conflict('A confirmation request is already open for this employee');
  const created = await prisma.confirmationRequest.create({
    data: { companyId, employeeId, dueDate: dueDate ?? e.probationEndDate ?? todayUTC() },
  });
  await notify(companyId, [e.managerId ?? null, ...(e.managerId ? [] : await employeeIdsWithRoles(companyId))], {
    event: 'confirmation.due',
    title: `Probation review due for ${e.name}`,
    body: `Probation ends ${e.probationEndDate ? longDate(e.probationEndDate) : 'soon'} — please submit your recommendation.`,
    link: '/confirmations',
  });
  return created;
}

/**
 * Manager's recommendation. Starts the CONFIRMATION approval chain; when the
 * first level is the recommending manager themself, their recommendation
 * counts as that level's approval.
 */
export async function recommend(
  companyId: string,
  id: string,
  actor: Actor,
  input: { recommendation: Recommendation; extendByDays?: number; comments: string }
) {
  const r = await prisma.confirmationRequest.findFirst({ where: { id, companyId }, include: { employee: { select: employeeSelect } } });
  if (!r) throw ApiError.notFound('Confirmation request not found');
  if (r.status !== 'PENDING') throw ApiError.badRequest(`Request is already ${r.status.toLowerCase()}`);
  if (r.recommendation) throw ApiError.conflict('A recommendation was already submitted');
  const isManager = !!actor.employeeId && r.employee.managerId === actor.employeeId;
  if (!isManager && !isCompanyAdmin(actor.role)) throw ApiError.forbidden("Only the employee's manager or HR can recommend");
  if (actor.employeeId === r.employeeId) throw ApiError.forbidden('You cannot review your own probation');
  if (input.recommendation === 'EXTEND' && !(input.extendByDays && input.extendByDays > 0)) {
    throw ApiError.badRequest('Give the number of days to extend the probation by');
  }

  await prisma.confirmationRequest.update({
    where: { id },
    data: {
      recommendation: input.recommendation,
      extendByDays: input.recommendation === 'EXTEND' ? (input.extendByDays ?? 0) : 0,
      comments: input.comments,
    },
  });
  const first = await approvalService.start(companyId, 'CONFIRMATION', id, r.employeeId);
  if (first && actor.employeeId && first.approverEmployeeId === actor.employeeId) {
    return applyDecision(companyId, id, actor, 'APPROVED', `Recommended: ${input.recommendation}`);
  }
  return prisma.confirmationRequest.findUniqueOrThrow({ where: { id } });
}

export async function decide(companyId: string, id: string, actor: Actor, decision: 'APPROVED' | 'REJECTED', remarks?: string) {
  const r = await prisma.confirmationRequest.findFirst({ where: { id, companyId } });
  if (!r) throw ApiError.notFound('Confirmation request not found');
  if (r.status !== 'PENDING') throw ApiError.badRequest(`Request is already ${r.status.toLowerCase()}`);
  if (!r.recommendation) throw ApiError.badRequest("Waiting for the manager's recommendation");
  return applyDecision(companyId, id, actor, decision, remarks);
}

async function applyDecision(companyId: string, id: string, actor: Actor, decision: 'APPROVED' | 'REJECTED', remarks?: string) {
  const r = await prisma.confirmationRequest.findUniqueOrThrow({ where: { id }, include: { employee: { select: employeeSelect } } });
  const result = await approvalService.act(companyId, 'CONFIRMATION', id, r.employeeId, actor, decision, remarks);
  if (result.outcome === 'PENDING') return prisma.confirmationRequest.findUniqueOrThrow({ where: { id } });

  const status = result.outcome;
  const updated = await prisma.confirmationRequest.update({
    where: { id },
    data: { status, approverId: actor.employeeId, decidedAt: new Date() },
  });
  if (status === 'REJECTED') {
    // The recommendation was turned down — HR raises a fresh request after discussion.
    await notify(companyId, [r.employee.managerId], {
      event: 'confirmation.rejected',
      title: `Recommendation for ${r.employee.name} was not approved`,
      body: remarks || 'Please discuss with HR and raise a new request.',
      link: '/confirmations',
    });
    return updated;
  }
  await applyOutcome(companyId, r, actor);
  return updated;
}

/** Side effects of an approved recommendation. */
async function applyOutcome(
  companyId: string,
  r: { id: string; employeeId: string; recommendation: string; extendByDays: number; comments: string; employee: { name: string; managerId: string | null; probationEndDate: Date | null } },
  actor: Actor
) {
  const today = todayUTC();
  if (r.recommendation === 'CONFIRM') {
    await prisma.employee.update({ where: { id: r.employeeId }, data: { confirmedOn: today } });
    await recordConfirmed(companyId, r, actor, today);
    await tryGenerateLetter(companyId, 'CONFIRMATION', r.employeeId, actor.employeeId);
    await notify(companyId, [r.employeeId, r.employee.managerId], {
      event: 'confirmation.confirmed',
      title: 'Congratulations — your employment is confirmed',
      body: `Confirmed with effect from ${longDate(today)}.`,
      link: '/letters',
      email: true,
    });
  } else if (r.recommendation === 'EXTEND') {
    const base = r.employee.probationEndDate && r.employee.probationEndDate > today ? r.employee.probationEndDate : today;
    const newEnd = addDays(base, r.extendByDays);
    await prisma.employee.update({ where: { id: r.employeeId }, data: { probationEndDate: newEnd } });
    await recordHistory(prisma, {
      companyId,
      employeeId: r.employeeId,
      type: 'PROBATION_EXTENDED',
      effectiveDate: today,
      title: `Probation extended by ${r.extendByDays} days (until ${longDate(newEnd)})`,
      from: { probationEndDate: r.employee.probationEndDate },
      to: { probationEndDate: newEnd },
      reason: r.comments,
      refType: 'ConfirmationRequest',
      refId: r.id,
      createdById: actor.employeeId,
    });
    // Probation that had lapsed into ACTIVE (end date passed unreviewed) is running again.
    const emp = await prisma.employee.findUniqueOrThrow({ where: { id: r.employeeId }, select: { employmentStatus: true, confirmedOn: true } });
    if (emp.employmentStatus === 'ACTIVE' && !emp.confirmedOn) {
      await setEmploymentStatus(prisma, companyId, r.employeeId, 'PROBATION', {
        effectiveDate: today, reason: 'Probation extended', refType: 'ConfirmationRequest', refId: r.id, createdById: actor.employeeId,
      });
    }
    await notify(companyId, [r.employeeId, r.employee.managerId], {
      event: 'confirmation.extended',
      title: 'Probation extended',
      body: `Your probation has been extended by ${r.extendByDays} days, until ${longDate(newEnd)}.`,
      link: '/confirmations',
      email: true,
    });
  } else if (r.recommendation === 'TERMINATE') {
    const active = await prisma.resignation.findFirst({ where: { companyId, employeeId: r.employeeId, status: { in: ['PENDING', 'APPROVED'] } } });
    if (active?.status === 'PENDING') {
      await approvalService.cancel(companyId, 'RESIGNATION', active.id);
      await prisma.resignation.update({ where: { id: active.id }, data: { status: 'WITHDRAWN', remarks: 'Superseded by probation termination' } });
    }
    if (active?.status !== 'APPROVED') {
      const emp = await prisma.employee.findUniqueOrThrow({ where: { id: r.employeeId }, select: { noticePeriodDays: true } });
      const exit = await prisma.resignation.create({
        data: {
          companyId,
          employeeId: r.employeeId,
          exitType: 'TERMINATION',
          reason: `Probation not confirmed${r.comments ? `: ${r.comments}` : ''}`,
          noticePeriodDays: emp.noticePeriodDays,
          requestedLastDay: today,
          approvedLastDay: today,
          status: 'APPROVED',
          approverId: actor.employeeId,
          noticeWaived: true,
        },
      });
      await onExitApproved(companyId, exit.id);
    }
  }
}

/**
 * Career history for a confirmation: PROBATION → ACTIVE through
 * setEmploymentStatus (writes the CONFIRMED row); an employee already ACTIVE
 * (probation lapsed unreviewed) only gets the CONFIRMED row. Idempotent per request.
 */
async function recordConfirmed(
  companyId: string,
  r: { id: string; employeeId: string; comments: string },
  actor: Actor,
  today: Date
) {
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: r.employeeId }, select: { employmentStatus: true } });
  const opts = {
    effectiveDate: today, reason: r.comments, refType: 'ConfirmationRequest', refId: r.id, createdById: actor.employeeId,
    title: 'Confirmed — probation completed',
  };
  if (emp.employmentStatus === 'PROBATION') {
    await setEmploymentStatus(prisma, companyId, r.employeeId, 'ACTIVE', opts);
    return;
  }
  const done = await prisma.employeeHistory.findFirst({ where: { companyId, employeeId: r.employeeId, type: 'CONFIRMED', refId: r.id } });
  if (!done) await recordHistory(prisma, { companyId, employeeId: r.employeeId, type: 'CONFIRMED', ...opts });
}

/** Daily job: raise requests for probations ending within LEAD_DAYS. */
export async function raiseDueRequests(companyId: string): Promise<number> {
  const horizon = addDays(todayUTC(), LEAD_DAYS);
  const due = await prisma.employee.findMany({
    where: {
      companyId,
      isActive: true,
      confirmedOn: null,
      probationEndDate: { not: null, lte: horizon },
      confirmations: { none: { status: 'PENDING' } },
      // An exiting employee needs no confirmation.
      resignations: { none: { status: { in: ['PENDING', 'APPROVED'] } } },
    },
    select: { id: true, probationEndDate: true },
  });
  let created = 0;
  for (const e of due) {
    // Skip probations already reviewed for this end date (e.g. a rejected recommendation awaiting HR).
    const reviewed = await prisma.confirmationRequest.findFirst({
      where: { companyId, employeeId: e.id, dueDate: e.probationEndDate ?? undefined },
    });
    if (reviewed) continue;
    await createRequest(companyId, e.id, e.probationEndDate ?? undefined).then(() => created++).catch(() => undefined);
  }
  return created;
}
