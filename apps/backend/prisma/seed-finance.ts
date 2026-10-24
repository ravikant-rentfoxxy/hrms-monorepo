/* eslint-disable no-console -- seed script, console output is the UX */
/**
 * Statutory & identity demo data for the EXISTING Rentfoxxy company:
 *   - PF number / UAN / Aadhaar / father's name for every active employee
 *     (powers the app's "My financial information" screen)
 *   - uploads prisma/files/"Ravikant Gupta_Form 124_Report.pdf" into the
 *     bucket as Ravikant's personal document (folder: Tax Forms)
 *
 * Re-runnable; existing non-empty values and documents are left alone.
 * Run: npm run db:seed-finance
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { ensureBucket, objectKey, putObject } from '../src/lib/storage';

const prisma = new PrismaClient();

async function main() {
  const company = await prisma.company.findFirst({
    where: { OR: [{ name: { contains: 'rentfoxxy', mode: 'insensitive' } }, { code: { equals: 'code01', mode: 'insensitive' } }] },
  });
  if (!company) throw new Error('Rentfoxxy company not found — create it from the panel first.');

  const employees = await prisma.employee.findMany({
    where: { companyId: company.id, isActive: true },
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: 'asc' },
  });

  // Deterministic dummy statutory numbers per employee (stable across runs).
  let updated = 0;
  for (const [i, e] of employees.entries()) {
    const isRavikant = e.user.email.toLowerCase().startsWith('ravikant@');
    const uan = isRavikant ? '102259368684' : String(102259368700 + i);
    const aadhaar = isRavikant ? '4583 1178 5983' : `4583 11${String(20 + i).padStart(2, '0')} ${String(1000 + i * 37).slice(-4)}`;
    const data = {
      ...(e.pfNumber ? {} : { pfNumber: uan }),
      ...(e.uan ? {} : { uan }),
      ...(e.aadhaarNumber ? {} : { aadhaarNumber: aadhaar }),
      ...(e.fatherName ? {} : { fatherName: isRavikant ? 'Subash Gupta' : '—' }),
      ...(isRavikant && !e.pan ? { pan: 'CCFPG2657A' } : {}),
    };
    if (Object.keys(data).length > 0) {
      await prisma.employee.update({ where: { id: e.id }, data });
      updated++;
    }
  }
  console.log(`Statutory details filled for ${updated}/${employees.length} employees.`);

  // Ravikant's Form 124 PDF → bucket + personal document in "Tax Forms".
  const ravikant = employees.find((e) => e.user.email.toLowerCase().startsWith('ravikant@'));
  if (!ravikant) {
    console.log('ravikant@rentfoxxy.com has no employee profile — skipped the Form 124 upload.');
    return;
  }
  const docName = 'Form 124 — Income tax declaration (FY 2026-27)';
  const existing = await prisma.document.findFirst({
    where: { companyId: company.id, employeeId: ravikant.id, name: docName },
  });
  if (existing) {
    console.log('Form 124 already uploaded for Ravikant — skipped.');
    return;
  }
  const fileName = 'Ravikant Gupta_Form 124_Report.pdf';
  const buffer = readFileSync(join(__dirname, 'files', fileName));
  await ensureBucket();
  const key = objectKey(company.id, 'documents', fileName);
  await putObject(key, buffer, 'application/pdf');
  await prisma.document.create({
    data: {
      companyId: company.id,
      employeeId: ravikant.id,
      name: docName,
      category: 'Tax Forms',
      fileKey: key,
      mimeType: 'application/pdf',
      size: buffer.length,
      uploadedById: null,
    },
  });
  console.log(`Uploaded "${fileName}" (${buffer.length} bytes) for ${ravikant.name} → folder "Tax Forms".`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
