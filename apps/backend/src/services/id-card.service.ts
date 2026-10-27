/**
 * Employee ID cards. One design per company (layout, colours, photo shape,
 * which rows print and in what order, back-side content, validity, plus the
 * letterhead logo), filled with each employee's details and photo. The QR code
 * links to a public verify page through a random per-employee token; reissuing
 * a card replaces the token so a lost card stops verifying.
 */
import { randomBytes } from 'crypto';
import QRCode from 'qrcode';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { objectKey, presignedGetUrl, putObject, removeObject } from '../lib/storage';
import { env } from '../config/env';
import { ApiError } from '../utils/http';
import { isoDate } from '../utils/tz';

export const CARD_LAYOUTS = ['VERTICAL', 'HORIZONTAL'] as const;
export const PHOTO_SHAPES = ['ROUNDED', 'CIRCLE', 'SQUARE'] as const;
/** Optional rows on the front. Name, photo, designation and code always print. */
export const CARD_FIELDS = [
  'department',
  'bloodGroup',
  'emergencyContact',
  'validTill',
  'joiningDate',
  'phone',
  'email',
  'office',
  'workMode',
  'employmentType',
  'grade',
  'manager',
  'dateOfBirth',
] as const;
export type CardField = (typeof CARD_FIELDS)[number];
/** More rows than this don't fit on a CR80 card. */
export const MAX_CARD_FIELDS = 6;

/** Stored in Company.idCardStyle. Every key is optional; colours fall back to the brand colour. */
export interface IdCardStyle {
  headerColor?: string;
  /** Second colour for a gradient top band; empty = solid. */
  headerColor2?: string;
  bodyColor?: string;
  accentColor?: string;
  footerColor?: string;
  photoShape?: (typeof PHOTO_SHAPES)[number];
  /** Small caption under the logo, e.g. "EMPLOYEE ID CARD". */
  title?: string;
  showAddress?: boolean;
  showContact?: boolean;
  showSignatory?: boolean;
  /** 0 = no expiry; otherwise the card is valid this many months from issue. */
  validityMonths?: number;
}

export interface CardSettingsInput {
  brandColor?: string;
  idCardLayout?: (typeof CARD_LAYOUTS)[number];
  idCardFields?: CardField[];
  idCardBackNote?: string;
  idCardStyle?: IdCardStyle;
}

const PHOTO_TYPES = ['image/png', 'image/jpeg'];
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

const WORK_MODE_LABEL: Record<string, string> = { OFFICE: 'Office', REMOTE: 'Work from home', FIELD: 'Field' };

const companySelect = {
  name: true,
  address: true,
  phone: true,
  email: true,
  logoKey: true,
  signatoryName: true,
  signatoryTitle: true,
  brandColor: true,
  idCardLayout: true,
  idCardFields: true,
  idCardBackNote: true,
  idCardStyle: true,
} as const;

async function loadCompany(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: companySelect });
  if (!company) throw ApiError.notFound('Company not found');
  return company;
}

const signed = (key: string | null) => (key ? presignedGetUrl(key, undefined, 'inline') : Promise.resolve(null));

/** The stored style with every default filled in. */
function resolveStyle(brandColor: string, raw: Prisma.JsonValue): Required<IdCardStyle> {
  const s = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as IdCardStyle;
  return {
    headerColor: s.headerColor || brandColor,
    headerColor2: s.headerColor2 ?? '',
    bodyColor: s.bodyColor || '#FFFFFF',
    accentColor: s.accentColor || brandColor,
    footerColor: s.footerColor || brandColor,
    photoShape: s.photoShape ?? 'ROUNDED',
    title: s.title ?? '',
    showAddress: s.showAddress ?? true,
    showContact: s.showContact ?? true,
    showSignatory: s.showSignatory ?? false,
    validityMonths: s.validityMonths ?? 0,
  };
}

