/**
 * Notice period work: handover tasks (manager / HR assign → leaver marks
 * DONE → manager verifies) and the read-only attendance & leave summary of
 * the notice period for HR.
 */
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';
import { dateOnly, isCompanyAdmin, longDate, todayUTC } from '../utils/lifecycle';
import { type Actor, assertCanView, assertManagerOrHr, lastDayOf, loadExit, type LoadedExit } from './exit.helpers';
import { autoTickClearances } from './exit-clearance.service';

export interface HandoverInput {
  title: string;
  description?: string;
  handoverToId?: string | null;
  dueDate?: Date | null;
}

/** Handover is planned from submission and runs until the exit completes. */
function assertOpen(r: LoadedExit) {
  if (r.status !== 'PENDING' && r.status !== 'APPROVED') {
    throw ApiError.badRequest(`Handover is closed — the exit is ${r.status.toLowerCase()}`);
  }
}

async function assertColleague(companyId: string, r: LoadedExit, employeeId: string | null | undefined) {
  if (!employeeId) return null;
  if (employeeId === r.employeeId) throw ApiError.badRequest('Work cannot be handed over to the leaver');
  const e = await prisma.employee.findFirst({ where: { id: employeeId, companyId, isActive: true }, select: { id: true, name: true } });
  if (!e) throw ApiError.badRequest('The colleague receiving the handover must be an active employee');
  return e;
}

async function loadTask(companyId: string, resignationId: string, taskId: string) {
  const t = await prisma.handoverTask.findFirst({ where: { id: taskId, companyId, resignationId } });
  if (!t) throw ApiError.notFound('Handover task not found');
  return t;
}

/** Tasks with the names of the receiving colleague / verifier. */
export async function listTasks(companyId: string, resignationId: string) {
  const tasks = await prisma.handoverTask.findMany({ where: { companyId, resignationId }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] });
  const ids = [...new Set(tasks.flatMap((t) => [t.handoverToId, t.verifiedById, t.createdById]).filter((x): x is string => !!x))];
  const people = ids.length ? await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? null) : null);
  const today = todayUTC();
  return tasks.map((t) => ({
    ...t,
    handoverToName: name(t.handoverToId),
    verifiedByName: name(t.verifiedById),
    createdByName: name(t.createdById),
    overdue: t.status === 'PENDING' && !!t.dueDate && t.dueDate < today,
  }));
}

export async function createTask(companyId: string, id: string, actor: Actor, input: HandoverInput) {
  const r = await loadExit(companyId, id);
  assertManagerOrHr(r, actor, 'assign handover tasks');
  assertOpen(r);
  const colleague = await assertColleague(companyId, r, input.handoverToId);
  const due = input.dueDate ? dateOnly(input.dueDate) : null;
  if (due && due > lastDayOf(r)) throw ApiError.badRequest(`The due date must be on or before the last working day (${longDate(lastDayOf(r))})`);
  const task = await prisma.handoverTask.create({
    data: {
      companyId,
      resignationId: r.id,
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      handoverToId: colleague?.id ?? null,
      dueDate: due,
      createdById: actor.employeeId,
    },
  });
  await notify(companyId, [r.employeeId], {
    event: 'exit.handover_assigned',
    title: 'New handover task',
    body: `${task.title}${due ? ` — due ${longDate(due)}` : ''}${colleague ? `, hand over to ${colleague.name}` : ''}.`,
    link: '/exits',
  });
  if (colleague) {
    await notify(companyId, [colleague.id], {
      event: 'exit.handover_receiving',
      title: `${r.employee.name} will hand over work to you`,
      body: task.title,
      link: `/exits/${r.id}`,
    });
  }
  return task;
}

export async function updateTask(companyId: string, id: string, taskId: string, actor: Actor, input: Partial<HandoverInput>) {
  const r = await loadExit(companyId, id);
  assertManagerOrHr(r, actor, 'edit handover tasks');
  assertOpen(r);
  const before = await loadTask(companyId, id, taskId);
  if (before.status === 'VERIFIED') throw ApiError.badRequest('A verified task can no longer be edited');
  const colleague = input.handoverToId !== undefined ? await assertColleague(companyId, r, input.handoverToId) : undefined;
  const due = input.dueDate === undefined ? undefined : input.dueDate ? dateOnly(input.dueDate) : null;
  if (due && due > lastDayOf(r)) throw ApiError.badRequest(`The due date must be on or before the last working day (${longDate(lastDayOf(r))})`);
  const after = await prisma.handoverTask.update({
    where: { id: before.id },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      ...(colleague !== undefined ? { handoverToId: colleague?.id ?? null } : {}),
      ...(due !== undefined ? { dueDate: due } : {}),
    },
  });
  return { before, after };
}

export async function deleteTask(companyId: string, id: string, taskId: string, actor: Actor) {
  const r = await loadExit(companyId, id);
  assertManagerOrHr(r, actor, 'remove handover tasks');
  assertOpen(r);
  const task = await loadTask(companyId, id, taskId);
  if (task.status === 'VERIFIED') throw ApiError.badRequest('A verified task cannot be removed');
  await prisma.handoverTask.delete({ where: { id: task.id } });
  return task;
}

