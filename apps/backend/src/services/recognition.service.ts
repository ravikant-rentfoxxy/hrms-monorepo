/** Peer recognition ("kudos"): give, company wall, monthly leaderboard. */
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { istNow } from '../lib/scheduler';
import { ApiError } from '../utils/http';
import { monthStart } from '../utils/people';
import { dispatchIntegrationEvent } from './integration.service';

export const DAILY_LIMIT = 5;

export interface KudosInput {
  toEmployeeId: string;
  badge: string;
  message: string;
  points: number;
}

const person = { select: { id: true, name: true, designation: true, department: true, avatarColor: true } };

/** Start of the current IST calendar day, as a UTC instant. */
function istDayStart(now = new Date()): Date {
  const ist = istNow(now);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 330 * 60 * 1000);
}

/** "YYYY-MM" of the current IST month. */
export function currentMonthKey(): string {
  return istNow().toISOString().slice(0, 7);
}

export async function giveKudos(companyId: string, fromEmployeeId: string, input: KudosInput) {
  if (input.toEmployeeId === fromEmployeeId) throw ApiError.badRequest('You cannot give kudos to yourself');
  const to = await prisma.employee.findFirst({ where: { id: input.toEmployeeId, companyId, isActive: true }, select: { id: true, name: true } });
  if (!to) throw ApiError.badRequest('Colleague not found');

  const today = await prisma.recognition.count({
    where: { companyId, fromEmployeeId, createdAt: { gte: istDayStart() } },
  });
  if (today >= DAILY_LIMIT) throw ApiError.badRequest(`Daily limit reached — you can give ${DAILY_LIMIT} kudos per day`);

  const kudos = await prisma.recognition.create({
    data: { companyId, fromEmployeeId, ...input },
    include: { fromEmployee: person, toEmployee: person },
  });
  await notify(companyId, [to.id], {
    event: 'kudos.received',
    title: `${kudos.fromEmployee.name} gave you kudos`,
    body: input.message,
    link: '/recognition',
  });
  await dispatchIntegrationEvent(companyId, 'kudos.received', {
    title: `${kudos.fromEmployee.name} → ${kudos.toEmployee.name}: ${kudos.badge.replace(/_/g, ' ').toLowerCase()}`,
    body: kudos.message,
    points: kudos.points,
  });
  return kudos;
}

export async function wall(companyId: string, opts: { page: number; pageSize: number; employeeId?: string }) {
  const where = {
    companyId,
    ...(opts.employeeId ? { OR: [{ toEmployeeId: opts.employeeId }, { fromEmployeeId: opts.employeeId }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.recognition.findMany({
      where,
      include: { fromEmployee: person, toEmployee: person },
      orderBy: { createdAt: 'desc' },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
    prisma.recognition.count({ where }),
  ]);
  return { items, total, page: opts.page, pageSize: opts.pageSize };
}

/** Points received per employee in a month (IST month boundaries). */
export async function leaderboard(companyId: string, opts: { month?: string; limit: number }) {
  const key = opts.month ?? currentMonthKey();
  const start = monthStart(key);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const shift = 330 * 60 * 1000; // IST midnight in UTC
  const grouped = await prisma.recognition.groupBy({
    by: ['toEmployeeId'],
    where: { companyId, createdAt: { gte: new Date(start.getTime() - shift), lt: new Date(end.getTime() - shift) } },
    _sum: { points: true },
    _count: { _all: true },
    orderBy: { _sum: { points: 'desc' } },
    take: opts.limit,
  });
  const people = await prisma.employee.findMany({ where: { companyId, id: { in: grouped.map((g) => g.toEmployeeId) } }, ...person });
  return {
    month: key,
    entries: grouped.map((g, i) => ({
      rank: i + 1,
      employee: people.find((p) => p.id === g.toEmployeeId) ?? null,
      points: g._sum.points ?? 0,
      kudos: g._count._all,
    })),
  };
}

/** Kudos received and given by an employee, plus totals and today's remaining allowance. */
export async function mine(companyId: string, employeeId: string) {
  const [received, given, totals, today] = await Promise.all([
    prisma.recognition.findMany({
      where: { companyId, toEmployeeId: employeeId },
      include: { fromEmployee: person, toEmployee: person },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.recognition.findMany({
      where: { companyId, fromEmployeeId: employeeId },
      include: { fromEmployee: person, toEmployee: person },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.recognition.aggregate({ where: { companyId, toEmployeeId: employeeId }, _sum: { points: true }, _count: { _all: true } }),
    prisma.recognition.count({ where: { companyId, fromEmployeeId: employeeId, createdAt: { gte: istDayStart() } } }),
  ]);
  return {
    received,
    given,
    totalPoints: totals._sum.points ?? 0,
    totalReceived: totals._count._all,
    remainingToday: Math.max(0, DAILY_LIMIT - today),
    dailyLimit: DAILY_LIMIT,
  };
}

/** Moderation (ADMIN): removes a kudos post. Returns the deleted row for the audit log. */
export async function deleteKudos(companyId: string, id: string) {
  const kudos = await prisma.recognition.findFirst({ where: { id, companyId } });
  if (!kudos) throw ApiError.notFound('Kudos not found');
  await prisma.recognition.delete({ where: { id } });
  return kudos;
}
