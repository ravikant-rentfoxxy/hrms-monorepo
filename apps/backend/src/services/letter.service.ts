/**
 * HR letters: templates with {{placeholders}} → rendered PDF stored in MinIO,
 * filed as a Document of the employee ("Employee Letters" folder) and logged
 * as a GeneratedLetter.
 *
 *   await generateLetter(companyId, { type: 'RELIEVING', employeeId, createdById });
 *   await generateLetter(companyId, { templateId, vars: { name: candidate.name, ... } });   // candidate letters
 */
import PDFDocument from 'pdfkit';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { objectKey, presignedGetUrl, putObject, removeObject, FILE_LINK_TTL_SECONDS } from '../lib/storage';
import { ApiError } from '../utils/http';
import { letterhead, type Letterhead } from './company-profile.service';
import { inr, isCompanyAdmin, longDate, monthlyGross } from '../utils/lifecycle';
import type { Role } from '@prisma/client';

export const LETTER_TYPES = [
  'OFFER', 'APPOINTMENT', 'CONFIRMATION', 'INCREMENT', 'EXPERIENCE', 'RELIEVING', 'SALARY_CERTIFICATE', 'WARNING', 'CUSTOM',
  'RESIGNATION_ACKNOWLEDGEMENT',
] as const;
export type LetterType = (typeof LETTER_TYPES)[number];

/** Letters an employee may issue to themselves from the app. */
export const SELF_SERVICE_TYPES: LetterType[] = ['SALARY_CERTIFICATE', 'EXPERIENCE'];

/** Document folder letters are filed under (an existing "My documents" folder). */
export const LETTERS_FOLDER = 'Employee Letters';

export const PLACEHOLDERS: { key: string; description: string }[] = [
  { key: 'name', description: 'Employee / candidate full name' },
  { key: 'employeeCode', description: 'Employee ID' },
  { key: 'designation', description: 'Designation' },
  { key: 'department', description: 'Department' },
  { key: 'joiningDate', description: 'Date of joining' },
  { key: 'leavingDate', description: 'Leaving date (exit)' },
  { key: 'lastWorkingDay', description: 'Approved last working day' },
  { key: 'ctc', description: 'Annual CTC, e.g. Rs. 12,00,000' },
  { key: 'monthlyGross', description: 'Monthly gross salary' },
  { key: 'companyName', description: 'Company name' },
  { key: 'companyAddress', description: 'Company address' },
  { key: 'today', description: "Today's date" },
  { key: 'managerName', description: 'Reporting manager' },
  { key: 'address', description: "Employee's address" },
  { key: 'probationEndDate', description: 'Probation end date' },
  { key: 'confirmationDate', description: 'Confirmation date' },
  { key: 'resignationDate', description: 'Date the resignation was submitted' },
  { key: 'exitCode', description: 'Exit case ID, e.g. EXIT-2026-0007' },
  { key: 'noticePeriodDays', description: 'Notice period (days)' },
];

interface DefaultTemplate {
  type: LetterType;
  name: string;
  subject: string;
  body: string;
}

