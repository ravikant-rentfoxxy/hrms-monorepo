/**
 * Transfers & promotions: department transfer, promotion, designation /
 * manager / location change for one employee.
 *
 *   raised by the employee's manager or HR (snapshot of the current values)
 *   → approval module TRANSFER (requester = the employee being moved, so their
 *     manager is step 1 of the default MANAGER → HR chain)
 *   → APPROVED: applied at once when effective today or earlier, otherwise
 *     by the daily job on the effective date
 *   → APPLIED: employee fields updated (+ legacy text columns), career history
 *     written, promotion increment raised through salary revisions.
 *
 * Cancellable while PENDING (and by ADMIN/HR while APPROVED but not applied).
 */
import type { Request } from 'express';
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { notify } from '../lib/notify';
import { logger } from '../lib/logger';
import { ApiError } from '../utils/http';
import { isCompanyAdmin, longDate, todayUTC } from '../utils/lifecycle';
import * as approvalService from './approval.service';
import { recordHistory, type HistoryType } from './employee-history.service';
import { assertManagerInCompany } from './employee.service';
import { applyIncrement } from './salary-revision.service';

export const TRANSFER_TYPES = ['TRANSFER', 'PROMOTION', 'DESIGNATION_CHANGE', 'MANAGER_CHANGE', 'LOCATION_CHANGE'] as const;
export type TransferType = (typeof TRANSFER_TYPES)[number];

export interface Actor {
  role: Role;
  employeeId: string | null;
}

export interface TransferInput {
  employeeId: string;
  type: TransferType;
  toDepartmentId?: string | null;
  toDesignationId?: string | null;
  toManagerId?: string | null;
  toOfficeId?: string | null;
  toGradeId?: string | null;
  incrementPercent?: number;
  effectiveDate: Date;
  reason: string;
}

/** Current / target values in one shape (ids + display names). */
interface Placement {
  departmentId: string | null;
  department: string;
  designationId: string | null;
  designation: string;
  managerId: string | null;
  manager: string;
  officeId: string | null;
  office: string;
  gradeId: string | null;
  grade: string;
}

const TYPE_LABEL: Record<TransferType, string> = {
  TRANSFER: 'Transfer',
  PROMOTION: 'Promotion',
  DESIGNATION_CHANGE: 'Designation change',
  MANAGER_CHANGE: 'Manager change',
  LOCATION_CHANGE: 'Location change',
};

const employeeSelect = {
  id: true, name: true, employeeCode: true, designation: true, department: true, location: true, avatarColor: true,
  managerId: true, departmentId: true, designationId: true, gradeId: true, officeId: true, isActive: true, employmentStatus: true,
} satisfies Prisma.EmployeeSelect;

type EmployeeRow = Prisma.EmployeeGetPayload<{ select: typeof employeeSelect }>;

async function placementOf(companyId: string, e: EmployeeRow): Promise<Placement> {
  const [manager, office, grade] = await Promise.all([
    e.managerId ? prisma.employee.findFirst({ where: { id: e.managerId, companyId }, select: { name: true } }) : null,
    e.officeId ? prisma.office.findFirst({ where: { id: e.officeId, companyId }, select: { name: true } }) : null,
    e.gradeId ? prisma.grade.findFirst({ where: { id: e.gradeId, companyId }, select: { name: true, code: true } }) : null,
  ]);
  return {
    departmentId: e.departmentId, department: e.department,
    designationId: e.designationId, designation: e.designation,
    managerId: e.managerId, manager: manager?.name ?? '',
    officeId: e.officeId, office: office?.name ?? e.location,
    gradeId: e.gradeId, grade: grade ? `${grade.name} (${grade.code})` : '',
  };
}

