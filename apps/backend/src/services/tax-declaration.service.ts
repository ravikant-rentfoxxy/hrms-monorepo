/**
 * Income-tax investment declarations (financial year April–March, "2026-27").
 *
 *   DRAFT ──submit──▶ SUBMITTED ──verify──▶ VERIFIED
 *     ▲                   │  └──reject──▶ REJECTED ──edit──▶ DRAFT
 *     └───────────────────┘
 *
 * Employees edit their own declaration while it is DRAFT or REJECTED (that
 * is the proof-submission window) and attach proofs (stored in MinIO) at any
 * time before verification. HR verifies with a per-item `approved` amount.
 * The payroll engine's TDS uses SUBMITTED declarations' declared amounts for
 * Apr–Dec payrolls and only VERIFIED approved amounts from January (proof
 * season); DRAFT / REJECTED are ignored. It also reads Employee.taxRegime,
 * which choosing a regime here updates for the current FY.
 *
 * Section limits are reported as warnings: the declaration is accepted and
 * only the eligible (capped) amount is deductible. HRA with annual rent above
 * ₹1,00,000 must carry the landlord's PAN (a hard rule at submission).
 */
import type { Request } from 'express';
import type { Prisma, Role, TaxDeclaration, TaxProof } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { notify } from '../lib/notify';
import { objectKey, presignedGetUrl, putObject, removeObject, FILE_LINK_TTL_SECONDS } from '../lib/storage';
import { logger } from '../lib/logger';
import { ApiError } from '../utils/http';
import { revealEmployeeSecrets } from '../utils/fieldCrypto';
import * as approvalService from './approval.service';

// ---- Financial year helpers ----

