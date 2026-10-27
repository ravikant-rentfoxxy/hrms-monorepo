/**
 * Company assets (laptops, phones, ID cards, ...): inventory, issue / return
 * history per asset and per employee. Assets still with an exiting employee
 * feed the IT / Admin exit clearance.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';
import { nextCode } from '../utils/codes';
import { isoDate, localDateOf } from '../utils/tz';

export const ASSET_CATEGORIES = ['Laptop', 'Desktop', 'Monitor', 'Mobile', 'Tablet', 'Accessory', 'ID Card', 'Access Card', 'Vehicle', 'Furniture', 'Other'] as const;
export const ASSET_STATUSES = ['AVAILABLE', 'ASSIGNED', 'IN_REPAIR', 'RETIRED', 'LOST'] as const;

/** Categories collected by IT at exit; everything else is Admin's. */
export const IT_CATEGORIES = ['Laptop', 'Desktop', 'Monitor', 'Mobile', 'Tablet', 'Accessory'];
export const clearanceDeptFor = (category: string): 'IT' | 'ADMIN' => (IT_CATEGORIES.includes(category) ? 'IT' : 'ADMIN');

export interface AssetInput {
  tag: string;
  name: string;
  category: string;
  serialNumber: string;
  brand: string;
  model: string;
  purchaseDate?: Date | null;
  cost: number;
  status?: string;
  notes: string;
}

export interface AssignInput {
  employeeId: string;
  /** Back-dated issue (e.g. recording an asset handed over earlier); default now. */
  issuedOn?: Date | null;
  expectedReturn?: Date | null;
  conditionOut?: string;
  notes?: string;
}

export interface ReturnInput {
  /** Back-dated return; default now. */
  returnedOn?: Date | null;
  conditionIn: string;
  status: 'AVAILABLE' | 'IN_REPAIR';
  notes?: string;
}

export interface AssignmentDatesInput {
  issuedOn?: Date;
  expectedReturn?: Date | null;
  returnedOn?: Date;
}

/** Today's date (YYYY-MM-DD) in the company's time zone. */
async function companyToday(companyId: string): Promise<string> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
  return isoDate(localDateOf(new Date(), company?.timezone ?? 'Asia/Kolkata'));
}

/**
 * Date rules for one issue → return period of an asset, compared by calendar
 * day: nothing in the future (company time zone), returned on or after issued,
 * return-by not before issued, and no overlap with the asset's other issues —
 * a same-day handover (one returns it, the next gets it) is fine.
 */
async function checkPeriod(
  companyId: string,
  assetId: string,
  period: { issuedOn: Date; returnedOn: Date | null; expectedReturn: Date | null },
  excludeAssignmentId?: string
) {
  const today = await companyToday(companyId);
  const issued = isoDate(period.issuedOn);
  const returned = period.returnedOn ? isoDate(period.returnedOn) : null;
  if (issued > today) throw ApiError.badRequest('The issue date cannot be in the future');
  if (returned && returned > today) throw ApiError.badRequest('The return date cannot be in the future');
  if (returned && returned < issued) throw ApiError.badRequest('The return date cannot be before the issue date');
  if (period.expectedReturn && isoDate(period.expectedReturn) < issued) {
    throw ApiError.badRequest('The return-by date cannot be before the issue date');
  }
  const others = await prisma.assetAssignment.findMany({
    where: { companyId, assetId, ...(excludeAssignmentId ? { id: { not: excludeAssignmentId } } : {}) },
    select: { issuedOn: true, returnedOn: true, employee: { select: { name: true } } },
  });
  const end = returned ?? '9999-12-31';
  for (const o of others) {
    const oStart = isoDate(o.issuedOn);
    const oEnd = o.returnedOn ? isoDate(o.returnedOn) : '9999-12-31';
    if (issued < oEnd && oStart < end) {
      throw ApiError.badRequest(
        `These dates overlap ${o.employee.name}'s issue of this asset (${oStart} to ${o.returnedOn ? oEnd : 'now'})`
      );
    }
  }
}

const holderInclude = {
  assignments: {
    where: { returnedOn: null },
    include: { employee: { select: { id: true, name: true, employeeCode: true } } },
    take: 1,
  },
} satisfies Prisma.AssetInclude;