/** Validates the target ids against the company and returns their names. */
async function resolveTargets(companyId: string, t: Pick<TransferInput, 'toDepartmentId' | 'toDesignationId' | 'toManagerId' | 'toOfficeId' | 'toGradeId'>) {
  const [dept, des, mgr, office, grade] = await Promise.all([
    t.toDepartmentId ? prisma.department.findFirst({ where: { id: t.toDepartmentId, companyId }, select: { id: true, name: true } }) : null,
    t.toDesignationId ? prisma.designation.findFirst({ where: { id: t.toDesignationId, companyId }, select: { id: true, name: true } }) : null,
    t.toManagerId ? prisma.employee.findFirst({ where: { id: t.toManagerId, companyId, isActive: true }, select: { id: true, name: true } }) : null,
    t.toOfficeId ? prisma.office.findFirst({ where: { id: t.toOfficeId, companyId }, select: { id: true, name: true, city: true } }) : null,
    t.toGradeId ? prisma.grade.findFirst({ where: { id: t.toGradeId, companyId }, select: { id: true, name: true, code: true } }) : null,
  ]);
  if (t.toDepartmentId && !dept) throw ApiError.badRequest('Target department not found in this company');
  if (t.toDesignationId && !des) throw ApiError.badRequest('Target designation not found in this company');
  if (t.toManagerId && !mgr) throw ApiError.badRequest('Target manager not found (or no longer active)');
  if (t.toOfficeId && !office) throw ApiError.badRequest('Target office not found in this company');
  if (t.toGradeId && !grade) throw ApiError.badRequest('Target grade not found in this company');
  return { dept, des, mgr, office, grade };
}

/** What each type must change. */
function assertTypeTargets(input: TransferInput) {
  const need: Record<TransferType, [boolean, string]> = {
    TRANSFER: [!!(input.toDepartmentId || input.toOfficeId || input.toManagerId), 'A transfer needs a target department, office or manager'],
    PROMOTION: [!!(input.toDesignationId || input.toGradeId), 'A promotion needs a new designation or grade'],
    DESIGNATION_CHANGE: [!!input.toDesignationId, 'Choose the new designation'],
    MANAGER_CHANGE: [!!input.toManagerId, 'Choose the new reporting manager'],
    LOCATION_CHANGE: [!!input.toOfficeId, 'Choose the new office / location'],
  };
  const [okay, message] = need[input.type];
  if (!okay) throw ApiError.badRequest(message);
  if ((input.incrementPercent ?? 0) > 0 && input.type !== 'PROMOTION') throw ApiError.badRequest('An increment can only accompany a promotion');
}

async function getOrThrow(companyId: string, id: string) {
  const t = await prisma.transferRequest.findFirst({ where: { id, companyId }, include: { employee: { select: employeeSelect } } });
  if (!t) throw ApiError.notFound('Transfer request not found');
  return t;
}

/** Names for a request's target ids (list / detail display). */
async function withTargetNames<T extends { toDepartmentId: string | null; toDesignationId: string | null; toManagerId: string | null; toOfficeId: string | null; toGradeId: string | null; requestedById: string | null }>(
  companyId: string,
  rows: T[]
) {
  const ids = (k: keyof T) => [...new Set(rows.map((r) => r[k] as string | null).filter((v): v is string => !!v))];
  const [depts, desigs, people, offices, grades] = await Promise.all([
    prisma.department.findMany({ where: { companyId, id: { in: ids('toDepartmentId') } }, select: { id: true, name: true } }),
    prisma.designation.findMany({ where: { companyId, id: { in: ids('toDesignationId') } }, select: { id: true, name: true } }),
    prisma.employee.findMany({ where: { companyId, id: { in: [...ids('toManagerId'), ...ids('requestedById')] } }, select: { id: true, name: true } }),
    prisma.office.findMany({ where: { companyId, id: { in: ids('toOfficeId') } }, select: { id: true, name: true } }),
    prisma.grade.findMany({ where: { companyId, id: { in: ids('toGradeId') } }, select: { id: true, name: true, code: true } }),
  ]);
  const name = (list: { id: string; name: string }[], id: string | null) => (id ? (list.find((x) => x.id === id)?.name ?? null) : null);
  return rows.map((r) => ({
    ...r,
    to: {
      department: name(depts, r.toDepartmentId),
      designation: name(desigs, r.toDesignationId),
      manager: name(people, r.toManagerId),
      office: name(offices, r.toOfficeId),
      grade: (() => {
        const g = grades.find((x) => x.id === r.toGradeId);
        return g ? `${g.name} (${g.code})` : null;
      })(),
    },
    requestedByName: name(people, r.requestedById),
  }));
}

