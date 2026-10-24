/**
 * Separation (exit case): resignation (approval module RESIGNATION) or an
 * HR-initiated exit → acknowledgement + serving notice → handover (see
 * exit-handover.service) → department clearances (exit-clearance.service) →
 * exit interview → full & final settlement (settlement.service) → relieving /
 * experience letters → deactivation on the last working day (daily job) →
 * case closed + profile archived with rehire eligibility.
 *
 *   await onExitApproved(companyId, resignation.id);   // after any approved exit (also used by probation TERMINATE)
 *   await completeDueExits(companyId);                 // daily job
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { notify } from '../lib/notify';
import { audit } from '../lib/audit';
import { ApiError } from '../utils/http';
import { nextCode } from '../utils/codes';
import { addDays, dateOnly, employeeIdsWithRoles, isCompanyAdmin, longDate, todayUTC } from '../utils/lifecycle';
import * as approvalService from './approval.service';
import { recordHistory, setEmploymentStatus } from './employee-history.service';
import { generateLetter, templateForType } from './letter.service';
import { unreturnedAssets } from './asset.service';
import {
  ACTIVE_STATUSES, CLEARANCE_DEPARTMENTS, EXIT_LETTER_TYPES, FNF_DUE_WORKING_DAYS, NO_EXPERIENCE_LETTER, addWorkingDays, type Actor, type ClearanceDept,
  type ExitLetterType, type ExitType, assertCanView, clearanceOverall, employeeSelect, exitLetters, exitStage, isReportingManager,
  lastDayOf, lettersDone, loadExit, noticeInfo, settlementDone, shortfallFor,
} from './exit.helpers';
import { autoTickClearances, itemsOf, openClearances } from './exit-clearance.service';
import { listTasks } from './exit-handover.service';
import { fnfOverdue } from './settlement.service';

export { CLEARANCE_DEPARTMENTS, EXIT_TYPES } from './exit.helpers';
export type { Actor, ClearanceDept, ExitType } from './exit.helpers';

/** Standard exit-interview questionnaire (answers are free text). */
export const EXIT_INTERVIEW_QUESTIONS = [
  'What is the primary reason for leaving the organisation?',
  'What did you like most about working here?',
  'What could we have done better to retain you?',
  'How would you describe your relationship with your reporting manager?',
  'Did you receive adequate training and growth opportunities?',
  'How do you feel about the compensation and benefits offered?',
  'How would you describe the work culture and work-life balance?',
  'Any other suggestions or feedback for the management?',
];

const humanize = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

// ---- Apply / initiate / withdraw ----

async function assertNoActiveExit(companyId: string, employeeId: string) {
  const active = await prisma.resignation.findFirst({ where: { companyId, employeeId, status: { in: ACTIVE_STATUSES } } });
  if (active) {
    throw ApiError.conflict(
      active.status === 'PENDING' ? 'A resignation is already awaiting approval' : 'An exit is already approved for this employee'
    );
  }
}

/** Employee resigns. Last day defaults to today + their notice period. */
export async function resign(companyId: string, employeeId: string, input: { reason: string; requestedLastDay?: Date }) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId, isActive: true }, select: employeeSelect });
  if (!employee) throw ApiError.notFound('Employee not found');
  await assertNoActiveExit(companyId, employeeId);
  const today = todayUTC();
  const lastDay = input.requestedLastDay ? dateOnly(input.requestedLastDay) : addDays(today, employee.noticePeriodDays);
  if (lastDay < today) throw ApiError.badRequest('Last working day cannot be in the past');

  const resignation = await prisma.$transaction(async (tx) => {
    const created = await tx.resignation.create({
      data: {
        companyId,
        employeeId,
        code: await nextCode(companyId, 'EXIT', tx),
        exitType: 'RESIGNATION',
        reason: input.reason,
        noticePeriodDays: employee.noticePeriodDays,
        requestedLastDay: lastDay,
      },
    });
    await recordHistory(tx, {
      companyId,
      employeeId,
      type: 'RESIGNED',
      effectiveDate: today,
      title: `Resigned — requested last working day ${longDate(lastDay)}`,
      reason: input.reason,
      refType: 'Resignation',
      refId: created.id,
      createdById: employeeId,
    });
    return created;
  });
  await approvalService.start(companyId, 'RESIGNATION', resignation.id, employeeId);
  await notify(companyId, [employee.managerId, ...(await employeeIdsWithRoles(companyId))], {
    event: 'exit.resigned',
    title: `${employee.name} has resigned`,
    body: `${resignation.code}: requested last working day ${longDate(lastDay)} (notice period ${employee.noticePeriodDays} days).`,
    link: `/exits/${resignation.id}`,
  });
  return resignation;
}

/** HR-initiated exit (termination, retirement, end of contract, absconding) — approved immediately. */
export async function initiateExit(
  companyId: string,
  actor: Actor,
  input: { employeeId: string; exitType: ExitType; reason: string; lastWorkingDay: Date; noticeWaived?: boolean }
) {
  if (input.exitType === 'RESIGNATION') throw ApiError.badRequest('Resignations are submitted by the employee');
  const employee = await prisma.employee.findFirst({ where: { id: input.employeeId, companyId, isActive: true }, select: employeeSelect });
  if (!employee) throw ApiError.notFound('Active employee not found');
  if (actor.employeeId === employee.id) throw ApiError.badRequest('You cannot initiate your own exit');
  await assertNoActiveExit(companyId, employee.id);
  const lastDay = dateOnly(input.lastWorkingDay);

  const resignation = await prisma.$transaction(async (tx) =>
    tx.resignation.create({
      data: {
        companyId,
        employeeId: employee.id,
        code: await nextCode(companyId, 'EXIT', tx),
        exitType: input.exitType,
        reason: input.reason,
        noticePeriodDays: employee.noticePeriodDays,
        requestedLastDay: lastDay,
        approvedLastDay: lastDay,
        status: 'APPROVED',
        approverId: actor.employeeId,
        noticeWaived: input.exitType !== 'ABSCONDING' ? true : !!input.noticeWaived,
      },
    })
  );
  await onExitApproved(companyId, resignation.id, { actorId: actor.employeeId });
  return resignation;
}