/** Professional Indian-HR wording; companies edit these under Letters → Templates. */
export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    type: 'OFFER',
    name: 'Offer letter',
    subject: 'Offer of Employment — {{designation}}',
    body: `Dear {{name}},

With reference to your application and the subsequent discussions you had with us, we are pleased to offer you the position of {{designation}} in the {{department}} department of {{companyName}}.

Your annual Cost to Company (CTC) will be {{ctc}}. The detailed salary structure will be shared with your appointment letter. This is a {{employmentType}} position based at {{workLocation}}, and your expected date of joining is {{joiningDate}}.

You will be on probation for {{probationMonths}} months from your date of joining. After confirmation, either party may terminate employment by giving {{noticePeriodDays}} days' written notice.

{{terms}}

This offer is subject to satisfactory verification of your educational and professional credentials and background, and to your submitting the documents requested by HR on or before the date of joining. This offer ({{offerCode}}) is valid until {{offerValidUntil}}.

Please accept this offer through the candidate portal link shared with you, or sign and return a copy of this letter. We look forward to welcoming you to {{companyName}}.`,
  },
  {
    type: 'APPOINTMENT',
    name: 'Appointment letter',
    subject: 'Letter of Appointment',
    body: `Dear {{name}},

We are pleased to appoint you as {{designation}} in the {{department}} department of {{companyName}} with effect from {{joiningDate}}, on the following terms and conditions:

1. Compensation: Your annual Cost to Company (CTC) will be {{ctc}} (monthly gross {{monthlyGross}}), subject to statutory deductions as applicable.
2. Probation: You will be on probation until {{probationEndDate}}. On successful completion, your services will be confirmed in writing.
3. Reporting: You will report to {{managerName}} or any other person designated by the management.
4. Notice period: Either party may terminate this employment by giving the notice period prescribed in the company policy, or salary in lieu thereof.
5. Confidentiality: You shall maintain strict confidentiality of all business information during and after your employment.
6. Policies: You will be governed by the rules, regulations and policies of the company as amended from time to time.

Please sign the duplicate copy of this letter in token of your acceptance of the above terms. We wish you a long and rewarding career with us.`,
  },
  {
    type: 'CONFIRMATION',
    name: 'Confirmation letter',
    subject: 'Confirmation of Employment',
    body: `Dear {{name}},

We are pleased to inform you that, based on a review of your performance during the probation period, your services as {{designation}} in the {{department}} department are confirmed with effect from {{confirmationDate}}.

All other terms and conditions of your appointment remain unchanged.

We appreciate your contribution and look forward to your continued commitment to {{companyName}}.`,
  },
  {
    type: 'INCREMENT',
    name: 'Increment letter',
    subject: 'Revision of Compensation',
    body: `Dear {{name}},

In recognition of your performance and contribution, the management is pleased to revise your compensation. With effect from {{today}}, your revised annual Cost to Company (CTC) will be {{ctc}} (monthly gross {{monthlyGross}}).

All other terms and conditions of your employment remain unchanged. The revised salary structure is available in your profile.

We thank you for your efforts and look forward to your continued contribution to {{companyName}}.`,
  },
  {
    type: 'EXPERIENCE',
    name: 'Experience certificate',
    subject: 'Experience Certificate',
    body: `TO WHOMSOEVER IT MAY CONCERN

This is to certify that {{name}} (Employee ID {{employeeCode}}) was employed with {{companyName}} from {{joiningDate}} to {{lastWorkingDay}}. At the time of leaving, {{name}} held the position of {{designation}} in the {{department}} department.

During this tenure we found {{name}} to be sincere, hardworking and professional. {{name}} bears a good moral character.

We wish {{name}} every success in all future endeavours.`,
  },
  {
    type: 'RELIEVING',
    name: 'Relieving letter',
    subject: 'Relieving Letter',
    body: `Dear {{name}},

This is with reference to your resignation from the services of the company. We hereby confirm that you have been relieved from your duties as {{designation}} in the {{department}} department of {{companyName}} at the close of business hours on {{lastWorkingDay}}.

Your full and final settlement will be processed as per company policy. You are reminded that the confidentiality obligations under your terms of employment continue to apply after your separation.

We thank you for your contributions during your tenure with us since {{joiningDate}} and wish you success in your future endeavours.`,
  },
  {
    type: 'RESIGNATION_ACKNOWLEDGEMENT',
    name: 'Resignation acknowledgement',
    subject: 'Acknowledgement of Resignation',
    body: `Dear {{name}},

This is to acknowledge receipt of your resignation dated {{resignationDate}} from the position of {{designation}} in the {{department}} department of {{companyName}} (reference {{exitCode}}).

Your resignation has been accepted by the management. As per the terms of your employment, your notice period is {{noticePeriodDays}} days, and your last working day with the company will be {{lastWorkingDay}}.

During the notice period, you are requested to complete the handover of your responsibilities to the colleagues identified by your reporting manager, return all company property in your possession, and complete the exit clearance formalities with the respective departments.

Your full and final settlement will be processed after the completion of the exit clearance, as per company policy and applicable law. Your relieving letter and experience certificate will be issued upon completion of the separation formalities.

We thank you for your contributions to {{companyName}} and wish you the very best in your future endeavours.`,
  },
  {
    type: 'SALARY_CERTIFICATE',
    name: 'Salary certificate',
    subject: 'Salary Certificate',
    body: `TO WHOMSOEVER IT MAY CONCERN

This is to certify that {{name}} (Employee ID {{employeeCode}}) has been working with {{companyName}} since {{joiningDate}} and currently holds the position of {{designation}} in the {{department}} department.

The current monthly gross salary of {{name}} is {{monthlyGross}} and the annual Cost to Company (CTC) is {{ctc}}.

This certificate is issued at the request of the employee for whatever purpose it may serve, without any liability on the part of the company.`,
  },
];