// ---- Read ----

export interface TransferFilter {
  status?: string;
  employeeId?: string;
  type?: TransferType;
  /** Only the caller's own transfer history. */
  mine?: boolean;
}

/**
 * ADMIN/HR see every request; managers their direct reports' and the ones
 * they raised; employees their own. `mine` limits anyone to their own.
 */
export async function list(companyId: string, viewer: Actor, filter: TransferFilter) {
  const where: Prisma.TransferRequestWhereInput = {
    companyId,
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.type ? { type: filter.type } : {}),
    ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
  };
  if (filter.mine) {
    if (!viewer.employeeId) throw ApiError.forbidden('This account has no employee profile');
    where.employeeId = viewer.employeeId;
  } else if (!isCompanyAdmin(viewer.role)) {
    if (!viewer.employeeId) throw ApiError.forbidden();
    where.OR = [{ employeeId: viewer.employeeId }, { employee: { managerId: viewer.employeeId } }, { requestedById: viewer.employeeId }];
  }
  const rows = await prisma.transferRequest.findMany({
    where,
    include: { employee: { select: employeeSelect } },
    orderBy: [{ createdAt: 'desc' }],
    take: 500,
  });
  const steps = await prisma.approvalStep.findMany({
    where: { companyId, module: 'TRANSFER', requestId: { in: rows.map((r) => r.id) }, status: 'PENDING' },
    orderBy: { level: 'asc' },
  });
  const named = await withTargetNames(companyId, rows);
  return named.map((r) => {
    const step = r.status === 'PENDING' ? (steps.find((s) => s.requestId === r.id) ?? null) : null;
    return {
      ...r,
      canDecide: !!step && approvalService.canAct(step, viewer),
      canCancel: canCancel(viewer, r),
    };
  });
}

function canCancel(viewer: Actor, t: { status: string; requestedById: string | null }) {
  if (t.status === 'PENDING') return isCompanyAdmin(viewer.role) || (!!viewer.employeeId && viewer.employeeId === t.requestedById);
  return t.status === 'APPROVED' && isCompanyAdmin(viewer.role);
}

export async function detail(companyId: string, id: string, viewer: Actor) {
  const t = await getOrThrow(companyId, id);
  const allowed =
    isCompanyAdmin(viewer.role) ||
    (!!viewer.employeeId && [t.employeeId, t.employee.managerId, t.requestedById].includes(viewer.employeeId));
  if (!allowed) throw ApiError.forbidden();
  const [named] = await withTargetNames(companyId, [t]);
  const step = t.status === 'PENDING' ? await approvalService.currentStep(companyId, 'TRANSFER', t.id) : null;
  return {
    ...named,
    canDecide: !!step && approvalService.canAct(step, viewer),
    canCancel: canCancel(viewer, t),
    trail: await approvalService.trail(companyId, 'TRANSFER', t.id),
  };
}

// ---- Raise / decide / cancel ----