/** The company's card design as the designer edits it. */
export async function getSettings(companyId: string) {
  const c = await loadCompany(companyId);
  return {
    brandColor: c.brandColor,
    layout: c.idCardLayout,
    fields: c.idCardFields.filter((f): f is CardField => (CARD_FIELDS as readonly string[]).includes(f)).slice(0, MAX_CARD_FIELDS),
    backNote: c.idCardBackNote,
    style: resolveStyle(c.brandColor, c.idCardStyle),
    company: {
      name: c.name,
      address: c.address ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
      signatoryName: c.signatoryName,
      signatoryTitle: c.signatoryTitle || 'Authorized Signatory',
      logoUrl: await signed(c.logoKey),
    },
  };
}

export async function updateSettings(companyId: string, input: CardSettingsInput) {
  const before = await getSettings(companyId);
  const { idCardStyle, ...rest } = input;
  await prisma.company.update({
    where: { id: companyId },
    // The style is saved whole, as the designer sends it.
    data: { ...rest, ...(idCardStyle ? { idCardStyle: idCardStyle as Prisma.InputJsonObject } : {}) },
  });
  return { before, after: await getSettings(companyId) };
}

const newToken = () => randomBytes(18).toString('base64url');

/** First view issues the card (token + issue date); older cards get their issue date now. */
async function ensureIssued(emp: { id: string; cardToken: string | null; cardIssuedAt: Date | null }) {
  if (emp.cardToken && emp.cardIssuedAt) return { token: emp.cardToken, issuedAt: emp.cardIssuedAt };
  const data = { cardToken: emp.cardToken ?? newToken(), cardIssuedAt: emp.cardIssuedAt ?? new Date() };
  await prisma.employee.update({ where: { id: emp.id }, data });
  return { token: data.cardToken, issuedAt: data.cardIssuedAt };
}

/** Issue date + the company's validity; null when cards don't expire. */
function expiresOn(issuedAt: Date | null, validityMonths: number): Date | null {
  if (!issuedAt || validityMonths <= 0) return null;
  const d = new Date(issuedAt);
  d.setMonth(d.getMonth() + validityMonths);
  return d;
}

const verifyUrl = (token: string) => `${env.WEB_PUBLIC_URL.replace(/\/$/, '')}/verify/${token}`;

/** Everything the card renders: the company design plus this employee's details, photo and QR. */
export async function card(companyId: string, employeeId: string) {
  const emp = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    select: {
      id: true,
      name: true,
      employeeCode: true,
      designation: true,
      department: true,
      bloodGroup: true,
      phone: true,
      emergencyContact: true,
      joiningDate: true,
      dateOfBirth: true,
      employmentType: true,
      workMode: true,
      avatarColor: true,
      photoKey: true,
      cardToken: true,
      cardIssuedAt: true,
      officeId: true,
      isActive: true,
      user: { select: { email: true } },
      manager: { select: { name: true } },
      gradeRef: { select: { name: true } },
    },
  });
  if (!emp) throw ApiError.notFound('Employee not found');
  const [settings, office, issued] = await Promise.all([
    getSettings(companyId),
    emp.officeId ? prisma.office.findFirst({ where: { id: emp.officeId, companyId }, select: { name: true } }) : null,
    ensureIssued(emp),
  ]);
  const url = verifyUrl(issued.token);
  const expires = expiresOn(issued.issuedAt, settings.style.validityMonths);
  const values: Record<CardField, string> = {
    department: emp.department,
    bloodGroup: emp.bloodGroup,
    emergencyContact: emp.emergencyContact,
    validTill: expires ? isoDate(expires) : '',
    joiningDate: isoDate(emp.joiningDate),
    phone: emp.phone,
    email: emp.user.email,
    office: office?.name ?? '',
    workMode: WORK_MODE_LABEL[emp.workMode] ?? '',
    employmentType: emp.employmentType,
    grade: emp.gradeRef?.name ?? '',
    manager: emp.manager?.name ?? '',
    dateOfBirth: emp.dateOfBirth ? isoDate(emp.dateOfBirth) : '',
  };
  return {
    ...settings,
    employee: {
      id: emp.id,
      name: emp.name,
      employeeCode: emp.employeeCode,
      designation: emp.designation,
      avatarColor: emp.avatarColor,
      isActive: emp.isActive,
      photoUrl: await signed(emp.photoKey),
      issuedOn: isoDate(issued.issuedAt),
      expiresOn: expires ? isoDate(expires) : null,
      // Only the rows the company chose, in its order; empty values are dropped.
      fields: settings.fields.filter((f) => values[f]).map((f) => ({ key: f, value: values[f] })),
    },
    verifyUrl: url,
    qr: await QRCode.toDataURL(url, { margin: 0, width: 240, errorCorrectionLevel: 'M' }),
  };
}