/** Flattens the open assignment into `holder`. */
function withHolder<T extends { assignments: { employee: { id: string; name: string; employeeCode: string }; issuedOn: Date; id: string }[] }>(a: T) {
  const { assignments, ...rest } = a;
  const open = assignments[0];
  return { ...rest, holder: open ? { ...open.employee, issuedOn: open.issuedOn, assignmentId: open.id } : null };
}

export async function listAssets(companyId: string, filter: { status?: string; category?: string; q?: string }) {
  const q = filter.q?.trim();
  const assets = await prisma.asset.findMany({
    where: {
      companyId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.category ? { category: filter.category } : {}),
      ...(q
        ? {
            OR: [
              { tag: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
              { serialNumber: { contains: q, mode: 'insensitive' } },
              { brand: { contains: q, mode: 'insensitive' } },
              { model: { contains: q, mode: 'insensitive' } },
              // Current holder's name or employee ID
              {
                assignments: {
                  some: {
                    returnedOn: null,
                    employee: {
                      OR: [{ name: { contains: q, mode: 'insensitive' } }, { employeeCode: { contains: q, mode: 'insensitive' } }],
                    },
                  },
                },
              },
            ],
          }
        : {}),
    },
    include: holderInclude,
    orderBy: { tag: 'asc' },
    take: 1000,
  });
  return assets.map(withHolder);
}

export async function summary(companyId: string) {
  const groups = await prisma.asset.groupBy({ by: ['status'], where: { companyId }, _count: { _all: true }, _sum: { cost: true } });
  const byStatus = Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
  return {
    total: groups.reduce((s, g) => s + g._count._all, 0),
    value: groups.reduce((s, g) => s + (g._sum.cost ?? 0), 0),
    byStatus,
  };
}

async function loadAsset(companyId: string, id: string) {
  const asset = await prisma.asset.findFirst({ where: { id, companyId }, include: holderInclude });
  if (!asset) throw ApiError.notFound('Asset not found');
  return asset;
}

export async function getAsset(companyId: string, id: string) {
  return withHolder(await loadAsset(companyId, id));
}

const isTagClash = (err: unknown) => (err as { code?: string }).code === 'P2002';

export async function createAsset(companyId: string, input: AssetInput) {
  if (input.status === 'ASSIGNED') throw ApiError.badRequest('Create the asset first, then assign it to an employee');
  try {
    return await prisma.asset.create({ data: { ...input, tag: input.tag.trim(), status: input.status ?? 'AVAILABLE', companyId } });
  } catch (err) {
    if (isTagClash(err)) throw ApiError.conflict(`Asset tag "${input.tag}" is already in use`);
    throw err;
  }
}

export async function updateAsset(companyId: string, id: string, input: Partial<AssetInput>) {
  const asset = await loadAsset(companyId, id);
  if (input.status && input.status !== asset.status) {
    if (input.status === 'ASSIGNED') throw ApiError.badRequest('Use "Assign" to issue the asset to an employee');
    if (asset.status === 'ASSIGNED') throw ApiError.badRequest('Record the return before changing the status of an assigned asset');
  }
  try {
    const updated = await prisma.asset.update({
      where: { id: asset.id },
      data: { ...input, ...(input.tag ? { tag: input.tag.trim() } : {}) },
      include: holderInclude,
    });
    return { before: asset, after: withHolder(updated) };
  } catch (err) {
    if (isTagClash(err)) throw ApiError.conflict(`Asset tag "${input.tag}" is already in use`);
    throw err;
  }
}

/**
 * Delete an asset. One that was ever issued needs `withHistory` — its issue
 * history goes with it (the controller copies it into the audit log first).
 */
export async function deleteAsset(companyId: string, id: string, opts: { withHistory?: boolean } = {}) {
  const asset = await loadAsset(companyId, id);
  const history = await prisma.assetAssignment.findMany({
    where: { companyId, assetId: id },
    select: { issuedOn: true, returnedOn: true, conditionOut: true, conditionIn: true, notes: true, employee: { select: { name: true, employeeCode: true } } },
    orderBy: { issuedOn: 'asc' },
  });
  if (history.length > 0 && !opts.withHistory) {
    throw ApiError.badRequest('This asset has an issue history — confirm deleting it together with its history, or set its status to RETIRED');
  }
  await prisma.asset.delete({ where: { id: asset.id } }); // assignments cascade
  return { asset, history };
}

