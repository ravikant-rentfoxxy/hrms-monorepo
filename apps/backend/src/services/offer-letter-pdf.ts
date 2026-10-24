/**
 * Provisional offer letter PDF: letterhead logo, candidate address block,
 * salary breakup table (per month / per annum), joining documents checklist
 * and the signatory block. DejaVu Sans is embedded so ₹ prints correctly.
 */
import path from 'path';
import PDFDocument from 'pdfkit';
import type { Letterhead } from './company-profile.service';
import type { SalaryBreakup } from './salary.service';

const FONT_DIR = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const REGULAR = path.join(FONT_DIR, 'DejaVuSans.ttf');
const BOLD = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');

const NAVY = '#1F3864';
const INK = '#1E293B';
const BORDER = '#1F2937';

export interface OfferSheet {
  reference: string;
  date: string;
  candidateName: string;
  designation: string;
  workLocation: string;
  joiningDate: string;
  validUntil: string;
  ctcAnnual: number;
  probationMonths: number;
  noticePeriodDays: number;
  terms: string;
  /** Monthly breakup derived from the offered CTC (same rules as on joining). */
  monthly: SalaryBreakup;
  esiEmployeeRate: number;
  esiEmployerRate: number;
}

export const JOINING_DOCUMENTS = [
  'Passport size photographs (5 Nos).',
  'Self-attested copy of PAN Card and Aadhaar Card.',
  'Self-attested certificate / document in support of your Date of Birth.',
  'Self-attested photocopy of your educational and professional qualifications.',
  'Certificates / documents in support of your past experience, including resignation acceptance and relieving letter / experience letter stating your last working day with your previous employer.',
  'Documentary support for your present salary (last 3 months pay slips, last 6 months bank statement and Form 16 of your previous employer).',
  'Cancelled cheque / passbook copy of your existing bank account.',
];

const money = (n: number) => Math.round(n).toLocaleString('en-IN');