export async function withdraw(companyId: string, employeeId: string, id: string) {
  const r = await prisma.resignation.findFirst({ where: { id, companyId } });
  if (!r) throw ApiError.notFound('Resignation not found');
  if (r.employeeId !== employeeId) throw ApiError.forbidden();
  if (r.status !== 'PENDING') throw ApiError.badRequest('Only a pending resignation can be withdrawn — talk to HR');
  await approvalService.cancel(companyId, 'RESIGNATION', id);
  const updated = await prisma.resignation.update({ where: { id }, data: { status: 'WITHDRAWN' } });
  await recordHistory(prisma, {
    companyId,
    employeeId,
    type: 'STATUS_CHANGE',
    effectiveDate: todayUTC(),
    title: 'Resignation withdrawn',
    refType: 'Resignation',
    refId: id,
    createdById: employeeId,
  }).catch(() => undefined);
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { name: true, managerId: true } });
  await notify(companyId, [emp?.managerId, ...(await employeeIdsWithRoles(companyId))], {
    event: 'exit.withdrawn',
    title: `${emp?.name ?? 'An employee'} withdrew their resignation`,
    body: 'No further action is needed.',
    link: `/exits/${id}`,
  });
  return updated;
}

// ---- Decide (approval engine) ----

export async function decide(
  companyId: string,
  id: string,
  actor: Actor,
  input: { decision: 'APPROVED' | 'REJECTED'; remarks?: string; approvedLastDay?: Date; noticeWaived?: boolean }
) {
  const r = await prisma.resignation.findFirst({ where: { id, companyId } });
  if (!r) throw ApiError.notFound('Resignation not found');
  if (r.status !== 'PENDING') throw ApiError.badRequest(`Resignation is already ${r.status.toLowerCase()}`);
  if (input.approvedLastDay && dateOnly(input.approvedLastDay) < dateOnly(r.appliedOn)) {
    throw ApiError.badRequest('Last working day cannot be before the resignation date');
  }

  const result = await approvalService.act(companyId, 'RESIGNATION', id, r.employeeId, actor, input.decision, input.remarks);
  // Every level may propose a last day; the waiver is HR's call. The final approval applies them.
  const proposals = {
    ...(input.approvedLastDay ? { approvedLastDay: dateOnly(input.approvedLastDay) } : {}),
    ...(input.noticeWaived !== undefined && isCompanyAdmin(actor.role) ? { noticeWaived: input.noticeWaived } : {}),
  };

  if (result.outcome === 'PENDING') {
    return prisma.resignation.update({ where: { id }, data: proposals });
  }
  if (result.outcome === 'REJECTED') {
    const updated = await prisma.resignation.update({
      where: { id },
      data: { status: 'REJECTED', approverId: actor.employeeId, remarks: input.remarks ?? null },
    });
    await notify(companyId, [r.employeeId], {
      event: 'exit.rejected',
      title: 'Your resignation was not accepted',
      body: input.remarks || 'Please speak to your manager / HR.',
      link: '/exits',
    });
    return updated;
  }
  await prisma.resignation.update({
    where: { id },
    data: {
      status: 'APPROVED',
      approverId: actor.employeeId,
      remarks: input.remarks ?? null,
      approvedLastDay: proposals.approvedLastDay ?? r.approvedLastDay ?? r.requestedLastDay,
      noticeWaived: proposals.noticeWaived ?? r.noticeWaived,
    },
  });
  return onExitApproved(companyId, id, { actorId: actor.employeeId });
}

/** Issues an exit letter when its template exists; never throws (automated hooks). */
async function autoLetter(companyId: string, r: { employeeId: string; appliedOn: Date }, type: ExitLetterType, createdById?: string | null) {
  try {
    if ((await exitLetters(companyId, r.employeeId, r.appliedOn)).some((l) => l.type === type)) return null;
    if (!(await templateForType(companyId, type))) return null;
    return await generateLetter(companyId, { type, employeeId: r.employeeId, createdById: createdById ?? null });
  } catch (err) {
    logger.warn({ err, companyId, type }, 'exit letter generation failed');
    return null;
  }
}

/**
 * Side effects of an approved exit (idempotent): exit case ID, the employee's
 * leaving date, the notice shortfall, status "Serving notice period", the
 * department clearances (IT / Admin list the assets to collect) and the
 * resignation acknowledgement letter. An exit whose last day is already past
 * is completed right away.
 */
