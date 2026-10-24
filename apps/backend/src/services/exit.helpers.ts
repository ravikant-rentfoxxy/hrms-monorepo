/**
 * Shared pieces of the separation (exit) modules — exit.service (case,
 * notice, completion, close), exit-handover.service, exit-clearance.service
 * and settlement.service: constants, permission checks, notice maths and the
 * stage of an exit case.
 */
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/http';
import { addDays, daysBetween, dateOnly, isCompanyAdmin, todayUTC } from '../utils/lifecycle';

export const EXIT_TYPES = ['RESIGNATION', 'TERMINATION', 'RETIREMENT', 'ABSCONDING', 'END_OF_CONTRACT'] as const;
export type ExitType = (typeof EXIT_TYPES)[number];
export const CLEARANCE_DEPARTMENTS = ['MANAGER', 'IT', 'FINANCE', 'ADMIN', 'HR'] as const;
export type ClearanceDept = (typeof CLEARANCE_DEPARTMENTS)[number];

/** Exits that are still running (awaiting approval or serving notice). */
export const ACTIVE_STATUSES = ['PENDING', 'APPROVED'];

/** Exit types whose relieving letter is issued without an experience certificate. */
export const NO_EXPERIENCE_LETTER: string[] = ['ABSCONDING', 'TERMINATION'];

export interface Actor {
  role: Role;
  employeeId: string | null;
}

export const employeeSelect = {
  id: true, name: true, employeeCode: true, designation: true, department: true, joiningDate: true,
  managerId: true, noticePeriodDays: true, avatarColor: true, isActive: true, leavingDate: true,
  employmentStatus: true, separatedOn: true, rehireEligible: true, rehireNote: true, archivedAt: true, userId: true,
} satisfies Prisma.EmployeeSelect;

/** The exit case with its employee; 404 when it is not in this company. */
export async function loadExit(companyId: string, id: string) {
  const r = await prisma.resignation.findFirst({ where: { id, companyId }, include: { employee: { select: employeeSelect } } });
  if (!r) throw ApiError.notFound('Exit case not found');
  return r;
}
export type LoadedExit = Awaited<ReturnType<typeof loadExit>>;

export const isReportingManager = (r: { employee: { managerId: string | null } }, actor: Actor): boolean =>
  !!actor.employeeId && r.employee.managerId === actor.employeeId;

/** HR / ADMIN, or the leaver's reporting manager — never the leaver. */
export function assertManagerOrHr(r: LoadedExit, actor: Actor, what = 'do this') {
  if (actor.employeeId && actor.employeeId === r.employeeId) throw ApiError.forbidden(`You cannot ${what} on your own exit`);
  if (isCompanyAdmin(actor.role) || isReportingManager(r, actor)) return;
  throw ApiError.forbidden(`Only the reporting manager or HR can ${what}`);
}

export function assertCanView(
  r: { employeeId: string; exitInterviewerId?: string | null; employee: { managerId: string | null } },
  viewer: Actor
) {
  if (isCompanyAdmin(viewer.role)) return;
  if (viewer.employeeId && (r.employeeId === viewer.employeeId || r.employee.managerId === viewer.employeeId)) return;
  if (viewer.employeeId && r.exitInterviewerId === viewer.employeeId) return;
  throw ApiError.forbidden();
}

export const lastDayOf = (r: { approvedLastDay: Date | null; requestedLastDay: Date }): Date => r.approvedLastDay ?? r.requestedLastDay;

/**
 * Notice days not served (recovered in F&F). Only resignations / absconding
 * owe notice; a waiver clears it.
 */
export function shortfallFor(
  r: { exitType: string; noticeWaived: boolean; noticePeriodDays: number; appliedOn: Date },
  lastDay: Date
): number {
  const exempt = r.noticeWaived || (r.exitType !== 'RESIGNATION' && r.exitType !== 'ABSCONDING');
  if (exempt) return 0;
  const served = Math.max(0, daysBetween(r.appliedOn, lastDay));
  return Math.max(0, r.noticePeriodDays - served);
}

/** Notice period progress: calendar days from the resignation date to the last working day. */
export function noticeInfo(r: { appliedOn: Date; approvedLastDay: Date | null; requestedLastDay: Date; status: string }, today = todayUTC()) {
  const start = dateOnly(r.appliedOn);
  const lastDay = lastDayOf(r);
  const totalDays = Math.max(0, daysBetween(start, lastDay));
  const servedDays = Math.min(totalDays, Math.max(0, daysBetween(start, today)));
  const remainingDays = Math.max(0, daysBetween(today, lastDay));
  return {
    startDate: start,
    lastDay,
    totalDays,
    servedDays,
    remainingDays,
    serving: r.status === 'APPROVED' && today.getTime() <= lastDay.getTime(),
  };
}