/** 600000 → "₹6 LPA", 550000 → "₹5.5 LPA". */
const lpa = (ctc: number) => `₹${Number((ctc / 100000).toFixed(2)).toString()} LPA`;

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export function buildOfferLetterPdf(head: Letterhead, o: OfferSheet): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const left = 72;
    // The letterhead is drawn inside the top margin on every page.
    const doc = new PDFDocument({ size: 'A4', margins: { top: 118, bottom: 60, left, right: left } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('Body', REGULAR);
    doc.registerFont('Bold', BOLD);

    const width = doc.page.width - left * 2;

    const letterhead = () => {
      const { x, y } = doc;
      if (head.logo) {
        try {
          doc.image(head.logo, left - 8, 38, { fit: [190, 52] });
        } catch {
          head.logo = null; // unreadable image — fall back to the name
        }
      }
      if (!head.logo) doc.font('Bold').fontSize(20).fillColor(NAVY).text(head.name, left, 50, { width, lineBreak: false });
      // Text that flows onto a new page (e.g. the documents list) continues in the body style.
      doc.font('Body').fontSize(10).fillColor(INK);
      doc.x = x;
      doc.y = y;
    };
    doc.on('pageAdded', letterhead);
    letterhead();

    const para = (gap = 0.9) => doc.moveDown(gap);
    const body = (size = 10.5) => doc.font('Body').fontSize(size).fillColor(INK);

    // Reference + date
    const top = doc.y;
    body(8.5).fillColor('#64748B').text(`Ref: ${o.reference}`, left, top + 2, { lineBreak: false });
    doc.font('Bold').fontSize(10.5).fillColor(INK).text(o.date, left, top, { width, align: 'right' });
    para(1.2);

    body().text('To,', left, doc.y);
    doc.font('Bold').text(o.candidateName);
    para();
    doc.font('Bold').text('Subject: Provisional Offer Letter');
    para();
    body().text('Dear ', { continued: true }).font('Bold').text(`${firstName(o.candidateName)},`);
    para();
    body().text('Congratulations…!');
    para();

    // Position paragraph (mixed bold runs can't be justified reliably in pdfkit)
    body().text('With reference to your application & subsequent interview with us, we are pleased to extend this provisional offer for the position of ', { continued: true, lineGap: 2 })
      .font('Bold').text(o.designation, { continued: true });
    if (head.address) body().text(` in our company situated at ${head.address.replace(/\s*\n\s*/g, ', ')}.`, { lineGap: 2 });
    else body().text(' in ', { continued: true }).font('Bold').text(`${head.name}.`, { lineGap: 2 });
    para();

    body().text('We require you to join on ', { continued: true, lineGap: 2 })
      .font('Bold').text(o.joiningDate, { continued: true });
    if (o.workLocation) body().text(' at ', { continued: true }).font('Bold').text(o.workLocation, { continued: true });
    body().text('. You will be entitled to an Annual CTC of ', { continued: true })
      .font('Bold').text(`${lpa(o.ctcAnnual)} (₹${money(o.ctcAnnual)}).`, { lineGap: 2 });
    para();

    const facts = [
      o.probationMonths > 0 ? `You will be on probation for ${o.probationMonths} month${o.probationMonths === 1 ? '' : 's'} from your date of joining.` : '',
      o.noticePeriodDays > 0 ? `The notice period is ${o.noticePeriodDays} days.` : '',
      o.validUntil ? `This offer is valid until ${o.validUntil}.` : '',
    ].filter(Boolean);
    if (facts.length) {
      body().text(facts.join(' '), left, doc.y, { width, align: 'justify', lineGap: 2 });
      para();
    }

    // ---- Salary table ----
    const m = o.monthly;
    const esiEmp = m.deductions.find((d) => d.label.startsWith('ESI'))?.amount ?? 0;
    const pfEmp = m.deductions.find((d) => d.label.startsWith('PF'))?.amount ?? 0;
    type Row = { label: string; month: number; style?: 'band' | 'bold' };
    const rows: Row[] = [
      { label: 'Basic', month: m.basic },
      { label: 'HRA', month: m.hra },
      ...(m.conveyance > 0 ? [{ label: 'Conveyance Allowance', month: m.conveyance }] : []),
      ...(m.medical > 0 ? [{ label: 'Medical Allowance', month: m.medical }] : []),
      { label: 'Special Allowance', month: m.specialAllowance },
      { label: 'Total Gross', month: m.subTotal, style: 'band' },
      { label: 'Employee PF @ 12%', month: pfEmp },
      { label: `Employee ESIC ${o.esiEmployeeRate}%`, month: esiEmp },
      { label: 'Total Deduction', month: m.totalDeductions, style: 'bold' },
      { label: 'Take Home', month: m.netPay, style: 'band' },
      { label: 'Employer PF @ 12%', month: m.pfEmployer },
      { label: `Employer ESIC ${o.esiEmployerRate}%`, month: m.esiEmployer },
      ...(m.gratuity > 0 ? [{ label: 'Gratuity @ 4.81%', month: m.gratuity }] : []),
      { label: 'CTC To Employee', month: m.total, style: 'band' },
    ];
    const rowH = 19;
    const cols = [190, 130, 130];
    const tableW = cols.reduce((a, b) => a + b, 0);
    const tx = left + (width - tableW) / 2;
    const tableH = rowH * (rows.length + 1);
    if (doc.y + tableH > doc.page.height - doc.page.margins.bottom) doc.addPage();
    let ty = doc.y + 4;

    const drawRow = (cells: string[], fill: string | null, bold: boolean, color: string) => {
      if (fill) doc.rect(tx, ty, tableW, rowH).fill(fill);
      let cx = tx;
      cells.forEach((cell, i) => {
        const w = cols[i] ?? 0;
        doc.rect(cx, ty, w, rowH).lineWidth(0.8).strokeColor(BORDER).stroke();
        doc.font(bold ? 'Bold' : 'Body').fontSize(8.5).fillColor(color)
          .text(cell, cx + 8, ty + 5.5, { width: w - 16, align: i === 0 ? 'left' : 'center', lineBreak: false });
        cx += w;
      });
      ty += rowH;
    };
    drawRow(['Particulars', 'Per Month (₹)', 'Per Annum (₹)'], NAVY, true, '#FFFFFF');
    for (const r of rows) {
      const band = r.style === 'band';
      drawRow([r.label, money(r.month), money(r.month * 12)], band ? NAVY : null, band || r.style === 'bold', band ? '#FFFFFF' : INK);
    }
    doc.x = left;
    doc.y = ty + 22;

    // ---- Joining documents ----
    body().text('Please carry the following documents on the day of your joining:', left, doc.y, { width });
    doc.moveDown(0.6);
    body(10).list(JOINING_DOCUMENTS, left + 14, doc.y, { width: width - 14, bulletRadius: 2, textIndent: 12, bulletIndent: 0, lineGap: 2, paragraphGap: 3 });
    para(1.2);

    if (o.terms.trim()) {
      doc.font('Bold').fontSize(10.5).fillColor(INK).text('Additional terms', left, doc.y, { width });
      doc.moveDown(0.3);
      body().text(o.terms.trim(), left, doc.y, { width, align: 'justify', lineGap: 2 });
      para();
    }

    body().text(
      'Nothing in the letter should be construed as creating a contract of employment, as this is a provisional offer and employment stands confirmed subject to availability and verification of documents supporting your credentials.',
      left, doc.y, { width, align: 'justify', lineGap: 2 }
    );
    para();
    body().text('We are excited to have you on board.', left, doc.y);
    para();

    // ---- Signatory (kept together) ----
    if (doc.y + 110 > doc.page.height - doc.page.margins.bottom) doc.addPage();
    body().text('Yours Sincerely', left, doc.y);
    para();
    doc.font('Bold').text(`For ${head.name}`);
    para(2.2);
    if (head.signatoryName) doc.font('Bold').text(head.signatoryName);
    doc.font('Bold').text(head.signatoryTitle);

    doc.end();
  });
}
