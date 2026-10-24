/**
 * Configurable multi-level approval engine shared by every request type.
 *
 *   await approvalService.start(companyId, 'LEAVE', leave.id, employeeId);   // on apply
 *   const r = await approvalService.act(companyId, 'LEAVE', id, actor, 'APPROVED', remarks);
 *   if (r.outcome === 'APPROVED') { ...finalize the request... }
 *   else if (r.outcome === 'REJECTED') { ...mark rejected... }
 *   // r.outcome === 'PENDING' → moved to the next level; nothing to finalize yet
 *
 * A company configures the chain per module (ApprovalFlow). Without a flow the
 * chain is one step: the reporting manager, or HR when there is none — the
 * same behaviour the app had before the engine.
 *
 * ADMIN / HR / SUPER_ADMIN may act on any step (override) — except an ADMIN
 * (management) step, which only ADMIN / SUPER_ADMIN may clear; MANAGER and
 * named approvers only on steps assigned to them. Nobody approves their own.
 */
import type { ApprovalStep, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';

export const APPROVAL_MODULES = [
  'LEAVE', 'EXPENSE', 'REGULARIZATION', 'OVERTIME', 'COMP_OFF', 'ENCASHMENT', 'LOAN',
  'RESIGNATION', 'TRAVEL', 'TIMESHEET', 'CONFIRMATION', 'SALARY_REVISION',
  'REQUISITION', 'OFFER', 'TRANSFER',
] as const;
export type ApprovalModule = (typeof APPROVAL_MODULES)[number];

export type StepType = 'MANAGER' | 'MANAGERS_MANAGER' | 'DEPARTMENT_HEAD' | 'ROLE' | 'EMPLOYEE';
export interface FlowStep {
  type: StepType;
  role?: Role;
  employeeId?: string;
}

export interface Actor {
  role: Role;
  employeeId: string | null;
}

const DEFAULT_FLOW: FlowStep[] = [{ type: 'MANAGER' }];
/** Modules whose sensible default is not "the requester's manager". */
const MODULE_DEFAULTS: Partial<Record<ApprovalModule, FlowStep[]>> = {
  // Hiring request: HR reviews the requirement, management/finance approves the budget.
  REQUISITION: [{ type: 'ROLE', role: 'HR' }, { type: 'ROLE', role: 'ADMIN' }],
  // Compensation in an offer is signed off by management.
  OFFER: [{ type: 'ROLE', role: 'ADMIN' }],
  // Transfer / promotion: current manager, then HR.
  TRANSFER: [{ type: 'MANAGER' }, { type: 'ROLE', role: 'HR' }],
};
const defaultFlow = (module: string): FlowStep[] => MODULE_DEFAULTS[module as ApprovalModule] ?? DEFAULT_FLOW;
const OVERRIDE_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'HR'];

// ---- Flow configuration ----

export async function listFlows(companyId: string) {
  const flows = await prisma.approvalFlow.findMany({ where: { companyId } });
  return APPROVAL_MODULES.map((module) => {
    const flow = flows.find((f) => f.module === module);
    return { module, steps: (flow?.isActive ? flow.steps : defaultFlow(module)) as unknown as FlowStep[], isCustom: !!flow?.isActive };
  });
}

export async function saveFlow(companyId: string, module: ApprovalModule, steps: FlowStep[]) {
  if (steps.length === 0) throw ApiError.badRequest('A flow needs at least one step');
  for (const s of steps) {
    if (s.type === 'ROLE' && !s.role) throw ApiError.badRequest('ROLE steps need a role');
    if (s.type === 'EMPLOYEE' && !s.employeeId) throw ApiError.badRequest('EMPLOYEE steps need an employeeId');
  }
  return prisma.approvalFlow.upsert({
    where: { companyId_module: { companyId, module } },
    create: { companyId, module, steps: steps as object[], isActive: true },
    update: { steps: steps as object[], isActive: true },
  });
}

export async function resetFlow(companyId: string, module: ApprovalModule) {
  await prisma.approvalFlow.deleteMany({ where: { companyId, module } });
}

// ---- Chain lifecycle ----