/** Financial year containing `d`, e.g. 19 Oct 2026 → "2026-27", 10 Feb 2027 → "2026-27". */
export function currentFy(d: Date = new Date()): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/** The FY after `fy`. */
export function nextFy(fy: string): string {
  const y = Number(fy.slice(0, 4)) + 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

export function isValidFy(fy: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  return !!m && (Number(m[1]) + 1) % 100 === Number(m[2]);
}

/** First (1 Apr) and last (31 Mar) day of a FY, UTC dates. */
export function fyRange(fy: string): { from: Date; to: Date } {
  const y = Number(fy.slice(0, 4));
  return { from: new Date(Date.UTC(y, 3, 1)), to: new Date(Date.UTC(y + 1, 2, 31)) };
}

// ---- Items & limits ----

export const TAX_SECTIONS = ['80C', '80D', '80CCD1B', '24B', '80E', '80G', '80TTA', 'HRA', 'LTA'] as const;
export type TaxSection = (typeof TAX_SECTIONS)[number];

export const SECTION_LABELS: Record<TaxSection, string> = {
  '80C': '80C — PPF, ELSS, LIC, tuition fees, home-loan principal, NSC, 5-yr FD …',
  '80D': '80D — Medical insurance (self/family, parents)',
  '80CCD1B': '80CCD(1B) — NPS (additional)',
  '24B': '24(b) — Home-loan interest (self-occupied)',
  '80E': '80E — Education-loan interest',
  '80G': '80G — Donations',
  '80TTA': '80TTA — Savings-account interest',
  HRA: 'HRA — Rent paid',
  LTA: 'LTA — Leave travel',
};

/** Statutory annual caps (null = no cap at declaration level). 80D is per group, see below. */
export const SECTION_CAPS: Record<TaxSection, number | null> = {
  '80C': 150000,
  '80D': null,
  '80CCD1B': 50000,
  '24B': 200000,
  '80E': null,
  '80G': null,
  '80TTA': 10000,
  HRA: null,
  LTA: null,
};
const CAP_80D = 25000;
const CAP_80D_SENIOR = 50000;
const HRA_PAN_THRESHOLD = 100000;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export interface DeclarationItem {
  section: TaxSection;
  label: string;
  declared: number;
  /** Set by HR on verification. */
  approved?: number | null;
  // HRA
  rentPerMonth?: number;
  months?: number;
  landlordName?: string;
  landlordPan?: string;
  landlordAddress?: string;
  metro?: boolean;
  // 80D
  forParents?: boolean;
  seniorCitizen?: boolean;
}

export interface DeclarationInput {
  fy: string;
  regime: 'NEW' | 'OLD';
  items: DeclarationItem[];
  previousEmployerIncome: number;
  previousEmployerTds: number;
}

export interface Actor {
  role: Role;
  employeeId: string | null;
}

/** Verifies declarations company-wide: HR and Finance (plus Admin). */
const isHr = (role: Role) => role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR' || role === 'FINANCE';

/** Normalises employee-entered items (HRA declared = rent × months; approved stripped). */
function normaliseItems(items: DeclarationItem[]): DeclarationItem[] {
  return items.map((i) => {
    const base: DeclarationItem = { section: i.section, label: i.label.trim(), declared: Math.max(0, Math.round(i.declared)) };
    if (i.section === 'HRA') {
      const months = Math.min(12, Math.max(1, Math.round(i.months ?? 12)));
      const rent = Math.max(0, Math.round(i.rentPerMonth ?? 0));
      return {
        ...base,
        label: base.label || 'House rent',
        rentPerMonth: rent,
        months,
        declared: rent * months,
        landlordName: i.landlordName?.trim() ?? '',
        landlordPan: i.landlordPan?.trim().toUpperCase() ?? '',
        landlordAddress: i.landlordAddress?.trim() ?? '',
        metro: !!i.metro,
      };
    }
    if (i.section === '80D') return { ...base, forParents: !!i.forParents, seniorCitizen: !!i.seniorCitizen };
    return base;
  });
}

export interface SectionSummary {
  section: TaxSection;
  title: string;
  declared: number;
  approved: number | null;
  cap: number | null;
  /** Deductible part of the declared amount after caps. */
  eligible: number;
}

/** Per-section totals, caps and warnings (never throws). */
export function summarize(items: DeclarationItem[], regime: string) {
  const warnings: string[] = [];
  const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`;
  const sections: SectionSummary[] = [];
  for (const section of TAX_SECTIONS) {
    const list = items.filter((i) => i.section === section);
    if (list.length === 0) continue;
    const declared = list.reduce((s, i) => s + i.declared, 0);
    const approvedList = list.filter((i) => typeof i.approved === 'number');
    const approved = approvedList.length > 0 ? approvedList.reduce((s, i) => s + (i.approved ?? 0), 0) : null;
    let cap = SECTION_CAPS[section];
    let eligible = cap === null ? declared : Math.min(declared, cap);
    if (section === '80D') {
      const self = list.filter((i) => !i.forParents);
      const parents = list.filter((i) => i.forParents);
      const selfCap = self.some((i) => i.seniorCitizen) ? CAP_80D_SENIOR : CAP_80D;
      const parentCap = parents.some((i) => i.seniorCitizen) ? CAP_80D_SENIOR : CAP_80D;
      const selfSum = self.reduce((s, i) => s + i.declared, 0);
      const parentSum = parents.reduce((s, i) => s + i.declared, 0);
      if (selfSum > selfCap) warnings.push(`80D (self/family) ${fmt(selfSum)} exceeds the ${fmt(selfCap)} limit`);
      if (parentSum > parentCap) warnings.push(`80D (parents) ${fmt(parentSum)} exceeds the ${fmt(parentCap)} limit`);
      cap = (self.length > 0 ? selfCap : 0) + (parents.length > 0 ? parentCap : 0);
      eligible = Math.min(selfSum, selfCap) + Math.min(parentSum, parentCap);
    } else if (cap !== null && declared > cap) {
      warnings.push(`${section} declared ${fmt(declared)} exceeds the ${fmt(cap)} limit — only ${fmt(cap)} is deductible`);
    }
    if (section === 'HRA') {
      for (const i of list) {
        if (i.declared > HRA_PAN_THRESHOLD && !i.landlordPan) {
          warnings.push(`Annual rent ${fmt(i.declared)} is above ${fmt(HRA_PAN_THRESHOLD)} — the landlord's PAN is required`);
        } else if (i.landlordPan && !PAN_RE.test(i.landlordPan)) {
          warnings.push(`Landlord PAN "${i.landlordPan}" is not a valid PAN`);
        }
      }
    }
    sections.push({ section, title: SECTION_LABELS[section], declared, approved, cap, eligible });
  }
  if (regime === 'NEW' && items.length > 0) {
    warnings.push('Under the new regime these exemptions/deductions are not considered for TDS (standard deduction applies)');
  }
  return {
    sections,
    totalDeclared: sections.reduce((s, x) => s + x.declared, 0),
    totalEligible: sections.reduce((s, x) => s + x.eligible, 0),
    warnings,
  };
}

