/**
 * Exit clearance: one row per department (MANAGER / IT / FINANCE / ADMIN /
 * HR), each with a checklist. Items with a `key` are ticked automatically
 * from data (handover verified, assets returned, loans closed, exit interview
 * submitted, ...); the rest are ticked by the department. A row moves
 * PENDING → IN_PROGRESS (some items done) → CLEARED (department sign-off).
 *
 *   await openClearances(companyId, resignationId);   // on approval (idempotent)
 *   await autoTickClearances(companyId, resignationId); // whenever the underlying data may have changed
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';
import { employeeIdsWithRoles, inr, isCompanyAdmin, round2 } from '../utils/lifecycle';
import { unreturnedAssets } from './asset.service';
import { CLEARANCE_DEPARTMENTS, type Actor, type ClearanceDept, isReportingManager, loadExit } from './exit.helpers';

export interface ClearanceItem {
  label: string;
  done: boolean;
  /** Set on items the system can tick from data. */
  key?: string;
  /** Ticked by the system (not by a person). */
  auto?: boolean;
  note?: string;
}

/** Default checklist per department; companies' departments tick / add items per case. */
export const DEFAULT_CLEARANCE_ITEMS: Record<ClearanceDept, { label: string; key?: string }[]> = {
  MANAGER: [
    { label: 'Handover tasks verified', key: 'handover' },
    { label: 'Knowledge transfer completed' },
    { label: 'Pending work and approvals reassigned' },
  ],
  IT: [
    { label: 'Laptop and IT equipment returned', key: 'it_assets' },
    { label: 'Email / SSO and system access disabled' },
    { label: 'Data backup taken' },
  ],
  FINANCE: [
    { label: 'Advances / loans settled', key: 'loans' },
    { label: 'Reimbursements cleared', key: 'expenses' },
  ],
  ADMIN: [
    { label: 'ID card returned' },
    { label: 'Access card returned' },
    { label: 'Other company assets returned', key: 'admin_assets' },
  ],
  HR: [
    { label: 'Documents collected' },
    { label: 'Exit interview done', key: 'interview' },
  ],
};

export const defaultItems = (department: string, done = false): ClearanceItem[] =>
  (DEFAULT_CLEARANCE_ITEMS[department as ClearanceDept] ?? []).map((i) => ({ ...i, done }));

/** Stored checklist, or the department's defaults for rows created before checklists existed. */
export function itemsOf(c: { department: string; status: string; items: Prisma.JsonValue | null }): ClearanceItem[] {
  if (Array.isArray(c.items)) {
    return (c.items as unknown as ClearanceItem[]).filter((i) => i && typeof i.label === 'string');
  }
  return defaultItems(c.department, c.status === 'CLEARED');
}

/** PENDING (nothing done) / IN_PROGRESS (something done); CLEARED only by sign-off. */
export const statusFromItems = (items: ClearanceItem[], current: string): string =>
  current === 'CLEARED' ? 'CLEARED' : items.some((i) => i.done) ? 'IN_PROGRESS' : 'PENDING';

const json = (items: ClearanceItem[]) => items as unknown as Prisma.InputJsonValue;

/** Creates the five department rows with their default checklists (idempotent). */
export async function openClearances(companyId: string, resignationId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  await db.exitClearance.createMany({
    data: CLEARANCE_DEPARTMENTS.map((department) => ({ companyId, resignationId, department, items: json(defaultItems(department)) })),
    skipDuplicates: true,
  });
}

/** Facts the keyed checklist items are ticked from. */
async function facts(companyId: string, r: { id: string; employeeId: string }) {
  const [tasks, assets, loans, expenses, interview] = await Promise.all([
    prisma.handoverTask.findMany({ where: { companyId, resignationId: r.id }, select: { status: true } }),
    unreturnedAssets(companyId, r.employeeId),
    prisma.loan.count({ where: { companyId, employeeId: r.employeeId, status: 'ACTIVE', balance: { gt: 0 } } }),
    prisma.expenseClaim.count({ where: { companyId, employeeId: r.employeeId, status: 'PENDING' } }),
    prisma.exitInterview.findUnique({ where: { resignationId: r.id }, select: { id: true } }),
  ]);
  return {
    handover: tasks.length > 0 && tasks.every((t) => t.status === 'VERIFIED'),
    it_assets: !assets.some((a) => a.department === 'IT'),
    admin_assets: !assets.some((a) => a.department === 'ADMIN'),
    loans: loans === 0,
    expenses: expenses === 0,
    interview: !!interview,
  } as Record<string, boolean>;
}

/**
 * Ticks keyed items whose condition now holds and moves rows to IN_PROGRESS.
 * Never unticks (a person may have ticked it) and never touches CLEARED rows.
 */
export async function autoTickClearances(companyId: string, resignationId: string): Promise<void> {
  const r = await prisma.resignation.findFirst({
    where: { id: resignationId, companyId, status: 'APPROVED' },
    select: { id: true, employeeId: true, clearances: true },
  });
  if (!r || r.clearances.length === 0) return;
  const f = await facts(companyId, r);
  for (const c of r.clearances) {
    if (c.status === 'CLEARED') continue;
    let changed = !Array.isArray(c.items);
    const items = itemsOf(c).map((i) => {
      if (!i.done && i.key && f[i.key]) {
        changed = true;
        return { ...i, done: true, auto: true };
      }
      return i;
    });
    const status = statusFromItems(items, c.status);
    if (!changed && status === c.status) continue;
    await prisma.exitClearance.update({ where: { id: c.id }, data: { items: json(items), status } });
  }
}

