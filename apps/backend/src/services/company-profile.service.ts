/**
 * Company profile as company admins see it: address, contact and the
 * letterhead (logo + signatory) printed on offer and HR letters.
 * Name and code stay platform-managed (super admin).
 */
import { prisma } from '../lib/prisma';
import { getObjectBuffer, objectKey, presignedGetUrl, putObject, removeObject } from '../lib/storage';
import { logger } from '../lib/logger';
import { ApiError } from '../utils/http';

export interface CompanyProfileInput {
  address?: string;
  email?: string;
  phone?: string;
  signatoryName?: string;
  signatoryTitle?: string;
}

// pdfkit can only embed PNG and JPEG.
const LOGO_TYPES = ['image/png', 'image/jpeg'];
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

const profileSelect = {
  id: true,
  name: true,
  code: true,
  email: true,
  phone: true,
  address: true,
  logoKey: true,
  signatoryName: true,
  signatoryTitle: true,
} as const;

async function load(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: profileSelect });
  if (!company) throw ApiError.notFound('Company not found');
  return company;
}

export async function getProfile(companyId: string) {
  const { logoKey, ...rest } = await load(companyId);
  return { ...rest, logoUrl: logoKey ? await presignedGetUrl(logoKey, undefined, 'inline') : null };
}

export async function updateProfile(companyId: string, input: CompanyProfileInput) {
  const before = await load(companyId);
  await prisma.company.update({ where: { id: companyId }, data: input });
  return { before, after: await getProfile(companyId) };
}

export async function setLogo(companyId: string, file?: Express.Multer.File) {
  if (!file) throw ApiError.badRequest('Choose a logo image');
  if (!LOGO_TYPES.includes(file.mimetype)) throw ApiError.badRequest('The logo must be a PNG or JPG image');
  if (file.size > LOGO_MAX_BYTES) throw ApiError.badRequest('The logo must be 2 MB or smaller');
  const { logoKey: old } = await load(companyId);
  const key = objectKey(companyId, 'branding', file.originalname || 'logo.png');
  await putObject(key, file.buffer, file.mimetype);
  await prisma.company.update({ where: { id: companyId }, data: { logoKey: key } });
  if (old) await removeObject(old).catch(() => undefined);
  return getProfile(companyId);
}

export async function removeLogo(companyId: string) {
  const { logoKey } = await load(companyId);
  if (logoKey) {
    await prisma.company.update({ where: { id: companyId }, data: { logoKey: null } });
    await removeObject(logoKey).catch(() => undefined);
  }
  return getProfile(companyId);
}

export interface Letterhead {
  name: string;
  address: string;
  logo: Buffer | null;
  signatoryName: string;
  signatoryTitle: string;
}

/** What the letter PDFs print. A missing logo file never blocks a letter. */
export async function letterhead(companyId: string): Promise<Letterhead> {
  const c = await load(companyId);
  let logo: Buffer | null = null;
  if (c.logoKey) {
    logo = await getObjectBuffer(c.logoKey).catch((err: unknown) => {
      logger.warn({ err, companyId }, 'company logo could not be loaded for a letter');
      return null;
    });
  }
  return {
    name: c.name,
    address: c.address ?? '',
    logo,
    signatoryName: c.signatoryName,
    signatoryTitle: c.signatoryTitle || 'Authorized Signatory',
  };
}
