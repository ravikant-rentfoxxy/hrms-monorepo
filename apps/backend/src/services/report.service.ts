/**
 * Reports: every report returns the same table-shaped result
 * ({ columns, rows, summary?, chart?, sections?, totals? }) so the web panel
 * can render any of them generically and `toReportCsv` can export them.
 *
 * All queries go straight to Prisma (tenant-scoped by companyId). A manager's
 * scope (`teamOf`) limits employee-level reports to their direct reports.
 */
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/http';
import { toCsv } from '../utils/csv';
import { dateOnlyUTC, workingDays } from '../utils/geo';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Cell = string | number | boolean | null;
export type ColumnType = 'text' | 'number' | 'money' | 'date' | 'percent';

export interface Column {
  key: string;
  label: string;
  type?: ColumnType;
}

export interface ReportTable {
  title?: string;
  columns: Column[];
  rows: Record<string, Cell>[];
}

export interface ReportResult extends ReportTable {
  key: string;
  title: string;
  /** Human-readable period / as-of the report covers. */
  period: string;
  summary?: { label: string; value: Cell; type?: ColumnType }[];
  /** Trend / distribution chart over the main rows. */
  chart?: { type: 'line' | 'bar'; x: string; series: { key: string; label: string }[] };
  /** Footer totals for the main table (also appended to the CSV). */
  totals?: Record<string, Cell>;
  /** Secondary tables (breakdowns). */
  sections?: ReportTable[];
  generatedAt: string;
}

export interface ReportQuery {
  from?: Date;
  to?: Date;
  asOf?: Date;
  year?: number;
  month?: number;
  departmentId?: string;
  department?: string;
  officeId?: string;
  groupBy?: string;
  status?: string;
  days?: number;
}

export interface ReportScope {
  companyId: string;
  /** Manager's employee id → only their direct reports. null/undefined = whole company. */
  teamOf?: string | null;
}

export type ParamType = 'month' | 'period' | 'asOf' | 'year' | 'department' | 'office' | 'groupBy' | 'status' | 'days';

export interface ParamSpec {
  name: string;
  type: ParamType;
  label: string;
  options?: { value: string; label: string }[];
  default?: string | number;
}

interface ReportDef {
  key: string;
  title: string;
  category: 'Workforce' | 'Attendance' | 'Leave' | 'Payroll' | 'Finance' | 'Lifecycle';
  description: string;
  params: ParamSpec[];
  /** Managers may run it for their team. */
  manager: boolean;
  chart: boolean;
  run: (scope: ReportScope, q: ReportQuery) => Promise<ReportResult>;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const monthStart = (y: number, m: number): Date => new Date(Date.UTC(y, m - 1, 1));
/** Last day of the month (midnight UTC). */
export const monthEnd = (y: number, m: number): Date => new Date(Date.UTC(y, m, 0));
export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY);
export const isoDate = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
export const monthLabel = (y: number, m: number): string => `${MONTHS[m - 1] ?? ''} ${y}`;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The `n` calendar months ending with (y, m), oldest first. */
export function lastMonths(y: number, m: number, n: number): { y: number; m: number }[] {
  const out: { y: number; m: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 });
  }
  return out;
}

function monthOf(q: ReportQuery): { y: number; m: number } {
  const today = dateOnlyUTC();
  return { y: q.year ?? today.getUTCFullYear(), m: q.month ?? today.getUTCMonth() + 1 };
}

/** from/to if given, else year+month, else year, else the fallback window. */
function periodOf(q: ReportQuery, fallback: 'month' | 'ytd' | 'last12'): { from: Date; to: Date; label: string } {
  const today = dateOnlyUTC();
  let from: Date;
  let to: Date;
  if (q.from || q.to) {
    to = q.to ?? today;
    from = q.from ?? monthStart(to.getUTCFullYear(), to.getUTCMonth() + 1);
  } else if (q.year && q.month) {
    from = monthStart(q.year, q.month);
    to = monthEnd(q.year, q.month);
  } else if (q.year) {
    from = new Date(Date.UTC(q.year, 0, 1));
    to = new Date(Date.UTC(q.year, 11, 31));
  } else if (fallback === 'month') {
    from = monthStart(today.getUTCFullYear(), today.getUTCMonth() + 1);
    to = monthEnd(today.getUTCFullYear(), today.getUTCMonth() + 1);
  } else if (fallback === 'ytd') {
    from = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    to = today;
  } else {
    from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
    to = today;
  }
  if (from > to) throw ApiError.badRequest('"from" must be on or before "to"');
  if (to.getTime() - from.getTime() > 3 * 366 * DAY) throw ApiError.badRequest('The period cannot exceed 3 years');
  return { from, to, label: `${isoDate(from)} to ${isoDate(to)}` };
}