function assertCanClear(r: Awaited<ReturnType<typeof loadExit>>, department: ClearanceDept, actor: Actor) {
  if (r.status !== 'APPROVED') throw ApiError.badRequest(`Clearances are open only while the exit is in progress (this one is ${r.status.toLowerCase()})`);
  if (actor.employeeId === r.employeeId) throw ApiError.forbidden('You cannot clear your own exit');
  if (isCompanyAdmin(actor.role)) return;
  if (department === 'MANAGER' && isReportingManager(r, actor)) return;
  throw ApiError.forbidden(department === 'MANAGER' ? "Only the employee's manager or HR can clear this" : 'Only ADMIN / HR can clear this department');
}

async function loadClearance(resignationId: string, department: ClearanceDept) {
  const clearance = await prisma.exitClearance.findUnique({ where: { resignationId_department: { resignationId, department } } });
  if (!clearance) throw ApiError.notFound('Clearance not found');
  return clearance;
}

/** Ticks / unticks / adds checklist items (department owner). */
export async function updateItems(
  companyId: string,
  id: string,
  department: ClearanceDept,
  actor: Actor,
  input: { items: { label: string; done: boolean }[] }
) {
  const r = await loadExit(companyId, id);
  assertCanClear(r, department, actor);
  const clearance = await loadClearance(id, department);
  if (clearance.status === 'CLEARED') throw ApiError.badRequest('This department is already cleared — reopen it to change the checklist');
  const previous = itemsOf(clearance);
  const seen = new Set<string>();
  const items: ClearanceItem[] = [];
  for (const i of input.items) {
    const label = i.label.trim();
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    const old = previous.find((p) => p.label === label);
    items.push({
      label,
      done: i.done,
      ...(old?.key ? { key: old.key } : {}),
      // A person changing an item takes it over from the system.
      ...(old?.auto && old.done === i.done ? { auto: true } : {}),
      ...(old?.note ? { note: old.note } : {}),
    });
  }
  if (items.length === 0) throw ApiError.badRequest('The checklist needs at least one item');
  const after = await prisma.exitClearance.update({
    where: { id: clearance.id },
    data: { items: json(items), status: statusFromItems(items, clearance.status) },
  });
  return { before: clearance, after };
}

/** Department sign-off (CLEARED) or reopen (back to PENDING / IN_PROGRESS). */
export async function actClearance(
  companyId: string,
  id: string,
  department: ClearanceDept,
  actor: Actor,
  input: { status: 'CLEARED' | 'PENDING'; dues?: number; remarks?: string; assetsNotReturned?: boolean; force?: boolean }
) {
  const r = await loadExit(companyId, id);
  assertCanClear(r, department, actor);
  const clearance = await loadClearance(id, department);
  let items = itemsOf(clearance);

  let dues = input.dues ?? clearance.dues;
  let remarks = input.remarks ?? clearance.remarks;
  if (input.status === 'CLEARED' && (department === 'IT' || department === 'ADMIN')) {
    const pending = (await unreturnedAssets(companyId, r.employeeId)).filter((a) => a.department === department);
    if (pending.length > 0) {
      if (!input.assetsNotReturned) {
        throw ApiError.badRequest(
          `${pending.length} asset(s) are still with the employee — record their return under Assets, or clear as "not returned" to recover the cost`
        );
      }
      const cost = pending.reduce((s, a) => s + a.cost, 0);
      dues = round2((input.dues ?? 0) + cost);
      const note = `Not returned: ${pending.map((a) => `${a.name} (${a.tag}) ${inr(a.cost)}`).join(', ')}`;
      remarks = [input.remarks, note].filter(Boolean).join(' · ');
      // The asset item is resolved by recovering the cost in F&F.
      items = items.map((i) => (i.key === `${department.toLowerCase()}_assets` && !i.done ? { ...i, done: true, note: 'Not returned — cost recovered in F&F' } : i));
    }
  }
  if (input.status === 'CLEARED') {
    const open = items.filter((i) => !i.done);
    if (open.length > 0 && !input.force) {
      throw ApiError.badRequest(`${open.length} checklist item(s) are still open: ${open.map((i) => i.label).join(', ')}`);
    }
    if (open.length > 0 && !(input.remarks ?? '').trim()) {
      throw ApiError.badRequest('Add a remark explaining why the department is cleared with open checklist items');
    }
  }

  const status = input.status === 'CLEARED' ? 'CLEARED' : statusFromItems(items, 'PENDING');
  const updated = await prisma.exitClearance.update({
    where: { id: clearance.id },
    data: {
      status,
      items: json(items),
      dues: Math.max(0, dues),
      remarks,
      clearedById: status === 'CLEARED' ? actor.employeeId : null,
      clearedAt: status === 'CLEARED' ? new Date() : null,
    },
  });
  const all = await prisma.exitClearance.findMany({ where: { resignationId: id } });
  if (status === 'CLEARED' && all.every((c) => c.status === 'CLEARED')) {
    await notify(companyId, [r.employeeId, ...(await employeeIdsWithRoles(companyId))], {
      event: 'exit.cleared',
      title: `All exit clearances done for ${r.employee.name}`,
      body: 'The full & final settlement can now be finalised.',
      link: `/exits/${id}`,
    });
  }
  return { before: clearance, after: updated };
}
