/**
 * Aggregated home-screen data in one call.
 *
 * Every caller gets the personal block (unchanged fields + `myPending`);
 * ADMIN/HR additionally get `company` analytics and managers get `team`.
 */
import type { AttendanceStatus, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { dateOnlyUTC } from '../utils/geo';
import {
  activeAt, addDays, celebrations, deptName, isoDate, lastMonths, loadEmployees, monthEnd,
  monthStart, monthlyHeadcount, payrollTotalsByMonth, probationDueList,
} from './report.service';

export interface DashboardViewer {
  role: Role;
  employeeId: string | null;
}

const isCompanyAdmin = (role: Role) => role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR';

export async function dashboard(companyId: string, viewer: DashboardViewer) {
  const { employeeId } = viewer;
  const today = dateOnlyUTC();

  const [todayAttendance, pendingLeaves, upcomingHolidays, announcements, openTickets, pendingExpenses, tasksDue, approvalsToAct] =
    await Promise.all([
      employeeId
        ? prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date: today } } })
        : null,
      employeeId ? prisma.leaveRequest.count({ where: { companyId, employeeId, status: 'PENDING' } }) : 0,
      prisma.holiday.findMany({
        where: { companyId, date: { gte: today } },
        orderBy: { date: 'asc' },
        take: 3,
      }),
      prisma.announcement.findMany({
        where: { companyId },
        orderBy: { postedOn: 'desc' },
        take: 5,
        include: { reads: employeeId ? { where: { employeeId }, select: { readAt: true } } : false },
      }),
      employeeId
        ? prisma.ticket.count({ where: { companyId, employeeId, status: { in: ['OPEN', 'IN_PROGRESS'] } } })
        : 0,
      employeeId ? prisma.expenseClaim.count({ where: { companyId, employeeId, status: 'PENDING' } }) : 0,
      employeeId ? prisma.task.count({ where: { companyId, employeeId, done: false } }) : 0,
      employeeId ? pendingApprovalsFor(companyId, employeeId) : 0,
    ]);

  const [company, team] = await Promise.all([
    isCompanyAdmin(viewer.role) ? companyAnalytics(companyId) : null,
    viewer.role === 'MANAGER' && employeeId ? teamToday(companyId, employeeId) : null,
  ]);

  return {
    todayAttendance,
    pendingLeaves,
    upcomingHolidays,
    announcements: announcements.map(({ reads, ...a }) => ({ ...a, read: Array.isArray(reads) && reads.length > 0 })),
    unreadAnnouncements: announcements.filter((a) => !(Array.isArray(a.reads) && a.reads.length > 0)).length,
    openTickets,
    pendingExpenses,
    tasksDue,
    /** Everything waiting on the caller: own open requests + approvals they can act on. */
    myPending: {
      leaves: pendingLeaves,
      expenses: pendingExpenses,
      tickets: openTickets,
      tasks: tasksDue,
      approvals: approvalsToAct,
    },
    company,
    team,
  };
}

/**
 * Requests whose current (lowest pending) approval level names this employee.
 * Approximate: ROLE-type steps are not resolved here.
 */
async function pendingApprovalsFor(companyId: string, employeeId: string): Promise<number> {
  const steps = await prisma.approvalStep.findMany({
    where: { companyId, status: 'PENDING' },
    select: { module: true, requestId: true, level: true, approverEmployeeId: true },
  });
  const current = new Map<string, { level: number; approver: string | null }>();
  for (const s of steps) {
    const key = `${s.module}:${s.requestId}`;
    const cur = current.get(key);
    if (!cur || s.level < cur.level) current.set(key, { level: s.level, approver: s.approverEmployeeId });
  }
  return [...current.values()].filter((c) => c.approver === employeeId).length;
}