export interface TemplateInput {
  type: LetterType;
  name: string;
  subject: string;
  body: string;
  isActive: boolean;
}

// ---- Templates ----

/** Seeds the default set the first time a company opens letters. */
export async function ensureDefaultTemplates(companyId: string): Promise<void> {
  const count = await prisma.letterTemplate.count({ where: { companyId } });
  if (count > 0) return;
  await prisma.letterTemplate.createMany({
    data: DEFAULT_TEMPLATES.map((t) => ({ companyId, type: t.type, name: t.name, subject: t.subject, body: t.body })),
  });
}

export async function listTemplates(companyId: string) {
  await ensureDefaultTemplates(companyId);
  return prisma.letterTemplate.findMany({ where: { companyId }, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
}

export async function createTemplate(companyId: string, input: TemplateInput) {
  return prisma.letterTemplate.create({ data: { ...input, companyId } });
}

export async function updateTemplate(companyId: string, id: string, input: Partial<TemplateInput>) {
  const result = await prisma.letterTemplate.updateMany({ where: { id, companyId }, data: input });
  if (result.count === 0) throw ApiError.notFound('Letter template not found');
  return prisma.letterTemplate.findUniqueOrThrow({ where: { id } });
}

export async function deleteTemplate(companyId: string, id: string): Promise<void> {
  const result = await prisma.letterTemplate.deleteMany({ where: { id, companyId } });
  if (result.count === 0) throw ApiError.notFound('Letter template not found');
}

/** The active template of a type (most recently edited wins), or null. */
export async function templateForType(companyId: string, type: string) {
  await ensureDefaultTemplates(companyId);
  return prisma.letterTemplate.findFirst({ where: { companyId, type, isActive: true }, orderBy: { updatedAt: 'desc' } });
}

// ---- Rendering ----

export type LetterVars = Record<string, string>;

/** Placeholder values for an employee (company-only values when no employee). */
export async function buildVars(companyId: string, employeeId?: string | null): Promise<LetterVars> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true, address: true } });
  const vars: LetterVars = {
    companyName: company?.name ?? '',
    companyAddress: company?.address ?? '',
    today: longDate(new Date()),
  };
  if (!employeeId) return vars;

  const e = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    include: { manager: { select: { name: true } } },
  });
  if (!e) throw ApiError.notFound('Employee not found');
  const exit = await prisma.resignation.findFirst({
    where: { companyId, employeeId, status: { in: ['APPROVED', 'COMPLETED'] } },
    orderBy: { appliedOn: 'desc' },
    select: { approvedLastDay: true, requestedLastDay: true, appliedOn: true, code: true, noticePeriodDays: true },
  });
  const gross = monthlyGross(e);
  const lastDay = exit?.approvedLastDay ?? e.leavingDate ?? exit?.requestedLastDay ?? null;
  return {
    ...vars,
    name: e.name,
    employeeCode: e.employeeCode,
    designation: e.designation,
    department: e.department,
    joiningDate: longDate(e.joiningDate),
    leavingDate: longDate(e.leavingDate ?? lastDay),
    lastWorkingDay: longDate(lastDay),
    ctc: inr(Math.round((gross + e.salaryPfEmployer) * 12)),
    monthlyGross: inr(Math.round(gross)),
    managerName: e.manager?.name ?? 'your reporting manager',
    address: e.address,
    probationEndDate: longDate(e.probationEndDate),
    confirmationDate: longDate(e.confirmedOn ?? new Date()),
    resignationDate: longDate(exit?.appliedOn),
    exitCode: exit?.code ?? '',
    noticePeriodDays: String(exit?.noticePeriodDays ?? e.noticePeriodDays),
  };
}