/** Errors that block submission (as opposed to warnings). */
function submissionErrors(items: DeclarationItem[]): string[] {
  const errors: string[] = [];
  for (const i of items) {
    if (i.section === 'HRA') {
      if ((i.rentPerMonth ?? 0) <= 0) errors.push('HRA: enter the monthly rent');
      if (!i.landlordName) errors.push('HRA: enter the landlord name');
      if (i.declared > HRA_PAN_THRESHOLD && !i.landlordPan) {
        errors.push(`HRA: landlord PAN is mandatory when annual rent exceeds ₹${HRA_PAN_THRESHOLD.toLocaleString('en-IN')}`);
      }
      if (i.landlordPan && !PAN_RE.test(i.landlordPan)) errors.push('HRA: landlord PAN is invalid');
    } else if (i.declared <= 0) {
      errors.push(`${i.section} "${i.label}": amount must be greater than zero`);
    }
  }
  return errors;
}

const employeeSelect = { id: true, name: true, employeeCode: true, department: true, designation: true, pan: true } as const;

/** PAN is encrypted at rest; only HR and the owner reach these responses, so they get it in plain text. */
const plainEmployee = <T extends { pan: string }>(e: T): T => revealEmployeeSecrets(e);

type DeclarationWithProofs = TaxDeclaration & { proofs: TaxProof[] };

function present(d: DeclarationWithProofs) {
  const items = d.items as unknown as DeclarationItem[];
  return {
    ...d,
    items,
    editable: d.status === 'DRAFT' || d.status === 'REJECTED',
    summary: summarize(items, d.regime),
    proofs: d.proofs.map(({ fileKey: _k, ...p }) => p),
  };
}

async function loadOwned(companyId: string, id: string, actor: Actor) {
  const d = await prisma.taxDeclaration.findFirst({
    where: { id, companyId },
    include: { proofs: { orderBy: { uploadedOn: 'asc' } }, employee: { select: employeeSelect } },
  });
  if (!d) throw ApiError.notFound('Tax declaration not found');
  if (!isHr(actor.role) && d.employeeId !== actor.employeeId) throw ApiError.forbidden();
  return d;
}

// ---- Employee: own declaration ----

export async function getMine(companyId: string, employeeId: string, fy: string) {
  if (!isValidFy(fy)) throw ApiError.badRequest('Financial year must look like 2026-27');
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { taxRegime: true } });
  if (!employee) throw ApiError.notFound('Employee not found');
  const d = await prisma.taxDeclaration.findUnique({
    where: { employeeId_fy: { employeeId, fy } },
    include: { proofs: { orderBy: { uploadedOn: 'asc' } } },
  });
  if (d && d.companyId === companyId) return present(d);
  // Not saved yet: an empty draft carrying the employee's current regime.
  return {
    id: null,
    companyId,
    employeeId,
    fy,
    regime: employee.taxRegime,
    items: [] as DeclarationItem[],
    previousEmployerIncome: 0,
    previousEmployerTds: 0,
    status: 'DRAFT',
    submittedAt: null,
    verifiedById: null,
    verifiedAt: null,
    remarks: null,
    updatedAt: null,
    editable: true,
    summary: summarize([], employee.taxRegime),
    proofs: [],
  };
}

