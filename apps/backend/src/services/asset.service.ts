/**
 * Company assets (laptops, phones, ID cards, ...): inventory, issue / return
 * history per asset and per employee. Assets still with an exiting employee
 * feed the IT / Admin exit clearance.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';

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
  expectedReturn?: Date | null;
  conditionOut?: string;
  notes?: string;
}

export interface ReturnInput {
  conditionIn: string;
  status: 'AVAILABLE' | 'IN_REPAIR';
  notes?: string;
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

/** Only never-issued assets can be deleted; issued ones keep their history — retire them instead. */
export async function deleteAsset(companyId: string, id: string) {
  const asset = await loadAsset(companyId, id);
  const issued = await prisma.assetAssignment.count({ where: { companyId, assetId: id } });
  if (issued > 0) throw ApiError.badRequest('This asset has an issue history — set its status to RETIRED instead of deleting it');
  await prisma.asset.delete({ where: { id: asset.id } });
  return asset;
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

  // Guarded status flip so two concurrent assigns cannot both succeed.
  const assignment = await prisma.$transaction(async (tx) => {
    const flip = await tx.asset.updateMany({ where: { id: asset.id, status: 'AVAILABLE' }, data: { status: 'ASSIGNED' } });
    if (flip.count === 0) throw ApiError.conflict('Asset was just assigned by someone else');
    return tx.assetAssignment.create({
      data: {
        companyId,
        assetId: asset.id,
        employeeId: employee.id,
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
  const [assignment] = await prisma.$transaction([
    prisma.assetAssignment.update({
      where: { id: open.id },
      data: {
        returnedOn: new Date(),
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

const assignmentInclude = {
  asset: { select: { id: true, tag: true, name: true, category: true, serialNumber: true, cost: true, status: true } },
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