/** Replaces {{key}} tokens; reports keys with no value so the editor can warn. */
export function render(text: string, vars: LetterVars): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key];
    if (v === undefined || v === '') {
      missing.add(key);
      return '';
    }
    return v;
  });
  return { text: out, missing: [...missing] };
}

/** Sample values used by the editor preview when no employee is picked. */
const SAMPLE_VARS: LetterVars = {
  name: 'Priya Sharma',
  employeeCode: 'EMP0042',
  designation: 'Senior Software Engineer',
  department: 'Engineering',
  joiningDate: '1 April 2024',
  leavingDate: '31 October 2026',
  lastWorkingDay: '31 October 2026',
  ctc: 'Rs. 18,00,000',
  monthlyGross: 'Rs. 1,38,000',
  managerName: 'Rahul Verma',
  address: '12, MG Road, Bengaluru 560001',
  probationEndDate: '30 September 2024',
  confirmationDate: '1 October 2024',
  resignationDate: '1 October 2026',
  exitCode: 'EXIT-2026-0007',
  noticePeriodDays: '30',
};

export async function preview(
  companyId: string,
  input: { templateId?: string; subject?: string; body?: string; employeeId?: string; vars?: LetterVars }
) {
  let subject = input.subject ?? '';
  let body = input.body ?? '';
  if (input.templateId) {
    const t = await prisma.letterTemplate.findFirst({ where: { id: input.templateId, companyId } });
    if (!t) throw ApiError.notFound('Letter template not found');
    subject = input.subject ?? t.subject;
    body = input.body ?? t.body;
  }
  const base = await buildVars(companyId, input.employeeId);
  const vars = { ...(input.employeeId ? {} : SAMPLE_VARS), ...base, ...(input.vars ?? {}) };
  const s = render(subject, vars);
  const b = render(body, vars);
  return { subject: s.text, body: b.text, missing: [...new Set([...s.missing, ...b.missing])], sample: !input.employeeId };
}

// ---- PDF ----