/** Declarations can be made for the current FY and (from February) the next one. */
function assertDeclarableFy(fy: string) {
  if (!isValidFy(fy)) throw ApiError.badRequest('Financial year must look like 2026-27');
  const cur = currentFy();
  const allowNext = new Date().getMonth() <= 2 && new Date().getMonth() >= 1; // Feb–Mar
  if (fy !== cur && !(allowNext && fy === nextFy(cur))) {
    throw ApiError.badRequest(`Declarations are open for FY ${cur} only`);
  }
}

export async function saveMine(companyId: string, employeeId: string, input: DeclarationInput, req: Request) {
  assertDeclarableFy(input.fy);
  const existing = await prisma.taxDeclaration.findUnique({ where: { employeeId_fy: { employeeId, fy: input.fy } } });
  if (existing && existing.companyId !== companyId) throw ApiError.forbidden();
  if (existing && existing.status !== 'DRAFT' && existing.status !== 'REJECTED') {
    throw ApiError.badRequest(`Your declaration is ${existing.status.toLowerCase()} and can no longer be edited`);
  }
  const items = normaliseItems(input.items);
  const data = {
    regime: input.regime,
    items: items as unknown as Prisma.InputJsonValue,
    previousEmployerIncome: Math.max(0, input.previousEmployerIncome),
    previousEmployerTds: Math.max(0, input.previousEmployerTds),
    status: 'DRAFT',
  };
  const saved = await prisma.taxDeclaration.upsert({
    where: { employeeId_fy: { employeeId, fy: input.fy } },
    create: { companyId, employeeId, fy: input.fy, ...data },
    update: data,
    include: { proofs: { orderBy: { uploadedOn: 'asc' } } },
  });
  // The regime drives this year's TDS.
  if (input.fy === currentFy()) {
    const emp = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { taxRegime: true } });
    if (emp && emp.taxRegime !== input.regime) {
      await prisma.employee.update({ where: { id: employeeId }, data: { taxRegime: input.regime } });
      await audit(req, { entity: 'Employee', entityId: employeeId, action: 'UPDATE', before: { taxRegime: emp.taxRegime }, after: { taxRegime: input.regime } });
    }
  }
  await audit(req, {
    entity: 'TaxDeclaration',
    entityId: saved.id,
    action: existing ? 'UPDATE' : 'CREATE',
    before: existing ? { regime: existing.regime, items: existing.items } : undefined,
    after: { regime: saved.regime, items: saved.items },
  });
  return present(saved);
}

export async function submitMine(companyId: string, employeeId: string, fy: string, req: Request) {
  const d = await prisma.taxDeclaration.findUnique({
    where: { employeeId_fy: { employeeId, fy } },
    include: { proofs: true, employee: { select: { name: true } } },
  });
  if (!d || d.companyId !== companyId) throw ApiError.badRequest('Save your declaration before submitting');
  if (d.status !== 'DRAFT' && d.status !== 'REJECTED') throw ApiError.badRequest(`Declaration is already ${d.status.toLowerCase()}`);
  const errors = submissionErrors(d.items as unknown as DeclarationItem[]);
  if (errors.length > 0) throw ApiError.badRequest(errors[0] ?? 'Declaration is incomplete', { errors });
  const updated = await prisma.taxDeclaration.update({
    where: { id: d.id },
    data: { status: 'SUBMITTED', submittedAt: new Date(), remarks: null },
    include: { proofs: { orderBy: { uploadedOn: 'asc' } } },
  });
  await audit(req, { entity: 'TaxDeclaration', entityId: d.id, action: 'SUBMIT', before: { status: d.status }, after: { status: 'SUBMITTED' } });
  const hr = await approvalService.approverEmployeeIds(companyId, { approverRole: 'HR', approverEmployeeId: null });
  await notify(companyId, hr, {
    event: 'tax_declaration.submitted',
    title: 'Tax declaration submitted',
    body: `${d.employee.name} submitted the FY ${fy} investment declaration for verification.`,
    link: '/tax-declarations',
  });
  return present(updated);
}

// ---- Proofs ----