export async function assignAsset(companyId: string, assetId: string, input: AssignInput, issuedById: string | null) {
  const asset = await loadAsset(companyId, assetId);
  if (asset.status !== 'AVAILABLE') {
    throw ApiError.badRequest(
      asset.status === 'ASSIGNED'
        ? `Already assigned to ${asset.assignments[0]?.employee.name ?? 'someone'} — record the return first`
        : `Asset is ${asset.status.replace('_', ' ').toLowerCase()} and cannot be issued`
    );
  }
  const employee = await prisma.employee.findFirst({ where: { id: input.employeeId, companyId, isActive: true }, select: { id: true, name: true } });
  if (!employee) throw ApiError.badRequest('Active employee not found in this company');
  const issuedOn = input.issuedOn ?? new Date();
  await checkPeriod(companyId, asset.id, { issuedOn, returnedOn: null, expectedReturn: input.expectedReturn ?? null });

  // Guarded status flip so two concurrent assigns cannot both succeed.
  const assignment = await prisma.$transaction(async (tx) => {
    const flip = await tx.asset.updateMany({ where: { id: asset.id, status: 'AVAILABLE' }, data: { status: 'ASSIGNED' } });
    if (flip.count === 0) throw ApiError.conflict('Asset was just assigned by someone else');
    return tx.assetAssignment.create({
      data: {
        companyId,
        assetId: asset.id,
        employeeId: employee.id,
        issuedOn,
        expectedReturn: input.expectedReturn ?? null,
        conditionOut: input.conditionOut?.trim() || 'Good',
        notes: input.notes ?? '',
        issuedById,
      },
    });
  });
  await notify(companyId, [employee.id], {
    event: 'asset.assigned',
    title: `${asset.name} (${asset.tag}) issued to you`,
    body: 'You are responsible for this asset until it is returned.',
    link: '/assets',
  });
  return assignment;
}

export async function returnAsset(companyId: string, assetId: string, input: ReturnInput) {
  const asset = await loadAsset(companyId, assetId);
  const open = asset.assignments[0];
  if (!open) throw ApiError.badRequest('Asset is not currently assigned');
  const returnedOn = input.returnedOn ?? new Date();
  await checkPeriod(companyId, asset.id, { issuedOn: open.issuedOn, returnedOn, expectedReturn: null }, open.id);
  const [assignment] = await prisma.$transaction([
    prisma.assetAssignment.update({
      where: { id: open.id },
      data: {
        returnedOn,
        conditionIn: input.conditionIn.trim(),
        notes: [open.notes, input.notes].filter((n) => n && n.trim()).join(' · '),
      },
    }),
    prisma.asset.update({ where: { id: asset.id }, data: { status: input.status } }),
  ]);
  await notify(companyId, [open.employee.id], {
    event: 'asset.returned',
    title: `Return of ${asset.name} (${asset.tag}) recorded`,
    body: `Condition: ${input.conditionIn}.`,
    link: '/assets',
  });
  return assignment;
}

/** Correct the dates of one issue (issued / return-by / returned); the return date only once it is returned. */
export async function updateAssignmentDates(companyId: string, assignmentId: string, input: AssignmentDatesInput) {
  const before = await prisma.assetAssignment.findFirst({ where: { id: assignmentId, companyId } });
  if (!before) throw ApiError.notFound('Assignment not found');
  if (input.returnedOn && !before.returnedOn) {
    throw ApiError.badRequest('This asset has not been returned yet — use Return to record it');
  }
  const next = {
    issuedOn: input.issuedOn ?? before.issuedOn,
    expectedReturn: input.expectedReturn !== undefined ? input.expectedReturn : before.expectedReturn,
    returnedOn: input.returnedOn ?? before.returnedOn,
  };
  await checkPeriod(companyId, before.assetId, next, before.id);
  const after = await prisma.assetAssignment.update({ where: { id: before.id }, data: next });
  return { before, after };
}

const assignmentInclude = {
  asset: {
    select: { id: true, tag: true, name: true, category: true, serialNumber: true, brand: true, model: true, purchaseDate: true, notes: true, cost: true, status: true },
  },
  employee: { select: { id: true, name: true, employeeCode: true } },
} satisfies Prisma.AssetAssignmentInclude;