function buildLetterPdf(head: Letterhead, input: {
  date: string;
  reference: string;
  subject: string;
  body: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 64, right: 64 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 64;
    const right = doc.page.width - 64;
    const width = right - left;

    // Letterhead: the company logo when uploaded, else the name
    let logoDrawn = false;
    if (head.logo) {
      try {
        doc.image(head.logo, left, 48, { fit: [190, 52], align: 'center' });
        doc.y = 48 + 56;
        logoDrawn = true;
      } catch {
        logoDrawn = false; // unreadable image — fall back to the name
      }
    }
    if (!logoDrawn) doc.font('Helvetica-Bold').fontSize(18).fillColor('#1E1B4B').text(head.name.toUpperCase(), left, 56, { width, align: 'center' });
    if (head.address) {
      doc.font('Helvetica').fontSize(9).fillColor('#64748B').text(head.address, left, doc.y, { width, align: 'center' });
    }
    doc.moveDown(0.6);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(1.2).strokeColor('#4338CA').stroke();
    doc.moveDown(1.2);

    // Reference + date
    const y = doc.y;
    doc.font('Helvetica').fontSize(9.5).fillColor('#475569').text(`Ref: ${input.reference}`, left, y);
    doc.text(`Date: ${input.date}`, left, y, { width, align: 'right' });
    doc.moveDown(1.6);

    // Subject
    if (input.subject) {
      doc.font('Helvetica-Bold').fontSize(11.5).fillColor('#0F172A').text(`Subject: ${input.subject}`, left, doc.y, { width });
      doc.moveDown(1);
    }

    // Body — blank lines separate paragraphs; single newlines are kept.
    const paragraphs = input.body.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    for (const p of paragraphs) {
      const heading = /^[A-Z0-9 ,.'&-]{8,}$/.test(p); // e.g. "TO WHOMSOEVER IT MAY CONCERN"
      doc.font(heading ? 'Helvetica-Bold' : 'Helvetica').fontSize(10.5).fillColor('#1E293B')
        .text(p, left, doc.y, { width, align: heading ? 'center' : 'justify', lineGap: 3 });
      doc.moveDown(0.8);
    }

    // Signature block
    if (doc.y > doc.page.height - 170) doc.addPage();
    doc.moveDown(1);
    doc.font('Helvetica').fontSize(10.5).fillColor('#1E293B').text('Yours sincerely,', left, doc.y);
    doc.font('Helvetica-Bold').text(`For ${head.name}`);
    doc.moveDown(2.6);
    if (head.signatoryName) doc.font('Helvetica-Bold').fontSize(10.5).text(head.signatoryName);
    doc.font('Helvetica-Bold').fontSize(10.5).text(head.signatoryTitle);
    if (!head.signatoryName) doc.font('Helvetica').fontSize(9.5).fillColor('#475569').text('Human Resources');

    // Footer (inside the bottom margin — lift the margin so pdfkit doesn't start a new page)
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor('#94A3B8')
      .text('This is a system-generated letter.', left, doc.page.height - 48, { width, align: 'center', lineBreak: false });
    doc.end();
  });
}

// ---- Generation ----

export interface GenerateLetterInput {
  /** Pick by template id, or the active template of this type. */
  templateId?: string;
  type?: string;
  /** Employee the letter is for (filed in their documents). Optional for candidate letters. */
  employeeId?: string | null;
  candidateId?: string | null;
  createdById?: string | null;
  /** Placeholder overrides / extras (e.g. candidate name, offered CTC). */
  vars?: LetterVars;
  /** Return the existing letter instead of issuing a second one of this type (for automated hooks). */
  skipIfExists?: boolean;
  /** Custom layout (e.g. the offer letter with its salary table) instead of the template body. */
  render?: (head: Letterhead, meta: { reference: string; date: string }) => Promise<Buffer>;
}

/**
 * Renders a template to PDF, stores it and records a GeneratedLetter (+ a
 * Document in the employee's "Employee Letters" folder when for an employee).
 * Throws 404 when no template exists — see `tryGenerateLetter` for hooks.
 */
export async function generateLetter(companyId: string, input: GenerateLetterInput) {
  const template = input.templateId
    ? await prisma.letterTemplate.findFirst({ where: { id: input.templateId, companyId } })
    : input.type
      ? await templateForType(companyId, input.type)
      : null;
  if (!template) {
    throw ApiError.notFound(input.type ? `No active ${input.type.replace(/_/g, ' ').toLowerCase()} template` : 'Letter template not found');
  }
  if (!input.employeeId && !input.vars) throw ApiError.badRequest('employeeId (or vars for a candidate) is required');

  if (input.skipIfExists && input.employeeId) {
    const existing = await prisma.generatedLetter.findFirst({ where: { companyId, employeeId: input.employeeId, type: template.type } });
    if (existing) return existing;
  }

  const vars = { ...(await buildVars(companyId, input.employeeId)), ...(input.vars ?? {}) };
  const subject = render(template.subject, vars).text;
  const body = render(template.body, vars).text;
  const who = input.employeeId ? (vars.employeeCode ?? '') : (input.candidateId?.slice(0, 8) ?? 'CAND');
  const reference = `HR/${template.type}/${who}/${new Date().getFullYear()}`;

  const head = await letterhead(companyId);
  const date = vars.today ?? longDate(new Date());
  const pdf = input.render ? await input.render(head, { reference, date }) : await buildLetterPdf(head, { date, reference, subject, body });
  const title = `${template.name}${vars.name ? ` — ${vars.name}` : ''}`;
  const fileName = `${template.type}_${(vars.employeeCode || vars.name || 'letter').replace(/\s+/g, '_')}.pdf`;
  const key = objectKey(companyId, 'letters', fileName);
  await putObject(key, pdf, 'application/pdf');

  const document = input.employeeId
    ? await prisma.document.create({
        data: {
          companyId,
          employeeId: input.employeeId,
          name: `${template.name}.pdf`,
          category: LETTERS_FOLDER,
          fileKey: key,
          mimeType: 'application/pdf',
          size: pdf.length,
          uploadedById: input.createdById ?? null,
        },
      })
    : null;

  const letter = await prisma.generatedLetter.create({
    data: {
      companyId,
      employeeId: input.employeeId ?? null,
      candidateId: input.candidateId ?? null,
      templateId: template.id,
      type: template.type,
      title,
      documentId: document?.id ?? null,
      fileKey: key,
      createdById: input.createdById ?? null,
    },
  });
  if (input.employeeId) {
    await notify(companyId, [input.employeeId], {
      event: 'letter.issued',
      title: `${template.name} issued`,
      body: 'The letter is available under My letters / Documents.',
      link: '/letters',
      email: true,
    });
  }
  return letter;
}