export async function create(companyId: string, actor: Actor, input: TransferInput, req: Request) {
  const emp = await prisma.employee.findFirst({ where: { id: input.employeeId, companyId }, select: employeeSelect });
  if (!emp || !emp.isActive || emp.employmentStatus === 'SEPARATED') throw ApiError.notFound('Active employee not found');
  const isManager = !!actor.employeeId && emp.managerId === actor.employeeId;
  if (!isManager && !isCompanyAdmin(actor.role)) {
    throw ApiError.forbidden("Only the employee's reporting manager or HR can raise a transfer / promotion");
  }
  if (actor.employeeId === emp.id) throw ApiError.forbidden('You cannot raise a transfer or promotion for yourself');
  if (emp.employmentStatus === 'NOTICE_PERIOD') throw ApiError.badRequest(`${emp.name} is serving notice — a transfer cannot be raised`);
  assertTypeTargets(input);
  await resolveTargets(companyId, input);
  if (input.toManagerId) await assertManagerInCompany(companyId, input.toManagerId, emp.id);

  // Something must actually change.
  const changes =
    (input.toDepartmentId && input.toDepartmentId !== emp.departmentId) ||
    (input.toDesignationId && input.toDesignationId !== emp.designationId) ||
    (input.toManagerId && input.toManagerId !== emp.managerId) ||
    (input.toOfficeId && input.toOfficeId !== emp.officeId) ||
    (input.toGradeId && input.toGradeId !== emp.gradeId);
  if (!changes) throw ApiError.badRequest(`The targets match ${emp.name}'s current placement — nothing would change`);

  const open = await prisma.transferRequest.findFirst({
    where: { companyId, employeeId: emp.id, status: { in: ['PENDING', 'APPROVED'] } },
  });
  if (open) {
    throw ApiError.conflict(`${emp.name} already has a ${TYPE_LABEL[open.type as TransferType]?.toLowerCase() ?? 'transfer'} ${open.status === 'PENDING' ? 'awaiting approval' : 'scheduled'}`);
  }

  const before = await placementOf(companyId, emp);
  const created = await prisma.transferRequest.create({
    data: {
      companyId,
      employeeId: emp.id,
      type: input.type,
      toDepartmentId: input.toDepartmentId || null,
      toDesignationId: input.toDesignationId || null,
      toManagerId: input.toManagerId || null,
      toOfficeId: input.toOfficeId || null,
      toGradeId: input.toGradeId || null,
      incrementPercent: input.type === 'PROMOTION' ? (input.incrementPercent ?? 0) : 0,
      effectiveDate: input.effectiveDate,
      reason: input.reason.trim(),
      requestedById: actor.employeeId,
      before: before as unknown as Prisma.InputJsonValue,
    },
  });
  await audit(req, { entity: 'TransferRequest', entityId: created.id, action: 'CREATE', after: created });
  const first = await approvalService.start(companyId, 'TRANSFER', created.id, emp.id);
  // The raising manager is usually step 1 — raising it counts as their approval.
  if (first && actor.employeeId && first.approverEmployeeId === actor.employeeId) {
    return decide(companyId, created.id, actor, 'APPROVED', 'Raised by the reporting manager', req);
  }
  return created;
}

export async function decide(
  companyId: string,
  id: string,
  actor: Actor,
  decision: 'APPROVED' | 'REJECTED',
  remarks: string | undefined,
  req: Request | null
) {
  const t = await getOrThrow(companyId, id);
  if (t.status !== 'PENDING') throw ApiError.badRequest(`Request is already ${t.status.toLowerCase()}`);
  const result = await approvalService.act(companyId, 'TRANSFER', id, t.employeeId, actor, decision, remarks);
  if (result.outcome === 'PENDING') return prisma.transferRequest.findUniqueOrThrow({ where: { id } });

  const updated = await prisma.transferRequest.update({
    where: { id },
    data: { status: result.outcome, ...(remarks ? { remarks } : {}) },
  });
  await audit(req, {
    entity: 'TransferRequest', entityId: id, action: result.outcome === 'APPROVED' ? 'APPROVE' : 'REJECT',
    before: { status: 'PENDING' }, after: { status: result.outcome, remarks }, ...(req ? {} : { companyId }),
  });
  const label = TYPE_LABEL[t.type as TransferType] ?? 'Transfer';
  if (result.outcome === 'REJECTED') {
    await notify(companyId, [t.requestedById], {
      event: 'transfer.rejected',
      title: `${label} for ${t.employee.name} was not approved`,
      body: remarks || 'The request was rejected.',
      link: '/transfers',
    });
    return updated;
  }
  if (t.effectiveDate.getTime() <= todayUTC().getTime()) return applyTransfer(companyId, id, actor.employeeId, req);
  await notify(companyId, [t.employeeId, t.requestedById, t.employee.managerId], {
    event: 'transfer.approved',
    title: `${label} approved`,
    body: `${t.employee.name}'s ${label.toLowerCase()} takes effect on ${longDate(t.effectiveDate)}.`,
    link: '/transfers',
  });
  return updated;
}