export async function assetHistory(companyId: string, assetId: string) {
  await loadAsset(companyId, assetId);
  return prisma.assetAssignment.findMany({ where: { companyId, assetId }, include: assignmentInclude, orderBy: { issuedOn: 'desc' } });
}

export async function employeeAssets(companyId: string, employeeId: string, opts: { includeReturned?: boolean } = {}) {
  return prisma.assetAssignment.findMany({
    where: { companyId, employeeId, ...(opts.includeReturned ? {} : { returnedOn: null }) },
    include: assignmentInclude,
    orderBy: { issuedOn: 'desc' },
  });
}

/** Assets still with the employee (open assignments) — used by exit clearance. */
export async function unreturnedAssets(companyId: string, employeeId: string) {
  const open = await prisma.assetAssignment.findMany({
    where: { companyId, employeeId, returnedOn: null },
    include: { asset: { select: { id: true, tag: true, name: true, category: true, cost: true } } },
  });
  return open.map((a) => ({ ...a.asset, assignmentId: a.id, issuedOn: a.issuedOn, department: clearanceDeptFor(a.asset.category) }));
}

export async function exportRows(companyId: string) {
  const assets = await listAssets(companyId, {});
  return assets.map((a) => [
    a.tag, a.name, a.category, a.brand, a.model, a.serialNumber, a.purchaseDate, a.cost, a.status,
    a.holder?.name ?? '', a.holder?.employeeCode ?? '', a.holder?.issuedOn ?? null, a.notes,
  ]);
}

export interface NewAssetItem {
  name: string;
  category: (typeof ASSET_CATEGORIES)[number];
  count: number;
  serialNumber?: string;
  /** Free text (multi-line) saved as the asset's notes — what it is, accessories, condition. */
  description?: string;
  /** When this item was handed over; falls back to the request's date, then now. */
  issuedOn?: Date | null;
}

/**
 * Creates `count` assets per item (auto tag AST-00001 …) and issues them all
 * to one employee in a single transaction — e.g. from the IT onboarding task.
 */
export async function issueNewAssets(
  companyId: string,
  employeeId: string,
  items: NewAssetItem[],
  opts: { issuedById: string | null; notes: string; issuedOn?: Date | null }
) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { id: true, name: true } });
  if (!employee) throw ApiError.badRequest('Employee not found in this company');
  // New assets have no earlier issues, so the only rule is: not in the future.
  const now = new Date();
  const issueDate = (item: NewAssetItem) => item.issuedOn ?? opts.issuedOn ?? now;
  const today = await companyToday(companyId);
  const future = items.find((item) => isoDate(issueDate(item)) > today);
  if (future) throw ApiError.badRequest(`The issue date of "${future.name}" cannot be in the future`);
  const created = await prisma.$transaction(async (tx) => {
    const out: { id: string; tag: string; name: string; category: string }[] = [];
    for (const item of items) {
      for (let i = 0; i < item.count; i++) {
        // Skip numbers already used by a hand-typed tag.
        let tag = await nextCode(companyId, 'ASSET', tx);
        while (await tx.asset.findFirst({ where: { companyId, tag }, select: { id: true } })) tag = await nextCode(companyId, 'ASSET', tx);
        const asset = await tx.asset.create({
          data: {
            companyId,
            tag,
            name: item.name.trim(),
            category: item.category,
            serialNumber: item.count === 1 ? (item.serialNumber ?? '').trim() : '',
            status: 'ASSIGNED',
            notes: (item.description ?? '').trim(),
          },
        });
        await tx.assetAssignment.create({
          data: { companyId, assetId: asset.id, employeeId: employee.id, issuedOn: issueDate(item), notes: opts.notes, issuedById: opts.issuedById },
        });
        out.push({ id: asset.id, tag: asset.tag, name: asset.name, category: asset.category });
      }
    }
    return out;
  });
  await notify(companyId, [employee.id], {
    event: 'asset.assigned',
    title: `${created.length} asset${created.length === 1 ? '' : 's'} issued to you`,
    body: created.map((a) => `${a.name} (${a.tag})`).join(', '),
    link: '/assets',
  });
  return created;
}