/** For automated hooks: generates when a template of `type` exists, never throws. */
export async function tryGenerateLetter(companyId: string, type: LetterType, employeeId: string, createdById?: string | null) {
  try {
    if (!(await templateForType(companyId, type))) return null;
    return await generateLetter(companyId, { type, employeeId, createdById, skipIfExists: type !== 'INCREMENT' });
  } catch {
    return null;
  }
}

// ---- Issued letters ----

export async function listLetters(
  companyId: string,
  viewer: { role: Role; employeeId: string | null },
  filter: { employeeId?: string; type?: string }
) {
  const canViewAll = isCompanyAdmin(viewer.role);
  const employeeId = canViewAll ? filter.employeeId : (viewer.employeeId ?? '');
  return prisma.generatedLetter.findMany({
    where: { companyId, ...(employeeId ? { employeeId } : {}), ...(filter.type ? { type: filter.type } : {}) },
    include: { employee: { select: { id: true, name: true, employeeCode: true } } },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
}

export async function letterUrl(
  companyId: string,
  id: string,
  viewer: { role: Role; employeeId: string | null },
  opts: { inline?: boolean } = {}
) {
  const letter = await prisma.generatedLetter.findFirst({ where: { id, companyId } });
  if (!letter || !letter.fileKey) throw ApiError.notFound('Letter not found');
  if (!isCompanyAdmin(viewer.role) && letter.employeeId !== viewer.employeeId) throw ApiError.forbidden();
  const fileName = `${letter.title.replace(/[^\w\- ]+/g, '').trim() || letter.type}.pdf`;
  return { url: await presignedGetUrl(letter.fileKey, fileName, opts.inline ? 'inline' : 'attachment'), fileName, expiresInSeconds: FILE_LINK_TTL_SECONDS };
}

export async function deleteLetter(companyId: string, id: string) {
  const letter = await prisma.generatedLetter.findFirst({ where: { id, companyId } });
  if (!letter) throw ApiError.notFound('Letter not found');
  await prisma.generatedLetter.delete({ where: { id } });
  if (letter.documentId) await prisma.document.deleteMany({ where: { id: letter.documentId, companyId } });
  if (letter.fileKey) await removeObject(letter.fileKey).catch(() => undefined);
  return letter;
}

/** Employee self-service: salary certificate / experience letter, issued instantly. */
export async function requestOwnLetter(companyId: string, employeeId: string, type: LetterType) {
  if (!SELF_SERVICE_TYPES.includes(type)) throw ApiError.badRequest('Only salary certificates and experience letters can be self-issued');
  const template = await templateForType(companyId, type);
  if (!template) throw ApiError.badRequest('HR has not set up this letter yet — please raise a help-desk ticket');
  return generateLetter(companyId, { templateId: template.id, employeeId, createdById: employeeId });
}