/** Status of each employee today: attendance record, else approved leave covering today. */
async function todayStatuses(companyId: string, employeeIds: string[]) {
  const today = dateOnlyUTC();
  const [records, leaves] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { companyId, date: today, employeeId: { in: employeeIds } },
      select: { employeeId: true, status: true, checkIn: true, checkOut: true },
    }),
    prisma.leaveRequest.findMany({
      where: { companyId, status: 'APPROVED', fromDate: { lte: today }, toDate: { gte: today }, employeeId: { in: employeeIds } },
      select: { employeeId: true },
    }),
  ]);
  const byEmp = new Map(records.map((r) => [r.employeeId, r]));
  const onLeave = new Set(leaves.map((l) => l.employeeId));
  const split = { total: employeeIds.length, present: 0, late: 0, absent: 0, onLeave: 0, notMarked: 0, off: 0 };
  const statusOf = new Map<string, { status: AttendanceStatus | 'NOT_MARKED'; checkIn: Date | null; checkOut: Date | null }>();
  for (const id of employeeIds) {
    const r = byEmp.get(id);
    let status: AttendanceStatus | 'NOT_MARKED' = r?.status ?? 'NOT_MARKED';
    // An approved leave wins over an auto-marked absence.
    if (onLeave.has(id) && (!r || r.status === 'ABSENT')) status = 'LEAVE';
    statusOf.set(id, { status, checkIn: r?.checkIn ?? null, checkOut: r?.checkOut ?? null });
    if (status === 'PRESENT' || status === 'HALF_DAY') split.present += 1;
    else if (status === 'LATE') split.late += 1;
    else if (status === 'ABSENT') split.absent += 1;
    else if (status === 'LEAVE') split.onLeave += 1;
    else if (status === 'HOLIDAY' || status === 'WEEKEND') split.off += 1;
    else split.notMarked += 1;
  }
  return { split, statusOf };
}