export async function addProof(
  companyId: string,
  declarationId: string,
  actor: Actor,
  input: { section: string; name?: string; file: { originalname: string; mimetype: string; buffer: Buffer; size: number } }
) {
  const d = await loadOwned(companyId, declarationId, actor);
  if (d.status === 'VERIFIED') throw ApiError.badRequest('Declaration is already verified');
  if (d.proofs.length >= 30) throw ApiError.badRequest('Too many proofs on this declaration (max 30)');
  const key = objectKey(companyId, 'tax-proofs', input.file.originalname);
  await putObject(key, input.file.buffer, input.file.mimetype || 'application/octet-stream');
  const proof = await prisma.taxProof.create({
    data: {
      companyId,
      declarationId: d.id,
      section: input.section,
      name: input.name?.trim() || input.file.originalname,
      fileKey: key,
      mimeType: input.file.mimetype || 'application/octet-stream',
      size: input.file.size,
    },
  });
  const { fileKey: _k, ...rest } = proof;
  return rest;
}

export async function deleteProof(companyId: string, declarationId: string, proofId: string, actor: Actor) {
  const d = await loadOwned(companyId, declarationId, actor);
  const proof = d.proofs.find((p) => p.id === proofId);
  if (!proof) throw ApiError.notFound('Proof not found');
  if (d.status === 'VERIFIED') throw ApiError.badRequest('Declaration is already verified');
  if (proof.status === 'ACCEPTED' && !isHr(actor.role)) throw ApiError.badRequest('An accepted proof cannot be removed');
  await prisma.taxProof.delete({ where: { id: proof.id } });
  await removeObject(proof.fileKey).catch((err: unknown) => logger.warn({ err, key: proof.fileKey }, 'tax proof object not removed'));
}

export async function proofUrl(companyId: string, declarationId: string, proofId: string, actor: Actor, inline: boolean) {
  const d = await loadOwned(companyId, declarationId, actor);
  const proof = d.proofs.find((p) => p.id === proofId);
  if (!proof) throw ApiError.notFound('Proof not found');
  return {
    url: await presignedGetUrl(proof.fileKey, proof.name, inline ? 'inline' : 'attachment'),
    mimeType: proof.mimeType,
    expiresInSeconds: FILE_LINK_TTL_SECONDS,
  };
}

// ---- HR verification ----

export async function list(companyId: string, filter: { fy: string; status?: string; employeeId?: string }) {
  const rows = await prisma.taxDeclaration.findMany({
    where: {
      companyId,
      fy: filter.fy,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
    },
    include: { employee: { select: employeeSelect }, proofs: { select: { id: true, status: true } } },
    orderBy: [{ submittedAt: 'asc' }, { updatedAt: 'desc' }],
  });
  const counts = await prisma.taxDeclaration.groupBy({ by: ['status'], where: { companyId, fy: filter.fy }, _count: true });
  const activeEmployees = await prisma.employee.count({ where: { companyId, isActive: true } });
  return {
    fy: filter.fy,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    notStarted: Math.max(0, activeEmployees - counts.reduce((s, c) => s + c._count, 0)),
    items: rows.map((d) => {
      const items = d.items as unknown as DeclarationItem[];
      const s = summarize(items, d.regime);
      return {
        id: d.id,
        fy: d.fy,
        regime: d.regime,
        status: d.status,
        submittedAt: d.submittedAt,
        verifiedAt: d.verifiedAt,
        employee: plainEmployee(d.employee),
        totalDeclared: s.totalDeclared,
        totalEligible: s.totalEligible,
        totalApproved: items.reduce((sum, i) => sum + (i.approved ?? 0), 0),
        proofs: d.proofs.length,
        proofsPending: d.proofs.filter((p) => p.status === 'PENDING').length,
      };
    }),
  };
}

export async function getOne(companyId: string, id: string, actor: Actor) {
  const d = await loadOwned(companyId, id, actor);
  return { ...present(d), employee: plainEmployee(d.employee) };
}

export interface VerifyInput {
  items: { index: number; approved: number }[];
  proofs: { id: string; status: 'ACCEPTED' | 'REJECTED' | 'PENDING' }[];
  remarks?: string;
}