export async function onExitApproved(companyId: string, resignationId: string, opts: { actorId?: string | null } = {}) {
  const r = await prisma.resignation.findFirst({ where: { id: resignationId, companyId }, include: { employee: { select: employeeSelect } } });
  if (!r) throw ApiError.notFound('Resignation not found');
  const lastDay = lastDayOf(r);
  const shortfallDays = shortfallFor(r, lastDay);
  const today = todayUTC();

  await prisma.$transaction(async (tx) => {
    await tx.resignation.update({
      where: { id: r.id },
      data: { approvedLastDay: lastDay, shortfallDays, ...(r.code ? {} : { code: await nextCode(companyId, 'EXIT', tx) }) },
    });
    await tx.employee.update({ where: { id: r.employeeId }, data: { leavingDate: lastDay } });
    await openClearances(companyId, r.id, tx);
    if (lastDay >= today) {
      await setEmploymentStatus(tx, companyId, r.employeeId, 'NOTICE_PERIOD', {
        effectiveDate: today,
        reason: r.reason,
        refType: 'Resignation',
        refId: r.id,
        createdById: opts.actorId ?? null,
        title: `Serving notice period — last working day ${longDate(lastDay)}`,
      });
    }
  });

  // Pre-fill IT / Admin remarks with the assets to collect.
  const assets = await unreturnedAssets(companyId, r.employeeId);
  for (const dept of ['IT', 'ADMIN'] as const) {
    const mine = assets.filter((a) => a.department === dept);
    if (mine.length === 0) continue;
    await prisma.exitClearance.updateMany({
      where: { resignationId: r.id, department: dept, status: 'PENDING', remarks: '' },
      data: { remarks: `To collect: ${mine.map((a) => `${a.name} (${a.tag})`).join(', ')}` },
    });
  }
  await autoTickClearances(companyId, r.id);

  if (r.exitType === 'RESIGNATION' && !r.acknowledgedAt) {
    await autoLetter(companyId, r, 'RESIGNATION_ACKNOWLEDGEMENT', opts.actorId);
    await prisma.resignation.update({ where: { id: r.id }, data: { acknowledgedAt: new Date() } });
  }

  await notify(companyId, [r.employeeId], {
    event: 'exit.approved',
    title: r.exitType === 'RESIGNATION' ? 'Your resignation has been accepted' : 'Your exit has been initiated',
    body: `Last working day: ${longDate(lastDay)}.${shortfallDays ? ` Notice shortfall of ${shortfallDays} days will be recovered in F&F.` : ''} Please complete your handover, exit interview and return company assets.`,
    link: '/exits',
    email: true,
  });
  await notify(companyId, [r.employee.managerId, ...(await employeeIdsWithRoles(companyId))], {
    event: 'exit.clearance_pending',
    title: `Exit clearance pending for ${r.employee.name}`,
    body: `Last working day ${longDate(lastDay)}. Plan the handover; Manager, IT, Finance, Admin and HR clearances are open.`,
    link: `/exits/${r.id}`,
  });

  if (lastDay < today) await completeExit(companyId, r.id);
  return prisma.resignation.findUniqueOrThrow({ where: { id: r.id }, include: { clearances: true } });
}

// ---- Read ----

export async function list(
  companyId: string,
  viewer: Actor,
  filter: { status?: string; scope?: 'me' | 'team' | 'company'; fnfOverdue?: boolean; q?: string }
) {
  const scope = filter.scope ?? (isCompanyAdmin(viewer.role) ? 'company' : viewer.role === 'MANAGER' ? 'team' : 'me');
  if (scope === 'company' && !isCompanyAdmin(viewer.role)) throw ApiError.forbidden();
  const where: Prisma.ResignationWhereInput = { companyId, ...(filter.status ? { status: filter.status } : {}) };
  if (scope === 'me') where.employeeId = viewer.employeeId ?? '';
  if (scope === 'team') where.employee = { managerId: viewer.employeeId ?? '' };
  const q = filter.q?.trim();
  if (q) {
    where.OR = [
      { code: { contains: q, mode: 'insensitive' } },
      { employee: { name: { contains: q, mode: 'insensitive' } } },
      { employee: { employeeCode: { contains: q, mode: 'insensitive' } } },
    ];
  }
  const rows = await prisma.resignation.findMany({
    where,
    include: {
      employee: { select: employeeSelect },
      clearances: { select: { department: true, status: true } },
      handoverTasks: { select: { status: true } },
      settlement: { select: { status: true, netAmount: true, dueDate: true, paidOn: true } },
      interview: { select: { id: true } },
    },
    orderBy: { appliedOn: 'desc' },
    take: 300,
  });
  const letters = rows.length
    ? await prisma.generatedLetter.findMany({
        where: { companyId, employeeId: { in: [...new Set(rows.map((r) => r.employeeId))] }, type: { in: [...EXIT_LETTER_TYPES] } },
        select: { employeeId: true, type: true, createdAt: true },
      })
    : [];
  const today = todayUTC();
  const out = rows.map((r) => {
    const letterTypes = letters.filter((l) => l.employeeId === r.employeeId && l.createdAt >= dateOnly(r.appliedOn)).map((l) => l.type);
    const isAdmin = isCompanyAdmin(viewer.role);
    const isSelf = viewer.employeeId === r.employeeId;
    const { userId: _userId, ...employee } = r.employee;
    return {
      ...r,
      employee,
      settlement: isAdmin || isSelf ? r.settlement : null,
      clearedCount: r.clearances.filter((c) => c.status === 'CLEARED').length,
      clearanceCount: r.clearances.length,
      clearanceStatus: clearanceOverall(r.clearances),
      handoverCount: r.handoverTasks.length,
      handoverVerified: r.handoverTasks.filter((t) => t.status === 'VERIFIED').length,
      interviewDone: !!r.interview,
      letterTypes,
      notice: noticeInfo(r, today),
      stage: exitStage({ ...r, letterTypes }),
      fnfOverdue: isAdmin ? fnfOverdue(r, r.settlement, today) : false,
    };
  });
  return filter.fnfOverdue ? out.filter((r) => r.fnfOverdue) : out;
}