export async function cancel(companyId: string, id: string, actor: Actor, remarks: string | undefined, req: Request) {
  const t = await getOrThrow(companyId, id);
  if (!canCancel(actor, t)) {
    if (t.status !== 'PENDING' && t.status !== 'APPROVED') throw ApiError.badRequest(`Request is already ${t.status.toLowerCase()}`);
    throw ApiError.forbidden(t.status === 'APPROVED' ? 'Only HR can cancel an approved transfer' : 'Only the requester or HR can cancel this request');
  }
  if (t.status === 'PENDING') await approvalService.cancel(companyId, 'TRANSFER', id);
  const updated = await prisma.transferRequest.update({
    where: { id },
    data: { status: 'CANCELLED', remarks: remarks ? `Cancelled: ${remarks}` : 'Cancelled' },
  });
  await audit(req, { entity: 'TransferRequest', entityId: id, action: 'CANCEL', before: { status: t.status }, after: { status: 'CANCELLED', remarks } });
  if (t.status === 'APPROVED') {
    await notify(companyId, [t.employeeId, t.requestedById], {
      event: 'transfer.cancelled',
      title: `${TYPE_LABEL[t.type as TransferType] ?? 'Transfer'} cancelled`,
      body: `The change scheduled for ${longDate(t.effectiveDate)} will not take effect.`,
      link: '/transfers',
    });
  }
  return updated;
}

// ---- Apply ----

const HISTORY_TYPE: Record<TransferType, HistoryType> = {
  TRANSFER: 'TRANSFER',
  PROMOTION: 'PROMOTION',
  DESIGNATION_CHANGE: 'DESIGNATION_CHANGE',
  MANAGER_CHANGE: 'MANAGER_CHANGE',
  LOCATION_CHANGE: 'LOCATION_CHANGE',
};

/**
 * Applies an APPROVED request to the employee: master links + legacy text
 * columns, one career-history row, then the promotion increment (a salary
 * revision conflict is reported in `remarks`, never undoes the move).
 * Idempotent: an APPLIED request is returned unchanged.
 */