/** `days` working days after `from` (weekends and the company's non-optional holidays skipped). */
export async function addWorkingDays(companyId: string, from: Date, days: number, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<Date> {
  const start = dateOnly(from);
  const holidays = await db.holiday.findMany({
    where: { companyId, optional: false, date: { gt: start, lte: addDays(start, days + 30) } },
    select: { date: true },
  });
  const off = new Set(holidays.map((h) => dateOnly(h.date).getTime()));
  let d = start;
  let left = days;
  while (left > 0) {
    d = addDays(d, 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !off.has(d.getTime())) left--;
  }
  return d;
}

/** Code on Wages: F&F is due within 2 working days of the last working day. */
export const FNF_DUE_WORKING_DAYS = 2;

// ---- Stage of an exit case ----

export const EXIT_STAGES = [
  { key: 'SUBMITTED', label: 'Resignation submitted' },
  { key: 'NOTICE', label: 'Approved / serving notice' },
  { key: 'HANDOVER', label: 'Handover' },
  { key: 'CLEARANCE', label: 'Clearance' },
  { key: 'SETTLEMENT', label: 'F&F settlement' },
  { key: 'LETTERS', label: 'Letters' },
  { key: 'CLOSED', label: 'Closed / archived' },
] as const;
export type ExitStageKey = (typeof EXIT_STAGES)[number]['key'];

export interface StageInput {
  exitType: string;
  status: string;
  closedAt: Date | null;
  handoverTasks: { status: string }[];
  clearances: { department: string; status: string }[];
  settlement: { status: string; netAmount: number } | null;
  letterTypes: string[];
}

/** F&F is settled when paid, or approved with nothing to pay / recover. */
export const settlementDone = (s: { status: string; netAmount: number } | null): boolean =>
  !!s && (s.status === 'PAID' || (s.status === 'APPROVED' && Math.abs(s.netAmount) < 0.005));

export const lettersDone = (exitType: string, letterTypes: string[]): boolean =>
  letterTypes.includes('RELIEVING') && (letterTypes.includes('EXPERIENCE') || NO_EXPERIENCE_LETTER.includes(exitType));

export const clearanceOverall = (clearances: { status: string }[]): 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' =>
  clearances.length > 0 && clearances.every((c) => c.status === 'CLEARED')
    ? 'COMPLETED'
    : clearances.some((c) => c.status !== 'PENDING')
      ? 'IN_PROGRESS'
      : 'PENDING';

/**
 * Where the case stands: every step with its done flag, the current step and
 * a percentage for the progress bar. Rejected / withdrawn requests stop at
 * the first step.
 */
export function exitStage(x: StageInput) {
  const approved = x.status === 'APPROVED' || x.status === 'COMPLETED';
  const handover = approved && (x.handoverTasks.length > 0
    ? x.handoverTasks.every((t) => t.status === 'VERIFIED')
    : x.clearances.some((c) => c.department === 'MANAGER' && c.status === 'CLEARED'));
  const done: Record<ExitStageKey, boolean> = {
    SUBMITTED: true,
    NOTICE: approved,
    HANDOVER: handover,
    CLEARANCE: approved && clearanceOverall(x.clearances) === 'COMPLETED',
    SETTLEMENT: approved && settlementDone(x.settlement),
    LETTERS: approved && lettersDone(x.exitType, x.letterTypes),
    CLOSED: !!x.closedAt,
  };
  const steps = EXIT_STAGES.map((s) => ({ ...s, done: done[s.key] }));
  const stopped = x.status === 'REJECTED' || x.status === 'WITHDRAWN';
  const current = stopped ? 'SUBMITTED' : (steps.find((s) => !s.done)?.key ?? 'CLOSED');
  const doneCount = steps.filter((s) => s.done).length;
  return {
    steps,
    current,
    currentLabel: stopped ? (x.status === 'REJECTED' ? 'Rejected' : 'Withdrawn') : (EXIT_STAGES.find((s) => s.key === current)?.label ?? ''),
    progress: stopped ? 0 : Math.round((doneCount / steps.length) * 100),
  };
}

/** Letter types filed on an exit case. */
export const EXIT_LETTER_TYPES = ['RESIGNATION_ACKNOWLEDGEMENT', 'RELIEVING', 'EXPERIENCE'] as const;
export type ExitLetterType = (typeof EXIT_LETTER_TYPES)[number];

/** Letters of this exit (issued on or after the resignation date — earlier ones belong to a previous stint). */
export async function exitLetters(companyId: string, employeeId: string, since: Date) {
  return prisma.generatedLetter.findMany({
    where: { companyId, employeeId, type: { in: [...EXIT_LETTER_TYPES] }, createdAt: { gte: dateOnly(since) } },
    select: { id: true, type: true, title: true, createdAt: true, createdById: true, documentId: true },
    orderBy: { createdAt: 'asc' },
  });
}