async function names(ids: (string | null | undefined)[]) {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (uniq.length === 0) return (_id: string | null | undefined): string | null => null;
  const people = await prisma.employee.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
  return (id: string | null | undefined) => (id ? (people.find((p) => p.id === id)?.name ?? null) : null);
}

/** What still blocks closing the case (empty = it can be closed). */
function closeBlockers(
  r: { status: string; closedAt: Date | null; exitType: string; approvedLastDay: Date | null; requestedLastDay: Date },
  clearances: { status: string }[],
  settlement: { status: string; netAmount: number } | null,
  letterTypes: string[],
  today = todayUTC()
): string[] {
  if (r.closedAt) return ['The case is already closed'];
  const out: string[] = [];
  if (r.status !== 'COMPLETED' && !(r.status === 'APPROVED' && lastDayOf(r) < today)) {
    out.push(r.status === 'APPROVED' ? `The last working day (${longDate(lastDayOf(r))}) has not passed yet` : `The exit is ${r.status.toLowerCase()}`);
  }
  if (clearanceOverall(clearances) !== 'COMPLETED') out.push('All department clearances must be cleared');
  if (!settlementDone(settlement)) {
    out.push(settlement ? 'The F&F settlement must be paid (or approved with a zero net amount)' : 'Compute, approve and pay the F&F settlement');
  }
  if (!lettersDone(r.exitType, letterTypes)) {
    out.push(NO_EXPERIENCE_LETTER.includes(r.exitType) ? 'Issue the relieving letter' : 'Issue the relieving letter and experience certificate');
  }
  return out;
}

export async function detail(companyId: string, id: string, viewer: Actor) {
  const base = await prisma.resignation.findFirst({ where: { id, companyId }, select: { status: true, employeeId: true, exitInterviewerId: true, employee: { select: { managerId: true } } } });
  if (!base) throw ApiError.notFound('Exit case not found');
  assertCanView(base, viewer);
  // Assets may have been returned / loans closed elsewhere since the last view.
  if (base.status === 'APPROVED') await autoTickClearances(companyId, id).catch(() => undefined);

  const r = await prisma.resignation.findFirstOrThrow({
    where: { id, companyId },
    include: {
      employee: { select: { ...employeeSelect, manager: { select: { id: true, name: true } } } },
      clearances: true,
      interview: true,
      settlement: true,
    },
  });
  const isAdmin = isCompanyAdmin(viewer.role);
  const isSelf = viewer.employeeId === r.employeeId;
  const isManager = isReportingManager(r, viewer);
  const today = todayUTC();
  const order = (d: string) => CLEARANCE_DEPARTMENTS.indexOf(d as ClearanceDept);
  const [handoverTasks, letters, trail, assets] = await Promise.all([
    listTasks(companyId, r.id),
    exitLetters(companyId, r.employeeId, r.appliedOn),
    approvalService.trail(companyId, 'RESIGNATION', r.id),
    unreturnedAssets(companyId, r.employeeId),
  ]);
  const name = await names([
    ...r.clearances.map((c) => c.clearedById),
    r.exitInterviewerId,
    r.lastDayChangeById,
    r.approverId,
    r.settlement?.approvedById,
    ...letters.map((l) => l.createdById),
  ]);
  const letterTypes = letters.map((l) => l.type);
  const step = r.status === 'PENDING' ? await approvalService.currentStep(companyId, 'RESIGNATION', r.id) : null;
  const open = r.status === 'APPROVED';
  const pendingChange = r.lastDayChangeStatus === 'PENDING';
  const blockers = closeBlockers(r, r.clearances, r.settlement, letterTypes, today);
  const { userId: _userId, ...employee } = r.employee;

  return {
    ...r,
    employee,
    approverName: name(r.approverId),
    exitInterviewerName: name(r.exitInterviewerId),
    lastDayChangeByName: name(r.lastDayChangeById),
    lastDayChangeByEmployee: !!r.lastDayChangeById && r.lastDayChangeById === r.employeeId,
    // Interview answers are visible to HR and the employee; F&F to HR and the employee.
    interview: isAdmin || isSelf ? r.interview : r.interview ? { submittedAt: r.interview.submittedAt } : null,
    settlement:
      isAdmin || isSelf
        ? r.settlement && { ...r.settlement, approvedByName: name(r.settlement.approvedById), overdue: fnfOverdue(r, r.settlement, today) }
        : null,
    fnfOverdue: isAdmin ? fnfOverdue(r, r.settlement, today) : false,
    clearances: [...r.clearances]
      .sort((a, b) => order(a.department) - order(b.department))
      .map((c) => ({ ...c, items: itemsOf(c), clearedByName: name(c.clearedById) })),
    clearanceStatus: clearanceOverall(r.clearances),
    handoverTasks,
    letters: letters.map((l) => ({ ...l, issuedByName: name(l.createdById) })),
    notice: noticeInfo(r, today),
    stage: exitStage({ ...r, handoverTasks, letterTypes }),
    closeBlockers: r.closedAt ? [] : blockers,
    trail,
    assets,
    questions: EXIT_INTERVIEW_QUESTIONS,
    can: {
      manage: isAdmin && !isSelf,
      decide: !!step && approvalService.canAct(step, viewer),
      planHandover: (isAdmin || isManager) && !isSelf && (r.status === 'PENDING' || open),
      completeHandover: (isSelf || isAdmin) && (r.status === 'PENDING' || open),
      clearManager: (isAdmin || isManager) && !isSelf && open,
      requestLastDayChange: open && !pendingChange && !r.closedAt && (isSelf || isManager || isAdmin),
      decideLastDayChange:
        open && pendingChange && !isSelf && (isAdmin || (isManager && r.lastDayChangeById !== viewer.employeeId)),
      interview: (isSelf || isAdmin) && (open || r.status === 'COMPLETED') && !r.closedAt,
      close: isAdmin && !isSelf && blockers.length === 0,
    },
  };
}