async function companyAnalytics(companyId: string) {
  const today = dateOnlyUTC();
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  const scope = { companyId };
  const emps = await loadEmployees(scope);
  const active = emps.filter((e) => activeAt(e, today));

  const trend = monthlyHeadcount(emps, lastMonths(y, m, 12));
  const exits12 = trend.reduce((s, r) => s + r.exits, 0);
  const avg12 = trend.reduce((s, r) => s + (r.opening + r.headcount) / 2, 0) / (trend.length || 1);
  const thisMonth = trend[trend.length - 1];

  const prev = lastMonths(y, m, 2)[0] ?? { y, m };
  const [todaySplit, pendingApprovals, payroll, probation, openJobs, openTickets] = await Promise.all([
    todayStatuses(companyId, active.map((e) => e.id)),
    companyPendingApprovals(companyId),
    payrollTotalsByMonth(scope, {}, [prev]),
    probationDueList(scope, {}, 30),
    prisma.jobOpening.findMany({ where: { companyId, status: 'OPEN' }, select: { openings: true } }),
    prisma.ticket.count({ where: { companyId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
  ]);
  const lastPayroll = payroll[0];

  const upcoming = celebrations(emps, today, addDays(today, 30));
  const person = (e: (typeof emps)[number]) => ({
    id: e.id,
    name: e.name,
    department: deptName(e),
    designation: e.designationRef?.name || e.designation,
  });

  const depts = new Map<string, number>();
  for (const e of active) depts.set(deptName(e), (depts.get(deptName(e)) ?? 0) + 1);

  return {
    headcount: active.length,
    joinersThisMonth: thisMonth?.joiners ?? 0,
    exitsThisMonth: thisMonth?.exits ?? 0,
    /** Exits in the last 12 months ÷ average headcount, %. */
    attritionRate12m: avg12 ? Math.round((exits12 / avg12) * 1000) / 10 : 0,
    today: todaySplit.split,
    pendingApprovals,
    payrollLastMonth:
      lastPayroll && lastPayroll.employees > 0
        ? { ...lastPayroll, monthStart: isoDate(monthStart(prev.y, prev.m)) }
        : null,
    upcomingBirthdays: upcoming
      .filter((c) => c.type === 'Birthday')
      .slice(0, 8)
      .map((c) => ({ ...person(c.employee), date: isoDate(c.date) })),
    upcomingAnniversaries: upcoming
      .filter((c) => c.type === 'Anniversary')
      .slice(0, 8)
      .map((c) => ({ ...person(c.employee), date: isoDate(c.date), years: c.years })),
    probationDue: {
      count: probation.length,
      items: probation.slice(0, 8).map((p) => ({
        ...person(p.employee),
        probationEndDate: isoDate(p.probationEndDate),
        daysLeft: p.daysLeft,
      })),
    },
    openPositions: { jobs: openJobs.length, openings: openJobs.reduce((s, j) => s + j.openings, 0) },
    openTickets,
    headcountTrend: trend.slice(-6).map((r) => ({ month: r.month, headcount: r.headcount, joiners: r.joiners, exits: r.exits })),
    departments: [...depts]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
    asOf: isoDate(today),
    monthEnd: isoDate(monthEnd(y, m)),
  };
}

/**
 * Distinct requests awaiting a decision: open approval chains plus legacy
 * PENDING leave / expense / regularization requests without a chain (approximate).
 */
async function companyPendingApprovals(companyId: string): Promise<number> {
  const [steps, leaves, expenses, regs] = await Promise.all([
    prisma.approvalStep.findMany({ where: { companyId, status: 'PENDING' }, distinct: ['module', 'requestId'], select: { requestId: true } }),
    prisma.leaveRequest.findMany({ where: { companyId, status: 'PENDING' }, select: { id: true } }),
    prisma.expenseClaim.findMany({ where: { companyId, status: 'PENDING' }, select: { id: true } }),
    prisma.regularizationRequest.findMany({ where: { companyId, status: 'PENDING' }, select: { id: true } }),
  ]);
  const ids = new Set(steps.map((s) => s.requestId));
  for (const r of [...leaves, ...expenses, ...regs]) ids.add(r.id);
  return ids.size;
}

/** Team today for a manager: split, pending requests and each direct report's status. */
export async function teamToday(companyId: string, managerId: string) {
  const today = dateOnlyUTC();
  const reports = await prisma.employee.findMany({
    where: { companyId, managerId, isActive: true },
    select: { id: true, name: true, employeeCode: true, designation: true, department: true, avatarColor: true, joiningDate: true, leavingDate: true, isActive: true },
    orderBy: { name: 'asc' },
  });
  const team = reports.filter((e) => activeAt(e, today));
  const ids = team.map((e) => e.id);
  const [{ split, statusOf }, leaves, expenses, regs, approvals] = await Promise.all([
    todayStatuses(companyId, ids),
    prisma.leaveRequest.count({ where: { companyId, employeeId: { in: ids }, status: 'PENDING' } }),
    prisma.expenseClaim.count({ where: { companyId, employeeId: { in: ids }, status: 'PENDING' } }),
    prisma.regularizationRequest.count({ where: { companyId, employeeId: { in: ids }, status: 'PENDING' } }),
    pendingApprovalsFor(companyId, managerId),
  ]);
  return {
    size: team.length,
    today: split,
    pendingRequests: {
      leaves,
      expenses,
      regularizations: regs,
      /** Requests (any module) whose current approval step names this manager. */
      awaitingYou: approvals,
      total: leaves + expenses + regs,
    },
    members: team.map((e) => {
      const s = statusOf.get(e.id);
      return {
        id: e.id,
        name: e.name,
        employeeCode: e.employeeCode,
        designation: e.designation,
        department: e.department,
        avatarColor: e.avatarColor,
        status: s?.status ?? 'NOT_MARKED',
        checkIn: s?.checkIn ?? null,
        checkOut: s?.checkOut ?? null,
      };
    }),
  };
}
