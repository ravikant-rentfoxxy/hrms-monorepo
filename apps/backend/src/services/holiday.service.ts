/** Holiday calendar, tenant-scoped. */
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/http';

export interface HolidayInput {
  name: string;
  date: Date;
  optional?: boolean;
}

export async function listHolidays(companyId: string, year?: number) {
  const where = year
    ? { date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } }
    : {};
  return prisma.holiday.findMany({ where: { companyId, ...where }, orderBy: { date: 'asc' } });
}

/**
 * Accepts a single holiday or a batch (bulk add). Duplicates (same name + date)
 * are skipped; a request that adds nothing is a conflict.
 */
export async function createHolidays(companyId: string, items: HolidayInput[]) {
  const created = await prisma.holiday.createMany({
    data: items.map((i) => ({ ...i, companyId })),
    skipDuplicates: true,
  });
  if (created.count === 0) {
    throw ApiError.conflict(items.length === 1 ? 'This holiday already exists on that date' : 'All of these holidays already exist');
  }
  return { created: created.count, skipped: items.length - created.count };
}

export async function updateHoliday(companyId: string, id: string, data: Partial<HolidayInput>) {
  if (data.name !== undefined || data.date !== undefined) {
    const current = await prisma.holiday.findFirst({ where: { id, companyId } });
    if (!current) throw ApiError.notFound('Holiday not found');
    const clash = await prisma.holiday.findFirst({
      where: { companyId, name: data.name ?? current.name, date: data.date ?? current.date, NOT: { id } },
    });
    if (clash) throw ApiError.conflict('This holiday already exists on that date');
  }
  const result = await prisma.holiday.updateMany({ where: { id, companyId }, data });
  if (result.count === 0) throw ApiError.notFound('Holiday not found');
  return prisma.holiday.findUnique({ where: { id } });
}

export async function deleteHoliday(companyId: string, id: string): Promise<void> {
  const result = await prisma.holiday.deleteMany({ where: { id, companyId } });
  if (result.count === 0) throw ApiError.notFound('Holiday not found');
}
