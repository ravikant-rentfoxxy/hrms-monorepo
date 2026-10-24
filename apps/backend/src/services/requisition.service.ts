/**
 * Job requisitions (stage 1 of hiring): a manager raises a hiring request →
 * submits it → HR reviews (note / send back for changes) → management
 * approves the budget (approval module REQUISITION, default HR → ADMIN) →
 * on final approval the JobOpening is created with its Job ID, status
 * APPROVED ("approved for posting"). Jobs only come from approved requisitions.
 *
 *   DRAFT → PENDING_APPROVAL → APPROVED | REJECTED;  DRAFT / PENDING_APPROVAL → CANCELLED
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';
import { dateOnlyUTC } from '../utils/geo';
import { nextCode } from '../utils/codes';
import * as approvalService from './approval.service';
import { type Actor, assertEmployee, employeeNames, hrEmployeeIds, isHrAdmin, requireEmployee } from './talent.helpers';

export interface RequisitionInput {
  title: string;
  departmentId?: string | null;
  department?: string;
  designation?: string;
  vacancies?: number;
  minExperience?: number;
  maxExperience?: number;
  skills?: string;
  qualifications?: string;
  location?: string;
  employmentType?: string;
  budgetMinCtc?: number;
  budgetMaxCtc?: number;
  reason?: string;
  replacementForId?: string | null;
  justification?: string;
  description?: string;
  priority?: string;
  targetDate?: Date | null;
  hiringManagerId?: string | null;
}

async function getOrThrow(companyId: string, id: string) {
  const req = await prisma.jobRequisition.findFirst({ where: { id, companyId }, include: { job: { select: { id: true, code: true, status: true } } } });
  if (!req) throw ApiError.notFound('Requisition not found');
  return req;
}

const isOwner = (r: { requestedById: string; hiringManagerId: string | null }, actor: Actor) =>
  !!actor.employeeId && (r.requestedById === actor.employeeId || r.hiringManagerId === actor.employeeId);

function assertView(r: { requestedById: string; hiringManagerId: string | null }, actor: Actor) {
  if (!isHrAdmin(actor.role) && !isOwner(r, actor)) throw ApiError.forbidden('You can only see requisitions you raised');
}

/** Validates links and fills the department name from the master. */
async function normalise(companyId: string, input: Partial<RequisitionInput>) {
  const data: Partial<RequisitionInput> = { ...input };
  if (input.departmentId) {
    const dept = await prisma.department.findFirst({ where: { id: input.departmentId, companyId } });
    if (!dept) throw ApiError.badRequest('Department not found in this company');
    data.department = dept.name;
  }
  if (input.hiringManagerId) await assertEmployee(companyId, input.hiringManagerId, 'Hiring manager');
  if (input.replacementForId) {
    const emp = await prisma.employee.findFirst({ where: { id: input.replacementForId, companyId }, select: { id: true } });
    if (!emp) throw ApiError.badRequest('Employee being replaced not found in this company');
  }
  if (input.targetDate) data.targetDate = dateOnlyUTC(input.targetDate);
  return data;
}

function assertComplete(r: { reason: string; replacementForId: string | null; justification: string; budgetMaxCtc: number; budgetMinCtc: number; minExperience: number; maxExperience: number }) {
  if (r.reason === 'REPLACEMENT' && !r.replacementForId) throw ApiError.badRequest('Pick the employee being replaced');
  if (r.justification.trim().length < 10) throw ApiError.badRequest('Add a business justification (at least 10 characters) before submitting');
  if (r.budgetMaxCtc <= 0) throw ApiError.badRequest('Set the salary budget (max CTC) before submitting');
  if (r.budgetMaxCtc < r.budgetMinCtc) throw ApiError.badRequest('Max budget cannot be below the minimum');
  if (r.maxExperience && r.maxExperience < r.minExperience) throw ApiError.badRequest('Max experience cannot be below the minimum');
}