/** Records approved amounts per item (default: the eligible declared amount) and proof outcomes. */
export async function verify(companyId: string, id: string, input: VerifyInput, actor: Actor, req: Request) {
  const d = await loadOwned(companyId, id, actor);
  if (actor.employeeId && d.employeeId === actor.employeeId) throw ApiError.forbidden('You cannot verify your own declaration');
  if (d.status !== 'SUBMITTED' && d.status !== 'VERIFIED') {
    throw ApiError.badRequest(d.status === 'DRAFT' ? 'Declaration has not been submitted' : `Declaration is ${d.status.toLowerCase()}`);
  }
  const items = d.items as unknown as DeclarationItem[];
  for (const it of input.items) {
    const item = items[it.index];
    if (!item) throw ApiError.badRequest(`Item #${it.index + 1} does not exist`);
    if (it.approved > item.declared) {
      throw ApiError.badRequest(`${item.section} "${item.label}": approved amount cannot exceed the declared ₹${item.declared}`);
    }
  }
  const nextItems = items.map((item, index) => {
    const given = input.items.find((x) => x.index === index);
    return { ...item, approved: Math.max(0, Math.round(given ? given.approved : (item.approved ?? item.declared))) };
  });
  for (const p of input.proofs) {
    if (!d.proofs.some((x) => x.id === p.id)) throw ApiError.badRequest('Unknown proof in request');
  }
  const updated = await prisma.$transaction(async (tx) => {
    for (const p of input.proofs) await tx.taxProof.update({ where: { id: p.id }, data: { status: p.status } });
    return tx.taxDeclaration.update({
      where: { id: d.id },
      data: {
        items: nextItems as unknown as Prisma.InputJsonValue,
        status: 'VERIFIED',
        verifiedById: actor.employeeId,
        verifiedAt: new Date(),
        remarks: input.remarks ?? null,
      },
      include: { proofs: { orderBy: { uploadedOn: 'asc' } }, employee: { select: employeeSelect } },
    });
  });
  await audit(req, {
    entity: 'TaxDeclaration',
    entityId: d.id,
    action: 'VERIFY',
    before: { status: d.status, items: d.items },
    after: { status: 'VERIFIED', items: nextItems, proofs: input.proofs },
  });
  const approvedTotal = nextItems.reduce((s, i) => s + i.approved, 0);
  await notify(companyId, [d.employeeId], {
    event: 'tax_declaration.verified',
    title: 'Tax declaration verified',
    body: `Your FY ${d.fy} declaration was verified: ₹${approvedTotal.toLocaleString('en-IN')} approved.` +
      (input.remarks ? ` Remarks: ${input.remarks}` : ''),
    link: '/tax-declarations',
  });
  return { ...present(updated), employee: plainEmployee(updated.employee) };
}

export async function reject(companyId: string, id: string, remarks: string, actor: Actor, req: Request) {
  const d = await loadOwned(companyId, id, actor);
  if (actor.employeeId && d.employeeId === actor.employeeId) throw ApiError.forbidden('You cannot reject your own declaration');
  if (d.status !== 'SUBMITTED' && d.status !== 'VERIFIED') throw ApiError.badRequest('Only submitted or verified declarations can be sent back');
  const updated = await prisma.taxDeclaration.update({
    where: { id: d.id },
    data: { status: 'REJECTED', remarks, verifiedById: actor.employeeId, verifiedAt: new Date() },
    include: { proofs: { orderBy: { uploadedOn: 'asc' } }, employee: { select: employeeSelect } },
  });
  await audit(req, { entity: 'TaxDeclaration', entityId: d.id, action: 'REJECT', before: { status: d.status }, after: { status: 'REJECTED', remarks } });
  await notify(companyId, [d.employeeId], {
    event: 'tax_declaration.rejected',
    title: 'Tax declaration sent back',
    body: `Your FY ${d.fy} declaration needs changes: ${remarks}`,
    link: '/tax-declarations',
  });
  return { ...present(updated), employee: plainEmployee(updated.employee) };
}