/** The employee's current (or latest) exit. */
export async function mine(companyId: string, employeeId: string) {
  const r = await prisma.resignation.findFirst({ where: { companyId, employeeId }, orderBy: { appliedOn: 'desc' } });
  if (!r) return null;
  return detail(companyId, r.id, { role: 'EMPLOYEE', employeeId });
}

// ---- Early release / notice extension ----

async function applyLastDayChange(
  companyId: string,
  r: Awaited<ReturnType<typeof loadExit>>,
  newDay: Date,
  opts: { requestedById: string | null; decidedById: string | null; noticeWaived?: boolean; note?: string }
) {
  const current = lastDayOf(r);
  const early = newDay < current;
  const byEmployee = opts.requestedById === r.employeeId;
  // Company-initiated early release costs the employee nothing; an employee's own request does (unless HR waives).
  const noticeWaived = opts.noticeWaived ?? (early && !byEmployee ? true : r.noticeWaived);
  const shortfallDays = shortfallFor({ ...r, noticeWaived }, newDay);
  await prisma.$transaction([
    prisma.resignation.update({
      where: { id: r.id },
      data: {
        approvedLastDay: newDay,
        noticeWaived,
        shortfallDays,
        lastDayChangeTo: newDay,
        lastDayChangeStatus: 'APPROVED',
        lastDayChangeById: opts.requestedById,
        ...(opts.note ? { lastDayChangeReason: opts.note } : {}),
      },
    }),
    prisma.employee.update({ where: { id: r.employeeId }, data: { leavingDate: newDay } }),
  ]);
  // A draft F&F follows the new day (its lines are refreshed on the next recompute).
  await prisma.finalSettlement.updateMany({
    where: { companyId, resignationId: r.id, status: 'DRAFT' },
    data: { lastWorkingDay: newDay, dueDate: await addWorkingDays(companyId, newDay, FNF_DUE_WORKING_DAYS) },
  });
  await notify(companyId, [r.employeeId, r.employee.managerId, ...(await employeeIdsWithRoles(companyId))], {
    event: 'exit.last_day_changed',
    title: `Last working day of ${r.employee.name} changed`,
    body: `${early ? 'Early release' : 'Notice extension'}: ${longDate(current)} → ${longDate(newDay)}.${shortfallDays ? ` Notice shortfall ${shortfallDays} days.` : ''}`,
    link: `/exits/${r.id}`,
  });
  return prisma.resignation.findUniqueOrThrow({ where: { id: r.id } });
}

/**
 * Early release / notice extension. The employee or their manager requests
 * it (HR / ADMIN decide); a request by HR / ADMIN applies immediately.
 */
export async function requestLastDayChange(companyId: string, id: string, actor: Actor, input: { lastDay: Date; reason: string }) {
  const r = await loadExit(companyId, id);
  const isSelf = actor.employeeId === r.employeeId;
  const isAdmin = isCompanyAdmin(actor.role) && !isSelf;
  if (!isSelf && !isAdmin && !isReportingManager(r, actor)) throw ApiError.forbidden('Only the employee, their manager or HR can request this');
  if (r.status !== 'APPROVED' || r.closedAt) throw ApiError.badRequest('The last working day can be changed only while the employee is serving notice');
  if (r.lastDayChangeStatus === 'PENDING') throw ApiError.conflict('A change request is already pending');
  const settlement = await prisma.finalSettlement.findUnique({ where: { resignationId: r.id }, select: { status: true } });
  if (settlement && settlement.status !== 'DRAFT') throw ApiError.badRequest('The F&F settlement is already approved — the last working day can no longer change');
  const newDay = dateOnly(input.lastDay);
  if (newDay < todayUTC()) throw ApiError.badRequest('The new last working day cannot be in the past');
  if (newDay.getTime() === lastDayOf(r).getTime()) throw ApiError.badRequest('That is already the last working day');
  if (newDay < dateOnly(r.appliedOn)) throw ApiError.badRequest('The last working day cannot be before the resignation date');
  const kind = newDay < lastDayOf(r) ? 'early release' : 'notice extension';

  const before = { approvedLastDay: r.approvedLastDay, shortfallDays: r.shortfallDays, noticeWaived: r.noticeWaived };

  if (isAdmin) {
    await prisma.resignation.update({ where: { id: r.id }, data: { lastDayChangeReason: input.reason } });
    return { before, after: await applyLastDayChange(companyId, r, newDay, { requestedById: actor.employeeId, decidedById: actor.employeeId }) };
  }
  const updated = await prisma.resignation.update({
    where: { id: r.id },
    data: { lastDayChangeTo: newDay, lastDayChangeReason: input.reason, lastDayChangeStatus: 'PENDING', lastDayChangeById: actor.employeeId },
  });
  await notify(companyId, [isSelf ? r.employee.managerId : r.employeeId, ...(await employeeIdsWithRoles(companyId))], {
    event: 'exit.last_day_change_requested',
    title: `${humanize(kind)} requested for ${r.employee.name}`,
    body: `${longDate(lastDayOf(r))} → ${longDate(newDay)}: ${input.reason}`,
    link: `/exits/${r.id}`,
  });
  return { before, after: updated };
}