/** Months touched by a period (oldest first), capped at 36. */
function monthsIn(from: Date, to: Date): { y: number; m: number }[] {
  const out: { y: number; m: number }[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth() + 1;
  while ((y < to.getUTCFullYear() || (y === to.getUTCFullYear() && m <= to.getUTCMonth() + 1)) && out.length < 36) {
    out.push({ y, m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** HH:mm of an instant in the company's timezone. */
export function clockIn(tz: string, d: Date | null): string | null {
  if (!d) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(d);
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

/** Days of a leave request falling inside [from, to] (pro-rated by working days). */
export function leaveDaysWithin(
  req: { fromDate: Date; toDate: Date; days: number },
  from: Date,
  to: Date
): number {
  const s = req.fromDate > from ? req.fromDate : from;
  const e = req.toDate < to ? req.toDate : to;
  if (s > e) return 0;
  if (req.fromDate >= from && req.toDate <= to) return req.days;
  const total = workingDays(req.fromDate, req.toDate);
  if (total === 0) return 0;
  return round2((req.days * workingDays(s, e)) / total);
}

// ---------------------------------------------------------------------------
// Employee helpers
// ---------------------------------------------------------------------------

const EMP_SELECT = {
  id: true,
  employeeCode: true,
  name: true,
  department: true,
  designation: true,
  location: true,
  joiningDate: true,
  leavingDate: true,
  dateOfBirth: true,
  isActive: true,
  gender: true,
  employmentType: true,
  officeId: true,
  managerId: true,
  probationEndDate: true,
  confirmedOn: true,
  salaryBasic: true,
  departmentRef: { select: { name: true } },
  designationRef: { select: { name: true } },
  gradeRef: { select: { name: true, code: true } },
  manager: { select: { name: true } },
} satisfies Prisma.EmployeeSelect;

export type ReportEmployee = Prisma.EmployeeGetPayload<{ select: typeof EMP_SELECT }>;

/** Tenant + team + department/office filters, as an Employee where-clause. */
export function employeeWhere(scope: ReportScope, q: ReportQuery = {}): Prisma.EmployeeWhereInput {
  const where: Prisma.EmployeeWhereInput = { companyId: scope.companyId };
  if (scope.teamOf) where.managerId = scope.teamOf;
  if (q.departmentId) where.departmentId = q.departmentId;
  else if (q.department) {
    where.OR = [
      { department: { equals: q.department, mode: 'insensitive' } },
      { departmentRef: { name: { equals: q.department, mode: 'insensitive' } } },
    ];
  }
  if (q.officeId) where.officeId = q.officeId;
  return where;
}

export function loadEmployees(scope: ReportScope, q: ReportQuery = {}): Promise<ReportEmployee[]> {
  return prisma.employee.findMany({ where: employeeWhere(scope, q), select: EMP_SELECT, orderBy: { name: 'asc' } });
}

export const deptName = (e: { department: string; departmentRef?: { name: string } | null }): string =>
  e.departmentRef?.name || e.department || 'Unassigned';

/**
 * Employed on day `d`: joined on/before it and not yet left. Deactivated
 * employees without a leaving date are treated as gone.
 */
export function activeAt(
  e: { joiningDate: Date; leavingDate: Date | null; isActive: boolean },
  d: Date
): boolean {
  if (e.joiningDate.getTime() >= d.getTime() + DAY) return false;
  if (e.leavingDate) return e.leavingDate.getTime() >= d.getTime();
  return e.isActive;
}

const inRange = (d: Date | null, from: Date, to: Date): boolean =>
  !!d && d.getTime() >= from.getTime() && d.getTime() < to.getTime() + DAY;

const genderLabel = (g: string): string =>
  ({ MALE: 'Male', FEMALE: 'Female', OTHER: 'Other' })[g.toUpperCase()] ?? 'Not specified';

async function officeMap(companyId: string) {
  const offices = await prisma.office.findMany({ where: { companyId }, select: { id: true, name: true, state: true } });
  return new Map(offices.map((o) => [o.id, o]));
}

async function companyTz(companyId: string): Promise<string> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
  return c?.timezone ?? 'Asia/Kolkata';
}

function tenureMonths(join: Date, end: Date): number {
  return (end.getUTCFullYear() - join.getUTCFullYear()) * 12 + (end.getUTCMonth() - join.getUTCMonth());
}

function tenureLabel(join: Date, end: Date): string {
  const months = Math.max(0, tenureMonths(join, end));
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y > 0 ? `${y}y ${m}m` : `${m}m`;
}

const TENURE_BUCKETS: { label: string; max: number }[] = [
  { label: '< 6 months', max: 6 },
  { label: '6–12 months', max: 12 },
  { label: '1–2 years', max: 24 },
  { label: '2–5 years', max: 60 },
  { label: '5+ years', max: Infinity },
];

/** RESIGNATION = voluntary; TERMINATION / ABSCONDING / END_OF_CONTRACT = involuntary; rest = other. */
export function exitClass(exitType: string | undefined): 'voluntary' | 'involuntary' | 'other' {
  if (exitType === 'RESIGNATION') return 'voluntary';
  if (exitType === 'TERMINATION' || exitType === 'ABSCONDING' || exitType === 'END_OF_CONTRACT') return 'involuntary';
  return 'other';
}

async function exitTypes(companyId: string, employeeIds: string[]): Promise<Map<string, string>> {
  if (employeeIds.length === 0) return new Map();
  const list = await prisma.resignation.findMany({
    where: { companyId, employeeId: { in: employeeIds }, status: { notIn: ['REJECTED', 'WITHDRAWN'] } },
    orderBy: { appliedOn: 'desc' },
    select: { employeeId: true, exitType: true },
  });
  const map = new Map<string, string>();
  for (const r of list) if (!map.has(r.employeeId)) map.set(r.employeeId, r.exitType);
  return map;
}

// ---------------------------------------------------------------------------
// Payslip helpers
// ---------------------------------------------------------------------------

export interface Line {
  label: string;
  amount: number;
}

/** Reads a payslip Json line array defensively and merges duplicate labels. */
export function lines(value: unknown): Line[] {
  if (!Array.isArray(value)) return [];
  const merged = new Map<string, number>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const { label, amount } = item as { label?: unknown; amount?: unknown };
    if (typeof label !== 'string') continue;
    const n = Number(amount);
    if (!Number.isFinite(n)) continue;
    merged.set(label, (merged.get(label) ?? 0) + n);
  }
  return [...merged].map(([label, amount]) => ({ label, amount }));
}

const sum = (ls: Line[]): number => ls.reduce((s, l) => s + l.amount, 0);

/** Gross / deductions / net / employer cost, falling back to the line sums for legacy payslips. */
export function slipTotals(p: {
  earnings: unknown;
  deductions: unknown;
  employerContributions: unknown;
  gross: number;
  totalDeductions: number;
  netPay: number;
}) {
  const gross = p.gross || sum(lines(p.earnings));
  const deductions = p.totalDeductions || sum(lines(p.deductions));
  const net = p.netPay || gross - deductions;
  const employer = sum(lines(p.employerContributions));
  return { gross, deductions, net, employer, cost: gross + employer };
}

type Statutory = 'PF' | 'ESI' | 'PT' | 'LWF' | 'TDS';

/** Classifies a deduction / employer-contribution label into a statutory head. */
export function statutoryHead(label: string): Statutory | null {
  if (/\blwf\b|labou?r welfare/i.test(label)) return 'LWF';
  if (/\besic?\b|state insurance/i.test(label)) return 'ESI';
  if (/professional tax|\bp\.?t\b/i.test(label)) return 'PT';
  if (/\btds\b|income tax/i.test(label)) return 'TDS';
  if (/\b(e?pf|vpf|eps|edli)\b|provident|pension/i.test(label)) return 'PF';
  return null;
}

function publishedSlips(scope: ReportScope, q: ReportQuery, months: Date[]) {
  return prisma.payslip.findMany({
    where: {
      companyId: scope.companyId,
      status: 'PUBLISHED',
      month: months.length === 1 ? months[0] : { in: months },
      employee: employeeWhere(scope, q),
    },
    select: {
      month: true,
      earnings: true,
      deductions: true,
      employerContributions: true,
      gross: true,
      totalDeductions: true,
      netPay: true,
      paidDays: true,
      workingDays: true,
      lopDays: true,
      employee: { select: EMP_SELECT },
    },
    orderBy: { employee: { name: 'asc' } },
  });
}

// ---------------------------------------------------------------------------
// Result builder
// ---------------------------------------------------------------------------

function result(
  key: string,
  period: string,
  table: ReportTable,
  extra: Partial<Omit<ReportResult, 'key' | 'title' | 'period' | 'columns' | 'rows' | 'generatedAt'>> = {}
): ReportResult {
  const def = REPORTS.find((r) => r.key === key);
  return { key, title: def?.title ?? key, period, ...table, ...extra, generatedAt: new Date().toISOString() };
}

function totalsOf(rows: Record<string, Cell>[], columns: Column[], labelKey: string): Record<string, Cell> {
  const totals: Record<string, Cell> = { [labelKey]: 'Total' };
  for (const c of columns) {
    if (c.type !== 'number' && c.type !== 'money') continue;
    totals[c.key] = round2(rows.reduce((s, r) => s + (typeof r[c.key] === 'number' ? (r[c.key] as number) : 0), 0));
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Workforce
// ---------------------------------------------------------------------------

const GROUP_OPTIONS = [
  { value: 'department', label: 'Department' },
  { value: 'designation', label: 'Designation' },
  { value: 'grade', label: 'Grade' },
  { value: 'location', label: 'Location' },
  { value: 'gender', label: 'Gender' },
  { value: 'employmentType', label: 'Employment type' },
];

async function headcount(scope: ReportScope, q: ReportQuery): Promise<ReportResult> {
  const asOf = q.asOf ?? dateOnlyUTC();
  const groupBy = GROUP_OPTIONS.some((g) => g.value === q.groupBy) ? (q.groupBy as string) : 'department';
  const [emps, offices] = await Promise.all([loadEmployees(scope, q), officeMap(scope.companyId)]);
  const keyOf = (e: ReportEmployee): string => {
    switch (groupBy) {
      case 'designation':
        return e.designationRef?.name || e.designation || 'Unassigned';
      case 'grade':
        return e.gradeRef?.name || 'No grade';
      case 'location':
        return (e.officeId && offices.get(e.officeId)?.name) || e.location || 'Unassigned';
      case 'gender':
        return genderLabel(e.gender);
      case 'employmentType':
        return e.employmentType || 'Unspecified';
      default:
        return deptName(e);
    }
  };
  const active = emps.filter((e) => activeAt(e, asOf));
  const counts = new Map<string, number>();
  for (const e of active) counts.set(keyOf(e), (counts.get(keyOf(e)) ?? 0) + 1);
  const total = active.length;
  const rows = [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([group, count]) => ({ group, count, percent: total ? round2((count / total) * 100) : 0 }));
  const groupLabel = GROUP_OPTIONS.find((g) => g.value === groupBy)?.label ?? 'Group';
  const columns: Column[] = [
    { key: 'group', label: groupLabel },
    { key: 'count', label: 'Headcount', type: 'number' },
    { key: 'percent', label: '% of total', type: 'percent' },
  ];
  return result('headcount', `As of ${isoDate(asOf)}`, { columns, rows }, {
    summary: [{ label: 'Active employees', value: total, type: 'number' }],
    chart: { type: 'bar', x: 'group', series: [{ key: 'count', label: 'Headcount' }] },
    totals: { group: 'Total', count: total, percent: total ? 100 : 0 },
  });
}

/** Month-by-month headcount (month end), joiners and exits. Shared with the dashboard. */
export function monthlyHeadcount(emps: ReportEmployee[], months: { y: number; m: number }[]) {
  return months.map(({ y, m }) => {
    const start = monthStart(y, m);
    const end = monthEnd(y, m);
    const opening = emps.filter((e) => activeAt(e, addDays(start, -1))).length;
    const closing = emps.filter((e) => activeAt(e, end)).length;
    const exited = emps.filter((e) => inRange(e.leavingDate, start, end));
    return {
      y,
      m,
      month: monthLabel(y, m),
      opening,
      headcount: closing,
      joiners: emps.filter((e) => inRange(e.joiningDate, start, end)).length,
      exits: exited.length,
      exited,
    };
  });
}

async function headcountTrend(scope: ReportScope, q: ReportQuery): Promise<ReportResult> {
  const { y, m } = monthOf(q);
  const emps = await loadEmployees(scope, q);
  const months = lastMonths(y, m, 12);
  const rows = monthlyHeadcount(emps, months).map((r) => ({
    month: r.month,
    headcount: r.headcount,
    joiners: r.joiners,
    exits: r.exits,
    net: r.joiners - r.exits,
  }));
  const columns: Column[] = [
    { key: 'month', label: 'Month' },
    { key: 'headcount', label: 'Headcount (month end)', type: 'number' },
    { key: 'joiners', label: 'Joiners', type: 'number' },
    { key: 'exits', label: 'Exits', type: 'number' },
    { key: 'net', label: 'Net change', type: 'number' },
  ];
  return result('headcount-trend', `12 months to ${monthLabel(y, m)}`, { columns, rows }, {
    chart: { type: 'line', x: 'month', series: [{ key: 'headcount', label: 'Headcount' }] },
  });
}

async function attrition(scope: ReportScope, q: ReportQuery): Promise<ReportResult> {
  const { from, to, label } = periodOf(q, 'last12');
  const emps = await loadEmployees(scope, q);
  const exits = emps.filter((e) => inRange(e.leavingDate, from, to));
  const types = await exitTypes(scope.companyId, exits.map((e) => e.id));

  const monthly = monthlyHeadcount(emps, monthsIn(from, to));
  const rows = monthly.map((r) => {
    const avg = (r.opening + r.headcount) / 2;
    const cls = r.exited.map((e) => exitClass(types.get(e.id)));
    return {
      month: r.month,
      opening: r.opening,
      closing: r.headcount,
      exits: r.exits,
      voluntary: cls.filter((c) => c === 'voluntary').length,
      involuntary: cls.filter((c) => c === 'involuntary').length,
      other: cls.filter((c) => c === 'other').length,
      rate: avg ? round2((r.exits / avg) * 100) : 0,
    };
  });
  const avgHeadcount = monthly.length
    ? monthly.reduce((s, r) => s + (r.opening + r.headcount) / 2, 0) / monthly.length
    : 0;
  const rate = avgHeadcount ? round2((exits.length / avgHeadcount) * 100) : 0;

  // By department.
  const startDay = addDays(from, -1);
  const depts = new Map<string, { exits: number; open: number; close: number }>();
  for (const e of emps) {
    const d = deptName(e);
    const v = depts.get(d) ?? { exits: 0, open: 0, close: 0 };
    if (activeAt(e, startDay)) v.open += 1;
    if (activeAt(e, to)) v.close += 1;
    if (inRange(e.leavingDate, from, to)) v.exits += 1;
    depts.set(d, v);
  }
  const byDept = [...depts]
    .filter(([, v]) => v.exits > 0 || v.close > 0)
    .map(([department, v]) => {
      const avg = (v.open + v.close) / 2;
      return { department, avgHeadcount: round2(avg), exits: v.exits, rate: avg ? round2((v.exits / avg) * 100) : 0 };
    })
    .sort((a, b) => b.exits - a.exits);

  // Tenure at exit.
  const buckets = TENURE_BUCKETS.map((b) => ({ bucket: b.label, exits: 0, percent: 0 }));
  for (const e of exits) {
    const months = tenureMonths(e.joiningDate, e.leavingDate as Date);
    const i = TENURE_BUCKETS.findIndex((b) => months < b.max);
    const bucket = buckets[i < 0 ? buckets.length - 1 : i];
    if (bucket) bucket.exits += 1;
  }
  for (const b of buckets) b.percent = exits.length ? round2((b.exits / exits.length) * 100) : 0;

  const vol = exits.filter((e) => exitClass(types.get(e.id)) === 'voluntary').length;
  const invol = exits.filter((e) => exitClass(types.get(e.id)) === 'involuntary').length;
  const columns: Column[] = [
    { key: 'month', label: 'Month' },
    { key: 'opening', label: 'Opening', type: 'number' },
    { key: 'closing', label: 'Closing', type: 'number' },
    { key: 'exits', label: 'Exits', type: 'number' },
    { key: 'voluntary', label: 'Voluntary', type: 'number' },
    { key: 'involuntary', label: 'Involuntary', type: 'number' },
    { key: 'other', label: 'Other', type: 'number' },
    { key: 'rate', label: 'Attrition %', type: 'percent' },
  ];
  return result('attrition', label, { columns, rows }, {
    summary: [
      { label: 'Exits', value: exits.length, type: 'number' },
      { label: 'Average headcount', value: round2(avgHeadcount), type: 'number' },
      { label: 'Attrition rate', value: rate, type: 'percent' },
      { label: 'Voluntary', value: vol, type: 'number' },
      { label: 'Involuntary', value: invol, type: 'number' },
    ],
    chart: { type: 'bar', x: 'month', series: [{ key: 'exits', label: 'Exits' }] },
    sections: [
      {
        title: 'By department',
        columns: [
          { key: 'department', label: 'Department' },
          { key: 'avgHeadcount', label: 'Avg headcount', type: 'number' },
          { key: 'exits', label: 'Exits', type: 'number' },
          { key: 'rate', label: 'Attrition %', type: 'percent' },
        ],
        rows: byDept,
      },
      {
        title: 'Tenure at exit',
        columns: [
          { key: 'bucket', label: 'Tenure' },
          { key: 'exits', label: 'Exits', type: 'number' },
          { key: 'percent', label: '% of exits', type: 'percent' },
        ],
        rows: buckets,
      },
    ],
  });
}

async function joinersExits(scope: ReportScope, q: ReportQuery): Promise<ReportResult> {
  const { from, to, label } = periodOf(q, 'month');
  const emps = await loadEmployees(scope, q);
  const joiners = emps.filter((e) => inRange(e.joiningDate, from, to));
  const exits = emps.filter((e) => inRange(e.leavingDate, from, to));
  const types = await exitTypes(scope.companyId, exits.map((e) => e.id));
  const base = (e: ReportEmployee) => ({
    employeeCode: e.employeeCode,
    name: e.name,
    department: deptName(e),
    designation: e.designationRef?.name || e.designation,
  });
  const rows = [
    ...joiners.map((e) => ({ type: 'Joiner', date: isoDate(e.joiningDate), ...base(e), exitType: null, tenure: null })),
    ...exits.map((e) => ({
      type: 'Exit',
      date: isoDate(e.leavingDate),
      ...base(e),
      exitType: types.get(e.id) ?? null,
      tenure: tenureLabel(e.joiningDate, e.leavingDate as Date),
    })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const columns: Column[] = [
    { key: 'type', label: 'Type' },
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'employeeCode', label: 'Employee ID' },
    { key: 'name', label: 'Name' },
    { key: 'department', label: 'Department' },
    { key: 'designation', label: 'Designation' },
    { key: 'exitType', label: 'Exit type' },
    { key: 'tenure', label: 'Tenure' },
  ];
  return result('joiners-exits', label, { columns, rows }, {
    summary: [
      { label: 'Joiners', value: joiners.length, type: 'number' },
      { label: 'Exits', value: exits.length, type: 'number' },
    ],
  });
}

async function diversity(scope: ReportScope, q: ReportQuery): Promise<ReportResult> {
  const asOf = q.asOf ?? dateOnlyUTC();
  const emps = (await loadEmployees(scope, q)).filter((e) => activeAt(e, asOf));
  const map = new Map<string, { male: number; female: number; other: number; unspecified: number }>();
  for (const e of emps) {
    const d = deptName(e);
    const v = map.get(d) ?? { male: 0, female: 0, other: 0, unspecified: 0 };
    const g = e.gender.toUpperCase();
    if (g === 'MALE') v.male += 1;
    else if (g === 'FEMALE') v.female += 1;
    else if (g === 'OTHER') v.other += 1;
    else v.unspecified += 1;
    map.set(d, v);
  }
  const rows = [...map]
    .map(([department, v]) => {
      const total = v.male + v.female + v.other + v.unspecified;
      return { department, ...v, total, femalePercent: total ? round2((v.female / total) * 100) : 0 };
    })
    .sort((a, b) => b.total - a.total);
  const columns: Column[] = [
    { key: 'department', label: 'Department' },
    { key: 'male', label: 'Male', type: 'number' },
    { key: 'female', label: 'Female', type: 'number' },
    { key: 'other', label: 'Other', type: 'number' },
    { key: 'unspecified', label: 'Not specified', type: 'number' },
    { key: 'total', label: 'Total', type: 'number' },
    { key: 'femalePercent', label: 'Female %', type: 'percent' },
  ];
  const totals = totalsOf(rows, columns, 'department');
  const total = Number(totals.total) || 0;
  totals.femalePercent = total ? round2((Number(totals.female) / total) * 100) : 0;
  return result('diversity', `As of ${isoDate(asOf)}`, { columns, rows }, {
    totals,
    summary: [
      { label: 'Employees', value: total, type: 'number' },
      { label: 'Female share', value: totals.femalePercent, type: 'percent' },
    ],
    chart: { type: 'bar', x: 'department', series: [{ key: 'femalePercent', label: 'Female %' }] },
  });
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

async function attendanceSummary(scope: ReportScope, q: ReportQuery): Promise<ReportResult> {
  const { y, m } = monthOf(q);
  const from = monthStart(y, m);
  const to = monthEnd(y, m);
  const emps = (await loadEmployees(scope, q)).filter(
    (e) => e.joiningDate.getTime() < to.getTime() + DAY && (e.leavingDate ? e.leavingDate >= from : e.isActive)
  );
  const ids = emps.map((e) => e.id);
  const [records, leaves] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { companyId: scope.companyId, employeeId: { in: ids }, date: { gte: from, lte: to } },
      select: { employeeId: true, status: true, lateMinutes: true, overtimeMinutes: true, workedMinutes: true },
    }),
    prisma.leaveRequest.findMany({
      where: {
        companyId: scope.companyId,
        employeeId: { in: ids },
        status: 'APPROVED',
        fromDate: { lte: to },
        toDate: { gte: from },
      },
      select: { employeeId: true, fromDate: true, toDate: true, days: true },
    }),
  ]);
  type Acc = { present: number; late: number; halfDays: number; absent: number; leaveRecords: number; lateMinutes: number; ot: number; worked: number };
  const acc = new Map<string, Acc>();
  for (const r of records) {
    const a = acc.get(r.employeeId) ?? { present: 0, late: 0, halfDays: 0, absent: 0, leaveRecords: 0, lateMinutes: 0, ot: 0, worked: 0 };
    if (r.status === 'PRESENT' || r.status === 'LATE') a.present += 1;
    if (r.status === 'LATE' || r.lateMinutes > 0) a.late += 1;
    if (r.status === 'HALF_DAY') a.halfDays += 1;
    if (r.status === 'ABSENT') a.absent += 1;
    if (r.status === 'LEAVE') a.leaveRecords += 1;
    a.lateMinutes += r.lateMinutes;
    a.ot += r.overtimeMinutes;
    a.worked += r.workedMinutes ?? 0;
    acc.set(r.employeeId, a);
  }
  const leaveDays = new Map<string, number>();
  for (const l of leaves) leaveDays.set(l.employeeId, (leaveDays.get(l.employeeId) ?? 0) + leaveDaysWithin(l, from, to));

  const rows = emps.map((e) => {
    const a = acc.get(e.id);
    return {
      employeeCode: e.employeeCode,
      name: e.name,
      department: deptName(e),
      present: a?.present ?? 0,
      late: a?.late ?? 0,
      halfDays: a?.halfDays ?? 0,
      absent: a?.absent ?? 0,
      // Approved leave requests are authoritative; fall back to LEAVE-marked days.
      leaveDays: round2(Math.max(leaveDays.get(e.id) ?? 0, a?.leaveRecords ?? 0)),
      lateMinutes: a?.lateMinutes ?? 0,
      otHours: round2((a?.ot ?? 0) / 60),
      workedHours: round2((a?.worked ?? 0) / 60),
    };
  });
  const columns: Column[] = [
    { key: 'employeeCode', label: 'Employee ID' },
    { key: 'name', label: 'Name' },
    { key: 'department', label: 'Department' },
    { key: 'present', label: 'Present', type: 'number' },
    { key: 'late', label: 'Late', type: 'number' },
    { key: 'halfDays', label: 'Half days', type: 'number' },
    { key: 'absent', label: 'Absent', type: 'number' },
    { key: 'leaveDays', label: 'Leave days', type: 'number' },
    { key: 'lateMinutes', label: 'Late minutes', type: 'number' },
    { key: 'otHours', label: 'OT hours', type: 'number' },
    { key: 'workedHours', label: 'Worked hours', type: 'number' },
  ];
  const totals = totalsOf(rows, columns, 'employeeCode');
  return result('attendance-summary', monthLabel(y, m), { columns, rows }, {
    totals,
    summary: [
      { label: 'Employees', value: rows.length, type: 'number' },
      { label: 'Late arrivals', value: totals.late ?? 0, type: 'number' },
      { label: 'Absences', value: totals.absent ?? 0, type: 'number' },
      { label: 'OT hours', value: totals.otHours ?? 0, type: 'number' },
    ],
  });
}

async function lateArrivals(scope: ReportScope, q: ReportQuery): Promise<ReportResult> {
  const { from, to, label } = periodOf(q, 'month');
  const tz = await companyTz(scope.companyId);
  const records = await prisma.attendanceRecord.findMany({
    where: {
      companyId: scope.companyId,
      date: { gte: from, lte: to },
      OR: [{ status: 'LATE' }, { lateMinutes: { gt: 0 } }],
      employee: employeeWhere(scope, q),
    },
    select: {
      date: true,
      checkIn: true,
      lateMinutes: true,
      employee: { select: { id: true, employeeCode: true, name: true, department: true, departmentRef: { select: { name: true } } } },
    },
    orderBy: [{ date: 'desc' }],
  });
  const rows = records.map((r) => ({
    date: isoDate(r.date),
    employeeCode: r.employee.employeeCode,
    name: r.employee.name,
    department: deptName(r.employee),
    checkIn: clockIn(tz, r.checkIn),
    lateMinutes: r.lateMinutes,
  }));
  const per = new Map<string, { employeeCode: string; name: string; department: string; count: number; minutes: number }>();
  for (const r of records) {
    const v = per.get(r.employee.id) ?? {
      employeeCode: r.employee.employeeCode,
      name: r.employee.name,
      department: deptName(r.employee),
      count: 0,
      minutes: 0,
    };
    v.count += 1;
    v.minutes += r.lateMinutes;
    per.set(r.employee.id, v);
  }
  const columns: Column[] = [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'employeeCode', label: 'Employee ID' },
    { key: 'name', label: 'Name' },
    { key: 'department', label: 'Department' },
    { key: 'checkIn', label: 'Check-in' },
    { key: 'lateMinutes', label: 'Late by (min)', type: 'number' },
  ];
  return result('late-arrivals', label, { columns, rows }, {
    summary: [
      { label: 'Late arrivals', value: rows.length, type: 'number' },
      { label: 'Employees', value: per.size, type: 'number' },
    ],
    sections: [
      {
        title: 'By employee',
        columns: [
          { key: 'employeeCode', label: 'Employee ID' },
          { key: 'name', label: 'Name' },
          { key: 'department', label: 'Department' },
          { key: 'count', label: 'Late days', type: 'number' },
          { key: 'minutes', label: 'Total minutes', type: 'number' },
        ],
        rows: [...per.values()].sort((a, b) => b.count - a.count),
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

async function leaveTaken(scope: ReportScope, q: ReportQuery): Promise<ReportResult> {
  const { from, to, label } = periodOf(q, 'ytd');
  const byEmployee = q.groupBy === 'employee';
  const [types, requests] = await Promise.all([
    prisma.leaveType.findMany({ where: { companyId: scope.companyId }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } }),
    prisma.leaveRequest.findMany({
      where: {
        companyId: scope.companyId,
        status: 'APPROVED',
        fromDate: { lte: to },
        toDate: { gte: from },
        employee: employeeWhere(scope, q),
      },
      select: {
        leaveTypeId: true,
        fromDate: true,
        toDate: true,
        days: true,
        employee: { select: { id: true, employeeCode: true, name: true, department: true, departmentRef: { select: { name: true } } } },
      },
    }),
  ]);
  const typeById = new Map(types.map((t) => [t.id, t]));
  const usedTypes = new Set<string>();
  const groups = new Map<string, Record<string, Cell>>();
  const byType = new Map<string, { leaveType: string; requests: number; days: number; employees: Set<string> }>();
  for (const r of requests) {
    const t = typeById.get(r.leaveTypeId);
    if (!t) continue;
    const days = leaveDaysWithin(r, from, to);
    if (days <= 0) continue;
    usedTypes.add(t.id);
    const gKey = byEmployee ? r.employee.id : deptName(r.employee);
    const g =
      groups.get(gKey) ??
      (byEmployee
        ? { employeeCode: r.employee.employeeCode, name: r.employee.name, department: deptName(r.employee), requests: 0, total: 0 }
        : { department: gKey, requests: 0, total: 0 });
    g[`t:${t.code}`] = round2(Number(g[`t:${t.code}`] ?? 0) + days);
    g.requests = Number(g.requests) + 1;
    g.total = round2(Number(g.total) + days);
    groups.set(gKey, g);
    const bt = byType.get(t.id) ?? { leaveType: `${t.name} (${t.code})`, requests: 0, days: 0, employees: new Set<string>() };
    bt.requests += 1;
    bt.days = round2(bt.days + days);
    bt.employees.add(r.employee.id);
    byType.set(t.id, bt);
  }
  const typeCols: Column[] = types
    .filter((t) => usedTypes.has(t.id))
    .map((t) => ({ key: `t:${t.code}`, label: t.code, type: 'number' as const }));
  const columns: Column[] = [
    ...(byEmployee
      ? [
          { key: 'employeeCode', label: 'Employee ID' },
          { key: 'name', label: 'Name' },
          { key: 'department', label: 'Department' },
        ]
      : [{ key: 'department', label: 'Department' }]),
    ...typeCols,
    { key: 'requests', label: 'Requests', type: 'number' },
    { key: 'total', label: 'Total days', type: 'number' },
  ];
  const rows = [...groups.values()].map((g) => {
    for (const c of typeCols) g[c.key] ??= 0;
    return g;
  }).sort((a, b) => Number(b.total) - Number(a.total));
  return result('leave-taken', label, { columns, rows }, {
    totals: totalsOf(rows, columns, byEmployee ? 'employeeCode' : 'department'),
    summary: [
      { label: 'Approved requests', value: requests.length, type: 'number' },
      { label: 'Days taken', value: round2(rows.reduce((s, r) => s + Number(r.total), 0)), type: 'number' },
    ],
    sections: [
      {
        title: 'By leave type',
        columns: [
          { key: 'leaveType', label: 'Leave type' },
          { key: 'requests', label: 'Requests', type: 'number' },
          { key: 'employees', label: 'Employees', type: 'number' },
          { key: 'days', label: 'Days', type: 'number' },
        ],
        rows: [...byType.values()].map((b) => ({ leaveType: b.leaveType, requests: b.requests, employees: b.employees.size, days: b.days })),
      },
    ],
  });
}

async function leaveLiability(scope: ReportScope, q: ReportQuery): Promise<ReportResult> {
  const year = q.year ?? dateOnlyUTC().getUTCFullYear();
  const types = await prisma.leaveType.findMany({
    where: { companyId: scope.companyId, encashable: true, isActive: true },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, maxEncashDays: true },
  });
  const emps = (await loadEmployees(scope, q)).filter((e) => activeAt(e, dateOnlyUTC()));
  const balances =
    types.length === 0 || emps.length === 0
      ? []
      : await prisma.leaveLedger.groupBy({
          by: ['employeeId', 'leaveTypeId'],
          where: {
            companyId: scope.companyId,
            leaveTypeId: { in: types.map((t) => t.id) },
            employeeId: { in: emps.map((e) => e.id) },
            date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
          },
          _sum: { change: true },
        });
  const bal = new Map(balances.map((b) => [`${b.employeeId}:${b.leaveTypeId}`, b._sum.change ?? 0]));
  const rows: Record<string, Cell>[] = [];
  for (const e of emps) {
    const row: Record<string, Cell> = { employeeCode: e.employeeCode, name: e.name, department: deptName(e) };
    let days = 0;
    for (const t of types) {
      const raw = Math.max(0, bal.get(`${e.id}:${t.id}`) ?? 0);
      const capped = t.maxEncashDays > 0 ? Math.min(raw, t.maxEncashDays) : raw;
      row[`t:${t.code}`] = round2(capped);
      days += capped;
    }
    if (days <= 0) continue;
    const daily = e.salaryBasic / 26;
    rows.push({ ...row, days: round2(days), basic: e.salaryBasic, dailyRate: round2(daily), liability: Math.round(days * daily) });
  }
  rows.sort((a, b) => Number(b.liability) - Number(a.liability));
  const columns: Column[] = [
    { key: 'employeeCode', label: 'Employee ID' },
    { key: 'name', label: 'Name' },
    { key: 'department', label: 'Department' },
    ...types.map((t) => ({ key: `t:${t.code}`, label: `${t.code} days`, type: 'number' as const })),
    { key: 'days', label: 'Encashable days', type: 'number' },
    { key: 'basic', label: 'Monthly basic', type: 'money' },
    { key: 'dailyRate', label: 'Daily rate (basic ÷ 26)', type: 'money' },
    { key: 'liability', label: 'Liability', type: 'money' },
  ];
  const totals = totalsOf(rows, columns, 'employeeCode');
  delete totals.basic;
  delete totals.dailyRate;
  return result('leave-liability', `Year ${year}`, { columns, rows }, {
    totals,
    summary: [
      { label: 'Encashable types', value: types.map((t) => t.code).join(', ') || 'None', type: 'text' },
      { label: 'Encashable days', value: totals.days ?? 0, type: 'number' },
      { label: 'Total liability', value: totals.liability ?? 0, type: 'money' },
    ],
  });
}

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

async function payrollRegister(scope: ReportScope, q: ReportQuery): Promise<ReportResult> {
  const { y, m } = monthOf(q);
  const slips = await publishedSlips(scope, q, [monthStart(y, m)]);
  const earnLabels: string[] = [];
  const dedLabels: string[] = [];
  const empLabels: string[] = [];
  const note = (list: string[], ls: Line[]) => ls.forEach((l) => !list.includes(l.label) && list.push(l.label));
  const parsed = slips.map((s) => {
    const e = lines(s.earnings);
    const d = lines(s.deductions);
    const c = lines(s.employerContributions);
    note(earnLabels, e);
    note(dedLabels, d);
    note(empLabels, c);
    return { s, e, d, c, t: slipTotals(s) };
  });
  const rows = parsed.map(({ s, e, d, c, t }) => {
    const row: Record<string, Cell> = {
      employeeCode: s.employee.employeeCode,
      name: s.employee.name,
      department: deptName(s.employee),
      designation: s.employee.designationRef?.name || s.employee.designation,
      paidDays: s.paidDays,
      lopDays: s.lopDays,
    };
    for (const l of earnLabels) row[`e:${l}`] = e.find((x) => x.label === l)?.amount ?? 0;
    row.gross = round2(t.gross);
    for (const l of dedLabels) row[`d:${l}`] = d.find((x) => x.label === l)?.amount ?? 0;
    row.deductions = round2(t.deductions);
    row.net = round2(t.net);
    for (const l of empLabels) row[`c:${l}`] = c.find((x) => x.label === l)?.amount ?? 0;
    row.employer = round2(t.employer);
    row.cost = round2(t.cost);
    return row;
  });
  const columns: Column[] = [
    { key: 'employeeCode', label: 'Employee ID' },
    { key: 'name', label: 'Name' },
    { key: 'department', label: 'Department' },
    { key: 'designation', label: 'Designation' },
    { key: 'paidDays', label: 'Paid days', type: 'number' },
    { key: 'lopDays', label: 'LOP days', type: 'number' },
    ...earnLabels.map((l) => ({ key: `e:${l}`, label: l, type: 'money' as const })),
    { key: 'gross', label: 'Gross', type: 'money' },
    ...dedLabels.map((l) => ({ key: `d:${l}`, label: l, type: 'money' as const })),
    { key: 'deductions', label: 'Total deductions', type: 'money' },
    { key: 'net', label: 'Net pay', type: 'money' },
    ...empLabels.map((l) => ({ key: `c:${l}`, label: `${l} (employer)`, type: 'money' as const })),
    { key: 'employer', label: 'Employer contributions', type: 'money' },
    { key: 'cost', label: 'Cost to company', type: 'money' },
  ];
  const totals = totalsOf(rows, columns, 'employeeCode');
  delete totals.paidDays;
  delete totals.lopDays;
  return result('payroll-register', monthLabel(y, m), { columns, rows }, {
    totals,
    summary: [
      { label: 'Payslips', value: rows.length, type: 'number' },
      { label: 'Gross', value: totals.gross ?? 0, type: 'money' },
      { label: 'Net pay', value: totals.net ?? 0, type: 'money' },
      { label: 'Cost to company', value: totals.cost ?? 0, type: 'money' },
    ],
  });
}

async function payrollByDepartment(scope: ReportScope, q: ReportQuery): Promise<ReportResult> {
  const { y, m } = monthOf(q);
  const slips = await publishedSlips(scope, q, [monthStart(y, m)]);
  const map = new Map<string, { department: string; employees: number; gross: number; deductions: number; net: number; employer: number; cost: number }>();
  for (const s of slips) {
    const d = deptName(s.employee);
    const t = slipTotals(s);
    const v = map.get(d) ?? { department: d, employees: 0, gross: 0, deductions: 0, net: 0, employer: 0, cost: 0 };
    v.employees += 1;
    v.gross += t.gross;
    v.deductions += t.deductions;
    v.net += t.net;
    v.employer += t.employer;
    v.cost += t.cost;
    map.set(d, v);
  }
  const rows = [...map.values()]
    .map((v) => ({ ...v, gross: round2(v.gross), deductions: round2(v.deductions), net: round2(v.net), employer: round2(v.employer), cost: round2(v.cost) }))
    .sort((a, b) => b.cost - a.cost);
  const columns: Column[] = [
    { key: 'department', label: 'Department' },
    { key: 'employees', label: 'Employees', type: 'number' },
    { key: 'gross', label: 'Gross', type: 'money' },
    { key: 'deductions', label: 'Deductions', type: 'money' },
    { key: 'net', label: 'Net pay', type: 'money' },
    { key: 'employer', label: 'Employer contributions', type: 'money' },
    { key: 'cost', label: 'Total cost', type: 'money' },
  ];
  return result('payroll-department-cost', monthLabel(y, m), { columns, rows }, {
    totals: totalsOf(rows, columns, 'department'),
    chart: { type: 'bar', x: 'department', series: [{ key: 'cost', label: 'Total cost' }] },
  });
}

/** Month-by-month payroll totals of published payslips. Shared with the dashboard. */
export async function payrollTotalsByMonth(scope: ReportScope, q: ReportQuery, months: { y: number; m: number }[]) {
  const dates = months.map(({ y, m }) => monthStart(y, m));
  const slips = await publishedSlips(scope, q, dates);
  return months.map(({ y, m }) => {
    const key = monthStart(y, m).getTime();
    const ofMonth = slips.filter((s) => s.month.getTime() === key);
    const t = ofMonth.map(slipTotals);
    const s = (k: keyof (typeof t)[number]) => round2(t.reduce((acc, x) => acc + x[k], 0));
    return {
      month: monthLabel(y, m),
      employees: ofMonth.length,
      gross: s('gross'),
      deductions: s('deductions'),
      net: s('net'),
      employer: s('employer'),
      cost: s('cost'),
    };
  });
}

async function payrollTrend(scope: ReportScope, q: ReportQuery): Promise<ReportResult> {
  const { y, m } = monthOf(q);
  const rows = await payrollTotalsByMonth(scope, q, lastMonths(y, m, 12));
  const columns: Column[] = [
    { key: 'month', label: 'Month' },
    { key: 'employees', label: 'Employees', type: 'number' },
    { key: 'gross', label: 'Gross', type: 'money' },
    { key: 'deductions', label: 'Deductions', type: 'money' },
    { key: 'net', label: 'Net pay', type: 'money' },
    { key: 'employer', label: 'Employer contributions', type: 'money' },
    { key: 'cost', label: 'Total cost', type: 'money' },
  ];
  const totals = totalsOf(rows, columns, 'month');
  delete totals.employees;
  return result('payroll-trend', `12 months to ${monthLabel(y, m)}`, { columns, rows }, {
    totals,
    chart: {
      type: 'line',
      x: 'month',
      series: [
        { key: 'cost', label: 'Total cost' },
        { key: 'net', label: 'Net pay' },
      ],
    },
  });
}

async function statutory(scope: ReportScope, q: ReportQuery): Promise<ReportResult> {
  const { y, m } = monthOf(q);
  const [slips, offices, config] = await Promise.all([
    publishedSlips(scope, q, [monthStart(y, m)]),
    officeMap(scope.companyId),
    prisma.statutoryConfig.findUnique({ where: { companyId: scope.companyId }, select: { defaultState: true } }),
  ]);
  const defaultState = config?.defaultState || 'Maharashtra';
  const rows = slips.map((s) => {
    const r = { pfEmployee: 0, pfEmployer: 0, esiEmployee: 0, esiEmployer: 0, pt: 0, lwfEmployee: 0, lwfEmployer: 0, tds: 0 };
    for (const l of lines(s.deductions)) {
      const head = statutoryHead(l.label);
      if (head === 'PF') r.pfEmployee += l.amount;
      else if (head === 'ESI') r.esiEmployee += l.amount;
      else if (head === 'PT') r.pt += l.amount;
      else if (head === 'LWF') r.lwfEmployee += l.amount;
      else if (head === 'TDS') r.tds += l.amount;
    }
    for (const l of lines(s.employerContributions)) {
      const head = statutoryHead(l.label);
      if (head === 'PF') r.pfEmployer += l.amount;
      else if (head === 'ESI') r.esiEmployer += l.amount;
      else if (head === 'LWF') r.lwfEmployer += l.amount;
    }
    const state = (s.employee.officeId && offices.get(s.employee.officeId)?.state) || defaultState;
    return {
      employeeCode: s.employee.employeeCode,
      name: s.employee.name,
      state,
      gross: round2(slipTotals(s).gross),
      ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, round2(v)])),
    } as Record<string, Cell>;
  });
  const columns: Column[] = [
    { key: 'employeeCode', label: 'Employee ID' },
    { key: 'name', label: 'Name' },
    { key: 'state', label: 'State' },
    { key: 'gross', label: 'Gross', type: 'money' },
    { key: 'pfEmployee', label: 'PF (employee)', type: 'money' },
    { key: 'pfEmployer', label: 'PF (employer)', type: 'money' },
    { key: 'esiEmployee', label: 'ESI (employee)', type: 'money' },
    { key: 'esiEmployer', label: 'ESI (employer)', type: 'money' },
    { key: 'pt', label: 'Professional tax', type: 'money' },
    { key: 'lwfEmployee', label: 'LWF (employee)', type: 'money' },
    { key: 'lwfEmployer', label: 'LWF (employer)', type: 'money' },
    { key: 'tds', label: 'TDS', type: 'money' },
  ];
  const totals = totalsOf(rows, columns, 'employeeCode');
  const n = (k: string) => Number(totals[k] ?? 0);
  const count = (k: string) => rows.filter((r) => Number(r[k]) > 0).length;
  const components = [
    { component: 'Provident Fund', employees: Math.max(count('pfEmployee'), count('pfEmployer')), employee: n('pfEmployee'), employer: n('pfEmployer') },
    { component: 'ESI', employees: Math.max(count('esiEmployee'), count('esiEmployer')), employee: n('esiEmployee'), employer: n('esiEmployer') },
    { component: 'Professional Tax', employees: count('pt'), employee: n('pt'), employer: 0 },
    { component: 'Labour Welfare Fund', employees: Math.max(count('lwfEmployee'), count('lwfEmployer')), employee: n('lwfEmployee'), employer: n('lwfEmployer') },
    { component: 'TDS', employees: count('tds'), employee: n('tds'), employer: 0 },
  ].map((c) => ({ ...c, total: round2(c.employee + c.employer) }));
  const byState = new Map<string, { state: string; employees: number; pt: number; lwfEmployee: number; lwfEmployer: number }>();
  for (const r of rows) {
    const st = String(r.state);
    const v = byState.get(st) ?? { state: st, employees: 0, pt: 0, lwfEmployee: 0, lwfEmployer: 0 };
    v.employees += 1;
    v.pt = round2(v.pt + Number(r.pt));
    v.lwfEmployee = round2(v.lwfEmployee + Number(r.lwfEmployee));
    v.lwfEmployer = round2(v.lwfEmployer + Number(r.lwfEmployer));
    byState.set(st, v);
  }
  return result('statutory', monthLabel(y, m), { columns, rows }, {
    totals,
    summary: components.map((c) => ({ label: c.component, value: c.total, type: 'money' as const })),
    sections: [
      {
        title: 'Totals by component',
        columns: [
          { key: 'component', label: 'Component' },
          { key: 'employees', label: 'Employees', type: 'number' },
          { key: 'employee', label: 'Employee share', type: 'money' },
          { key: 'employer', label: 'Employer share', type: 'money' },
          { key: 'total', label: 'Total', type: 'money' },
        ],
        rows: components,
      },
      {
        title: 'Professional tax & LWF by state',
        columns: [
          { key: 'state', label: 'State' },
          { key: 'employees', label: 'Employees', type: 'number' },
          { key: 'pt', label: 'Professional tax', type: 'money' },
          { key: 'lwfEmployee', label: 'LWF (employee)', type: 'money' },
          { key: 'lwfEmployer', label: 'LWF (employer)', type: 'money' },
        ],
        rows: [...byState.values()],
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

async function expenses(scope: ReportScope, q: ReportQuery): Promise<ReportResult> {
  const { from, to, label } = periodOf(q, 'month');
  const groupBy = ['category', 'department', 'status', 'employee'].includes(q.groupBy ?? '') ? (q.groupBy as string) : 'category';
  const status = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(q.status ?? '') ? q.status : undefined;
  const claims = await prisma.expenseClaim.findMany({
    where: {
      companyId: scope.companyId,
      date: { gte: from, lte: to },
      ...(status ? { status: status as 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' } : {}),
      employee: employeeWhere(scope, q),
    },
    select: {
      category: true,
      amount: true,
      status: true,
      employee: { select: { id: true, name: true, employeeCode: true, department: true, departmentRef: { select: { name: true } } } },
    },
  });
  const map = new Map<string, { group: string; claims: number; total: number; approved: number; pending: number; rejected: number }>();
  for (const c of claims) {
    const g =
      groupBy === 'department'
        ? deptName(c.employee)
        : groupBy === 'status'
          ? c.status
          : groupBy === 'employee'
            ? `${c.employee.name} (${c.employee.employeeCode})`
            : c.category || 'Uncategorised';
    const v = map.get(g) ?? { group: g, claims: 0, total: 0, approved: 0, pending: 0, rejected: 0 };
    v.claims += 1;
    v.total = round2(v.total + c.amount);
    if (c.status === 'APPROVED') v.approved = round2(v.approved + c.amount);
    if (c.status === 'PENDING') v.pending = round2(v.pending + c.amount);
    if (c.status === 'REJECTED') v.rejected = round2(v.rejected + c.amount);
    map.set(g, v);
  }
  const rows = [...map.values()].sort((a, b) => b.total - a.total);
  const columns: Column[] = [
    { key: 'group', label: { category: 'Category', department: 'Department', status: 'Status', employee: 'Employee' }[groupBy] ?? 'Group' },
    { key: 'claims', label: 'Claims', type: 'number' },
    { key: 'total', label: 'Total', type: 'money' },
    { key: 'approved', label: 'Approved', type: 'money' },
    { key: 'pending', label: 'Pending', type: 'money' },
    { key: 'rejected', label: 'Rejected', type: 'money' },
  ];
  return result('expenses', label, { columns, rows }, {
    totals: totalsOf(rows, columns, 'group'),
    chart: { type: 'bar', x: 'group', series: [{ key: 'total', label: 'Total' }] },
  });
}

async function loans(scope: ReportScope, q: ReportQuery): Promise<ReportResult> {
  const status = q.status && q.status !== 'ALL' ? q.status : q.status === 'ALL' ? undefined : 'ACTIVE';
  const list = await prisma.loan.findMany({
    where: { companyId: scope.companyId, ...(status ? { status } : {}), employee: employeeWhere(scope, q) },
    include: {
      repayments: { select: { amount: true } },
      employee: { select: { employeeCode: true, name: true, department: true, departmentRef: { select: { name: true } } } },
    },
    orderBy: { appliedOn: 'desc' },
  });
  const rows = list.map((l) => ({
    employeeCode: l.employee.employeeCode,
    name: l.employee.name,
    department: deptName(l.employee),
    type: l.type,
    principal: l.principal,
    interestRate: l.interestRate,
    tenureMonths: l.tenureMonths,
    emi: l.emi,
    startMonth: isoDate(l.startMonth),
    repaid: round2(l.repayments.reduce((s, r) => s + r.amount, 0)),
    balance: l.balance,
    status: l.status,
  }));
  const columns: Column[] = [
    { key: 'employeeCode', label: 'Employee ID' },
    { key: 'name', label: 'Name' },
    { key: 'department', label: 'Department' },
    { key: 'type', label: 'Type' },
    { key: 'principal', label: 'Principal', type: 'money' },
    { key: 'interestRate', label: 'Interest %', type: 'percent' },
    { key: 'tenureMonths', label: 'Tenure (months)', type: 'number' },
    { key: 'emi', label: 'EMI', type: 'money' },
    { key: 'startMonth', label: 'First EMI', type: 'date' },
    { key: 'repaid', label: 'Repaid', type: 'money' },
    { key: 'balance', label: 'Outstanding', type: 'money' },
    { key: 'status', label: 'Status' },
  ];
  const totals = totalsOf(rows, columns, 'employeeCode');
  delete totals.tenureMonths;
  return result('loans', status ? `Status ${status}` : 'All loans', { columns, rows }, {
    totals,
    summary: [
      { label: 'Loans', value: rows.length, type: 'number' },
      { label: 'Outstanding', value: totals.balance ?? 0, type: 'money' },
      { label: 'Monthly EMI', value: totals.emi ?? 0, type: 'money' },
    ],
  });
}

async function assets(scope: ReportScope, q: ReportQuery): Promise<ReportResult> {
  const filtered = !!(scope.teamOf || q.departmentId || q.department || q.officeId);
  const [all, open] = await Promise.all([
    prisma.asset.findMany({ where: { companyId: scope.companyId }, select: { id: true, category: true, status: true, cost: true } }),
    prisma.assetAssignment.findMany({
      where: { companyId: scope.companyId, returnedOn: null, employee: employeeWhere(scope, q) },
      include: {
        asset: { select: { tag: true, name: true, category: true, cost: true } },
        employee: { select: { employeeCode: true, name: true, department: true, departmentRef: { select: { name: true } } } },
      },
      orderBy: { issuedOn: 'desc' },
    }),
  ]);
  const today = dateOnlyUTC();
  const cats = new Map<string, { category: string; total: number; assigned: number; available: number; inRepair: number; retired: number; assignedCost: number }>();
  for (const a of all) {
    const v = cats.get(a.category) ?? { category: a.category, total: 0, assigned: 0, available: 0, inRepair: 0, retired: 0, assignedCost: 0 };
    v.total += 1;
    if (a.status === 'ASSIGNED') {
      v.assigned += 1;
      v.assignedCost = round2(v.assignedCost + a.cost);
    } else if (a.status === 'AVAILABLE') v.available += 1;
    else if (a.status === 'IN_REPAIR') v.inRepair += 1;
    else v.retired += 1;
    cats.set(a.category, v);
  }
  const columns: Column[] = [
    { key: 'category', label: 'Category' },
    { key: 'total', label: 'Total', type: 'number' },
    { key: 'assigned', label: 'Assigned', type: 'number' },
    { key: 'available', label: 'Available', type: 'number' },
    { key: 'inRepair', label: 'In repair', type: 'number' },
    { key: 'retired', label: 'Retired / lost', type: 'number' },
    { key: 'assignedCost', label: 'Assigned value', type: 'money' },
  ];
  const rows = [...cats.values()].sort((a, b) => b.total - a.total);
  return result('assets', filtered ? 'Category totals are company-wide; assignments are filtered' : `As of ${isoDate(today)}`, { columns, rows }, {
    totals: totalsOf(rows, columns, 'category'),
    sections: [
      {
        title: 'Currently assigned',
        columns: [
          { key: 'tag', label: 'Tag' },
          { key: 'asset', label: 'Asset' },
          { key: 'category', label: 'Category' },
          { key: 'employeeCode', label: 'Employee ID' },
          { key: 'name', label: 'Employee' },
          { key: 'department', label: 'Department' },
          { key: 'issuedOn', label: 'Issued', type: 'date' },
          { key: 'expectedReturn', label: 'Expected return', type: 'date' },
          { key: 'overdue', label: 'Overdue' },
        ],
        rows: open.map((o) => ({
          tag: o.asset.tag,
          asset: o.asset.name,
          category: o.asset.category,
          employeeCode: o.employee.employeeCode,
          name: o.employee.name,
          department: deptName(o.employee),
          issuedOn: isoDate(o.issuedOn),
          expectedReturn: isoDate(o.expectedReturn),
          overdue: o.expectedReturn && o.expectedReturn < today ? 'Yes' : 'No',
        })),
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Birthdays / work anniversaries of active employees falling inside [from, to]. Shared with the dashboard. */
export function celebrations(emps: ReportEmployee[], from: Date, to: Date) {
  const out: { type: 'Birthday' | 'Anniversary'; date: Date; employee: ReportEmployee; years: number | null }[] = [];
  const today = dateOnlyUTC();
  for (const e of emps) {
    if (!activeAt(e, today)) continue;
    const add = (type: 'Birthday' | 'Anniversary', base: Date) => {
      for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
        const last = new Date(Date.UTC(y, base.getUTCMonth() + 1, 0)).getUTCDate();
        const d = new Date(Date.UTC(y, base.getUTCMonth(), Math.min(base.getUTCDate(), last)));
        if (d < from || d > to) continue;
        const years = y - base.getUTCFullYear();
        if (type === 'Anniversary' && years < 1) continue;
        out.push({ type, date: d, employee: e, years: type === 'Anniversary' ? years : null });
      }
    };
    if (e.dateOfBirth) add('Birthday', e.dateOfBirth);
    add('Anniversary', e.joiningDate);
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime() || a.employee.name.localeCompare(b.employee.name));
}

async function birthdays(scope: ReportScope, q: ReportQuery): Promise<ReportResult> {
  const { y, m } = monthOf(q);
  const emps = await loadEmployees(scope, q);
  const list = celebrations(emps, monthStart(y, m), monthEnd(y, m));
  const rows = list.map((c) => ({
    date: isoDate(c.date),
    type: c.type,
    employeeCode: c.employee.employeeCode,
    name: c.employee.name,
    department: deptName(c.employee),
    designation: c.employee.designationRef?.name || c.employee.designation,
    years: c.years,
  }));
  const columns: Column[] = [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'type', label: 'Occasion' },
    { key: 'employeeCode', label: 'Employee ID' },
    { key: 'name', label: 'Name' },
    { key: 'department', label: 'Department' },
    { key: 'designation', label: 'Designation' },
    { key: 'years', label: 'Years of service', type: 'number' },
  ];
  return result('birthdays-anniversaries', monthLabel(y, m), { columns, rows }, {
    summary: [
      { label: 'Birthdays', value: list.filter((c) => c.type === 'Birthday').length, type: 'number' },
      { label: 'Anniversaries', value: list.filter((c) => c.type === 'Anniversary').length, type: 'number' },
    ],
  });
}

/** Unconfirmed employees whose probation ends within `days` (or is already overdue). Shared with the dashboard. */
export async function probationDueList(scope: ReportScope, q: ReportQuery, days: number) {
  const today = dateOnlyUTC();
  const until = addDays(today, days);
  const emps = await prisma.employee.findMany({
    where: { ...employeeWhere(scope, q), isActive: true, confirmedOn: null, probationEndDate: { not: null, lte: until } },
    select: EMP_SELECT,
    orderBy: { probationEndDate: 'asc' },
  });
  const pending = await prisma.confirmationRequest.findMany({
    where: { companyId: scope.companyId, employeeId: { in: emps.map((e) => e.id) }, status: 'PENDING' },
    select: { employeeId: true, recommendation: true },
  });
  const pend = new Map(pending.map((p) => [p.employeeId, p]));
  return emps
    .filter((e) => !e.leavingDate || e.leavingDate >= today)
    .map((e) => {
      const end = e.probationEndDate as Date;
      const daysLeft = Math.round((end.getTime() - today.getTime()) / DAY);
      const req = pend.get(e.id);
      return {
        employee: e,
        probationEndDate: end,
        daysLeft,
        confirmation: req ? (req.recommendation ? `Recommended: ${req.recommendation}` : 'Awaiting manager') : 'Not started',
      };
    });
}

async function probationDue(scope: ReportScope, q: ReportQuery): Promise<ReportResult> {
  const days = q.days ?? 30;
  const list = await probationDueList(scope, q, days);
  const rows = list.map((p) => ({
    employeeCode: p.employee.employeeCode,
    name: p.employee.name,
    department: deptName(p.employee),
    manager: p.employee.manager?.name ?? null,
    joiningDate: isoDate(p.employee.joiningDate),
    probationEndDate: isoDate(p.probationEndDate),
    daysLeft: p.daysLeft,
    status: p.daysLeft < 0 ? 'Overdue' : 'Due',
    confirmation: p.confirmation,
  }));
  const columns: Column[] = [
    { key: 'employeeCode', label: 'Employee ID' },
    { key: 'name', label: 'Name' },
    { key: 'department', label: 'Department' },
    { key: 'manager', label: 'Manager' },
    { key: 'joiningDate', label: 'Joined', type: 'date' },
    { key: 'probationEndDate', label: 'Probation ends', type: 'date' },
    { key: 'daysLeft', label: 'Days left', type: 'number' },
    { key: 'status', label: 'Status' },
    { key: 'confirmation', label: 'Confirmation' },
  ];
  return result('probation-due', `Next ${days} days (including overdue)`, { columns, rows }, {
    summary: [
      { label: 'Due', value: rows.filter((r) => r.status === 'Due').length, type: 'number' },
      { label: 'Overdue', value: rows.filter((r) => r.status === 'Overdue').length, type: 'number' },
    ],
  });
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

const P = {
  month: { name: 'month', type: 'month', label: 'Month' },
  period: { name: 'period', type: 'period', label: 'Period' },
  asOf: { name: 'asOf', type: 'asOf', label: 'As of' },
  year: { name: 'year', type: 'year', label: 'Year' },
  department: { name: 'department', type: 'department', label: 'Department' },
  office: { name: 'officeId', type: 'office', label: 'Location' },
} satisfies Record<string, ParamSpec>;

const REPORTS: ReportDef[] = [
  {
    key: 'headcount',
    title: 'Headcount',
    category: 'Workforce',
    description: 'Active employees as of a date, grouped by department, designation, grade, location, gender or employment type.',
    params: [P.asOf, { name: 'groupBy', type: 'groupBy', label: 'Group by', options: GROUP_OPTIONS, default: 'department' }, P.department, P.office],
    manager: true,
    chart: true,
    run: headcount,
  },
  {
    key: 'headcount-trend',
    title: 'Headcount trend',
    category: 'Workforce',
    description: 'Month-end headcount, joiners and exits for the last 12 months.',
    params: [{ ...P.month, label: 'Ending month' }, P.department, P.office],
    manager: true,
    chart: true,
    run: headcountTrend,
  },
  {
    key: 'attrition',
    title: 'Attrition',
    category: 'Workforce',
    description: 'Exits per month, attrition rate (exits ÷ average headcount), voluntary vs involuntary, by department and tenure at exit.',
    params: [P.period, P.department, P.office],
    manager: false,
    chart: true,
    run: attrition,
  },
  {
    key: 'joiners-exits',
    title: 'New joiners & exits',
    category: 'Workforce',
    description: 'Everyone who joined or left during a period.',
    params: [P.period, P.department, P.office],
    manager: false,
    chart: false,
    run: joinersExits,
  },
  {
    key: 'diversity',
    title: 'Diversity',
    category: 'Workforce',
    description: 'Gender split of active employees by department.',
    params: [P.asOf, P.department, P.office],
    manager: false,
    chart: true,
    run: diversity,
  },
  {
    key: 'attendance-summary',
    title: 'Attendance summary',
    category: 'Attendance',
    description: 'Per employee for a month: present, late, half days, absent, leave days, late minutes and overtime hours.',
    params: [P.month, P.department, P.office],
    manager: true,
    chart: false,
    run: attendanceSummary,
  },
  {
    key: 'late-arrivals',
    title: 'Late arrivals',
    category: 'Attendance',
    description: 'Every late check-in in a period with the minutes late, plus a per-employee count.',
    params: [P.period, P.department, P.office],
    manager: true,
    chart: false,
    run: lateArrivals,
  },
  {
    key: 'leave-taken',
    title: 'Leave taken',
    category: 'Leave',
    description: 'Approved leave days by type, per department or per employee (defaults to year to date).',
    params: [
      P.period,
      { name: 'groupBy', type: 'groupBy', label: 'Group by', options: [{ value: 'department', label: 'Department' }, { value: 'employee', label: 'Employee' }], default: 'department' },
      P.department,
      P.office,
    ],
    manager: true,
    chart: false,
    run: leaveTaken,
  },
  {
    key: 'leave-liability',
    title: 'Leave liability',
    category: 'Leave',
    description: 'Encashable leave balance × (basic ÷ 26) per employee, capped at each type’s max encashable days.',
    params: [P.year, P.department, P.office],
    manager: false,
    chart: false,
    run: leaveLiability,
  },
  {
    key: 'payroll-register',
    title: 'Payroll register',
    category: 'Payroll',
    description: 'Published payslips for a month with every earning, deduction and employer contribution as a column.',
    params: [P.month, P.department, P.office],
    manager: false,
    chart: false,
    run: payrollRegister,
  },
  {
    key: 'payroll-department-cost',
    title: 'Department-wise payroll cost',
    category: 'Payroll',
    description: 'Gross, deductions, net and employer cost per department for a month.',
    params: [P.month, P.office],
    manager: false,
    chart: true,
    run: payrollByDepartment,
  },
  {
    key: 'payroll-trend',
    title: 'Payroll cost trend',
    category: 'Payroll',
    description: 'Month-over-month payroll cost for the last 12 months.',
    params: [{ ...P.month, label: 'Ending month' }, P.department, P.office],
    manager: false,
    chart: true,
    run: payrollTrend,
  },
  {
    key: 'statutory',
    title: 'Statutory summary',
    category: 'Payroll',
    description: 'PF, ESI, professional tax (by state), LWF and TDS from published payslips.',
    params: [P.month, P.department, P.office],
    manager: false,
    chart: false,
    run: statutory,
  },
  {
    key: 'expenses',
    title: 'Expense claims',
    category: 'Finance',
    description: 'Claim amounts by category, department, status or employee.',
    params: [
      P.period,
      {
        name: 'groupBy',
        type: 'groupBy',
        label: 'Group by',
        options: [
          { value: 'category', label: 'Category' },
          { value: 'department', label: 'Department' },
          { value: 'status', label: 'Status' },
          { value: 'employee', label: 'Employee' },
        ],
        default: 'category',
      },
      {
        name: 'status',
        type: 'status',
        label: 'Status',
        options: [
          { value: '', label: 'All' },
          { value: 'PENDING', label: 'Pending' },
          { value: 'APPROVED', label: 'Approved' },
          { value: 'REJECTED', label: 'Rejected' },
        ],
      },
      P.department,
    ],
    manager: false,
    chart: true,
    run: expenses,
  },
  {
    key: 'loans',
    title: 'Loans outstanding',
    category: 'Finance',
    description: 'Loans and salary advances with EMI, amount repaid and outstanding balance.',
    params: [
      {
        name: 'status',
        type: 'status',
        label: 'Status',
        options: [
          { value: 'ACTIVE', label: 'Active' },
          { value: 'PENDING', label: 'Pending' },
          { value: 'CLOSED', label: 'Closed' },
          { value: 'ALL', label: 'All' },
        ],
        default: 'ACTIVE',
      },
      P.department,
    ],
    manager: false,
    chart: false,
    run: loans,
  },
  {
    key: 'assets',
    title: 'Assets assigned',
    category: 'Finance',
    description: 'Asset counts by category and status, plus everything currently issued to employees.',
    params: [P.department],
    manager: false,
    chart: false,
    run: assets,
  },
  {
    key: 'birthdays-anniversaries',
    title: 'Birthdays & anniversaries',
    category: 'Lifecycle',
    description: 'Birthdays and work anniversaries in a month.',
    params: [P.month, P.department, P.office],
    manager: true,
    chart: false,
    run: birthdays,
  },
  {
    key: 'probation-due',
    title: 'Probation due',
    category: 'Lifecycle',
    description: 'Unconfirmed employees whose probation ends soon or is overdue.',
    params: [{ name: 'days', type: 'days', label: 'Due within (days)', default: 30 }, P.department, P.office],
    manager: true,
    chart: false,
    run: probationDue,
  },
];

export function findReport(key: string): ReportDef | undefined {
  return REPORTS.find((r) => r.key === key);
}

/** Report list + filter options for the UI. Managers only see team-capable reports. */
export async function catalog(companyId: string, role: Role) {
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR';
  const [masters, texts, offices] = await Promise.all([
    prisma.department.findMany({ where: { companyId, isActive: true }, select: { name: true } }),
    prisma.employee.findMany({ where: { companyId, department: { not: '' } }, distinct: ['department'], select: { department: true } }),
    prisma.office.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  const departments = [...new Set([...masters.map((d) => d.name), ...texts.map((t) => t.department)])].sort((a, b) =>
    a.localeCompare(b)
  );
  return {
    reports: REPORTS.filter((r) => isAdmin || r.manager).map(({ run: _run, manager, ...r }) => ({
      ...r,
      roles: manager ? ['ADMIN', 'HR', 'MANAGER'] : ['ADMIN', 'HR'],
      teamScoped: !isAdmin,
    })),
    departments,
    offices,
  };
}

export function runReport(key: string, scope: ReportScope, q: ReportQuery): Promise<ReportResult> {
  const def = findReport(key);
  if (!def) throw ApiError.notFound(`Unknown report "${key}"`);
  return def.run(scope, q);
}

/** CSV of the main table (+ totals row), followed by each section separated by a blank line. */
export function toReportCsv(r: ReportResult): string {
  const block = (t: ReportTable, totals?: Record<string, Cell>) => {
    const rows = t.rows.map((row) => t.columns.map((c) => row[c.key] ?? null));
    if (totals) rows.push(t.columns.map((c) => totals[c.key] ?? null));
    return toCsv(t.columns.map((c) => c.label), rows);
  };
  const parts = [block(r, r.totals)];
  for (const s of r.sections ?? []) parts.push(toCsv([s.title ?? ''], []).replace(/^\uFEFF/, '') + block(s).replace(/^\uFEFF/, ''));
  return parts.join('\r\n');
}
