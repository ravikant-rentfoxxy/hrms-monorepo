/**
 * Separation backfill (idempotent, never deletes):
 *  1. Exit case IDs (EXIT-YYYY-NNNN) for resignations without one, in
 *     resignation-date order (the year is the resignation's year).
 *  2. Clearance checklists for clearances created before checklists existed:
 *     the department's default items — all ticked when the row is CLEARED.
 *  3. F&F due dates (last working day + 2 working days) for settlements without one.
 *  4. Closed / archived: COMPLETED exits whose clearances are all CLEARED and
 *     whose F&F is PAID get closedAt (= paid date) and the employee archivedAt.
 *     Rehire eligibility stays undecided (null). employmentStatus is NOT touched
 *     here — the career backfill decides it.
 *  5. The RESIGNATION_ACKNOWLEDGEMENT letter template for companies whose
 *     templates were seeded before it existed. acknowledgedAt stays null for
 *     old resignations.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { nextCode } from '../../src/utils/codes';
import { addWorkingDays, FNF_DUE_WORKING_DAYS } from '../../src/services/exit.helpers';
import { defaultItems } from '../../src/services/exit-clearance.service';
import { DEFAULT_TEMPLATES } from '../../src/services/letter.service';

export async function backfillSeparation(prisma: PrismaClient): Promise<string[]> {
  const log: string[] = [];

  // 1. Exit case IDs.
  const uncoded = await prisma.resignation.findMany({
    where: { code: null },
    select: { id: true, companyId: true, appliedOn: true },
    orderBy: [{ appliedOn: 'asc' }, { id: 'asc' }],
  });
  for (const r of uncoded) {
    const code = await nextCode(r.companyId, 'EXIT', prisma, r.appliedOn);
    await prisma.resignation.update({ where: { id: r.id }, data: { code } });
  }
  log.push(`separation: ${uncoded.length} exit case ID(s) assigned`);

  // 2. Clearance checklists.
  const missing = (await prisma.exitClearance.findMany({ select: { id: true, department: true, status: true, items: true } })).filter(
    (c) => !Array.isArray(c.items)
  );
  for (const c of missing) {
    await prisma.exitClearance.update({
      where: { id: c.id },
      data: { items: defaultItems(c.department, c.status === 'CLEARED') as unknown as Prisma.InputJsonValue },
    });
  }
  log.push(`separation: ${missing.length} clearance checklist(s) defaulted`);

  // 3. F&F due dates.
  const undated = await prisma.finalSettlement.findMany({
    where: { dueDate: null },
    select: { id: true, companyId: true, lastWorkingDay: true },
  });
  for (const s of undated) {
    const dueDate = await addWorkingDays(s.companyId, s.lastWorkingDay, FNF_DUE_WORKING_DAYS, prisma);
    await prisma.finalSettlement.update({ where: { id: s.id }, data: { dueDate } });
  }
  log.push(`separation: ${undated.length} F&F due date(s) set`);

  // 4. Close finished exits.
  const finished = await prisma.resignation.findMany({
    where: { status: 'COMPLETED', closedAt: null, settlement: { status: 'PAID' } },
    select: {
      id: true, employeeId: true,
      clearances: { select: { status: true } },
      settlement: { select: { paidOn: true, updatedAt: true } },
    },
  });
  let closed = 0;
  for (const r of finished) {
    if (r.clearances.length === 0 || r.clearances.some((c) => c.status !== 'CLEARED')) continue;
    const closedAt = r.settlement?.paidOn ?? r.settlement?.updatedAt ?? new Date();
    await prisma.resignation.update({ where: { id: r.id }, data: { closedAt } });
    await prisma.employee.updateMany({ where: { id: r.employeeId, archivedAt: null }, data: { archivedAt: closedAt } });
    closed++;
  }
  log.push(`separation: ${closed} completed exit case(s) closed and archived`);

  // 5. Resignation acknowledgement template.
  const ack = DEFAULT_TEMPLATES.find((t) => t.type === 'RESIGNATION_ACKNOWLEDGEMENT');
  let seeded = 0;
  if (ack) {
    const withTemplates = await prisma.letterTemplate.groupBy({ by: ['companyId'] });
    const have = new Set(
      (await prisma.letterTemplate.findMany({ where: { type: ack.type }, select: { companyId: true } })).map((t) => t.companyId)
    );
    for (const { companyId } of withTemplates) {
      if (have.has(companyId)) continue;
      await prisma.letterTemplate.create({ data: { companyId, type: ack.type, name: ack.name, subject: ack.subject, body: ack.body } });
      seeded++;
    }
  }
  log.push(`separation: resignation acknowledgement template added for ${seeded} compan${seeded === 1 ? 'y' : 'ies'}`);

  return log;
}