export async function decideLastDayChange(
  companyId: string,
  id: string,
  actor: Actor,
  input: { decision: 'APPROVED' | 'REJECTED'; remarks?: string; noticeWaived?: boolean }
) {
  const r = await loadExit(companyId, id);
  if (r.lastDayChangeStatus !== 'PENDING' || !r.lastDayChangeTo) throw ApiError.badRequest('There is no pending change request');
  if (actor.employeeId === r.employeeId) throw ApiError.forbidden('You cannot decide your own request');
  const isAdmin = isCompanyAdmin(actor.role);
  if (!isAdmin && !isReportingManager(r, actor)) throw ApiError.forbidden('Only HR or the reporting manager can decide this');
  if (!isAdmin && r.lastDayChangeById === actor.employeeId) throw ApiError.forbidden('HR decides requests raised by the manager');
  if (r.status !== 'APPROVED') throw ApiError.badRequest(`The exit is ${r.status.toLowerCase()}`);
  const note = input.remarks?.trim() ? `${r.lastDayChangeReason}\nDecision: ${input.remarks.trim()}` : undefined;

  if (input.decision === 'REJECTED') {
    const updated = await prisma.resignation.update({
      where: { id: r.id },
      data: { lastDayChangeStatus: 'REJECTED', ...(note ? { lastDayChangeReason: note } : {}) },
    });
    await notify(companyId, [r.lastDayChangeById, r.employeeId], {
      event: 'exit.last_day_change_rejected',
      title: 'Last working day change not approved',
      body: input.remarks || `The last working day stays ${longDate(lastDayOf(r))}.`,
      link: '/exits',
    });
    return updated;
  }
  const settlement = await prisma.finalSettlement.findUnique({ where: { resignationId: r.id }, select: { status: true } });
  if (settlement && settlement.status !== 'DRAFT') throw ApiError.badRequest('The F&F settlement is already approved — the last working day can no longer change');
  if (r.lastDayChangeTo < todayUTC()) throw ApiError.badRequest('The requested day has already passed — ask for a new date');
  return applyLastDayChange(companyId, r, r.lastDayChangeTo, {
    requestedById: r.lastDayChangeById,
    decidedById: actor.employeeId,
    noticeWaived: isAdmin ? input.noticeWaived : undefined,
    note,
  });
}

// ---- Exit interview ----

export async function scheduleInterview(companyId: string, id: string, actor: Actor, input: { at: Date; interviewerId?: string | null }) {
  const r = await loadExit(companyId, id);
  if (r.status !== 'APPROVED' && r.status !== 'COMPLETED') throw ApiError.badRequest('The exit interview can be scheduled once the exit is approved');
  if (r.closedAt) throw ApiError.badRequest('This exit case is closed');
  if (input.at.getTime() < Date.now() - 60 * 60 * 1000) throw ApiError.badRequest('Pick a future date and time');
  let interviewer: { id: string; name: string } | null = null;
  if (input.interviewerId) {
    if (input.interviewerId === r.employeeId) throw ApiError.badRequest('The leaver cannot interview themselves');
    interviewer = await prisma.employee.findFirst({ where: { id: input.interviewerId, companyId, isActive: true }, select: { id: true, name: true } });
    if (!interviewer) throw ApiError.badRequest('Interviewer must be an active employee');
  }
  const before = { exitInterviewAt: r.exitInterviewAt, exitInterviewerId: r.exitInterviewerId };
  const after = await prisma.resignation.update({
    where: { id: r.id },
    data: { exitInterviewAt: input.at, exitInterviewerId: interviewer?.id ?? actor.employeeId },
  });
  const when = input.at.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  await notify(companyId, [r.employeeId], {
    event: 'exit.interview_scheduled',
    title: 'Exit interview scheduled',
    body: `${when}${interviewer ? ` with ${interviewer.name}` : ''}.`,
    link: '/exits',
    email: true,
  });
  if (after.exitInterviewerId && after.exitInterviewerId !== actor.employeeId) {
    await notify(companyId, [after.exitInterviewerId], {
      event: 'exit.interview_assigned',
      title: `Exit interview with ${r.employee.name}`,
      body: when,
      link: `/exits/${r.id}`,
    });
  }
  return { before, after };
}

/** The leaver fills the questionnaire (HR may record it on their behalf after the meeting). */
export async function submitInterview(
  companyId: string,
  actor: Actor,
  id: string,
  input: { answers: { question: string; answer: string }[]; overallRating?: number; wouldRejoin?: boolean }
) {
  const r = await prisma.resignation.findFirst({ where: { id, companyId } });
  if (!r) throw ApiError.notFound('Resignation not found');
  const isSelf = actor.employeeId === r.employeeId;
  if (!isSelf && !isCompanyAdmin(actor.role)) throw ApiError.forbidden('Only the exiting employee or HR can fill the exit interview');
  if (!['APPROVED', 'COMPLETED'].includes(r.status)) throw ApiError.badRequest('The exit interview opens once the exit is approved');
  if (r.closedAt) throw ApiError.badRequest('This exit case is closed');
  const data = {
    answers: input.answers as unknown as Prisma.InputJsonValue,
    overallRating: input.overallRating ?? null,
    wouldRejoin: input.wouldRejoin ?? null,
    submittedAt: new Date(),
  };
  const saved = await prisma.exitInterview.upsert({
    where: { resignationId: id },
    create: { companyId, resignationId: id, ...data },
    update: data,
  });
  await autoTickClearances(companyId, id);
  if (isSelf) {
    await notify(companyId, await employeeIdsWithRoles(companyId), {
      event: 'exit.interview_submitted',
      title: 'Exit interview submitted',
      body: 'Answers are available on the exit record.',
      link: `/exits/${id}`,
    });
  }
  return saved;
}