async function resolveChain(companyId: string, module: string, requesterId: string) {
  const flow = await prisma.approvalFlow.findUnique({ where: { companyId_module: { companyId, module } } });
  const steps = (flow?.isActive ? (flow.steps as unknown as FlowStep[]) : defaultFlow(module)) ?? defaultFlow(module);
  const requester = await prisma.employee.findFirst({
    where: { id: requesterId, companyId },
    select: {
      userId: true,
      managerId: true,
      manager: { select: { managerId: true } },
      departmentRef: { select: { headId: true } },
    },
  });
  if (!requester) throw ApiError.notFound('Employee not found');
  const membership = await prisma.membership.findUnique({
    where: { userId_companyId: { userId: requester.userId, companyId } },
    select: { role: true },
  });

  const resolved: { approverType: StepType; approverRole: Role | null; approverEmployeeId: string | null }[] = [];
  for (const s of steps) {
    let employeeId: string | null = null;
    let role: Role | null = null;
    if (s.type === 'MANAGER') employeeId = requester.managerId;
    else if (s.type === 'MANAGERS_MANAGER') employeeId = requester.manager?.managerId ?? null;
    else if (s.type === 'DEPARTMENT_HEAD') employeeId = requester.departmentRef?.headId ?? null;
    else if (s.type === 'EMPLOYEE') employeeId = s.employeeId ?? null;
    else if (s.type === 'ROLE') role = s.role ?? 'HR';
    // An unresolvable person-step (no manager, no head) or a self-approval is skipped.
    if (s.type !== 'ROLE' && (!employeeId || employeeId === requesterId)) continue;
    // A role review by the requester's own role is implicit (HR raising a requisition needs no "HR review").
    if (s.type === 'ROLE' && membership && role === membership.role) continue;
    const last = resolved[resolved.length - 1];
    if (last && last.approverEmployeeId === employeeId && last.approverRole === role) continue; // same approver twice in a row
    resolved.push({ approverType: s.type, approverRole: role, approverEmployeeId: employeeId });
  }
  if (resolved.length === 0) resolved.push({ approverType: 'ROLE', approverRole: 'HR', approverEmployeeId: null });
  return resolved;
}

/** Creates the approval chain for a new request and notifies the first approver. */
export async function start(companyId: string, module: ApprovalModule, requestId: string, requesterId: string) {
  const chain = await resolveChain(companyId, module, requesterId);
  await prisma.approvalStep.createMany({
    data: chain.map((c, i) => ({ companyId, module, requestId, requesterId, level: i + 1, ...c })),
  });
  const first = await currentStep(companyId, module, requestId);
  if (first) {
    await notify(companyId, await approverEmployeeIds(companyId, first), {
      event: 'approval.pending',
      title: `${label(module)} awaiting your approval`,
      body: 'A new request needs your decision.',
      link: '/approvals',
    });
  }
  return first;
}

/** The lowest pending level, or null when the chain is finished (or never started). */
export async function currentStep(companyId: string, module: string, requestId: string) {
  return prisma.approvalStep.findFirst({
    where: { companyId, module, requestId, status: 'PENDING' },
    orderBy: { level: 'asc' },
  });
}

export function canAct(step: Pick<ApprovalStep, 'requesterId' | 'approverRole' | 'approverEmployeeId'>, actor: Actor): boolean {
  if (actor.employeeId && actor.employeeId === step.requesterId) return false;
  // A management (ADMIN) sign-off step can't be cleared by HR's override.
  if (step.approverRole === 'ADMIN') return actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN';
  if (OVERRIDE_ROLES.includes(actor.role)) return true;
  if (step.approverRole) return actor.role === step.approverRole;
  return !!actor.employeeId && actor.employeeId === step.approverEmployeeId;
}

export interface ActResult {
  /** Final state of the whole request: APPROVED / REJECTED, or PENDING when more levels remain. */
  outcome: 'APPROVED' | 'REJECTED' | 'PENDING';
  step: ApprovalStep;
}

/**
 * Records a decision on the current level. Requests created before the engine
 * existed (no steps) get their chain created on first action.
 */
