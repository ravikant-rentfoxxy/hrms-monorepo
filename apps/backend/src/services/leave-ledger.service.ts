/**
 * Leave ledger — the single source of truth for leave balances.
 *
 * Every credit / debit is a LeaveLedger row (positive = credit). A balance is
 * SUM(change) of the rows dated in a calendar year; comp-off types are the
 * exception and are summed over all time (their credits expire individually
 * instead of lapsing at year end).
 *
 *   OPENING        admin-set opening balance (migration / go-live)
 *   ACCRUAL        policy credit: YEARLY quota or one MONTHLY instalment
 *   CARRY_FORWARD  +n on 1 Jan of the new year, -n on 31 Dec of the old one
 *   LAPSE          year-end balance above carryForwardMax (31 Dec)
 *   ADJUSTMENT     manual HR correction (signed)
 *   AVAILED        approved leave (debit, refId = leave request)
 *   REVERSAL       cancelled approved leave / revoked credit (refId = source)
 *   ENCASHED       approved encashment (debit, refId = encashment)
 *   COMP_OFF       approved comp-off credit (refId = comp-off request)
 *   EXPIRED        unused comp-off past expiresOn (refId = comp-off request)
 *
 * Writers serialise per employee with `withLedgerLock`, so lazy credits,
 * approvals and jobs never double-post.
 */
import type { LeaveType, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { istNow } from '../lib/scheduler';
import { ApiError } from '../utils/http';
import * as approvalService from './approval.service';

export const LEDGER_KINDS = [
  'OPENING', 'ACCRUAL', 'CARRY_FORWARD', 'LAPSE', 'ADJUSTMENT', 'AVAILED', 'REVERSAL', 'ENCASHED', 'COMP_OFF', 'EXPIRED',
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

type Db = Prisma.TransactionClient | typeof prisma;

// ---- Date helpers (date-only values are midnight UTC) ----

const DAY_MS = 24 * 60 * 60 * 1000;

export const utcDate = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m, d));

export const dateOnly = (d: Date): Date => utcDate(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY_MS);

export const dayDiff = (a: Date, b: Date): number => Math.round((dateOnly(a).getTime() - dateOnly(b).getTime()) / DAY_MS);