// ---- Letters ----

/** HR issues (or re-issues) the acknowledgement / relieving / experience letter from the exit case. */
export async function issueLetter(companyId: string, id: string, actor: Actor, input: { type: ExitLetterType; reissue?: boolean }) {
  const r = await loadExit(companyId, id);
  if (actor.employeeId === r.employeeId) throw ApiError.forbidden('You cannot issue letters for your own exit');
  if (!['APPROVED', 'COMPLETED'].includes(r.status)) throw ApiError.badRequest('Letters are issued once the exit is approved');
  if (input.type === 'RESIGNATION_ACKNOWLEDGEMENT' && r.exitType !== 'RESIGNATION') {
    throw ApiError.badRequest('A resignation acknowledgement applies only to resignations');
  }
  const existing = (await exitLetters(companyId, r.employeeId, r.appliedOn)).find((l) => l.type === input.type);
  if (existing && !input.reissue) throw ApiError.conflict('This letter was already issued for this exit — re-issue it to generate a new copy');
  const letter = await generateLetter(companyId, { type: input.type, employeeId: r.employeeId, createdById: actor.employeeId });
  if (input.type === 'RESIGNATION_ACKNOWLEDGEMENT' && !r.acknowledgedAt) {
    await prisma.resignation.update({ where: { id: r.id }, data: { acknowledgedAt: new Date() } });
  }
  return letter;
}

// ---- Completion (last working day passed) ----

/**
 * Separates the employee (idempotent, status APPROVED only): revokes access
 * (profile + membership inactive, refresh token cleared), status SEPARATED,
 * re-assigns their direct reports to their own manager, clears department
 * head / hiring manager links, re-routes approvals waiting on them to HR,
 * then issues the relieving / experience letters. Nothing is deleted.
 */
export async function completeExit(companyId: string, resignationId: string): Promise<boolean> {
  const r = await prisma.resignation.findFirst({
    where: { id: resignationId, companyId, status: 'APPROVED' },
    include: { employee: { select: { id: true, name: true, userId: true, managerId: true } } },
  });
  if (!r) return false;
  const lastDay = lastDayOf(r);
  const leaver = r.employee;
  const newManager = leaver.managerId
    ? await prisma.employee.findFirst({ where: { id: leaver.managerId, companyId }, select: { id: true, name: true, isActive: true } })
    : null;
  const successor = newManager?.isActive ? newManager : null;

  const result = await prisma.$transaction(
    async (tx) => {
      await tx.employee.update({ where: { id: leaver.id }, data: { isActive: false, leavingDate: lastDay } });
      await tx.membership.updateMany({ where: { userId: leaver.userId, companyId }, data: { isActive: false } });
      // Force re-login (same as a manual deactivation); access to other companies is restored on next login.
      await tx.user.update({ where: { id: leaver.userId }, data: { refreshTokenHash: null } });
      await tx.resignation.update({ where: { id: r.id }, data: { status: 'COMPLETED' } });
      await setEmploymentStatus(tx, companyId, leaver.id, 'SEPARATED', {
        effectiveDate: lastDay,
        reason: `${humanize(r.exitType)}: ${r.reason}`.slice(0, 500),
        refType: 'Resignation',
        refId: r.id,
        title: `Separated (${humanize(r.exitType).toLowerCase()}) — last working day ${longDate(lastDay)}`,
      });

      // Direct reports move up to the leaver's own manager.
      const reports = await tx.employee.findMany({ where: { companyId, managerId: leaver.id, isActive: true }, select: { id: true } });
      for (const rep of reports) {
        await tx.employee.update({ where: { id: rep.id }, data: { managerId: successor?.id ?? null } });
        await recordHistory(tx, {
          companyId,
          employeeId: rep.id,
          type: 'MANAGER_CHANGE',
          effectiveDate: todayUTC(),
          title: `Reporting manager: ${leaver.name} → ${successor?.name ?? 'none'}`,
          from: { managerId: leaver.id, managerName: leaver.name },
          to: { managerId: successor?.id ?? null, managerName: successor?.name ?? null },
          reason: `${leaver.name} separated from the company`,
          refType: 'Resignation',
          refId: r.id,
        });
      }
      const heads = await tx.department.updateMany({ where: { companyId, headId: leaver.id }, data: { headId: null } });
      const jobs = await tx.jobOpening.updateMany({ where: { companyId, hiringManagerId: leaver.id }, data: { hiringManagerId: null } });
      const reqs = await tx.jobRequisition.updateMany({ where: { companyId, hiringManagerId: leaver.id }, data: { hiringManagerId: null } });
      const steps = await tx.approvalStep.updateMany({
        where: { companyId, status: 'PENDING', approverEmployeeId: leaver.id },
        data: { approverType: 'ROLE', approverRole: 'HR', approverEmployeeId: null },
      });
      return { reports: reports.map((x) => x.id), departmentsHeaded: heads.count, jobs: jobs.count + reqs.count, approvalsRerouted: steps.count };
    },
    { timeout: 30_000 }
  );

  await autoLetter(companyId, r, 'RELIEVING');
  if (!NO_EXPERIENCE_LETTER.includes(r.exitType)) await autoLetter(companyId, r, 'EXPERIENCE');
  await audit(null, {
    companyId,
    entity: 'Resignation',
    entityId: r.id,
    action: 'COMPLETE',
    after: { status: 'COMPLETED', employeeDeactivated: leaver.id, newManagerId: successor?.id ?? null, ...result },
  });
  await notify(companyId, [leaver.id], {
    event: 'exit.confirmation',
    title: 'Your separation is complete',
    body: `Your last working day was ${longDate(lastDay)}. Your relieving documents and F&F statement will be shared by HR.`,
    email: true,
  });
  if (result.reports.length) {
    await notify(companyId, [...result.reports, successor?.id], {
      event: 'exit.reports_reassigned',
      title: 'Reporting line updated',
      body: `${leaver.name} has left; ${successor ? `${successor.name} is now the reporting manager` : 'HR will assign a new reporting manager'}.`,
      link: '/profile',
    });
  }
  await notify(companyId, await employeeIdsWithRoles(companyId), {
    event: 'exit.completed',
    title: `${leaver.name} has been relieved`,
    body: `Access revoked${result.reports.length ? `, ${result.reports.length} report(s) moved to ${successor?.name ?? 'no manager'}` : ''}${result.approvalsRerouted ? `, ${result.approvalsRerouted} pending approval(s) moved to HR` : ''}.`,
    link: `/exits/${r.id}`,
  });
  return true;
}