export async function act(
  companyId: string,
  module: ApprovalModule,
  requestId: string,
  requesterId: string,
  actor: Actor,
  decision: 'APPROVED' | 'REJECTED',
  remarks?: string
): Promise<ActResult> {
  if (actor.employeeId && actor.employeeId === requesterId) throw ApiError.forbidden('Cannot decide your own request');
  let step = await currentStep(companyId, module, requestId);
  if (!step) {
    const any = await prisma.approvalStep.count({ where: { companyId, module, requestId } });
    if (any > 0) throw ApiError.badRequest('Request already decided');
    step = await start(companyId, module, requestId, requesterId);
    if (!step) throw ApiError.badRequest('No approver could be resolved');
  }
  if (!canAct(step, actor)) throw ApiError.forbidden('This request is waiting on another approver');

  const updated = await prisma.approvalStep.update({
    where: { id: step.id },
    data: { status: decision, actedById: actor.employeeId, remarks: remarks ?? null, actedAt: new Date() },
  });

  if (decision === 'REJECTED') {
    await prisma.approvalStep.updateMany({
      where: { companyId, module, requestId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    return { outcome: 'REJECTED', step: updated };
  }

  const next = await currentStep(companyId, module, requestId);
  if (!next) return { outcome: 'APPROVED', step: updated };
  await notify(companyId, await approverEmployeeIds(companyId, next), {
    event: 'approval.pending',
    title: `${label(module)} awaiting your approval`,
    body: `Approved at level ${updated.level}; your decision is next.`,
    link: '/approvals',
  });
  return { outcome: 'PENDING', step: updated };
}

/** Withdraws the remaining levels (request cancelled by the employee). */
export async function cancel(companyId: string, module: ApprovalModule, requestId: string) {
  await prisma.approvalStep.updateMany({
    where: { companyId, module, requestId, status: 'PENDING' },
    data: { status: 'CANCELLED' },
  });
}

/** Full chain with approver / actor names, for timelines in the UI. */
export async function trail(companyId: string, module: string, requestId: string) {
  const steps = await prisma.approvalStep.findMany({ where: { companyId, module, requestId }, orderBy: { level: 'asc' } });
  const ids = [...new Set(steps.flatMap((s) => [s.approverEmployeeId, s.actedById]).filter((x): x is string => !!x))];
  const people = await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const name = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? null) : null);
  return steps.map((s) => ({
    ...s,
    approverName: s.approverRole ? s.approverRole : name(s.approverEmployeeId),
    actedByName: name(s.actedById),
  }));
}

/**
 * Current steps the actor is expected to act on (their inbox). Override roles
 * see ROLE steps for their own role plus steps naming them — not every request.
 */
export async function pendingFor(companyId: string, actor: Actor, module?: string) {
  const pending = await prisma.approvalStep.findMany({
    where: { companyId, status: 'PENDING', ...(module ? { module } : {}) },
    orderBy: [{ requestId: 'asc' }, { level: 'asc' }],
  });
  const current = new Map<string, ApprovalStep>();
  for (const s of pending) if (!current.has(s.requestId)) current.set(s.requestId, s);
  return [...current.values()].filter((s) => {
    if (actor.employeeId && s.requesterId === actor.employeeId) return false;
    if (s.approverRole) return s.approverRole === actor.role || (s.approverRole === 'HR' && actor.role === 'ADMIN');
    return !!actor.employeeId && s.approverEmployeeId === actor.employeeId;
  });
}

/** Employees to notify for a step (named approver, or everyone holding the role). */
export async function approverEmployeeIds(companyId: string, step: Pick<ApprovalStep, 'approverRole' | 'approverEmployeeId'>) {
  if (step.approverEmployeeId) return [step.approverEmployeeId];
  if (!step.approverRole) return [];
  const members = await prisma.membership.findMany({
    where: { companyId, role: step.approverRole, isActive: true },
    select: { userId: true },
  });
  const emps = await prisma.employee.findMany({
    where: { companyId, isActive: true, userId: { in: members.map((m) => m.userId) } },
    select: { id: true },
  });
  return emps.map((e) => e.id);
}

const label = (module: string) =>
  module.charAt(0) + module.slice(1).toLowerCase().replace(/_/g, ' ') + ' request';