export async function list(companyId: string, actor: Actor, filter: { status?: string; scope?: 'mine' | 'all' }) {
  const where: Prisma.JobRequisitionWhereInput = { companyId };
  if (filter.status) where.status = filter.status;
  if (!isHrAdmin(actor.role) || filter.scope === 'mine') {
    const me = requireEmployee(actor);
    where.OR = [{ requestedById: me }, { hiringManagerId: me }];
  }
  const rows = await prisma.jobRequisition.findMany({
    where,
    include: { job: { select: { id: true, code: true, status: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const people = await employeeNames(companyId, rows.flatMap((r) => [r.requestedById, r.hiringManagerId, r.replacementForId]));
  const pendingSteps = await prisma.approvalStep.findMany({
    where: { companyId, module: 'REQUISITION', status: 'PENDING', requestId: { in: rows.map((r) => r.id) } },
    orderBy: { level: 'asc' },
  });
  return rows.map((r) => {
    const step = pendingSteps.find((s) => s.requestId === r.id);
    return {
      ...r,
      requestedBy: people.get(r.requestedById) ?? null,
      hiringManager: r.hiringManagerId ? (people.get(r.hiringManagerId) ?? null) : null,
      replacementFor: r.replacementForId ? (people.get(r.replacementForId) ?? null) : null,
      pendingWith: step ? (step.approverRole ?? 'Approver') : null,
      canDecide: step ? approvalService.canAct(step, actor) : false,
    };
  });
}

export async function get(companyId: string, id: string, actor: Actor) {
  const r = await getOrThrow(companyId, id);
  assertView(r, actor);
  const people = await employeeNames(companyId, [r.requestedById, r.hiringManagerId, r.replacementForId]);
  const step = await approvalService.currentStep(companyId, 'REQUISITION', id);
  return {
    ...r,
    requestedBy: people.get(r.requestedById) ?? null,
    hiringManager: r.hiringManagerId ? (people.get(r.hiringManagerId) ?? null) : null,
    replacementFor: r.replacementForId ? (people.get(r.replacementForId) ?? null) : null,
    canDecide: step ? approvalService.canAct(step, actor) : false,
    trail: await approvalService.trail(companyId, 'REQUISITION', id),
  };
}

export async function create(companyId: string, actor: Actor, input: RequisitionInput & { submit?: boolean }) {
  const me = requireEmployee(actor);
  const { submit, ...rest } = input;
  const data = await normalise(companyId, rest);
  const created = await prisma.$transaction(async (tx) =>
    tx.jobRequisition.create({
      data: {
        ...(data as RequisitionInput),
        companyId,
        code: await nextCode(companyId, 'REQUISITION', tx),
        requestedById: me,
        hiringManagerId: data.hiringManagerId ?? me,
      },
    })
  );
  return submit ? submitRequisition(companyId, created.id, actor) : created;
}

export async function update(companyId: string, id: string, actor: Actor, input: Partial<RequisitionInput>) {
  const before = await getOrThrow(companyId, id);
  if (!isHrAdmin(actor.role) && before.requestedById !== actor.employeeId) throw ApiError.forbidden('Only the requester or HR can edit');
  if (before.status !== 'DRAFT') throw ApiError.badRequest('Only a draft requisition can be edited — ask HR to send it back for changes');
  const data = await normalise(companyId, input);
  const { job: _job, ...plain } = before;
  const after = await prisma.jobRequisition.update({ where: { id }, data });
  return { before: plain, after };
}

export async function submitRequisition(companyId: string, id: string, actor: Actor) {
  const r = await getOrThrow(companyId, id);
  if (!isHrAdmin(actor.role) && r.requestedById !== actor.employeeId) throw ApiError.forbidden('Only the requester can submit');
  if (r.status !== 'DRAFT') throw ApiError.badRequest(`Requisition is ${r.status.toLowerCase().replace(/_/g, ' ')}`);
  assertComplete(r);
  // Guarded flip so a double submit cannot start two chains.
  const flipped = await prisma.jobRequisition.updateMany({
    where: { id, status: 'DRAFT' },
    data: { status: 'PENDING_APPROVAL', submittedAt: new Date() },
  });
  if (flipped.count === 0) throw ApiError.conflict('Requisition was just submitted');
  await approvalService.start(companyId, 'REQUISITION', id, r.requestedById);
  return prisma.jobRequisition.findUniqueOrThrow({ where: { id } });
}

/** HR review: add a note, optionally sending the request back to the requester as DRAFT. */
export async function review(companyId: string, id: string, actor: Actor, input: { note: string; sendBack?: boolean }) {
  const r = await getOrThrow(companyId, id);
  if (!isHrAdmin(actor.role)) throw ApiError.forbidden('Only HR can review requisitions');
  if (input.sendBack && r.status !== 'PENDING_APPROVAL') throw ApiError.badRequest('Only a pending requisition can be sent back');
  if (['CANCELLED', 'REJECTED'].includes(r.status)) throw ApiError.badRequest(`Requisition is ${r.status.toLowerCase()}`);
  const after = await prisma.jobRequisition.update({
    where: { id },
    data: { hrReviewNote: input.note, ...(input.sendBack ? { status: 'DRAFT', submittedAt: null } : {}) },
  });
  if (input.sendBack) await approvalService.cancel(companyId, 'REQUISITION', id);
  await notify(companyId, [r.requestedById], {
    event: input.sendBack ? 'recruitment.requisition_sent_back' : 'recruitment.requisition_note',
    title: input.sendBack ? `Requisition ${r.code} needs changes` : `HR note on requisition ${r.code}`,
    body: input.note,
    link: '/recruitment',
  });
  return { before: r, after };
}

/** Creates the job opening from an approved requisition (Job ID, copied requirements). */
async function createJob(tx: Prisma.TransactionClient, companyId: string, r: Awaited<ReturnType<typeof getOrThrow>>) {
  return tx.jobOpening.create({
    data: {
      companyId,
      code: await nextCode(companyId, 'JOB', tx),
      requisitionId: r.id,
      title: r.title,
      department: r.department,
      designation: r.designation,
      location: r.location,
      employmentType: r.employmentType,
      openings: r.vacancies,
      minExperience: r.minExperience,
      maxExperience: r.maxExperience,
      minCtc: r.budgetMinCtc,
      maxCtc: r.budgetMaxCtc,
      description: r.description,
      skills: r.skills,
      qualifications: r.qualifications,
      hiringManagerId: r.hiringManagerId ?? r.requestedById,
      status: 'APPROVED',
    },
  });
}

export async function decide(companyId: string, id: string, actor: Actor, decision: 'APPROVED' | 'REJECTED', remarks?: string) {
  const r = await getOrThrow(companyId, id);
  if (r.status !== 'PENDING_APPROVAL') throw ApiError.badRequest(`Requisition is ${r.status.toLowerCase().replace(/_/g, ' ')}`);
  const result = await approvalService.act(companyId, 'REQUISITION', id, r.requestedById, actor, decision, remarks);
  if (result.outcome === 'PENDING') return { requisition: r, outcome: result.outcome, job: null };

  if (result.outcome === 'REJECTED') {
    const after = await prisma.jobRequisition.update({ where: { id }, data: { status: 'REJECTED' } });
    await notify(companyId, [r.requestedById], {
      event: 'recruitment.requisition_rejected',
      title: `Requisition ${r.code} rejected`,
      body: remarks ? `${r.title}: ${remarks}` : `${r.title} was not approved.`,
      link: '/recruitment',
    });
    return { requisition: after, outcome: result.outcome, job: null };
  }

  const { after, job } = await prisma.$transaction(async (tx) => {
    const flipped = await tx.jobRequisition.updateMany({ where: { id, status: 'PENDING_APPROVAL' }, data: { status: 'APPROVED', approvedAt: new Date() } });
    if (flipped.count === 0) throw ApiError.conflict('Requisition was just decided');
    const existing = await tx.jobOpening.findFirst({ where: { requisitionId: id } });
    const job = existing ?? (await createJob(tx, companyId, r));
    return { after: await tx.jobRequisition.findUniqueOrThrow({ where: { id } }), job };
  });
  await notify(companyId, [r.requestedById, r.hiringManagerId, ...(await hrEmployeeIds(companyId))], {
    event: 'recruitment.requisition_approved',
    title: `Requisition ${r.code} approved`,
    body: `${r.title} is approved for posting as ${job.code}.`,
    link: `/recruitment/jobs/${job.id}`,
  });
  return { requisition: after, outcome: result.outcome, job };
}

export async function cancel(companyId: string, id: string, actor: Actor, reason?: string) {
  const r = await getOrThrow(companyId, id);
  if (!isHrAdmin(actor.role) && r.requestedById !== actor.employeeId) throw ApiError.forbidden('Only the requester or HR can cancel');
  if (!['DRAFT', 'PENDING_APPROVAL'].includes(r.status)) throw ApiError.badRequest(`A ${r.status.toLowerCase()} requisition cannot be cancelled`);
  const after = await prisma.jobRequisition.update({
    where: { id },
    data: { status: 'CANCELLED', ...(reason ? { hrReviewNote: r.hrReviewNote ? `${r.hrReviewNote}\nCancelled: ${reason}` : `Cancelled: ${reason}` } : {}) },
  });
  await approvalService.cancel(companyId, 'REQUISITION', id);
  return { before: r, after };
}