/** Daily job: completes approved exits whose last working day has passed. Idempotent. */
export async function completeDueExits(companyId: string): Promise<number> {
  const due = await prisma.resignation.findMany({
    where: { companyId, status: 'APPROVED', approvedLastDay: { lt: todayUTC() } },
    select: { id: true },
  });
  let done = 0;
  for (const r of due) {
    try {
      if (await completeExit(companyId, r.id)) done++;
    } catch (err) {
      logger.error({ err, companyId, resignationId: r.id }, 'exit completion failed');
    }
  }
  return done;
}

// ---- Close & archive ----

export async function closeCase(companyId: string, id: string, actor: Actor, input: { rehireEligible: boolean; rehireNote: string }) {
  let r = await loadExit(companyId, id);
  if (actor.employeeId === r.employeeId) throw ApiError.forbidden('You cannot close your own exit case');
  if (r.closedAt) throw ApiError.conflict('The exit case is already closed');
  if (!input.rehireEligible && !input.rehireNote.trim()) throw ApiError.badRequest('Give a reason when the employee is not eligible for rehire');
  const [clearances, settlement, letters] = await Promise.all([
    prisma.exitClearance.findMany({ where: { resignationId: r.id }, select: { status: true } }),
    prisma.finalSettlement.findUnique({ where: { resignationId: r.id }, select: { status: true, netAmount: true } }),
    exitLetters(companyId, r.employeeId, r.appliedOn),
  ]);
  const blockers = closeBlockers(r, clearances, settlement, letters.map((l) => l.type));
  if (blockers.length) throw ApiError.badRequest(`The case cannot be closed yet: ${blockers.join('; ')}`);
  // Last day passed but the daily job has not run yet.
  if (r.status === 'APPROVED') {
    await completeExit(companyId, r.id);
    r = await loadExit(companyId, id);
  }
  const before = { status: r.status, closedAt: r.closedAt, rehireEligible: r.employee.rehireEligible, rehireNote: r.employee.rehireNote };
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.resignation.update({ where: { id: r.id }, data: { closedAt: now, status: 'COMPLETED' } });
    await setEmploymentStatus(tx, companyId, r.employeeId, 'SEPARATED', { effectiveDate: lastDayOf(r), reason: r.reason, refType: 'Resignation', refId: r.id });
    await tx.employee.update({
      where: { id: r.employeeId },
      data: { archivedAt: now, rehireEligible: input.rehireEligible, rehireNote: input.rehireNote.trim() },
    });
  });
  await notify(companyId, await employeeIdsWithRoles(companyId), {
    event: 'exit.closed',
    title: `Exit case closed${r.code ? ` — ${r.code}` : ''}`,
    body: `${r.employee.name}'s profile is archived (${input.rehireEligible ? 'eligible' : 'not eligible'} for rehire).`,
    link: `/exits/${r.id}`,
  });
  const after = await prisma.resignation.findUniqueOrThrow({ where: { id: r.id } });
  return { before, after: { status: after.status, closedAt: after.closedAt, rehireEligible: input.rehireEligible, rehireNote: input.rehireNote.trim() }, resignation: after };
}

/** HR revisits rehire eligibility of a former employee. */
export async function updateRehire(companyId: string, id: string, actor: Actor, input: { rehireEligible: boolean; rehireNote: string }) {
  const r = await loadExit(companyId, id);
  if (actor.employeeId === r.employeeId) throw ApiError.forbidden();
  if (r.status !== 'COMPLETED') throw ApiError.badRequest('Rehire eligibility is set once the employee has separated');
  if (!input.rehireEligible && !input.rehireNote.trim()) throw ApiError.badRequest('Give a reason when the employee is not eligible for rehire');
  const before = { rehireEligible: r.employee.rehireEligible, rehireNote: r.employee.rehireNote };
  const emp = await prisma.employee.update({
    where: { id: r.employeeId },
    data: { rehireEligible: input.rehireEligible, rehireNote: input.rehireNote.trim() },
    select: { id: true, rehireEligible: true, rehireNote: true },
  });
  return { employeeId: emp.id, before, after: { rehireEligible: emp.rehireEligible, rehireNote: emp.rehireNote } };
}