export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Today's date in the companies' timezone (IST), as a date-only value. */
export function todayIST(): Date {
  const n = istNow();
  return utcDate(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
}

export const yearRange = (year: number) => ({ gte: utcDate(year, 0, 1), lt: utcDate(year + 1, 0, 1) });

/** Rounds to 2 decimals (and turns -0 into 0). */
export const round2 = (n: number): number => Math.round(n * 100) / 100 + 0;
const roundHalf = (n: number): number => Math.round(n * 2) / 2;

// ---- Locking ----

/**
 * Runs `fn` in a transaction holding a per-employee advisory lock, so two
 * writers (e.g. a balance read posting lazy credits and an approval) can't
 * interleave and double-post.
 */
export async function withLedgerLock<T>(employeeId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`leave-ledger:${employeeId}`}))`;
      return fn(tx);
    },
    { timeout: 30_000, maxWait: 15_000 }
  );
}

// ---- Policy credits ----

/**
 * Idempotently posts the policy credits an employee is owed for `year`
 * (never for future years):
 *   YEARLY  — the full quota once (pro-rated by month in the joining year);
 *   MONTHLY — one `ACCRUAL YYYY-MM` instalment per elapsed month (incl. the current one);
 *   NONE    — nothing.
 * It also back-fills AVAILED debits for APPROVED requests of that year that
 * pre-date the ledger (refId = request id), which migrates old data lazily.
 */
export async function ensureYearCreditsTx(tx: Prisma.TransactionClient, companyId: string, employeeId: string, year: number) {
  const today = todayIST();
  const currentYear = today.getUTCFullYear();
  if (year > currentYear) return;
  const employee = await tx.employee.findFirst({ where: { id: employeeId, companyId }, select: { joiningDate: true, gender: true } });
  if (!employee) return;
  const joining = dateOnly(employee.joiningDate);
  const joinYear = joining.getUTCFullYear();

  const data: Prisma.LeaveLedgerCreateManyInput[] = [];
  if (joinYear <= year) {
    const types = await tx.leaveType.findMany({
      where: { companyId, isActive: true, isCompOff: false, accrualType: { in: ['YEARLY', 'MONTHLY'] } },
    });
    const existing = await tx.leaveLedger.findMany({
      where: { companyId, employeeId, date: yearRange(year), kind: { in: ['OPENING', 'ACCRUAL'] } },
      select: { leaveTypeId: true, kind: true, reason: true },
    });
    const startMonth = joinYear === year ? joining.getUTCMonth() : 0;
    const endMonth = year < currentYear ? 11 : today.getUTCMonth();
    // First credit date: 1 Jan, or the joining date in the joining year.
    const creditDate = (month: number) =>
      joinYear === year && month === joining.getUTCMonth() ? joining : utcDate(year, month, 1);

    for (const t of types) {
      // Gender-specific types (maternity / paternity) are only credited to that gender — same rule as applying.
      if (t.gender && employee.gender !== t.gender) continue;
      const mine = existing.filter((e) => e.leaveTypeId === t.id);
      if (t.accrualType === 'YEARLY') {
        if (mine.length > 0) continue;
        const months = 12 - startMonth;
        const amount = roundHalf((t.totalPerYear * months) / 12);
        if (amount <= 0) continue;
        data.push({
          companyId, employeeId, leaveTypeId: t.id, date: creditDate(startMonth), change: amount, kind: 'ACCRUAL',
          reason: `ACCRUAL ${year}${months < 12 ? ` (pro-rated, ${months} months)` : ''}`,
        });
      } else {
        const rate = t.accrualRate > 0 ? t.accrualRate : t.totalPerYear / 12;
        if (rate <= 0) continue;
        const posted = new Set(mine.filter((e) => e.kind === 'ACCRUAL').map((e) => e.reason));
        for (let m = startMonth; m <= endMonth; m++) {
          const reason = monthlyAccrualReason(year, m);
          if (posted.has(reason)) continue;
          data.push({ companyId, employeeId, leaveTypeId: t.id, date: creditDate(m), change: round2(rate), kind: 'ACCRUAL', reason });
        }
      }
    }
  }

  // Back-fill approved leave that has no ledger debit yet.
  const approved = await tx.leaveRequest.findMany({
    where: { companyId, employeeId, status: 'APPROVED', fromDate: yearRange(year) },
    select: { id: true, leaveTypeId: true, fromDate: true, days: true },
  });
  if (approved.length > 0) {
    const posted = await tx.leaveLedger.findMany({
      where: { companyId, employeeId, kind: 'AVAILED', refId: { in: approved.map((a) => a.id) } },
      select: { refId: true },
    });
    const done = new Set(posted.map((p) => p.refId));
    for (const a of approved) {
      if (done.has(a.id)) continue;
      data.push({
        companyId, employeeId, leaveTypeId: a.leaveTypeId, date: a.fromDate, change: -a.days, kind: 'AVAILED',
        reason: 'Approved leave', refId: a.id,
      });
    }
  }

  if (data.length > 0) await tx.leaveLedger.createMany({ data });
}

export const monthlyAccrualReason = (year: number, month0: number) =>
  `ACCRUAL ${year}-${String(month0 + 1).padStart(2, '0')}`;

/** Locked wrapper of `ensureYearCreditsTx` (+ comp-off expiry) — safe to call from anywhere. */
export async function ensureYearCredits(companyId: string, employeeId: string, year: number) {
  await withLedgerLock(employeeId, async (tx) => {
    await ensureYearCreditsTx(tx, companyId, employeeId, year);
    await expireCompOffTx(tx, companyId, employeeId);
  });
}

// ---- Comp-off expiry ----

/**
 * Posts EXPIRED debits for comp-off credits past their expiresOn that were not
 * used. Usage is matched to credits first-in-first-out.
 */
export async function expireCompOffTx(tx: Prisma.TransactionClient, companyId: string, employeeId: string) {
  const today = todayIST();
  const types = await tx.leaveType.findMany({ where: { companyId, isCompOff: true }, select: { id: true } });
  for (const t of types) {
    const entries = await tx.leaveLedger.findMany({
      where: { companyId, employeeId, leaveTypeId: t.id },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
    const credits = entries.filter((e) => e.kind === 'COMP_OFF' && e.change > 0);
    if (!credits.some((c) => c.expiresOn && c.expiresOn < today)) continue;
    // Net usage of everything that is not a comp-off credit or an expiry.
    let usage = -entries.filter((e) => e.kind !== 'COMP_OFF' && e.kind !== 'EXPIRED').reduce((s, e) => s + e.change, 0);
    usage = Math.max(0, usage);
    const data: Prisma.LeaveLedgerCreateManyInput[] = [];
    for (const c of credits) {
      const used = Math.min(usage, c.change);
      usage -= used;
      if (!c.expiresOn || c.expiresOn >= today) continue;
      const key = c.refId ?? c.id;
      const alreadyExpired = -entries.filter((e) => e.kind === 'EXPIRED' && e.refId === key).reduce((s, e) => s + e.change, 0);
      const toExpire = round2(c.change - used - alreadyExpired);
      if (toExpire <= 0) continue;
      data.push({
        companyId, employeeId, leaveTypeId: t.id, date: c.expiresOn, change: -toExpire, kind: 'EXPIRED',
        reason: `Comp-off for ${isoDay(c.date)} expired`, refId: key,
      });
    }
    if (data.length > 0) await tx.leaveLedger.createMany({ data });
  }
}

// ---- Balances ----

export interface BalanceRow {
  leaveType: LeaveType;
  year: number;
  /** Credits for the year: accrued + carriedForward + adjusted. */
  total: number;
  used: number;
  pending: number;
  /** balance − pending leave − pending encashment (what can still be applied for). */
  available: number;
  /** Ledger balance (SUM of entries). */
  balance: number;
  accrued: number;
  carriedForward: number;
  adjusted: number;
  encashed: number;
  lapsed: number;
  pendingEncashment: number;
}

/** Ledger-based balances for one employee and year (no writes). */
export async function computeBalances(db: Db, companyId: string, employeeId: string, year: number, onlyTypeId?: string) {
  const [allTypes, employee] = await Promise.all([
    db.leaveType.findMany({
      where: { companyId, isActive: true, ...(onlyTypeId ? { id: onlyTypeId } : {}) },
      orderBy: { code: 'asc' },
    }),
    db.employee.findFirst({ where: { id: employeeId, companyId }, select: { gender: true } }),
  ]);
  // Hide types the employee can never use (maternity for men, paternity for women).
  const types = allTypes.filter((t) => !t.gender || t.gender === employee?.gender);
  const compOffIds = types.filter((t) => t.isCompOff).map((t) => t.id);
  const range = yearRange(year);
  const [yearSums, compSums, pendingLeaves, pendingEnc] = await Promise.all([
    db.leaveLedger.groupBy({
      by: ['leaveTypeId', 'kind'],
      where: { companyId, employeeId, date: range, leaveTypeId: { in: types.map((t) => t.id) } },
      _sum: { change: true },
    }),
    compOffIds.length
      ? db.leaveLedger.groupBy({
          by: ['leaveTypeId', 'kind'],
          where: { companyId, employeeId, leaveTypeId: { in: compOffIds } },
          _sum: { change: true },
        })
      : Promise.resolve([]),
    db.leaveRequest.findMany({
      where: { companyId, employeeId, status: 'PENDING', leaveTypeId: { in: types.map((t) => t.id) } },
      select: { leaveTypeId: true, days: true, fromDate: true },
    }),
    db.leaveEncashment.groupBy({
      by: ['leaveTypeId'],
      where: { companyId, employeeId, status: 'PENDING' },
      _sum: { days: true },
    }),
  ]);

  return types.map((t): BalanceRow => {
    const sums = t.isCompOff ? compSums : yearSums;
    const k = (...kinds: LedgerKind[]) =>
      sums.filter((s) => s.leaveTypeId === t.id && kinds.includes(s.kind as LedgerKind)).reduce((a, s) => a + (s._sum.change ?? 0), 0);
    const accrued = k('OPENING', 'ACCRUAL', 'COMP_OFF');
    const carriedForward = k('CARRY_FORWARD');
    const adjusted = k('ADJUSTMENT');
    const used = -k('AVAILED', 'REVERSAL');
    const encashed = -k('ENCASHED');
    const lapsed = -k('LAPSE', 'EXPIRED');
    const balance = accrued + carriedForward + adjusted - used - encashed - lapsed;
    const pending = pendingLeaves
      .filter((p) => p.leaveTypeId === t.id && (t.isCompOff || p.fromDate.getUTCFullYear() === year))
      .reduce((s, p) => s + p.days, 0);
    const pendingEncashment = pendingEnc.find((p) => p.leaveTypeId === t.id)?._sum.days ?? 0;
    return {
      leaveType: t,
      year,
      total: round2(accrued + carriedForward + adjusted),
      used: round2(used),
      pending: round2(pending),
      available: round2(balance - pending - pendingEncashment),
      balance: round2(balance),
      accrued: round2(accrued),
      carriedForward: round2(carriedForward),
      adjusted: round2(adjusted),
      encashed: round2(encashed),
      lapsed: round2(lapsed),
      pendingEncashment: round2(pendingEncashment),
    };
  });
}

/**
 * Per-type balances for an employee (current year by default). Posts any
 * missing policy credits first. Used by the app, F&F (encashable balance) and reports.
 */
export async function balances(companyId: string, employeeId: string, year = todayIST().getUTCFullYear()): Promise<BalanceRow[]> {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { id: true } });
  if (!employee) throw ApiError.notFound('Employee not found');
  await ensureYearCredits(companyId, employeeId, Math.min(year, todayIST().getUTCFullYear()));
  return computeBalances(prisma, companyId, employeeId, year);
}

/** The lowest balance a type may reach (0, or -maxNegative when negative balance is allowed). */
export const balanceFloor = (t: Pick<LeaveType, 'allowNegative' | 'maxNegative'>) => (t.allowNegative ? -t.maxNegative : 0);

// ---- Ledger posting / admin ----

export async function post(
  db: Db,
  entry: {
    companyId: string; employeeId: string; leaveTypeId: string; date: Date; change: number; kind: LedgerKind;
    reason?: string; refId?: string | null; expiresOn?: Date | null; createdById?: string | null;
  }
) {
  return db.leaveLedger.create({
    data: { ...entry, change: round2(entry.change), reason: entry.reason ?? '', refId: entry.refId ?? null },
  });
}

/** Sum of the entries of `kinds` that reference `refId` (e.g. what an approved leave already debited). */
export async function sumByRef(db: Db, companyId: string, refId: string, kinds: LedgerKind[]) {
  const agg = await db.leaveLedger.aggregate({ where: { companyId, refId, kind: { in: kinds } }, _sum: { change: true } });
  return agg._sum.change ?? 0;
}

export interface AdjustInput {
  employeeId: string;
  leaveTypeId: string;
  /** Signed: positive credits, negative debits. */
  days: number;
  reason: string;
  date?: Date;
}

async function assertEmployeeAndType(companyId: string, employeeId: string, leaveTypeId: string) {
  const [employee, type] = await Promise.all([
    prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { id: true, name: true } }),
    prisma.leaveType.findFirst({ where: { id: leaveTypeId, companyId } }),
  ]);
  if (!employee) throw ApiError.notFound('Employee not found');
  if (!type) throw ApiError.notFound('Leave type not found');
  return { employee, type };
}

/** Manual HR correction. The caller audits it. */
export async function adjust(companyId: string, actorEmployeeId: string | null, input: AdjustInput) {
  if (input.days === 0) throw ApiError.badRequest('Adjustment cannot be zero');
  const { type } = await assertEmployeeAndType(companyId, input.employeeId, input.leaveTypeId);
  const date = dateOnly(input.date ?? todayIST());
  return withLedgerLock(input.employeeId, async (tx) => {
    await ensureYearCreditsTx(tx, companyId, input.employeeId, date.getUTCFullYear());
    const entry = await post(tx, {
      companyId, employeeId: input.employeeId, leaveTypeId: type.id, date, change: input.days, kind: 'ADJUSTMENT',
      reason: input.reason, createdById: actorEmployeeId,
      // Comp-off credits added by hand expire like approved ones.
      expiresOn: type.isCompOff && input.days > 0 && type.compOffExpiryDays > 0 ? addDays(date, type.compOffExpiryDays) : null,
    });
    const [row] = await computeBalances(tx, companyId, input.employeeId, date.getUTCFullYear(), type.id);
    return { entry, balance: row ?? null };
  });
}

export interface OpeningInput {
  employeeId: string;
  leaveTypeId: string;
  year: number;
  days: number;
}

/**
 * Sets the opening balance of a type for a year (replaces a previous OPENING).
 * For YEARLY types the opening replaces the automatic yearly credit; MONTHLY
 * instalments keep accruing on top of it.
 */
export async function setOpening(companyId: string, actorEmployeeId: string | null, input: OpeningInput) {
  const { type } = await assertEmployeeAndType(companyId, input.employeeId, input.leaveTypeId);
  if (input.days < 0) throw ApiError.badRequest('Opening balance cannot be negative');
  return withLedgerLock(input.employeeId, async (tx) => {
    const range = yearRange(input.year);
    const removed = await tx.leaveLedger.findMany({
      where: {
        companyId, employeeId: input.employeeId, leaveTypeId: type.id, date: range,
        kind: type.accrualType === 'YEARLY' ? { in: ['OPENING', 'ACCRUAL'] } : 'OPENING',
      },
    });
    await tx.leaveLedger.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
    const entry = await post(tx, {
      companyId, employeeId: input.employeeId, leaveTypeId: type.id, date: utcDate(input.year, 0, 1), change: input.days,
      kind: 'OPENING', reason: `Opening balance ${input.year}`, createdById: actorEmployeeId,
    });
    return { entry, replaced: removed };
  });
}

/** Ledger rows for an employee (year window; comp-off rows of that year too) with a running balance per type. */
export async function ledger(companyId: string, employeeId: string, opts: { year?: number; leaveTypeId?: string }) {
  const year = opts.year ?? todayIST().getUTCFullYear();
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    select: { id: true, name: true, employeeCode: true, joiningDate: true },
  });
  if (!employee) throw ApiError.notFound('Employee not found');
  await ensureYearCredits(companyId, employeeId, Math.min(year, todayIST().getUTCFullYear()));

  const range = yearRange(year);
  const typeFilter = opts.leaveTypeId ? { leaveTypeId: opts.leaveTypeId } : {};
  const entries = await prisma.leaveLedger.findMany({
    where: { companyId, employeeId, date: range, ...typeFilter },
    include: { leaveType: { select: { id: true, code: true, name: true, color: true, isCompOff: true } } },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
  // Comp-off balances run over all time: start them from what was left before the year.
  const before = await prisma.leaveLedger.groupBy({
    by: ['leaveTypeId'],
    where: { companyId, employeeId, date: { lt: range.gte }, leaveType: { isCompOff: true }, ...typeFilter },
    _sum: { change: true },
  });
  const running = new Map<string, number>(before.map((b) => [b.leaveTypeId, b._sum.change ?? 0]));
  const creatorIds = [...new Set(entries.map((e) => e.createdById).filter((x): x is string => !!x))];
  const creators = await prisma.employee.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } });
  const rows = entries.map((e) => {
    const bal = round2((running.get(e.leaveTypeId) ?? 0) + e.change);
    running.set(e.leaveTypeId, bal);
    return { ...e, runningBalance: bal, createdByName: creators.find((c) => c.id === e.createdById)?.name ?? null };
  });
  return { employee, year, openingCompOff: Object.fromEntries(before.map((b) => [b.leaveTypeId, round2(b._sum.change ?? 0)])), entries: rows };
}

// ---- Year end ----

/**
 * Closes `prevYear` for one employee: the closing balance of each type is
 * carried into the next year up to carryForwardMax and the rest lapses
 * (entries dated 31 Dec). A negative closing balance is carried in full.
 * Idempotent per employee / type / year. Comp-off types are skipped (they expire per credit).
 */
export async function yearEndTx(tx: Prisma.TransactionClient, companyId: string, employeeId: string, prevYear: number) {
  await ensureYearCreditsTx(tx, companyId, employeeId, prevYear);
  const types = await tx.leaveType.findMany({ where: { companyId, isActive: true, isCompOff: false } });
  const nextYear = prevYear + 1;
  const marker = `Year-end ${prevYear}`;
  const done = await tx.leaveLedger.findMany({
    where: { companyId, employeeId, reason: { startsWith: marker }, kind: { in: ['CARRY_FORWARD', 'LAPSE'] } },
    select: { leaveTypeId: true },
  });
  const doneIds = new Set(done.map((d) => d.leaveTypeId));
  const rows = await computeBalances(tx, companyId, employeeId, prevYear);
  const dec31 = utcDate(prevYear, 11, 31);
  const jan1 = utcDate(nextYear, 0, 1);
  const data: Prisma.LeaveLedgerCreateManyInput[] = [];
  for (const t of types) {
    if (doneIds.has(t.id)) continue;
    const closing = rows.find((r) => r.leaveType.id === t.id)?.balance ?? 0;
    if (closing === 0) continue;
    const carry = closing < 0 ? closing : round2(Math.min(closing, Math.max(0, t.carryForwardMax)));
    const lapse = round2(closing - carry);
    const base = { companyId, employeeId, leaveTypeId: t.id };
    if (lapse > 0) data.push({ ...base, date: dec31, change: -lapse, kind: 'LAPSE', reason: `${marker}: lapsed above carry-forward limit` });
    if (carry !== 0) {
      data.push({ ...base, date: dec31, change: -carry, kind: 'CARRY_FORWARD', reason: `${marker}: carried to ${nextYear}` });
      data.push({ ...base, date: jan1, change: carry, kind: 'CARRY_FORWARD', reason: `${marker}: carried from ${prevYear}` });
    }
  }
  if (data.length > 0) await tx.leaveLedger.createMany({ data });
  if (nextYear <= todayIST().getUTCFullYear()) await ensureYearCreditsTx(tx, companyId, employeeId, nextYear);
}

// ---- Liability (reports) ----

/**
 * Encashable leave liability: for every active employee, the current-year
 * balance of each encashable type × (basic ÷ 26). Relies on the monthly job
 * having posted credits (it runs at boot and on the 1st).
 */
export async function leaveLiability(companyId: string) {
  const year = todayIST().getUTCFullYear();
  const [types, employees] = await Promise.all([
    prisma.leaveType.findMany({ where: { companyId, isActive: true, encashable: true } }),
    prisma.employee.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true, employeeCode: true, department: true, salaryBasic: true },
    }),
  ]);
  if (types.length === 0) return { asOf: todayIST(), year, total: 0, totalDays: 0, rows: [] };
  const sums = await prisma.leaveLedger.groupBy({
    by: ['employeeId', 'leaveTypeId'],
    where: { companyId, date: yearRange(year), leaveTypeId: { in: types.map((t) => t.id) } },
    _sum: { change: true },
  });
  const rows = [];
  for (const s of sums) {
    const emp = employees.find((e) => e.id === s.employeeId);
    const type = types.find((t) => t.id === s.leaveTypeId);
    const balance = round2(s._sum.change ?? 0);
    if (!emp || !type || balance <= 0) continue;
    const perDay = round2(emp.salaryBasic / 26);
    rows.push({
      employeeId: emp.id, employeeCode: emp.employeeCode, name: emp.name, department: emp.department,
      leaveTypeId: type.id, leaveCode: type.code, balance, perDay, amount: round2(balance * perDay),
    });
  }
  rows.sort((a, b) => b.amount - a.amount);
  return {
    asOf: todayIST(),
    year,
    total: round2(rows.reduce((s, r) => s + r.amount, 0)),
    totalDays: round2(rows.reduce((s, r) => s + r.balance, 0)),
    rows,
  };
}

// ---- Approval trails (shared by leave / comp-off / encashment lists) ----

export interface TrailStep {
  level: number;
  status: string;
  approverName: string | null;
  actedByName: string | null;
  actedAt: Date | null;
  remarks: string | null;
}

/** Batched approval trails for a list of requests: { [requestId]: steps }. */
export async function trailsFor(companyId: string, module: approvalService.ApprovalModule, ids: string[]) {
  const out = new Map<string, TrailStep[]>();
  if (ids.length === 0) return out;
  const steps = await prisma.approvalStep.findMany({
    where: { companyId, module, requestId: { in: ids } },
    orderBy: { level: 'asc' },
  });
  const peopleIds = [...new Set(steps.flatMap((s) => [s.approverEmployeeId, s.actedById]).filter((x): x is string => !!x))];
  const people = await prisma.employee.findMany({ where: { id: { in: peopleIds } }, select: { id: true, name: true } });
  const name = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? null) : null);
  for (const s of steps) {
    const list = out.get(s.requestId) ?? [];
    list.push({
      level: s.level,
      status: s.status,
      approverName: s.approverRole ?? name(s.approverEmployeeId),
      actedByName: name(s.actedById),
      actedAt: s.actedAt,
      remarks: s.remarks,
    });
    out.set(s.requestId, list);
  }
  return out;
}

/**
 * Ids of PENDING requests of `module` the actor should act on: their engine
 * inbox plus legacy requests (no chain yet) of their direct reports — or all
 * legacy ones for HR/ADMIN.
 */
export async function awaitingActor(
  companyId: string,
  module: approvalService.ApprovalModule,
  actor: approvalService.Actor,
  legacyCandidates: { id: string; employeeId: string; managerId: string | null }[]
) {
  const inbox = await approvalService.pendingFor(companyId, actor, module);
  const ids = new Set(inbox.map((s) => s.requestId));
  if (legacyCandidates.length > 0) {
    const withSteps = await prisma.approvalStep.findMany({
      where: { companyId, module, requestId: { in: legacyCandidates.map((c) => c.id) } },
      select: { requestId: true },
      distinct: ['requestId'],
    });
    const chained = new Set(withSteps.map((s) => s.requestId));
    const override = actor.role === 'SUPER_ADMIN' || actor.role === 'ADMIN' || actor.role === 'HR';
    for (const c of legacyCandidates) {
      if (chained.has(c.id) || c.employeeId === actor.employeeId) continue;
      if (override || (actor.employeeId && c.managerId === actor.employeeId)) ids.add(c.id);
    }
  }
  return ids;
}