async function employeeIn(companyId: string, employeeId: string) {
  const emp = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { id: true, photoKey: true } });
  if (!emp) throw ApiError.notFound('Employee not found');
  return emp;
}

export async function setPhoto(companyId: string, employeeId: string, file?: Express.Multer.File) {
  if (!file) throw ApiError.badRequest('Choose a photo');
  if (!PHOTO_TYPES.includes(file.mimetype)) throw ApiError.badRequest('The photo must be a PNG or JPG image');
  if (file.size > PHOTO_MAX_BYTES) throw ApiError.badRequest('The photo must be 2 MB or smaller');
  const emp = await employeeIn(companyId, employeeId);
  const key = objectKey(companyId, 'photos', file.originalname || 'photo.jpg');
  await putObject(key, file.buffer, file.mimetype);
  await prisma.employee.update({ where: { id: emp.id }, data: { photoKey: key } });
  if (emp.photoKey) await removeObject(emp.photoKey).catch(() => undefined);
  return card(companyId, employeeId);
}

export async function removePhoto(companyId: string, employeeId: string) {
  const emp = await employeeIn(companyId, employeeId);
  if (emp.photoKey) {
    await prisma.employee.update({ where: { id: emp.id }, data: { photoKey: null } });
    await removeObject(emp.photoKey).catch(() => undefined);
  }
  return card(companyId, employeeId);
}

/** New QR token and issue date — the old card's QR stops verifying (lost, stolen or expired card). */
export async function reissue(companyId: string, employeeId: string) {
  const emp = await employeeIn(companyId, employeeId);
  await prisma.employee.update({ where: { id: emp.id }, data: { cardToken: newToken(), cardIssuedAt: new Date() } });
  return card(companyId, employeeId);
}

/**
 * Public verify page behind the QR. Shows only what is printed on the card
 * anyway (name, photo, designation, company) and whether it is still valid —
 * never contact or personal details.
 */
export async function verify(token: string) {
  const emp = await prisma.employee.findUnique({
    where: { cardToken: token },
    select: {
      name: true,
      employeeCode: true,
      designation: true,
      avatarColor: true,
      photoKey: true,
      isActive: true,
      employmentStatus: true,
      cardIssuedAt: true,
      company: { select: { name: true, logoKey: true, brandColor: true, isActive: true, idCardStyle: true } },
    },
  });
  if (!emp) throw ApiError.notFound('No employee matches this QR code. The card may have been reissued, or it is not genuine.');
  const style = resolveStyle(emp.company.brandColor, emp.company.idCardStyle);
  const expires = expiresOn(emp.cardIssuedAt, style.validityMonths);
  const employed = emp.isActive && emp.company.isActive && emp.employmentStatus !== 'SEPARATED';
  const expired = !!expires && expires.getTime() < Date.now();
  return {
    valid: employed && !expired,
    reason: !employed ? 'SEPARATED' : expired ? 'EXPIRED' : null,
    expiresOn: expires ? isoDate(expires) : null,
    name: emp.name,
    employeeCode: emp.employeeCode,
    designation: emp.designation,
    avatarColor: emp.avatarColor,
    photoUrl: await signed(emp.photoKey),
    company: { name: emp.company.name, brandColor: style.headerColor, logoUrl: await signed(emp.company.logoKey) },
  };
}