/** The leaver (or HR on their behalf) marks a task done. */
export async function completeTask(companyId: string, id: string, taskId: string, actor: Actor, input: { notes?: string }) {
  const r = await loadExit(companyId, id);
  if (actor.employeeId !== r.employeeId && !isCompanyAdmin(actor.role)) throw ApiError.forbidden('Only the leaver marks handover tasks done');
  assertOpen(r);
  const before = await loadTask(companyId, id, taskId);
  if (before.status === 'VERIFIED') throw ApiError.badRequest('This task is already verified');
  const after = await prisma.handoverTask.update({
    where: { id: before.id },
    data: { status: 'DONE', completedAt: new Date(), ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}) },
  });
  await notify(companyId, [r.employee.managerId, before.handoverToId], {
    event: 'exit.handover_done',
    title: `${r.employee.name} completed a handover task`,
    body: `${before.title} — please verify.`,
    link: `/exits/${r.id}`,
  });
  return { before, after };
}

/** Manager / HR verifies a DONE task, or sends it back to the leaver. */
export async function verifyTask(
  companyId: string,
  id: string,
  taskId: string,
  actor: Actor,
  input: { decision: 'VERIFIED' | 'REOPEN'; notes?: string }
) {
  const r = await loadExit(companyId, id);
  assertManagerOrHr(r, actor, 'verify handover');
  assertOpen(r);
  const before = await loadTask(companyId, id, taskId);
  if (input.decision === 'VERIFIED' && before.status !== 'DONE') {
    throw ApiError.badRequest(before.status === 'VERIFIED' ? 'This task is already verified' : 'The leaver has not marked this task done yet');
  }
  const notes = input.notes?.trim() ? [before.notes, `Reviewer: ${input.notes.trim()}`].filter(Boolean).join('\n') : before.notes;
  const after = await prisma.handoverTask.update({
    where: { id: before.id },
    data:
      input.decision === 'VERIFIED'
        ? { status: 'VERIFIED', verifiedById: actor.employeeId, verifiedAt: new Date(), notes }
        : { status: 'PENDING', completedAt: null, verifiedById: null, verifiedAt: null, notes },
  });
  if (input.decision === 'REOPEN') {
    await notify(companyId, [r.employeeId], {
      event: 'exit.handover_reopened',
      title: 'Handover task sent back',
      body: `${before.title}${input.notes ? ` — ${input.notes}` : ''}`,
      link: '/exits',
    });
  }
  await autoTickClearances(companyId, r.id);
  return { before, after };
}

// ---- Notice period attendance & leave (read-only) ----

/**
 * Attendance by status and leaves taken between the resignation date and
 * today (or the last working day when that is earlier).
 */
export async function noticeSummary(companyId: string, id: string, viewer: Actor) {
  const r = await loadExit(companyId, id);
  assertCanView(r, viewer);
  const from = dateOnly(r.appliedOn);
  const lastDay = lastDayOf(r);
  const today = todayUTC();
  const to = lastDay < today ? lastDay : today;

  const [records, leaves] = await Promise.all([
    to >= from
      ? prisma.attendanceRecord.findMany({
          where: { companyId, employeeId: r.employeeId, date: { gte: from, lte: to } },
          select: { date: true, status: true, workedMinutes: true, lateMinutes: true },
        })
      : Promise.resolve([]),
    prisma.leaveRequest.findMany({
      where: { companyId, employeeId: r.employeeId, status: { in: ['PENDING', 'APPROVED'] }, toDate: { gte: from }, fromDate: { lte: lastDay } },
      include: { leaveType: { select: { name: true, code: true, isPaid: true } } },
      orderBy: { fromDate: 'asc' },
    }),
  ]);
  const byStatus: Record<string, number> = {};
  for (const a of records) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
  const approvedLeaves = leaves.filter((l) => l.status === 'APPROVED');
  return {
    from,
    to,
    lastDay,
    attendance: {
      present: (byStatus.PRESENT ?? 0) + (byStatus.LATE ?? 0),
      late: byStatus.LATE ?? 0,
      halfDay: byStatus.HALF_DAY ?? 0,
      absent: byStatus.ABSENT ?? 0,
      leave: byStatus.LEAVE ?? 0,
      holidays: (byStatus.HOLIDAY ?? 0) + (byStatus.WEEKEND ?? 0),
      lateMinutes: records.reduce((s, a) => s + a.lateMinutes, 0),
      recorded: records.length,
    },
    leaves: leaves.map((l) => ({
      id: l.id,
      leaveType: l.leaveType.name,
      code: l.leaveType.code,
      isPaid: l.leaveType.isPaid,
      fromDate: l.fromDate,
      toDate: l.toDate,
      days: l.days,
      status: l.status,
      reason: l.reason,
    })),
    leaveDaysApproved: approvedLeaves.reduce((s, l) => s + l.days, 0),
    leaveDaysPending: leaves.filter((l) => l.status === 'PENDING').reduce((s, l) => s + l.days, 0),
  };
}