export async function applyTransfer(companyId: string, id: string, actorEmployeeId: string | null, req: Request | null) {
  const t = await getOrThrow(companyId, id);
  if (t.status === 'APPLIED') return t;
  if (t.status !== 'APPROVED') throw ApiError.badRequest('Only approved requests can be applied');
  const emp = t.employee;
  if (!emp.isActive || emp.employmentStatus === 'SEPARATED') {
    await prisma.transferRequest.update({ where: { id }, data: { status: 'CANCELLED', remarks: 'Employee is no longer active' } });
    throw ApiError.badRequest(`${emp.name} is no longer active — the request was cancelled`);
  }
  const targets = await resolveTargets(companyId, t);
  if (t.toManagerId) await assertManagerInCompany(companyId, t.toManagerId, emp.id);

  const data: Prisma.EmployeeUncheckedUpdateInput = {};
  if (targets.dept) Object.assign(data, { departmentId: targets.dept.id, department: targets.dept.name });
  if (targets.des) Object.assign(data, { designationId: targets.des.id, designation: targets.des.name });
  if (targets.mgr) data.managerId = targets.mgr.id;
  if (targets.office) Object.assign(data, { officeId: targets.office.id, location: targets.office.city || targets.office.name });
  if (targets.grade) data.gradeId = targets.grade.id;

  const before = await placementOf(companyId, emp);
  const type = t.type as TransferType;
  const label = TYPE_LABEL[type] ?? 'Transfer';
  const applied = await prisma.$transaction(async (tx) => {
    const updatedEmp = await tx.employee.update({ where: { id: emp.id }, data, select: employeeSelect });
    const after = await placementOf(companyId, updatedEmp);
    const parts: string[] = [];
    if (before.designation !== after.designation) parts.push(`${before.designation || '—'} → ${after.designation || '—'}`);
    if (before.department !== after.department) parts.push(`${before.department || '—'} → ${after.department || '—'}`);
    if (before.grade !== after.grade) parts.push(`grade ${before.grade || '—'} → ${after.grade || '—'}`);
    if (before.manager !== after.manager) parts.push(`reports to ${after.manager || '—'}`);
    if (before.office !== after.office) parts.push(`${before.office || '—'} → ${after.office || '—'}`);
    await recordHistory(tx, {
      companyId,
      employeeId: emp.id,
      type: HISTORY_TYPE[type] ?? 'TRANSFER',
      effectiveDate: t.effectiveDate,
      title: `${label}${parts.length ? `: ${parts.join('; ')}` : ''}`,
      from: before,
      to: after,
      reason: t.reason,
      refType: 'TransferRequest',
      refId: t.id,
      createdById: actorEmployeeId ?? t.requestedById,
    });
    return tx.transferRequest.update({ where: { id }, data: { status: 'APPLIED', appliedAt: new Date() } });
  });
  await audit(req, {
    entity: 'Employee', entityId: emp.id, action: `${type}_APPLIED`,
    before, after: data as Record<string, unknown>, ...(req ? {} : { companyId }),
  });

  let incrementNote = '';
  if (type === 'PROMOTION' && t.incrementPercent > 0) {
    try {
      await applyIncrement(companyId, emp.id, t.incrementPercent, t.effectiveDate, `Promotion: ${t.reason}`.slice(0, 500), {
        employeeId: actorEmployeeId ?? t.requestedById,
        req,
      });
      incrementNote = ` with a ${t.incrementPercent}% increment`;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'salary revision failed';
      logger.warn({ err, transferId: id }, 'promotion increment not applied');
      await prisma.transferRequest.update({
        where: { id },
        data: { remarks: `${t.remarks ? `${t.remarks} | ` : ''}Increment not applied: ${message}` },
      });
      incrementNote = ` (increment not applied: ${message} — raise a salary revision)`;
      await notify(companyId, [t.requestedById], {
        event: 'transfer.increment_failed',
        title: `Increment for ${emp.name} needs attention`,
        body: `The promotion was applied but the ${t.incrementPercent}% increment was not: ${message}.`,
        link: '/salary-revisions',
      });
    }
  }
  await notify(companyId, [emp.id, t.requestedById, emp.managerId, t.toManagerId], {
    event: 'transfer.applied',
    title: type === 'PROMOTION' ? 'Congratulations on your promotion' : `${label} effective`,
    body: `${label} for ${emp.name} is effective from ${longDate(t.effectiveDate)}${incrementNote}.`,
    link: '/transfers',
    email: true,
  });
  return prisma.transferRequest.findUniqueOrThrow({ where: { id: applied.id } });
}

/** Daily job: applies approved requests whose effective date has arrived. */
export async function applyDueTransfers(companyId: string): Promise<number> {
  const due = await prisma.transferRequest.findMany({
    where: { companyId, status: 'APPROVED', effectiveDate: { lte: todayUTC() } },
    orderBy: { effectiveDate: 'asc' },
    select: { id: true },
  });
  let applied = 0;
  for (const t of due) {
    try {
      await applyTransfer(companyId, t.id, null, null);
      applied++;
    } catch (err) {
      logger.warn({ err, companyId, transferId: t.id }, 'could not apply transfer');
    }
  }
  return applied;
}
