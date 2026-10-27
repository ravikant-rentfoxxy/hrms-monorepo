/**
 * Showcase demo data — ONE fully populated tenant, "Nimbus Technologies Pvt Ltd"
 * (code `nimbus`), so every screen of the web panel and the app has realistic,
 * internally consistent data: masters, ~30 people, 3+ months of attendance,
 * leave, payroll runs (real engine), expenses / travel / timesheets, the whole
 * recruitment funnel, onboarding, confirmations, transfers, reviews, learning,
 * surveys, kudos and exits (serving notice + archived former employees).
 *
 * Wherever a module has side effects the real service functions are called
 * (approval chains, codes, letters → PDFs in MinIO, payroll, ledger, ...);
 * business dates are then back-dated so the story reads naturally.
 *
 * Re-runnable: deletes only the `nimbus` company (cascade), its audit rows,
 * its MinIO objects and `@nimbus.test` users without other memberships.
 * "Today" is the real current date.
 *
 * Run: npm run db:seed-showcase
 */
/* eslint-disable no-console */
import PDFDocument from 'pdfkit';
import { deflateSync } from 'zlib';
import bcrypt from 'bcryptjs';
import type { Request } from 'express';
import type { AttendanceStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { logger } from '../src/lib/logger';
import { BUCKET, ensureBucket, minio, objectKey, putObject } from '../src/lib/storage';
import { atLocalTime, isoDate } from '../src/utils/tz';
import { dateOnlyUTC, distanceMeters } from '../src/utils/geo';
import { encryptEmployeeSecrets } from '../src/utils/fieldCrypto';
import { longDate } from '../src/utils/lifecycle';
import { recordHistory } from '../src/services/employee-history.service';
import { createEmployee } from '../src/services/employee.service';
import * as approvalService from '../src/services/approval.service';
import { ensureStatutoryDefaults, updateConfig } from '../src/services/statutory.service';
import { ensureDefaultPlans } from '../src/services/billing.service';
import { assignShift } from '../src/services/shift.service';
import * as leaveService from '../src/services/leave.service';
import { ensureYearCredits } from '../src/services/leave-ledger.service';
import * as compOffService from '../src/services/leave-compoff.service';
import * as encashService from '../src/services/leave-encashment.service';
import * as attendanceService from '../src/services/attendance.service';
import * as overtimeService from '../src/services/overtime.service';
import * as expenseService from '../src/services/expense.service';
import * as travelService from '../src/services/travel.service';
import * as timesheetService from '../src/services/timesheet.service';
import * as payrollService from '../src/services/payroll.service';
import * as payrollInputService from '../src/services/payroll-input.service';
import * as loanService from '../src/services/loan.service';
import * as salaryRevisionService from '../src/services/salary-revision.service';
import * as taxService from '../src/services/tax-declaration.service';
import * as assetService from '../src/services/asset.service';
import * as letterService from '../src/services/letter.service';
import * as onboardingService from '../src/services/onboarding.service';
import * as confirmationService from '../src/services/confirmation.service';
import * as exitService from '../src/services/exit.service';
import * as handoverService from '../src/services/exit-handover.service';
import * as clearanceService from '../src/services/exit-clearance.service';
import * as settlementService from '../src/services/settlement.service';
import * as transferService from '../src/services/transfer.service';
import * as surveyService from '../src/services/survey.service';
import * as requisitionService from '../src/services/requisition.service';
import * as postingService from '../src/services/job-posting.service';
import * as candidateService from '../src/services/candidate.service';
import * as recruitmentService from '../src/services/recruitment.service';
import * as interviewService from '../src/services/interview.service';
import * as offerService from '../src/services/offer.service';
import * as preOnboardingService from '../src/services/pre-onboarding.service';

// Services log every notify() at debug level — keep the seed output readable.
logger.level = 'warn';

const COMPANY_CODE = 'nimbus';
const DOMAIN = '@nimbus.test';
const TZ = 'Asia/Kolkata';
const START = Date.now();

// ---------------------------------------------------------------------------
// Deterministic random + date helpers
// ---------------------------------------------------------------------------

let seedState = 20261021;
function rnd(): number {
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)] as T;
const digits = (n: number) => Array.from({ length: n }, () => String(ri(0, 9))).join('');
const letter = () => String.fromCharCode(65 + ri(0, 25));

const DAY = 86_400_000;
const NOW = new Date();
const TODAY = dateOnlyUTC(NOW);
const Y = TODAY.getUTCFullYear();
const addD = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const ago = (n: number) => addD(TODAY, -n);
const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
const monthEnd = (m: Date) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0));
const at = (d: Date, hhmm: string, plusDays = 0) => atLocalTime(d, hhmm, TZ, plusDays);
const iso = isoDate;
const minDate = (a: Date, b: Date) => (a < b ? a : b);
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
const M0 = monthStart(TODAY);
const M = (k: number) => addMonths(M0, -k); // M(1) = previous month
const FY_START_YEAR = TODAY.getUTCMonth() >= 3 ? Y : Y - 1;

/** Indian holidays for the current year (approximate dates; optional = restricted holiday). */
const HOLIDAYS: [string, number, number, boolean][] = [
  ["New Year's Day", 1, 1, true], ['Makar Sankranti / Pongal', 1, 14, true], ['Republic Day', 1, 26, false],
  ['Holi', 3, 4, false], ['Ugadi / Gudi Padwa', 3, 19, false], ['Eid-ul-Fitr', 3, 20, false], ['Good Friday', 4, 3, false],
  ['Ambedkar Jayanti', 4, 14, true], ['May Day / Maharashtra Day', 5, 1, false], ['Bakrid / Eid-ul-Adha', 5, 27, true],
  ['Independence Day', 8, 15, false], ['Raksha Bandhan', 8, 28, true], ['Janmashtami', 9, 4, true],
  ['Ganesh Chaturthi', 9, 14, false], ['Gandhi Jayanti', 10, 2, false], ['Dussehra (Vijaya Dashami)', 10, 20, false],
  ['Diwali (Balipratipada)', 11, 9, false], ['Bhai Dooj', 11, 11, true], ['Guru Nanak Jayanti', 11, 24, true],
  ['Christmas', 12, 25, false],
];
const HOLIDAY_SET = new Set(HOLIDAYS.filter((h) => !h[3]).map((h) => iso(ymd(Y, h[1], h[2]))));
const isWorkday = (d: Date) => !isWeekend(d) && !HOLIDAY_SET.has(iso(d));
function nextWorkday(d: Date): Date {
  let x = d;
  while (!isWorkday(x)) x = addD(x, 1);
  return x;
}
function prevWorkday(d: Date): Date {
  let x = d;
  while (!isWorkday(x)) x = addD(x, -1);
  return x;
}
/** Last day of `count` working days starting at `from`. */
function spanWorkdays(from: Date, count: number): Date {
  let d = from;
  let left = count - 1;
  while (left > 0) {
    d = addD(d, 1);
    if (isWorkday(d)) left--;
  }
  return d;
}
const nextMonday = () => addD(TODAY, ((8 - TODAY.getUTCDay()) % 7) || 7);

// ---------------------------------------------------------------------------
// Files (small real PDFs / PNGs)
// ---------------------------------------------------------------------------

function pdfBuffer(title: string, lines: string[], header = 'Nimbus Technologies Pvt Ltd'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(9).fillColor('#64748B').text(header);
    doc.moveDown(0.6).fontSize(18).fillColor('#0F172A').text(title);
    doc.moveDown().fontSize(11).fillColor('#1E293B');
    for (const l of lines) doc.text(l).moveDown(0.35);
    doc.end();
  });
}

const CRC_TABLE = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A small "ID card"-looking PNG (header band, photo box, text lines). */
function cardPng(rgb: [number, number, number], w = 360, h = 220): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const f = y < 40 ? 0.55 : x > 20 && x < 110 && y > 60 && y < 180 ? 0.8 : y > 70 && y % 24 < 6 && x > 130 && x < 330 ? 0.65 : 1;
      const o = row + 1 + x * 3;
      raw[o] = Math.round(rgb[0] * f);
      raw[o + 1] = Math.round(rgb[1] * f);
      raw[o + 2] = Math.round(rgb[2] * f);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
const fileOf = (name: string, buffer: Buffer, mimetype: string) => ({ originalname: name, mimetype, size: buffer.length, buffer });
const pdfFile = async (name: string, title: string, lines: string[]) => fileOf(name, await pdfBuffer(title, lines), 'application/pdf');

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

type OfficeKey = 'BLR' | 'MUM';
type ShiftKey = 'GEN' | 'EARLY' | 'NIGHT';
interface PersonSpec {
  key: string;
  name: string;
  gender: 'MALE' | 'FEMALE';
  role: Role;
  dept: string;
  desig: string;
  office: OfficeKey;
  manager?: string;
  joined: number; // days ago (moved to the next working day)
  ctc: number; // annual
  dob: Date;
  blood: string;
  marital: string;
  shift?: ShiftKey;
  former?: 'RESIGNED' | 'TERMINATED';
}
/** Birthday `offset` days from today in year `y` (birthdays this month). */
const bday = (y: number, offset: number) => {
  const d = addD(TODAY, offset);
  return ymd(y, d.getUTCMonth() + 1, d.getUTCDate());
};
const P = (key: string, name: string, gender: 'MALE' | 'FEMALE', role: Role, dept: string, desig: string, office: OfficeKey,
  manager: string | undefined, joined: number, ctc: number, dob: Date, blood: string, marital: string, extra: Partial<PersonSpec> = {}): PersonSpec =>
  ({ key, name, gender, role, dept, desig, office, manager, joined, ctc, dob, blood, marital, ...extra });

const PEOPLE: PersonSpec[] = [
  P('arjun', 'Arjun Mehta', 'MALE', 'ADMIN', 'Operations', 'Chief Executive Officer', 'BLR', undefined, 1080, 4500000, ymd(1982, 3, 14), 'B+', 'Married'),
  P('kavya', 'Kavya Iyer', 'FEMALE', 'HR', 'Human Resources', 'Head of Human Resources', 'BLR', 'arjun', 1020, 2600000, ymd(1986, 7, 2), 'O+', 'Married'),
  P('vikram', 'Vikram Nair', 'MALE', 'MANAGER', 'Engineering', 'Engineering Manager', 'BLR', 'arjun', 990, 3600000, ymd(1985, 1, 19), 'A+', 'Married'),
  P('neha', 'Neha Kapoor', 'FEMALE', 'MANAGER', 'Sales', 'Sales Manager', 'MUM', 'arjun', 900, 2800000, ymd(1988, 12, 5), 'AB+', 'Married'),
  P('siddharth', 'Siddharth Rao', 'MALE', 'MANAGER', 'Product', 'Group Product Manager', 'BLR', 'arjun', 840, 3200000, ymd(1987, 5, 23), 'O-', 'Married'),
  P('meera', 'Meera Pillai', 'FEMALE', 'MANAGER', 'Customer Success', 'Head of Customer Success', 'BLR', 'arjun', 760, 2200000, bday(1989, 7), 'B+', 'Single'),
  P('suresh', 'Suresh Iyengar', 'MALE', 'EMPLOYEE', 'Finance', 'Finance Manager', 'BLR', 'arjun', 950, 2200000, ymd(1983, 9, 9), 'A-', 'Married'),
  P('nikhil', 'Nikhil Jain', 'MALE', 'EMPLOYEE', 'Marketing', 'Marketing Manager', 'MUM', 'arjun', 620, 1800000, ymd(1990, 2, 11), 'B-', 'Married'),
  P('ganesh', 'Ganesh Patil', 'MALE', 'EMPLOYEE', 'Operations', 'Operations Executive', 'MUM', 'arjun', 820, 520000, bday(1991, 9), 'O+', 'Married', { shift: 'EARLY' }),
  P('rohan', 'Rohan Desai', 'MALE', 'HR', 'Human Resources', 'HR Executive', 'MUM', 'kavya', 470, 650000, ymd(1996, 4, 30), 'A+', 'Single'),
  P('aditya', 'Aditya Kulkarni', 'MALE', 'EMPLOYEE', 'Engineering', 'Tech Lead', 'BLR', 'vikram', 728, 2700000, ymd(1990, 8, 17), 'B+', 'Married'),
  P('priya', 'Priya Sharma', 'FEMALE', 'EMPLOYEE', 'Engineering', 'Software Engineer', 'BLR', 'vikram', 650, 1700000, bday(1995, 4), 'O+', 'Single'),
  P('rahul', 'Rahul Verma', 'MALE', 'EMPLOYEE', 'Engineering', 'DevOps Engineer', 'BLR', 'vikram', 540, 1650000, bday(1993, 0), 'AB-', 'Single', { shift: 'EARLY' }),
  P('karthik', 'Karthik Reddy', 'MALE', 'EMPLOYEE', 'Engineering', 'Software Engineer', 'BLR', 'vikram', 189, 1300000, ymd(1996, 6, 3), 'B+', 'Married'),
  P('ishaan', 'Ishaan Gupta', 'MALE', 'EMPLOYEE', 'Engineering', 'QA Engineer', 'BLR', 'vikram', 166, 850000, ymd(1999, 11, 27), 'O+', 'Single'),
  P('sneha', 'Sneha Joshi', 'FEMALE', 'EMPLOYEE', 'Engineering', 'Software Engineer', 'BLR', 'vikram', 16, 1100000, ymd(1998, 1, 8), 'A+', 'Single'),
  P('varun', 'Varun Chopra', 'MALE', 'EMPLOYEE', 'Engineering', 'Software Engineer', 'BLR', 'vikram', 860, 1400000, ymd(1994, 3, 3), 'B+', 'Married', { former: 'RESIGNED' }),
  P('ananya', 'Ananya Bose', 'FEMALE', 'EMPLOYEE', 'Product', 'Product Manager', 'BLR', 'siddharth', 600, 2000000, ymd(1992, 6, 21), 'A+', 'Married'),
  P('dev', 'Dev Malhotra', 'MALE', 'EMPLOYEE', 'Product', 'Associate Product Manager', 'BLR', 'siddharth', 420, 1200000, ymd(1997, 2, 14), 'O+', 'Single'),
  P('riya', 'Riya Sen', 'FEMALE', 'EMPLOYEE', 'Design', 'Senior Product Designer', 'BLR', 'siddharth', 1103, 1700000, ymd(1993, 12, 1), 'B+', 'Single'),
  P('aman', 'Aman Khanna', 'MALE', 'EMPLOYEE', 'Design', 'UI/UX Designer', 'BLR', 'riya', 65, 800000, ymd(2000, 5, 9), 'A-', 'Single'),
  P('farhan', 'Farhan Qureshi', 'MALE', 'EMPLOYEE', 'Sales', 'Account Executive', 'MUM', 'neha', 700, 1250000, ymd(1994, 9, 25), 'O+', 'Married'),
  P('pooja', 'Pooja Agarwal', 'FEMALE', 'EMPLOYEE', 'Sales', 'Account Executive', 'MUM', 'neha', 400, 850000, ymd(1997, 7, 7), 'B+', 'Single'),
  P('manish', 'Manish Tiwari', 'MALE', 'EMPLOYEE', 'Sales', 'Business Development Representative', 'MUM', 'neha', 300, 500000, ymd(2000, 1, 30), 'A+', 'Single'),
  P('ritu', 'Ritu Saxena', 'FEMALE', 'EMPLOYEE', 'Sales', 'Account Executive', 'MUM', 'neha', 640, 700000, ymd(1995, 11, 12), 'O-', 'Single', { former: 'TERMINATED' }),
  P('shreya', 'Shreya Menon', 'FEMALE', 'EMPLOYEE', 'Marketing', 'Content Marketing Specialist', 'MUM', 'nikhil', 350, 750000, ymd(1998, 3, 18), 'AB+', 'Single'),
  P('lakshmi', 'Lakshmi Narayan', 'FEMALE', 'EMPLOYEE', 'Finance', 'Accountant', 'BLR', 'suresh', 480, 680000, ymd(1994, 4, 4), 'B+', 'Married'),
  P('sunita', 'Sunita Yadav', 'FEMALE', 'EMPLOYEE', 'Operations', 'Office Assistant', 'MUM', 'ganesh', 260, 240000, ymd(1990, 8, 8), 'O+', 'Married'),
  P('rajesh', 'Rajesh Kumar', 'MALE', 'EMPLOYEE', 'Customer Success', 'Support Engineer', 'BLR', 'meera', 560, 600000, ymd(1996, 10, 2), 'A+', 'Single', { shift: 'NIGHT' }),
  P('divya', 'Divya Krishnan', 'FEMALE', 'EMPLOYEE', 'Customer Success', 'Support Engineer', 'BLR', 'meera', 380, 560000, ymd(1998, 6, 15), 'B-', 'Single', { shift: 'NIGHT' }),
  P('harish', 'Harish Gowda', 'MALE', 'EMPLOYEE', 'Customer Success', 'Customer Success Associate', 'BLR', 'meera', 177, 460000, ymd(1999, 9, 1), 'O+', 'Single'),
];
const TANVI = { key: 'tanvi', name: 'Tanvi Shah', role: 'EMPLOYEE' as Role };

const DEPARTMENTS = [
  ['Engineering', 'ENG'], ['Product', 'PRD'], ['Design', 'DSN'], ['Sales', 'SAL'], ['Marketing', 'MKT'],
  ['Human Resources', 'HR'], ['Finance', 'FIN'], ['Operations', 'OPS'], ['Customer Success', 'CS'],
] as const;
const DESIGNATIONS: [string, number][] = [
  ['Chief Executive Officer', 10], ['Head of Human Resources', 8], ['Engineering Manager', 7], ['Sales Manager', 7],
  ['Group Product Manager', 7], ['Head of Customer Success', 7], ['Tech Lead', 6], ['Finance Manager', 6], ['Marketing Manager', 6],
  ['Senior Software Engineer', 5], ['DevOps Engineer', 5], ['Product Manager', 5], ['Senior Product Designer', 5],
  ['Senior Account Executive', 5], ['Software Engineer', 4], ['QA Engineer', 4], ['Associate Product Manager', 4],
  ['UI/UX Designer', 4], ['Account Executive', 4], ['HR Executive', 4], ['Accountant', 4], ['Content Marketing Specialist', 4],
  ['Support Engineer', 4], ['Associate Software Engineer', 3], ['Business Development Representative', 3],
  ['Operations Executive', 3], ['Customer Success Associate', 3], ['Product Designer', 4], ['Office Assistant', 2],
];
const GRADES: [string, string, number, number][] = [
  ['G1', 'Associate', 240000, 600000], ['G2', 'Executive', 600000, 1000000], ['G3', 'Senior Executive', 1000000, 1600000],
  ['G4', 'Lead', 1600000, 2500000], ['G5', 'Manager', 2500000, 4000000], ['G6', 'Leadership', 4000000, 8000000],
];
const gradeFor = (ctc: number) => (GRADES.find((g) => ctc < g[3]) ?? GRADES[5]!)[0];
const AVATARS = ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#3B82F6'];
const BANKS: [string, string][] = [['HDFC Bank', 'HDFC'], ['ICICI Bank', 'ICIC'], ['State Bank of India', 'SBIN'], ['Axis Bank', 'UTIB'], ['Kotak Mahindra Bank', 'KKBK']];
const ADDR: Record<OfficeKey, string[]> = {
  BLR: [
    'Flat 304, Prestige Shantiniketan, Whitefield, Bengaluru, Karnataka 560048',
    '#12, 3rd Cross, HSR Layout Sector 2, Bengaluru, Karnataka 560102',
    'C-1102, Sobha Dream Acres, Panathur, Bengaluru, Karnataka 560087',
    '45, 7th Main, Indiranagar 2nd Stage, Bengaluru, Karnataka 560038',
    'A-506, Brigade Metropolis, Mahadevapura, Bengaluru, Karnataka 560048',
    '18/2, 5th Block, Koramangala, Bengaluru, Karnataka 560095',
  ],
  MUM: [
    'B-1204, Lodha Splendora, Ghodbunder Road, Thane West, Maharashtra 400615',
    '702, Sea Breeze CHS, Bandra West, Mumbai, Maharashtra 400050',
    '14, Shanti Niwas, Ram Maruti Road, Dadar West, Mumbai, Maharashtra 400028',
    'D-301, Hiranandani Gardens, Powai, Mumbai, Maharashtra 400076',
  ],
};
const FATHERS = ['Ramesh', 'Suresh', 'Mahesh', 'Rajendra', 'Venkatesh', 'Anil', 'Prakash', 'Ashok', 'Mohan', 'Vijay', 'Krishnan', 'Gopal'];

interface Emp {
  key: string;
  id: string;
  userId: string;
  name: string;
  role: Role;
  managerKey: string | null;
  joining: Date;
  office: OfficeKey;
  dept: string;
  shift: ShiftKey;
  gender: string;
  leaving: Date | null;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

let C = ''; // company id
const E = new Map<string, Emp>();
const e = (k: string): Emp => {
  const x = E.get(k);
  if (!x) throw new Error(`unknown employee ${k}`);
  return x;
};
const actor = (k: string) => ({ role: e(k).role, employeeId: e(k).id });
const reqOf = (k: string) =>
  ({ auth: { userId: e(k).userId, role: e(k).role, companyId: C, employeeId: e(k).id }, tenantId: C, ip: '10.20.0.15', headers: {} }) as unknown as Request;
const mgrOf = (k: string) => e(k).managerKey ?? 'kavya';
const ids: {
  dept: Map<string, string>; desig: Map<string, string>; grade: Map<string, string>; office: Record<OfficeKey, { id: string; lat: number; lng: number; city: string }>;
  shift: Record<ShiftKey, { id: string; start: string; end: string }>; leave: Map<string, string>; project: Map<string, string>;
} = {
  dept: new Map(), desig: new Map(), grade: new Map(),
  office: {} as Record<OfficeKey, { id: string; lat: number; lng: number; city: string }>,
  shift: {} as Record<ShiftKey, { id: string; start: string; end: string }>,
  leave: new Map(), project: new Map(),
};

/** Moves an approval chain's timestamps back so inbox / trail dates read naturally. */
async function backdateSteps(module: string, requestId: string, submitted: Date, decideAfterHours = 20) {
  const steps = await prisma.approvalStep.findMany({ where: { companyId: C, module, requestId }, orderBy: { level: 'asc' } });
  for (const s of steps) {
    const acted = s.actedAt ? new Date(Math.min(submitted.getTime() + s.level * decideAfterHours * 3600_000, NOW.getTime() - 60_000)) : null;
    await prisma.approvalStep.update({ where: { id: s.id }, data: { createdAt: submitted, ...(acted ? { actedAt: acted } : {}) } });
  }
}
const pastInstant = (d: Date, hhmm = '10:30') => new Date(Math.min(at(d, hhmm).getTime(), NOW.getTime() - 3600_000));

// ---------------------------------------------------------------------------
// 0. Clean-up
// ---------------------------------------------------------------------------

async function removePrefix(prefix: string) {
  const names: string[] = await new Promise((resolve, reject) => {
    const out: string[] = [];
    const stream = minio.listObjectsV2(BUCKET, prefix, true);
    stream.on('data', (o: { name?: string }) => { if (o.name) out.push(o.name); });
    stream.on('end', () => resolve(out));
    stream.on('error', reject);
  });
  for (let i = 0; i < names.length; i += 500) await minio.removeObjects(BUCKET, names.slice(i, i + 500));
  return names.length;
}

async function cleanup() {
  const existing = await prisma.company.findUnique({ where: { code: COMPANY_CODE } });
  if (existing) {
    const objects = await removePrefix(`${existing.id}/`);
    await prisma.auditLog.deleteMany({ where: { companyId: existing.id } });
    await prisma.company.delete({ where: { id: existing.id } });
    console.log(`• removed previous ${COMPANY_CODE} tenant (${objects} files)`);
  }
  const users = await prisma.user.findMany({
    where: { email: { endsWith: DOMAIN } },
    select: { id: true, _count: { select: { memberships: true, employees: true } } },
  });
  const orphan = users.filter((u) => u._count.memberships === 0 && u._count.employees === 0).map((u) => u.id);
  if (orphan.length) await prisma.user.deleteMany({ where: { id: { in: orphan } } });
}

// ---------------------------------------------------------------------------
// 1. Company setup
// ---------------------------------------------------------------------------

async function setupCompany() {
  const company = await prisma.company.create({
    data: {
      name: 'Nimbus Technologies Pvt Ltd', code: COMPANY_CODE, email: `hr${DOMAIN}`, phone: '+91 80 4718 2200',
      address: '4th Floor, Embassy Golf Links Business Park, Domlur, Bengaluru, Karnataka 560071', timezone: TZ, workStart: '09:30',
    },
  });
  C = company.id;
  const blr = await prisma.office.create({
    data: { companyId: C, name: 'Bengaluru HQ', latitude: 12.9716, longitude: 77.5946, radiusMeters: 300, state: 'Karnataka', city: 'Bengaluru', isMetro: true },
  });
  const mum = await prisma.office.create({
    data: { companyId: C, name: 'Mumbai Office (BKC)', latitude: 19.066, longitude: 72.8679, radiusMeters: 250, state: 'Maharashtra', city: 'Mumbai', isMetro: true },
  });
  ids.office = {
    BLR: { id: blr.id, lat: blr.latitude, lng: blr.longitude, city: 'Bengaluru' },
    MUM: { id: mum.id, lat: mum.latitude, lng: mum.longitude, city: 'Mumbai' },
  };

  await prisma.department.createMany({ data: DEPARTMENTS.map(([name, code]) => ({ companyId: C, name, code })) });
  await prisma.designation.createMany({ data: DESIGNATIONS.map(([name, level]) => ({ companyId: C, name, level })) });
  await prisma.grade.createMany({ data: GRADES.map(([code, name, minCtc, maxCtc]) => ({ companyId: C, code, name, minCtc, maxCtc })) });
  for (const d of await prisma.department.findMany({ where: { companyId: C } })) ids.dept.set(d.name, d.id);
  for (const d of await prisma.designation.findMany({ where: { companyId: C } })) ids.desig.set(d.name, d.id);
  for (const g of await prisma.grade.findMany({ where: { companyId: C } })) ids.grade.set(g.code, g.id);

  const gen = await prisma.shift.create({ data: { companyId: C, name: 'General', code: 'GEN', startTime: '09:30', endTime: '18:30', isDefault: true, color: '#4F46E5' } });
  const early = await prisma.shift.create({ data: { companyId: C, name: 'Early', code: 'EARLY', startTime: '07:00', endTime: '16:00', color: '#0EA5E9' } });
  const night = await prisma.shift.create({
    data: { companyId: C, name: 'Night (Support)', code: 'NIGHT', startTime: '21:00', endTime: '06:00', isNight: true, color: '#7C3AED' },
  });
  ids.shift = {
    GEN: { id: gen.id, start: '09:30', end: '18:30' },
    EARLY: { id: early.id, start: '07:00', end: '16:00' },
    NIGHT: { id: night.id, start: '21:00', end: '06:00' },
  };

  await prisma.holiday.createMany({ data: HOLIDAYS.map(([name, m, d, optional]) => ({ companyId: C, name, date: ymd(Y, m, d), optional })) });

  await ensureStatutoryDefaults(C);
  await updateConfig(C, {
    pfEstablishmentCode: 'KNBNG0098765000', esiEmployerCode: '53000123450001001', tan: 'BLRN12345E', companyPan: 'AAFCN4821K', defaultState: 'Karnataka',
  });

  await prisma.leaveType.createMany({
    data: [
      { companyId: C, code: 'CL', name: 'Casual Leave', totalPerYear: 12, color: '#0EA5E9', accrualType: 'YEARLY', maxConsecutive: 3 },
      { companyId: C, code: 'SL', name: 'Sick Leave', totalPerYear: 12, color: '#F59E0B', accrualType: 'YEARLY' },
      {
        companyId: C, code: 'EL', name: 'Earned / Privilege Leave', totalPerYear: 18, color: '#16A34A', accrualType: 'MONTHLY', accrualRate: 1.5,
        carryForwardMax: 30, encashable: true, maxEncashDays: 10, applicableAfterDays: 90, sandwichRule: true,
      },
      { companyId: C, code: 'ML', name: 'Maternity Leave', totalPerYear: 182, color: '#EC4899', accrualType: 'YEARLY', gender: 'FEMALE', allowHalfDay: false },
      { companyId: C, code: 'PTL', name: 'Paternity Leave', totalPerYear: 5, color: '#6366F1', accrualType: 'YEARLY', gender: 'MALE', allowHalfDay: false },
      { companyId: C, code: 'CO', name: 'Comp-off', totalPerYear: 0, color: '#14B8A6', accrualType: 'NONE', isCompOff: true, compOffExpiryDays: 90 },
      { companyId: C, code: 'LWP', name: 'Leave Without Pay', totalPerYear: 0, color: '#94A3B8', accrualType: 'NONE', isPaid: false, allowNegative: true, maxNegative: 60 },
    ],
  });
  for (const t of await prisma.leaveType.findMany({ where: { companyId: C } })) ids.leave.set(t.code, t.id);

  // Custom approval chains (others keep the defaults).
  await approvalService.saveFlow(C, 'EXPENSE', [{ type: 'MANAGER' }, { type: 'ROLE', role: 'HR' }]);
  await approvalService.saveFlow(C, 'CONFIRMATION', [{ type: 'MANAGER' }, { type: 'ROLE', role: 'HR' }]);

  // Plan, subscription, invoices.
  await ensureDefaultPlans();
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'STANDARD' } });
  await prisma.subscription.create({
    data: { companyId: C, planId: plan.id, status: 'ACTIVE', seats: 30, startedOn: addMonths(M0, -14), renewsOn: addMonths(M0, 1) },
  });
  for (const [k, status] of [[3, 'PAID'], [2, 'PAID'], [1, 'DUE']] as const) {
    const seats = 29 + (k === 1 ? 1 : 0);
    await prisma.invoice.create({
      data: {
        companyId: C, period: M(k), seats, amount: seats * plan.pricePerEmployee, status,
        paidOn: status === 'PAID' ? addD(M(k - 1), 6) : null, createdAt: addD(M(k - 1), 1),
      },
    });
  }

  await prisma.integration.createMany({
    data: [
      {
        companyId: C, type: 'SLACK', name: 'Slack — #people-updates', url: 'https://hooks.slack.com/services/T05NIMBUS/B07HRMS/demo-webhook',
        events: 'employee.joined,leave.approved,kudos.received,announcement.posted,payroll.published',
      },
      { companyId: C, type: 'TALLY', name: 'Tally Prime — payroll journal', url: '', events: 'payroll.published' },
    ],
  });

  await prisma.project.createMany({
    data: [
      { companyId: C, name: 'Nimbus Cloud Platform', code: 'NCP', client: 'Internal', isBillable: false },
      { companyId: C, name: 'Acme Retail Mobile App', code: 'ARM', client: 'Acme Retail Pvt Ltd', isBillable: true },
      { companyId: C, name: 'Bharat Payments Integration', code: 'BPI', client: 'Bharat Payments Ltd', isBillable: true },
      { companyId: C, name: 'Data Pipeline Revamp', code: 'DPR', client: 'Internal', isBillable: false },
    ],
  });
  for (const p of await prisma.project.findMany({ where: { companyId: C } })) ids.project.set(p.code, p.id);
  await letterService.ensureDefaultTemplates(C);
}

// ---------------------------------------------------------------------------
// 2. People
// ---------------------------------------------------------------------------

function joiningOf(p: PersonSpec) {
  return nextWorkday(ago(p.joined));
}

async function createPeople() {
  const [adminPw, empPw] = await Promise.all([bcrypt.hash('Admin@12345', 12), bcrypt.hash('Employee@123', 12)]);
  for (const p of [...PEOPLE, TANVI]) {
    await prisma.user.create({ data: { email: `${p.key}${DOMAIN}`, passwordHash: p.role === 'ADMIN' ? adminPw : empPw, role: p.role } });
  }
  let n = 0;
  for (const p of PEOPLE) {
    n++;
    const joining = joiningOf(p);
    const probationEnd = addMonths(joining, 6);
    const confirmedOn = probationEnd < TODAY && p.key !== 'karthik' ? probationEnd : null;
    const [bankName, bankCode] = pick(BANKS);
    const [first, ...rest] = p.name.split(' ');
    const last = rest.join(' ');
    const office = ids.office[p.office];
    const user = await prisma.user.findUniqueOrThrow({ where: { email: `${p.key}${DOMAIN}` } });
    const req = (E.size ? reqOf(E.has('kavya') ? 'kavya' : 'arjun') : ({ auth: { userId: user.id, role: 'ADMIN', companyId: C, employeeId: null }, tenantId: C, ip: '10.20.0.15', headers: {} } as unknown as Request));
    const created = await createEmployee(C, {
      name: p.name, email: `${p.key}${DOMAIN}`, role: p.role === 'ADMIN' ? 'HR' : (p.role as 'HR' | 'MANAGER' | 'EMPLOYEE'),
      employeeCode: `NIM-${String(n).padStart(3, '0')}`,
      departmentId: ids.dept.get(p.dept), designationId: ids.desig.get(p.desig), gradeId: ids.grade.get(gradeFor(p.ctc)), officeId: office.id,
      location: office.city, phone: `+91 ${ri(70000, 99999)} ${ri(10000, 99999)}`, joiningDate: joining, dateOfBirth: p.dob,
      managerId: p.manager ? e(p.manager).id : null, bloodGroup: p.blood, address: pick(ADDR[p.office]),
      emergencyContact: `${p.marital === 'Married' ? 'Spouse' : 'Parent'} — +91 ${ri(70000, 99999)} ${ri(10000, 99999)}`,
      bankName, accountNumber: `${ri(1, 9)}${digits(13)}`, ifsc: `${bankCode}0${digits(6)}`,
      pan: `${letter()}${letter()}${letter()}P${last.charAt(0).toUpperCase()}${ri(1000, 9999)}${letter()}`,
      pfNumber: `KN/BNG/0098765/000/${String(1000 + n).padStart(7, '0')}`, uan: `10${digits(10)}`, aadhaarNumber: `${ri(2, 9)}${digits(11)}`,
      fatherName: `${pick(FATHERS)} ${last}`, gender: p.gender, maritalStatus: p.marital,
      personalEmail: `${(first ?? p.key).toLowerCase()}.${last.toLowerCase().replace(/\s+/g, '')}@example.com`,
      probationEndDate: probationEnd, confirmedOn, noticePeriodDays: p.key === 'arjun' ? 90 : p.role === 'MANAGER' || p.role === 'HR' ? 60 : 30,
      salaryCtc: Math.round(p.ctc / 12), avatarColor: AVATARS[n % AVATARS.length], employmentType: 'Full-time', taxRegime: 'NEW',
      ...(p.key === 'sunita' ? { esiNumber: '3100123456' } : {}),
    }, req);
    E.set(p.key, {
      key: p.key, id: created.employee.id, userId: user.id, name: p.name, role: p.role, managerKey: p.manager ?? null, joining,
      office: p.office, dept: p.dept, shift: p.shift ?? 'GEN', gender: p.gender, leaving: null,
    });
    if (p.role === 'ADMIN') {
      await prisma.membership.update({ where: { userId_companyId: { userId: user.id, companyId: C } }, data: { role: 'ADMIN' } });
    }
    if (confirmedOn) {
      await recordHistory(prisma, {
        companyId: C, employeeId: created.employee.id, type: 'CONFIRMED', effectiveDate: confirmedOn, title: 'Confirmed — probation completed',
        refType: 'Employee', refId: created.employee.id, createdById: E.has('kavya') ? e('kavya').id : null,
      });
    }
    if (p.shift && p.shift !== 'GEN') {
      await assignShift(C, { shiftId: ids.shift[p.shift].id, employeeIds: [created.employee.id], fromDate: joining });
    }
  }
  // Department heads.
  const heads: Record<string, string> = {
    Engineering: 'vikram', Product: 'siddharth', Design: 'riya', Sales: 'neha', Marketing: 'nikhil', 'Human Resources': 'kavya',
    Finance: 'suresh', Operations: 'arjun', 'Customer Success': 'meera',
  };
  for (const [dept, k] of Object.entries(heads)) await prisma.department.update({ where: { id: ids.dept.get(dept)! }, data: { headId: e(k).id } });

  // Onboarding of long-tenured employees is long done.
  const cases = await prisma.onboardingCase.findMany({ where: { companyId: C }, include: { employee: { select: { joiningDate: true } }, tasks: true } });
  for (const c of cases) {
    const j = c.employee.joiningDate;
    await prisma.onboardingCase.update({ where: { id: c.id }, data: { startedOn: j } });
    if (j < ago(45)) {
      for (const t of c.tasks) {
        await prisma.onboardingTask.update({ where: { id: t.id }, data: { done: true, doneAt: addD(t.dueDate ?? j, 1) } });
      }
      await prisma.onboardingCase.update({ where: { id: c.id }, data: { status: 'COMPLETED', completedOn: addD(j, 12) } });
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Assets
// ---------------------------------------------------------------------------

const ASSET_IDS = new Map<string, string>(); // tag → id
async function createAssets() {
  const kav = e('kavya').id;
  const laptopFor: Record<string, [string, string, number]> = {}; // key → [brand, model, cost]
  const mac: [string, string, number] = ['Apple', 'MacBook Pro 14" M3', 199900];
  const dell: [string, string, number] = ['Dell', 'Latitude 5440', 92000];
  const lenovo: [string, string, number] = ['Lenovo', 'ThinkPad E14 Gen 5', 68000];
  for (const p of PEOPLE) {
    if (p.key === 'sunita') continue;
    laptopFor[p.key] = ['Engineering', 'Product', 'Design'].includes(p.dept) ? mac : p.role === 'ADMIN' || p.dept === 'Finance' ? dell : lenovo;
  }
  let i = 0;
  const make = async (tag: string, name: string, category: string, brand: string, model: string, cost: number, purchase: Date, status = 'AVAILABLE', note = '') => {
    const a = await assetService.createAsset(C, {
      tag, name, category, serialNumber: `${brand.slice(0, 2).toUpperCase()}${digits(9)}`, brand, model, purchaseDate: purchase, cost, status, notes: note,
    });
    ASSET_IDS.set(tag, a.id);
    return a;
  };
  for (const [key, [brand, model, cost]] of Object.entries(laptopFor)) {
    i++;
    const tag = `NIM-LT-${String(i).padStart(3, '0')}`;
    const emp = e(key);
    await make(tag, `${brand} ${model}`, 'Laptop', brand, model, cost, addD(emp.joining, -5));
    await assetService.assignAsset(C, ASSET_IDS.get(tag)!, { employeeId: emp.id, conditionOut: 'New', notes: 'Issued on joining' }, kav);
  }
  // Spares (Tanvi's laptop comes from here), one in repair, one retired.
  await make('NIM-LT-101', 'Apple MacBook Air 13" M2', 'Laptop', 'Apple', 'MacBook Air M2', 114900, ago(120));
  await make('NIM-LT-102', 'Lenovo ThinkPad E14 Gen 5', 'Laptop', 'Lenovo', 'ThinkPad E14 Gen 5', 68000, ago(90));
  await make('NIM-LT-103', 'Dell Latitude 5440', 'Laptop', 'Dell', 'Latitude 5440', 92000, ago(60));
  await make('NIM-LT-104', 'Apple MacBook Pro 14" M3', 'Laptop', 'Apple', 'MacBook Pro 14" M3', 199900, ago(30));
  await make('NIM-LT-090', 'Dell Latitude 7420', 'Laptop', 'Dell', 'Latitude 7420', 105000, ago(900), 'IN_REPAIR', 'Keyboard + battery replacement at Dell service centre (ticket #DL-778812)');
  await make('NIM-LT-050', 'HP ProBook 440 G7', 'Laptop', 'HP', 'ProBook 440 G7', 61000, ago(1500), 'RETIRED', 'End of life — data wiped, sent for e-waste recycling');
  // Monitors
  const monitorTo = ['vikram', 'aditya', 'priya', 'riya', 'siddharth', 'suresh'];
  for (let m = 1; m <= 8; m++) {
    const tag = `NIM-MN-${String(m).padStart(3, '0')}`;
    await make(tag, 'Dell P2422H 24" Monitor', 'Monitor', 'Dell', 'P2422H', 16500, ago(400 - m * 20));
    const k = monitorTo[m - 1];
    if (k) await assetService.assignAsset(C, ASSET_IDS.get(tag)!, { employeeId: e(k).id, notes: 'Desk setup' }, kav);
  }
  // Phones
  const phones: [string, string, string, number][] = [
    ['neha', 'Apple', 'iPhone 15', 79900], ['farhan', 'Apple', 'iPhone 15', 79900], ['meera', 'Samsung', 'Galaxy S23 FE', 54999],
    ['rajesh', 'Samsung', 'Galaxy A54 (on-call)', 38999], ['', 'Samsung', 'Galaxy A54 (on-call)', 38999],
  ];
  let ph = 0;
  for (const [k, brand, model, cost] of phones) {
    ph++;
    const tag = `NIM-MB-${String(ph).padStart(3, '0')}`;
    await make(tag, `${brand} ${model}`, 'Mobile', brand, model, cost, ago(300));
    if (k) await assetService.assignAsset(C, ASSET_IDS.get(tag)!, { employeeId: e(k).id, notes: 'Company phone with corporate SIM' }, kav);
  }
  // ID cards
  const idTo = ['sneha', 'aman', 'ishaan', 'harish', 'karthik', 'varun', 'ritu', 'dev', 'sunita', 'manish'];
  let idn = 0;
  for (const k of idTo) {
    idn++;
    const tag = `NIM-ID-${String(idn).padStart(3, '0')}`;
    await make(tag, `Employee ID card — ${e(k).name}`, 'ID Card', 'HID', 'iCLASS SE', 450, e(k).joining);
    await assetService.assignAsset(C, ASSET_IDS.get(tag)!, { employeeId: e(k).id, notes: 'Photo ID + access card' }, kav);
  }
  for (const extra of ['NIM-ID-101', 'NIM-ID-102']) await make(extra, 'Blank ID card (stock)', 'ID Card', 'HID', 'iCLASS SE', 450, ago(30));
  // Back-date issue dates to the joining dates.
  const assignments = await prisma.assetAssignment.findMany({ where: { companyId: C }, include: { employee: { select: { joiningDate: true } } } });
  for (const a of assignments) await prisma.assetAssignment.update({ where: { id: a.id }, data: { issuedOn: a.employee.joiningDate } });
}

// ---------------------------------------------------------------------------
// 4. Leave
// ---------------------------------------------------------------------------

async function seedLeave() {
  const el = ids.leave.get('EL')!;
  const jan1 = ymd(Y, 1, 1);
  for (const emp of E.values()) {
    if (emp.joining < jan1) {
      await prisma.leaveLedger.create({
        data: { companyId: C, employeeId: emp.id, leaveTypeId: el, date: jan1, change: ri(4, 16), kind: 'CARRY_FORWARD', reason: `Carried forward from ${Y - 1}` },
      });
    }
    await ensureYearCredits(C, emp.id, Y);
  }

  type L = [who: string, type: string, offset: number, days: number, status: 'A' | 'R' | 'C' | 'P', reason: string, half?: boolean];
  const fixtures: L[] = [
    ['siddharth', 'EL', -108, 3, 'A', 'Family vacation to Coorg'],
    ['vikram', 'EL', -100, 2, 'A', 'Personal work — house registration'],
    ['aditya', 'EL', -95, 5, 'A', 'Trip to Ladakh'],
    ['nikhil', 'EL', -85, 2, 'A', "Sister's engagement"],
    ['priya', 'EL', -80, 3, 'A', 'Visiting parents in Jaipur'],
    ['shreya', 'CL', -70, 2, 'A', 'Moving to a new flat'],
    ['varun', 'EL', -66, 2, 'A', 'Relocation house-hunting in Pune'],
    ['farhan', 'CL', -60, 2, 'A', 'Family function in Lucknow'],
    ['kavya', 'EL', -55, 3, 'A', "Daughter's school annual day + short break"],
    ['karthik', 'SL', -50, 1, 'A', 'Viral fever'],
    ['riya', 'EL', -45, 4, 'A', 'Design conference + leave in Goa'],
    ['meera', 'CL', -42, 1, 'A', 'Bank and passport appointments'],
    ['rajesh', 'SL', -40, 2, 'A', 'Food poisoning'],
    ['sunita', 'CL', -38, 1, 'A', "Child's PTM at school"],
    ['pooja', 'SL', -35, 2, 'A', 'Migraine — doctor advised rest'],
    ['suresh', 'CL', -33, 1, 'A', 'Personal errand'],
    ['ishaan', 'SL', -30, 1, 'A', 'Dental surgery'],
    ['lakshmi', 'SL', -28, 1, 'A', 'Fever'],
    ['neha', 'CL', -25, 1, 'A', 'Personal work'],
    ['harish', 'SL', -22, 1, 'A', 'Cold and cough'],
    ['manish', 'CL', -20, 1, 'R', 'Cousin wedding'],
    ['rohan', 'SL', -18, 1, 'A', 'Back pain'],
    ['ananya', 'CL', -15, 1, 'A', 'Personal work'],
    ['divya', 'CL', -12, 1, 'A', 'Half day — bank visit', true],
    ['ganesh', 'CL', -10, 1, 'A', 'Village festival'],
    ['dev', 'CL', -6, 1, 'A', 'Interview for Masters admission (personal)'],
    ['ananya', 'CL', 0, 1, 'A', 'Plumbing emergency at home'],
    ['pooja', 'CL', 5, 1, 'C', 'Personal work'],
    ['shreya', 'CL', 8, 1, 'P', 'Attending a friend\'s wedding'],
    ['vikram', 'CL', 9, 1, 'P', 'Parent-teacher meeting'],
    ['ishaan', 'CL', 11, 1, 'R', 'Short trip'],
    ['farhan', 'EL', 12, 2, 'P', 'Eid with family in Lucknow'],
    ['priya', 'EL', 14, 3, 'P', 'Diwali at home in Jaipur'],
    ['rohan', 'CL', 16, 2, 'P', 'Hometown visit'],
    ['divya', 'CL', 18, 1, 'P', 'Personal work'],
    ['karthik', 'PTL', 20, 4, 'P', 'Paternity leave — baby due in the first week of next month (4 days pro-rated balance)'],
    ['aditya', 'EL', 25, 2, 'A', 'Long weekend trip'],
    ['lakshmi', 'CL', 28, 2, 'A', 'Family function'],
    ['arjun', 'EL', 30, 4, 'P', 'Year-end family holiday'],
  ];
  for (const [who, code, offset, days, status, reason, half] of fixtures) {
    const from = offset < 0 ? prevWorkday(addD(TODAY, offset)) : nextWorkday(addD(TODAY, offset));
    const to = half ? from : spanWorkdays(from, days);
    if (offset < 0 && to >= TODAY) continue;
    const req = await leaveService.applyLeave(C, e(who).id, { leaveTypeId: ids.leave.get(code)!, fromDate: from, toDate: to, halfDay: !!half, reason });
    const approverKey = mgrOf(who);
    if (status === 'A' || status === 'R') {
      await leaveService.decideRequest(C, req.id, {
        decision: status === 'A' ? 'APPROVED' : 'REJECTED',
        remarks: status === 'A' ? 'Approved — enjoy!' : 'Release week — please pick another date',
        actor: actor(approverKey),
      });
    } else if (status === 'C') {
      await leaveService.cancelRequest(C, actor(who), req.id);
    }
    const applied = offset < 0 ? addD(from, -ri(3, 8)) : addD(TODAY, -ri(0, 3));
    const appliedAt = pastInstant(applied, '11:15');
    await prisma.leaveRequest.update({ where: { id: req.id }, data: { appliedOn: appliedAt } });
    await backdateSteps('LEAVE', req.id, appliedAt);
  }
}

// ---------------------------------------------------------------------------
// 5. Recruitment (full funnel)
// ---------------------------------------------------------------------------

interface CandSpec {
  name: string;
  email?: string;
  job: 'J1' | 'J2' | 'J3' | 'J4';
  via: string; // posting platform, or REFERRAL:<employeeKey>
  exp: number;
  company: string;
  desig: string;
  loc: string;
  ctc: number;
  expected: number;
  notice: number;
  skills: string;
  qual: string;
  daysAgo: number;
  flow: string[];
  offerCtc?: number;
  joinIn?: number;
}
const JOBS: Record<string, { id: string; title: string; hm: string; tech: string; postings: Record<string, string>; desig: string; dept: string }> = {};
const APPS = new Map<string, string>(); // candidate name → application id
let portalCandidate = '';
let tanviJoin: Date = TODAY;

async function seedRecruitment() {
  const hr = actor('kavya');
  const admin = actor('arjun');
  // ---- Requisitions ----
  const reqDefs = [
    {
      key: 'J1', by: 'vikram', title: 'Senior Backend Engineer', dept: 'Engineering', desig: 'Senior Software Engineer', vacancies: 2, min: 4, max: 8,
      skills: 'Node.js, TypeScript, PostgreSQL, AWS, System design', loc: 'Bengaluru', bmin: 1800000, bmax: 3000000, reason: 'EXPANSION',
      just: 'Bharat Payments integration and the platform roadmap need two more senior backend engineers this half.', ago: 52, tech: 'aditya', prio: 'HIGH',
    },
    {
      key: 'J2', by: 'neha', title: 'Inside Sales Executive', dept: 'Sales', desig: 'Account Executive', vacancies: 3, min: 1, max: 4,
      skills: 'B2B SaaS sales, CRM, Cold calling, Negotiation', loc: 'Mumbai', bmin: 600000, bmax: 1000000, reason: 'NEW_POSITION',
      just: 'New West-region territory for mid-market accounts; pipeline target needs three executives.', ago: 46, tech: 'farhan', prio: 'HIGH',
    },
    {
      key: 'J3', by: 'vikram', title: 'Associate Software Engineer', dept: 'Engineering', desig: 'Associate Software Engineer', vacancies: 1, min: 0, max: 2,
      skills: 'JavaScript, React, Node.js, SQL', loc: 'Bengaluru', bmin: 600000, bmax: 900000, reason: 'REPLACEMENT',
      just: 'Backfill for the open associate position on the Acme Retail app team.', ago: 85, tech: 'priya', prio: 'MEDIUM',
    },
    {
      key: 'J4', by: 'meera', title: 'Customer Success Associate', dept: 'Customer Success', desig: 'Customer Success Associate', vacancies: 2, min: 0, max: 3,
      skills: 'Customer support, Zendesk, Communication, SaaS', loc: 'Bengaluru', bmin: 400000, bmax: 600000, reason: 'EXPANSION',
      just: 'Support volume grew 40% after the Acme go-live; two associates for the day shift.', ago: 40, tech: 'rajesh', prio: 'MEDIUM',
    },
  ];
  for (const r of reqDefs) {
    const created = await requisitionService.create(C, actor(r.by), {
      title: r.title, departmentId: ids.dept.get(r.dept), designation: r.desig, vacancies: r.vacancies, minExperience: r.min, maxExperience: r.max,
      skills: r.skills, qualifications: 'B.E. / B.Tech or equivalent', location: r.loc, employmentType: 'Full-time', budgetMinCtc: r.bmin,
      budgetMaxCtc: r.bmax, reason: r.reason, justification: r.just, description: `${r.title} for our ${r.loc} office.`, priority: r.prio,
      targetDate: addD(TODAY, 30), submit: true,
      ...(r.reason === 'REPLACEMENT' ? { replacementForId: e('varun').id } : {}),
    });
    await requisitionService.decide(C, created.id, hr, 'APPROVED', 'Requirement reviewed — fits the hiring plan');
    const res = await requisitionService.decide(C, created.id, admin, 'APPROVED', 'Budget approved');
    if (!res.job) throw new Error('requisition did not create a job');
    const t0 = pastInstant(ago(r.ago), '10:00');
    await prisma.jobRequisition.update({ where: { id: created.id }, data: { createdAt: t0, submittedAt: t0, approvedAt: addD(t0, 2) } });
    await prisma.jobOpening.update({ where: { id: res.job.id }, data: { createdAt: addD(t0, 2) } });
    await backdateSteps('REQUISITION', created.id, t0, 24);
    JOBS[r.key] = { id: res.job.id, title: r.title, hm: r.by, tech: r.tech, postings: {}, desig: r.desig, dept: r.dept };
  }
  // Pending / draft / rejected requisitions.
  const pending = await requisitionService.create(C, actor('siddharth'), {
    title: 'Product Designer', departmentId: ids.dept.get('Design'), designation: 'Product Designer', vacancies: 1, minExperience: 2, maxExperience: 5,
    skills: 'Figma, Design systems, User research, Prototyping', location: 'Bengaluru', budgetMinCtc: 1000000, budgetMaxCtc: 1600000,
    reason: 'NEW_POSITION', justification: 'Design capacity is the bottleneck for the Acme Retail app v2 and the new onboarding flows.', priority: 'HIGH',
    targetDate: addD(TODAY, 45), submit: true,
  });
  await prisma.jobRequisition.update({ where: { id: pending.id }, data: { createdAt: pastInstant(ago(3)), submittedAt: pastInstant(ago(3)) } });
  await backdateSteps('REQUISITION', pending.id, pastInstant(ago(3)));
  await requisitionService.create(C, actor('nikhil'), {
    title: 'Performance Marketing Specialist', departmentId: ids.dept.get('Marketing'), designation: 'Content Marketing Specialist', vacancies: 1,
    minExperience: 2, maxExperience: 4, skills: 'Google Ads, Meta Ads, GA4, SEO', location: 'Mumbai', budgetMinCtc: 800000, budgetMaxCtc: 1200000,
    reason: 'NEW_POSITION', justification: 'Draft — waiting for the FY plan', priority: 'LOW',
  });
  const rej = await requisitionService.create(C, actor('neha'), {
    title: 'Sales Operations Analyst', departmentId: ids.dept.get('Sales'), designation: 'Account Executive', vacancies: 1, minExperience: 2, maxExperience: 5,
    skills: 'Excel, Salesforce, Reporting', location: 'Mumbai', budgetMinCtc: 900000, budgetMaxCtc: 1400000, reason: 'NEW_POSITION',
    justification: 'Need someone to own CRM hygiene and the weekly sales reporting pack.', priority: 'MEDIUM', submit: true,
  });
  await requisitionService.decide(C, rej.id, hr, 'APPROVED', 'OK from HR');
  await requisitionService.decide(C, rej.id, admin, 'REJECTED', 'Not in this year\'s budget — revisit in Q4 planning');
  await prisma.jobRequisition.update({ where: { id: rej.id }, data: { createdAt: pastInstant(ago(20)), submittedAt: pastInstant(ago(20)) } });
  await backdateSteps('REQUISITION', rej.id, pastInstant(ago(20)), 30);

  // ---- Postings ----
  const posts: [string, string, number, number, number, string][] = [
    ['J1', 'LINKEDIN', 18000, -40, 20, 'ACTIVE'], ['J1', 'NAUKRI', 12500, -38, 22, 'ACTIVE'], ['J1', 'CAREERS_PAGE', 0, -40, 50, 'ACTIVE'],
    ['J2', 'NAUKRI', 9500, -30, 30, 'ACTIVE'], ['J2', 'INDEED', 6000, -44, -5, 'EXPIRED'], ['J2', 'LINKEDIN', 15000, -28, 32, 'ACTIVE'],
    ['J3', 'LINKEDIN', 12000, -75, 15, 'ACTIVE'], ['J3', 'INTERNSHALA', 2500, -75, -20, 'EXPIRED'],
    ['J4', 'INTERNSHALA', 2500, -35, 25, 'ACTIVE'], ['J4', 'INDEED', 5000, -35, 25, 'ACTIVE'],
  ];
  for (const [jk, platform, cost, posted, expires, status] of posts) {
    const job = JOBS[jk]!;
    const p = await postingService.create(C, job.id, e('rohan').id, {
      platform, cost, postedOn: addD(TODAY, posted), expiresOn: addD(TODAY, expires), status: 'PUBLISHED',
      url: platform === 'CAREERS_PAGE' ? `https://careers.nimbus.test/jobs/${jk.toLowerCase()}` : `https://www.${platform.toLowerCase()}.com/jobs/view/${digits(9)}`,
      externalId: platform === 'CAREERS_PAGE' ? '' : digits(9), notes: cost ? 'Premium listing' : 'Free listing on our careers page',
    });
    await prisma.jobPosting.update({ where: { id: p.id }, data: { status, createdAt: pastInstant(addD(TODAY, posted)) } });
    job.postings[platform] = p.id;
  }

  // ---- Candidates ----
  const cands: CandSpec[] = [
    // J1 Senior Backend Engineer
    { name: 'Amit Bansal', job: 'J1', via: 'LINKEDIN', exp: 5, company: 'Swiggy', desig: 'SDE II', loc: 'Bengaluru', ctc: 2100000, expected: 2800000, notice: 60, skills: 'Node.js, TypeScript, Kafka, PostgreSQL', qual: 'B.Tech CSE, NIT Trichy', daysAgo: 3, flow: [] },
    { name: 'Swati Kulkarni', job: 'J1', via: 'NAUKRI', exp: 6, company: 'Infosys', desig: 'Senior Systems Engineer', loc: 'Pune', ctc: 1600000, expected: 2200000, notice: 90, skills: 'Java, Spring Boot, AWS, SQL', qual: 'B.E. IT, PICT Pune', daysAgo: 2, flow: [] },
    { name: 'Rakesh Menon', job: 'J1', via: 'CAREERS_PAGE', exp: 4.5, company: 'Freshworks', desig: 'Software Engineer II', loc: 'Chennai', ctc: 1900000, expected: 2500000, notice: 30, skills: 'Node.js, TypeScript, Redis, AWS', qual: 'B.E. CSE, Anna University', daysAgo: 8, flow: ['shortlist'] },
    { name: 'Pallavi Deshpande', job: 'J1', via: 'NAUKRI', exp: 7, company: 'Persistent Systems', desig: 'Lead Engineer', loc: 'Pune', ctc: 2400000, expected: 3000000, notice: 60, skills: 'Node.js, PostgreSQL, System design, Microservices', qual: 'M.Tech, COEP', daysAgo: 12, flow: ['shortlist', 'hr'] },
    { name: 'Gaurav Sinha', job: 'J1', via: 'LINKEDIN', exp: 6, company: 'Razorpay', desig: 'Senior Software Engineer', loc: 'Bengaluru', ctc: 2600000, expected: 3200000, notice: 60, skills: 'Node.js, TypeScript, PostgreSQL, AWS, Payments', qual: 'B.Tech, IIIT Hyderabad', daysAgo: 18, flow: ['shortlist', 'hr', 'int1', 'upcoming:1:1100'] },
    { name: 'Nisha Thomas', job: 'J1', via: 'REFERRAL:aditya', exp: 5, company: 'Zeta', desig: 'Backend Engineer', loc: 'Bengaluru', ctc: 2200000, expected: 2700000, notice: 30, skills: 'Node.js, TypeScript, PostgreSQL, Docker', qual: 'B.Tech CSE, CET Trivandrum', daysAgo: 9, flow: ['shortlist', 'hr', 'upcoming:2:1530'] },
    { name: 'Mohit Arora', job: 'J1', via: 'LINKEDIN', exp: 5.5, company: 'PhonePe', desig: 'Software Engineer III', loc: 'Bengaluru', ctc: 2500000, expected: 3000000, notice: 60, skills: 'Node.js, Go, PostgreSQL, AWS', qual: 'B.Tech, DTU', daysAgo: 22, flow: ['shortlist', 'hr', 'int1'] },
    { name: 'Deepak Choudhary', job: 'J1', via: 'NAUKRI', exp: 6, company: 'Ola', desig: 'SDE III', loc: 'Bengaluru', ctc: 2400000, expected: 2900000, notice: 45, skills: 'Node.js, TypeScript, System design, AWS', qual: 'B.E., BITS Pilani', daysAgo: 26, flow: ['shortlist', 'hr', 'int1', 'int2', 'recommend', 'select'], offerCtc: 2850000, joinIn: 45 },
    { name: 'Kunal Bhatia', job: 'J1', via: 'LINKEDIN', exp: 7, company: 'Flipkart', desig: 'SDE III', loc: 'Bengaluru', ctc: 2600000, expected: 3000000, notice: 30, skills: 'Node.js, TypeScript, PostgreSQL, AWS, System design', qual: 'B.Tech, IIT Roorkee', daysAgo: 30, flow: ['shortlist', 'hr', 'int1', 'int2', 'recommend', 'select', 'offer', 'approve', 'send'], offerCtc: 2950000, joinIn: 32 },
    { name: 'Sameer Khan', job: 'J1', via: 'NAUKRI', exp: 6.5, company: 'Paytm', desig: 'Senior Software Engineer', loc: 'Noida', ctc: 2500000, expected: 3300000, notice: 60, skills: 'Node.js, MongoDB, PostgreSQL, AWS', qual: 'B.Tech, JIIT', daysAgo: 33, flow: ['shortlist', 'hr', 'int1', 'int2', 'select', 'offer', 'approve', 'send', 'negotiate'], offerCtc: 2900000, joinIn: 50 },
    { name: 'Harsh Vardhan', job: 'J1', via: 'CAREERS_PAGE', exp: 5, company: 'Juspay', desig: 'Software Engineer', loc: 'Bengaluru', ctc: 2000000, expected: 2600000, notice: 30, skills: 'Node.js, TypeScript, Haskell, PostgreSQL', qual: 'B.Tech, NIT Surathkal', daysAgo: 40, flow: ['shortlist', 'hr', 'int1', 'int2', 'recommend', 'select', 'offer', 'approve', 'send', 'accept', 'docs-all', 'confirm'], offerCtc: 2600000, joinIn: 8 },
    { name: 'Arvind Pillai', job: 'J1', via: 'LINKEDIN', exp: 4, company: 'TCS', desig: 'IT Analyst', loc: 'Kochi', ctc: 1200000, expected: 2000000, notice: 90, skills: 'Java, Spring, Oracle', qual: 'B.Tech, MG University', daysAgo: 24, flow: ['shortlist', 'hr', 'int1-nohire', 'reject:Did not clear the technical round — gaps in system design and SQL tuning'] },
    { name: 'Komal Batra', job: 'J1', via: 'NAUKRI', exp: 5, company: 'Nagarro', desig: 'Senior Engineer', loc: 'Gurugram', ctc: 1800000, expected: 2400000, notice: 60, skills: 'Node.js, React, AWS', qual: 'B.Tech, GGSIPU', daysAgo: 16, flow: ['shortlist', 'hr-withdraw'] },
    // J2 Inside Sales Executive
    { name: 'Rohit Pawar', job: 'J2', via: 'INDEED', exp: 2, company: 'Byju\'s', desig: 'Business Development Associate', loc: 'Mumbai', ctc: 550000, expected: 750000, notice: 30, skills: 'Inside sales, Cold calling, CRM', qual: 'BBA, Mumbai University', daysAgo: 6, flow: [] },
    { name: 'Sana Shaikh', job: 'J2', via: 'NAUKRI', exp: 1.5, company: 'Justdial', desig: 'Sales Executive', loc: 'Mumbai', ctc: 420000, expected: 600000, notice: 15, skills: 'Telesales, Lead generation', qual: 'B.Com, Mumbai University', daysAgo: 10, flow: ['hold'] },
    { name: 'Akash More', job: 'J2', via: 'REFERRAL:farhan', exp: 3, company: 'IndiaMART', desig: 'Senior Sales Executive', loc: 'Thane', ctc: 650000, expected: 850000, notice: 30, skills: 'B2B SaaS sales, CRM, Negotiation', qual: 'MBA Marketing, Welingkar', daysAgo: 7, flow: ['shortlist'] },
    { name: 'Prachi Jadhav', job: 'J2', via: 'LINKEDIN', exp: 3.5, company: 'Zoho', desig: 'Inside Sales Executive', loc: 'Mumbai', ctc: 700000, expected: 900000, notice: 30, skills: 'B2B SaaS sales, CRM, Negotiation, Demos', qual: 'MBA, NMIMS', daysAgo: 20, flow: ['shortlist', 'hr', 'int1', 'int2', 'select', 'offer'], offerCtc: 880000, joinIn: 25 },
    { name: 'Yash Thakur', job: 'J2', via: 'NAUKRI', exp: 2.5, company: 'LeadSquared', desig: 'Sales Development Rep', loc: 'Mumbai', ctc: 600000, expected: 800000, notice: 30, skills: 'B2B SaaS sales, Cold calling, CRM', qual: 'BMS, Mumbai University', daysAgo: 26, flow: ['shortlist', 'hr', 'int1', 'select', 'offer', 'approve', 'send', 'accept-hr'], offerCtc: 780000, joinIn: 28 },
    { name: 'Ankita Rane', job: 'J2', via: 'LINKEDIN', exp: 3, company: 'Freshworks', desig: 'Account Executive', loc: 'Navi Mumbai', ctc: 680000, expected: 880000, notice: 30, skills: 'B2B SaaS sales, CRM, Negotiation', qual: 'MBA, SIMSR', daysAgo: 29, flow: ['shortlist', 'hr', 'int1', 'int2', 'select', 'offer', 'approve', 'send', 'accept', 'docs-some'], offerCtc: 860000, joinIn: 18 },
    { name: 'Pranav Kulkarni', job: 'J2', via: 'NAUKRI', exp: 2, company: 'Practo', desig: 'Inside Sales Associate', loc: 'Mumbai', ctc: 520000, expected: 720000, notice: 30, skills: 'Inside sales, CRM, Communication', qual: 'B.Com, Pune University', daysAgo: 31, flow: ['shortlist', 'hr', 'int1', 'select', 'offer', 'approve', 'send', 'accept', 'docs-all'], offerCtc: 720000, joinIn: 22 },
    { name: 'Vivek Shetty', job: 'J2', via: 'INDEED', exp: 4, company: 'Salesforce', desig: 'SDR', loc: 'Mumbai', ctc: 900000, expected: 1100000, notice: 60, skills: 'B2B SaaS sales, Salesforce, Negotiation', qual: 'MBA, KJ Somaiya', daysAgo: 35, flow: ['shortlist', 'hr', 'int1', 'select', 'offer', 'approve', 'send', 'decline'], offerCtc: 980000, joinIn: 40 },
    // J3 Associate Software Engineer (filled)
    { name: 'Neeraj Goyal', job: 'J3', via: 'INTERNSHALA', exp: 0, company: '—', desig: 'Fresher', loc: 'Jaipur', ctc: 0, expected: 500000, notice: 0, skills: 'C++, HTML', qual: 'BCA, Rajasthan University', daysAgo: 70, flow: ['reject-screen'] },
    { name: 'Tanvi Shah', email: `tanvi${DOMAIN}`, job: 'J3', via: 'LINKEDIN', exp: 1, company: 'Tata Elxsi (intern)', desig: 'Software Engineering Intern', loc: 'Bengaluru', ctc: 300000, expected: 700000, notice: 0, skills: 'JavaScript, React, Node.js, SQL', qual: 'B.E. CSE, RV College of Engineering', daysAgo: 60, flow: ['shortlist', 'hr', 'int1', 'int2', 'recommend', 'select', 'offer', 'approve', 'send', 'accept', 'docs-all', 'confirm', 'join'], offerCtc: 720000, joinIn: 1 },
    // J4 Customer Success Associate (put on hold at the end)
    { name: 'Fatima Sheikh', job: 'J4', via: 'INTERNSHALA', exp: 0.5, company: 'Teleperformance', desig: 'Customer Care Executive', loc: 'Bengaluru', ctc: 300000, expected: 420000, notice: 15, skills: 'Customer support, Communication', qual: 'B.A., Mount Carmel College', daysAgo: 5, flow: [] },
    { name: 'Joseph Mathew', job: 'J4', via: 'INDEED', exp: 2, company: 'Zendesk', desig: 'Support Associate', loc: 'Bengaluru', ctc: 380000, expected: 500000, notice: 30, skills: 'Customer support, Zendesk, SaaS', qual: 'B.Com, Christ University', daysAgo: 14, flow: ['shortlist'] },
    { name: 'Bhavna Rao', job: 'J4', via: 'INDEED', exp: 1, company: 'Concentrix', desig: 'Customer Support Executive', loc: 'Mysuru', ctc: 320000, expected: 450000, notice: 30, skills: 'Customer support, Communication', qual: 'B.Sc, University of Mysore', daysAgo: 12, flow: ['hold'] },
    { name: 'Lokesh Gowda', job: 'J4', via: 'REFERRAL:harish', exp: 1.5, company: 'Infosys BPM', desig: 'Process Executive', loc: 'Bengaluru', ctc: 340000, expected: 460000, notice: 30, skills: 'Customer support, Zendesk, Communication', qual: 'B.Com, Bangalore University', daysAgo: 4, flow: [] },
  ];

  let phoneSeq = 0;
  for (const c of cands) {
    phoneSeq++;
    const first = c.name.split(' ')[0]!.toLowerCase();
    const last = c.name.split(' ').slice(1).join('').toLowerCase();
    const email = c.email ?? `${first}.${last}@example.com`;
    const resume = await pdfFile(`${c.name.replace(/\s+/g, '_')}_Resume.pdf`, `${c.name} — Résumé`, [
      `${c.desig} at ${c.company} · ${c.exp} years of experience · ${c.loc}`,
      `Email: ${email} · Phone: +91 9${String(810000000 + phoneSeq * 7919).slice(0, 9)}`,
      `Skills: ${c.skills}`, `Education: ${c.qual}`,
      'Highlights: shipped customer-facing features end to end, mentored juniors, strong ownership.',
    ]);
    const base = {
      name: c.name, email, phone: `+91 9${String(810000000 + phoneSeq * 7919).slice(0, 9)}`, currentCompany: c.company,
      currentDesignation: c.desig, currentLocation: c.loc, currentCtc: c.ctc, expectedCtc: c.expected, noticePeriodDays: c.notice,
      experienceYears: c.exp, qualifications: c.qual, skills: c.skills,
    };
    let appId: string;
    if (c.via.startsWith('REFERRAL:')) {
      const by = c.via.split(':')[1]!;
      const res = await recruitmentService.refer(C, e(by).id, { jobId: JOBS[c.job]!.id, ...base, notes: `Referred by ${e(by).name}` }, resume);
      appId = res.application!.id;
    } else {
      const res = await candidateService.intake(C, {
        ...base, source: c.via === 'CAREERS_PAGE' ? 'CAREERS' : c.via, jobId: JOBS[c.job]!.id, postingId: JOBS[c.job]!.postings[c.via],
        externalRef: c.via === 'CAREERS_PAGE' ? '' : `${c.via.slice(0, 2)}-${digits(7)}`,
      }, { file: resume, actorId: e('rohan').id });
      appId = res.application!.id;
    }
    await prisma.application.update({ where: { id: appId }, data: { assignedToId: e('rohan').id } });
    APPS.set(c.name, appId);
    await runFlow(c, appId, hr, admin);
    await spreadHistory(c, appId);
  }
  await recruitmentService.setJobStatus(C, JOBS.J4!.id, 'ON_HOLD');
}

const interviewLog = new Map<string, string[]>(); // applicationId → completed interview ids (in order)

async function completedInterview(appId: string, round: string, type: string, panel: string[], rec: string, rating: number, text: string) {
  const hr = actor('kavya');
  const iv = await interviewService.scheduleInterview(C, hr, {
    applicationId: appId, round, interviewType: type, scheduledAt: new Date(Date.now() + 60_000), durationMinutes: 60, mode: type === 'TECHNICAL' ? 'VIDEO' : 'ONSITE',
    location: type === 'TECHNICAL' ? 'https://meet.google.com/nim-tech-room' : 'Bengaluru HQ — Meeting room "Cirrus"', panelIds: panel.map((k) => e(k).id),
  });
  for (const k of panel) {
    await interviewService.submitFeedback(C, iv.id, hr, { rating: Math.max(1, Math.min(5, rating + ri(-1, 0))), recommendation: rec, feedback: text, interviewerId: e(k).id });
  }
  interviewLog.set(appId, [...(interviewLog.get(appId) ?? []), iv.id]);
}

async function runFlow(c: CandSpec, appId: string, hr: { role: Role; employeeId: string }, admin: { role: Role; employeeId: string }) {
  const job = JOBS[c.job]!;
  const joinDate = () => nextWorkday(addD(TODAY, c.joinIn ?? 30));
  let offerId = '';
  for (const step of c.flow) {
    const [name, a1, a2] = step.split(':');
    switch (name) {
      case 'shortlist':
        await recruitmentService.screen(C, appId, hr, { decision: 'SHORTLISTED', notes: 'Relevant experience; good match on core skills', rating: ri(3, 5) });
        break;
      case 'hold':
        await recruitmentService.screen(C, appId, hr, { decision: 'ON_HOLD', notes: 'Good profile — revisit once the current round closes', rating: 3 });
        break;
      case 'reject-screen':
        await recruitmentService.screen(C, appId, hr, { decision: 'REJECTED', rejectionReason: 'Experience and skills below the requirement for this role' });
        break;
      case 'hr':
      case 'hr-withdraw':
        await recruitmentService.hrScreening(C, appId, hr, {
          experienceVerified: true, experienceYears: c.exp, currentCtc: c.ctc, expectedCtc: c.expected, noticePeriodDays: c.notice,
          availableFrom: addD(TODAY, c.notice), interested: name === 'hr',
          notes: name === 'hr' ? 'Comfortable with hybrid (3 days in office). Notice negotiable.' : 'Has accepted another offer — not interested in proceeding.',
        });
        break;
      case 'int1':
        await completedInterview(appId, 'Technical round 1', 'TECHNICAL', [job.hm, job.tech], 'HIRE', 4, 'Solid fundamentals and clear communication; good problem-solving under time pressure.');
        break;
      case 'int1-nohire':
        await completedInterview(appId, 'Technical round 1', 'TECHNICAL', [job.hm, job.tech], 'NO_HIRE', 2, 'Struggled with the design exercise; SQL basics were shaky.');
        break;
      case 'int2':
        await completedInterview(appId, 'Managerial + HR round', 'MANAGERIAL', [job.hm, 'kavya'], 'STRONG_HIRE', 5, 'Great ownership mindset and culture fit; aligned on role expectations.');
        break;
      case 'upcoming': {
        const day = nextWorkday(addD(TODAY, Number(a1)));
        const hhmm = `${a2!.slice(0, 2)}:${a2!.slice(2)}`;
        await interviewService.scheduleInterview(C, hr, {
          applicationId: appId, round: (interviewLog.get(appId)?.length ?? 0) > 0 ? 'Technical round 2 (system design)' : 'Technical round 1',
          interviewType: 'TECHNICAL', scheduledAt: at(day, hhmm), durationMinutes: 60, mode: 'VIDEO', location: 'https://meet.google.com/nim-tech-room',
          panelIds: [e(job.hm).id, e(job.tech).id],
        });
        break;
      }
      case 'recommend':
        await recruitmentService.recommend(C, appId, actor(job.hm), 'Strong panel feedback — recommend we hire.');
        break;
      case 'select':
        await recruitmentService.select(C, appId, hr, { proposedCtc: c.offerCtc!, proposedJoiningDate: joinDate(), note: 'Selected after panel review' });
        break;
      case 'offer': {
        const { offer } = await offerService.createOffer(C, hr, {
          applicationId: appId, designation: job.desig, department: job.dept, ctcAnnual: c.offerCtc!, joiningDate: joinDate(),
          workLocation: c.job === 'J2' ? 'Mumbai Office (BKC)' : 'Bengaluru HQ', probationMonths: 6, noticePeriodDays: 30,
          terms: 'Hybrid: 3 days a week in office. Joining bonus clawback applies if you leave within 12 months.', validUntil: addD(TODAY, 10),
        });
        offerId = offer.id;
        await offerService.submitOffer(C, offerId, hr);
        break;
      }
      case 'approve':
        await offerService.decideOffer(C, offerId, admin, 'APPROVED', 'Within the approved budget');
        break;
      case 'send':
        await offerService.sendOffer(C, offerId, hr);
        break;
      case 'negotiate':
        await offerService.respond(C, offerId, { response: 'NEGOTIATE', counterCtc: c.expected, note: 'I have a competing offer at a higher fixed pay — can we revisit the CTC?' }, { via: 'PORTAL', actorId: null });
        break;
      case 'decline':
        await offerService.respond(C, offerId, { response: 'DECLINE', reason: 'Accepted a counter-offer from my current employer' }, { via: 'PORTAL', actorId: null });
        break;
      case 'accept':
        await offerService.respond(C, offerId, { response: 'ACCEPT' }, { via: 'PORTAL', actorId: null });
        break;
      case 'accept-hr': {
        // Acceptance recorded; pre-joining not initiated yet (normally automatic — shown as the OFFER_ACCEPTED stage).
        await prisma.offer.update({ where: { id: offerId }, data: { status: 'ACCEPTED', respondedAt: new Date(), acceptedVia: 'HR_RECORDED' } });
        const app = await prisma.application.findUniqueOrThrow({ where: { id: appId } });
        await prisma.application.update({ where: { id: appId }, data: { stage: 'OFFER_ACCEPTED' } });
        await prisma.applicationStageHistory.create({
          data: { companyId: C, applicationId: appId, fromStage: app.stage, toStage: 'OFFER_ACCEPTED', note: 'Acceptance recorded by HR (verbal + email)', actorId: hr.employeeId },
        });
        break;
      }
      case 'docs-some':
      case 'docs-all': {
        const po = await prisma.preOnboarding.findUniqueOrThrow({ where: { applicationId: appId }, include: { documents: true } });
        const required = po.documents.filter((d) => d.required);
        const list = name === 'docs-all' ? required : required.filter((d) => d.type === 'PAN' || d.type === 'AADHAAR' || d.type === 'PHOTO');
        for (const d of list) {
          const isPhoto = d.type === 'PHOTO';
          const file = isPhoto
            ? fileOf(`${c.name.split(' ')[0]}_photo.png`, cardPng([96, 165, 250]), 'image/png')
            : await pdfFile(`${d.type.toLowerCase()}_${c.name.split(' ')[0]}.pdf`, d.name, [`Candidate: ${c.name}`, 'Self-attested copy uploaded through the candidate portal.']);
          await preOnboardingService.uploadDocument(C, po.id, d.id, file, { actorId: null, via: 'PORTAL' });
          if (name === 'docs-all' || d.type === 'PAN') {
            await preOnboardingService.verifyDocument(C, po.id, d.id, hr, { decision: 'VERIFIED', remarks: 'Matches original' });
          }
        }
        await preOnboardingService.update(C, po.id, hr, {
          bgvRequired: true, bgvStatus: name === 'docs-all' ? 'CLEAR' : 'IN_PROGRESS', bgvVendor: 'AuthBridge',
          bgvNotes: name === 'docs-all' ? 'Employment + education verified' : 'Employment verification with previous employer in progress',
        });
        break;
      }
      case 'confirm': {
        const po = await prisma.preOnboarding.findUniqueOrThrow({ where: { applicationId: appId } });
        const date = c.name === 'Tanvi Shah' ? tanviJoin : nextMonday();
        await preOnboardingService.confirmJoining(C, po.id, hr, date);
        break;
      }
      case 'join': {
        const po = await prisma.preOnboarding.findUniqueOrThrow({ where: { applicationId: appId } });
        const res = await preOnboardingService.join(C, po.id, hr, {
          joiningDate: tanviJoin, role: 'EMPLOYEE', managerId: e('vikram').id, departmentId: ids.dept.get('Engineering'),
          designationId: ids.desig.get('Associate Software Engineer'), gradeId: ids.grade.get('G2'), officeId: ids.office.BLR.id, shiftId: ids.shift.GEN.id,
          assetIds: [ASSET_IDS.get('NIM-LT-101')!, ASSET_IDS.get('NIM-ID-101')!],
        }, reqOf('kavya'));
        const user = await prisma.user.findUniqueOrThrow({ where: { email: `tanvi${DOMAIN}` } });
        E.set('tanvi', {
          key: 'tanvi', id: res.employee.id, userId: user.id, name: TANVI.name, role: 'EMPLOYEE', managerKey: 'vikram', joining: tanviJoin,
          office: 'BLR', dept: 'Engineering', shift: 'GEN', gender: 'FEMALE', leaving: null,
        });
        await prisma.employee.update({
          where: { id: res.employee.id },
          data: encryptEmployeeSecrets({
            dateOfBirth: ymd(2003, 2, 17), gender: 'FEMALE', bloodGroup: 'A+', maritalStatus: 'Single', personalEmail: 'tanvi.shah@example.com',
            address: 'PG — 22, 4th Cross, Jayanagar 4th Block, Bengaluru, Karnataka 560011', emergencyContact: 'Parent — +91 98450 33112',
            bankName: 'HDFC Bank', accountNumber: `5010${digits(10)}`, ifsc: `HDFC0${digits(6)}`, pan: `${letter()}${letter()}${letter()}PS${ri(1000, 9999)}${letter()}`,
            aadhaarNumber: `${ri(2, 9)}${digits(11)}`, uan: `10${digits(10)}`, fatherName: 'Hemant Shah', avatarColor: '#EC4899',
          }),
        });
        await prisma.offer.update({ where: { id: offerId }, data: { joiningDate: tanviJoin } });
        await prisma.application.update({ where: { id: appId }, data: { proposedJoiningDate: tanviJoin } });
        await prisma.preOnboarding.update({ where: { id: po.id }, data: { expectedJoiningDate: tanviJoin, confirmedJoiningDate: tanviJoin, joinedAt: at(tanviJoin, '09:45') } });
        await prisma.assetAssignment.updateMany({ where: { companyId: C, employeeId: res.employee.id }, data: { issuedOn: at(tanviJoin, '10:00') } });
        await prisma.onboardingCase.updateMany({ where: { companyId: C, employeeId: res.employee.id }, data: { startedOn: tanviJoin } });
        break;
      }
      case 'reject':
        await recruitmentService.moveStage(C, appId, hr, { stage: 'REJECTED', reason: a1 });
        break;
      default:
        throw new Error(`unknown recruitment step ${step}`);
    }
  }
}

/** Spreads an application's stage history (and the related timestamps) between `daysAgo` and now. */
async function spreadHistory(c: CandSpec, appId: string) {
  const start = pastInstant(ago(c.daysAgo), '10:20');
  const end = c.name === 'Tanvi Shah' ? at(tanviJoin, '09:50') : new Date(NOW.getTime() - 2 * 3600_000);
  const rows = await prisma.applicationStageHistory.findMany({ where: { applicationId: appId }, orderBy: { createdAt: 'asc' } });
  const step = rows.length > 1 ? (end.getTime() - start.getTime()) / (rows.length - 1) : 0;
  const when = new Map<string, Date>();
  for (const [i, r] of rows.entries()) {
    const t = new Date(start.getTime() + i * step);
    await prisma.applicationStageHistory.update({ where: { id: r.id }, data: { createdAt: t } });
    when.set(r.toStage, when.get(r.toStage) ?? t);
    if (r.toStage === 'INTERVIEW_COMPLETED') {
      const done = interviewLog.get(appId) ?? [];
      const k = rows.slice(0, i + 1).filter((x) => x.toStage === 'INTERVIEW_COMPLETED').length - 1;
      const ivId = done[k];
      if (ivId) {
        const ivAt = new Date(t.getTime() - 3 * 3600_000);
        await prisma.interview.update({ where: { id: ivId }, data: { scheduledAt: ivAt } });
        await prisma.interviewFeedback.updateMany({ where: { interviewId: ivId }, data: { submittedAt: new Date(ivAt.getTime() + 90 * 60_000) } });
      }
    }
  }
  await prisma.application.update({ where: { id: appId }, data: { appliedOn: start } });
  const app = await prisma.application.findUniqueOrThrow({ where: { id: appId }, select: { candidateId: true } });
  await prisma.candidate.update({ where: { id: app.candidateId }, data: { createdAt: start } });
  const offer = await prisma.offer.findUnique({ where: { applicationId: appId } });
  if (offer) {
    const sel = when.get('SELECTED') ?? start;
    const sent = when.get('OFFERED');
    const resp = when.get('PRE_ONBOARDING') ?? when.get('OFFER_DECLINED') ?? when.get('OFFER_ACCEPTED');
    await prisma.offer.update({
      where: { id: offer.id },
      data: {
        createdAt: sel, ...(offer.approvedAt ? { approvedAt: sent ?? sel } : {}), ...(offer.sentAt && sent ? { sentAt: sent } : {}),
        ...(offer.respondedAt && resp ? { respondedAt: resp } : {}),
      },
    });
    await backdateSteps('OFFER', offer.id, sel, 4);
  }
}

// ---------------------------------------------------------------------------
// 6. Attendance (+ regularization, overtime, comp-off)
// ---------------------------------------------------------------------------

const attStatus = new Map<string, AttendanceStatus>(); // empId|iso → status
interface Override { kind: 'WORK' | 'MISSED_OUT' | 'ABSENT'; inOff?: number; stay?: number; note?: string }
const overrides = new Map<string, Override>();
const ovKey = (k: string, d: Date) => `${e(k).id}|${iso(d)}`;

async function seedAttendance() {
  const windowStart = M(3);
  const leaves = await prisma.leaveRequest.findMany({ where: { companyId: C, status: 'APPROVED' }, include: { leaveType: true } });
  const onLeave = new Map<string, { code: string; half: boolean }>();
  for (const l of leaves) {
    for (let d = l.fromDate; d <= l.toDate; d = addD(d, 1)) onLeave.set(`${l.employeeId}|${iso(d)}`, { code: l.leaveType.code, half: l.halfDay });
  }
  /** A working day near `daysAgo` with no leave / override for the employee. */
  const freeDay = (k: string, daysAgo: number): Date => {
    let d = prevWorkday(ago(daysAgo));
    while (onLeave.has(`${e(k).id}|${iso(d)}`) || overrides.has(ovKey(k, d)) || d < e(k).joining) d = prevWorkday(addD(d, -1));
    return d;
  };
  const lastSaturday = (minAgo: number) => {
    let d = ago(minAgo);
    while (d.getUTCDay() !== 6) d = addD(d, -1);
    return d;
  };
  const recentHoliday = (() => {
    let d = ago(3);
    while (!(HOLIDAY_SET.has(iso(d)) && !isWeekend(d))) d = addD(d, -1);
    return d;
  })();

  // Special days used by the request flows below.
  const plan = {
    otRahulAug: freeDay('rahul', Math.round((TODAY.getTime() - addD(M(2), 20).getTime()) / DAY)),
    otRajeshSep: freeDay('rajesh', Math.round((TODAY.getTime() - addD(M(1), 16).getTime()) / DAY)),
    otRahulPending: freeDay('rahul', 6),
    otManishRejected: freeDay('manish', 12),
    regPriya: freeDay('priya', 7),
    regFarhan: freeDay('farhan', 4),
    regKarthik: freeDay('karthik', 24),
    regManish: freeDay('manish', 9),
    woRahul: lastSaturday(17),
    woAditya: lastSaturday(1),
    woRajesh: recentHoliday,
  };
  overrides.set(ovKey('rahul', plan.otRahulAug), { kind: 'WORK', inOff: -5, stay: 760, note: 'Production DB migration window' });
  overrides.set(ovKey('rajesh', plan.otRajeshSep), { kind: 'WORK', inOff: 0, stay: 750, note: 'P1 incident — Acme checkout outage' });
  overrides.set(ovKey('rahul', plan.otRahulPending), { kind: 'WORK', inOff: 0, stay: 705, note: 'Kubernetes upgrade' });
  overrides.set(ovKey('manish', plan.otManishRejected), { kind: 'WORK', inOff: 0, stay: 630 });
  overrides.set(ovKey('priya', plan.regPriya), { kind: 'MISSED_OUT' });
  overrides.set(ovKey('farhan', plan.regFarhan), { kind: 'ABSENT' });
  overrides.set(ovKey('karthik', plan.regKarthik), { kind: 'ABSENT' });
  overrides.set(ovKey('manish', plan.regManish), { kind: 'ABSENT' });
  overrides.set(ovKey('rahul', plan.woRahul), { kind: 'WORK', inOff: 60, stay: 420, note: 'Weekend release support' });
  overrides.set(ovKey('aditya', plan.woAditya), { kind: 'WORK', inOff: 30, stay: 400, note: 'Release v4.2 go-live' });
  overrides.set(ovKey('rajesh', plan.woRajesh), { kind: 'WORK', inOff: 0, stay: 540, note: 'Holiday support coverage' });

  const rows: Prisma.AttendanceRecordCreateManyInput[] = [];
  for (const emp of E.values()) {
    const shift = ids.shift[emp.shift];
    const office = ids.office[emp.office];
    const from = emp.joining > windowStart ? emp.joining : windowStart;
    const to = emp.leaving ?? TODAY;
    for (let d = from; d <= to; d = addD(d, 1)) {
      const key = `${emp.id}|${iso(d)}`;
      const start = at(d, shift.start);
      const ov = overrides.get(key);
      const leave = onLeave.get(key);
      const isToday = d.getTime() === TODAY.getTime();
      const geo = () => {
        const lat = office.lat + (rnd() - 0.5) * 0.0024;
        const lng = office.lng + (rnd() - 0.5) * 0.0024;
        return { lat, lng, dist: Math.round(distanceMeters(lat, lng, office.lat, office.lng)) };
      };
      const punched = (inOff: number, stay: number | null, status: AttendanceStatus, extra: Partial<Prisma.AttendanceRecordCreateManyInput> = {}) => {
        const checkIn = new Date(start.getTime() + inOff * 60_000);
        const checkOut = stay === null ? null : new Date(checkIn.getTime() + stay * 60_000);
        const worked = stay === null ? null : stay >= 300 ? stay - 60 : stay;
        const g1 = geo();
        const g2 = geo();
        rows.push({
          companyId: C, employeeId: emp.id, date: d, status, checkIn, checkOut, shiftId: shift.id,
          checkInLat: g1.lat, checkInLng: g1.lng, checkInDistance: g1.dist,
          checkOutLat: checkOut ? g2.lat : null, checkOutLng: checkOut ? g2.lng : null, checkOutDistance: checkOut ? g2.dist : null,
          workedMinutes: worked, lateMinutes: inOff > 10 && status === 'LATE' ? inOff : 0,
          overtimeMinutes: worked !== null ? (isWorkday(d) ? Math.max(0, worked - 480) : worked) : 0, ...extra,
        });
        attStatus.set(key, status);
      };
      const auto = (status: AttendanceStatus, note: string | null = null) => {
        rows.push({ companyId: C, employeeId: emp.id, date: d, status, note, shiftId: shift.id, isAutoMarked: true });
        attStatus.set(key, status);
      };
      if (ov) {
        if (ov.kind === 'WORK') punched(ov.inOff ?? 0, ov.stay ?? 540, 'PRESENT', { note: ov.note ?? null });
        else if (ov.kind === 'ABSENT') auto('ABSENT');
        else punched(ri(-10, 5), null, 'HALF_DAY', { isAutoMarked: true, note: 'Missed check-out' });
        continue;
      }
      if (isToday) {
        if (leave) auto('LEAVE', leave.code);
        else if (isWorkday(d) && NOW.getTime() > start.getTime() + 25 * 60_000 && rnd() < 0.85) {
          const late = rnd() < 0.15;
          const inOff = Math.min(late ? ri(12, 45) : ri(-15, 8), Math.floor((NOW.getTime() - start.getTime()) / 60_000) - 5);
          const stay = ri(545, 590);
          const done = NOW.getTime() > start.getTime() + (inOff + stay) * 60_000;
          punched(inOff, done ? stay : null, late && inOff > 10 ? 'LATE' : 'PRESENT', done ? {} : { workedMinutes: null, overtimeMinutes: 0 });
        }
        continue;
      }
      if (HOLIDAY_SET.has(iso(d))) { auto('HOLIDAY', HOLIDAYS.find((h) => iso(ymd(Y, h[1], h[2])) === iso(d))?.[0] ?? null); continue; }
      if (isWeekend(d)) { auto('WEEKEND'); continue; }
      if (leave) {
        if (leave.half) punched(ri(-10, 5), ri(300, 320), 'HALF_DAY', { note: `${leave.code} half-day leave` });
        else auto('LEAVE', leave.code);
        continue;
      }
      const r = rnd();
      if (r < 0.025) auto('ABSENT');
      else if (r < 0.05) punched(ri(-10, 8), ri(300, 330), 'HALF_DAY');
      else if (r < 0.17) punched(ri(12, 55), ri(545, 590), 'LATE');
      else punched(ri(-18, 9), ri(542, 600) + (rnd() < 0.06 ? ri(90, 200) : 0), 'PRESENT');
    }
  }
  for (let i = 0; i < rows.length; i += 1000) await prisma.attendanceRecord.createMany({ data: rows.slice(i, i + 1000) });

  // ---- Regularizations ----
  const reg = async (k: string, d: Date, reason: string, note: string, decision?: 'APPROVED' | 'REJECTED', remarks?: string) => {
    const r = await attendanceService.requestRegularization(C, e(k).id, { date: d, reason, note });
    if (decision) await attendanceService.decideRegularization(C, r.id, { decision, remarks, actor: actor(mgrOf(k)) });
    const t = pastInstant(addD(d, 1), '10:05');
    await prisma.regularizationRequest.update({ where: { id: r.id }, data: { appliedOn: t } });
    await backdateSteps('REGULARIZATION', r.id, t, 26);
  };
  await reg('priya', plan.regPriya, 'Forgot to check out', 'Left at 7:10 PM after the sprint review — app crashed while checking out.');
  await reg('farhan', plan.regFarhan, 'Client visit', 'Full day at Godrej One, Vikhroli for the renewal meeting — no office punch.');
  await reg('karthik', plan.regKarthik, 'Work from client site', 'At Acme Retail office, Whitefield for UAT.', 'APPROVED', 'Confirmed with the Acme PM');
  await reg('manish', plan.regManish, 'Client visit', 'Field visits in Andheri.', 'REJECTED', 'No visits logged in the CRM for this date — please apply leave');

  // ---- Overtime ----
  const ot = async (k: string, d: Date, minutes: number, reason: string, decision?: 'APPROVED' | 'REJECTED', remarks?: string) => {
    const r = await overtimeService.createRequest(C, e(k).id, { date: d, minutes, reason });
    if (decision) await overtimeService.decideRequest(C, r.id, { decision, remarks, actor: { ...actor(mgrOf(k)), userId: e(mgrOf(k)).userId } });
    const t = pastInstant(addD(d, 1), '09:40');
    await prisma.overtimeRequest.update({ where: { id: r.id }, data: { appliedOn: t } });
    await backdateSteps('OVERTIME', r.id, t);
  };
  await ot('rahul', plan.otRahulAug, 220, 'Production DB migration (planned maintenance window)', 'APPROVED', 'Thanks for staying back');
  await ot('rajesh', plan.otRajeshSep, 210, 'P1 incident — Acme checkout outage', 'APPROVED', 'Approved');
  await ot('rahul', plan.otRahulPending, 165, 'Kubernetes cluster upgrade went past shift end');
  await ot('manish', plan.otManishRejected, 90, 'Prospect follow-up calls', 'REJECTED', 'Calls should fit in regular hours — not overtime');

  // ---- Comp-off ----
  const co = async (k: string, d: Date, reason: string, decision?: 'APPROVED') => {
    const r = await compOffService.requestCompOff(C, e(k).id, { workDate: d, days: 1, reason });
    if (decision) await compOffService.decideCompOff(C, r.id, { decision, remarks: 'Approved — credited', actor: actor(mgrOf(k)) });
    const t = pastInstant(addD(d, 2), '10:00');
    await prisma.compOffRequest.update({ where: { id: r.id }, data: { appliedOn: t } });
    await backdateSteps('COMP_OFF', r.id, t);
  };
  await co('rahul', plan.woRahul, 'Worked Saturday for the release support window', 'APPROVED');
  await co('aditya', plan.woAditya, 'Worked Saturday for the v4.2 go-live');
  await co('rajesh', plan.woRajesh, `Covered support on ${iso(plan.woRajesh)} (holiday)`);
}

// ---------------------------------------------------------------------------
// 7. Timesheets
// ---------------------------------------------------------------------------

async function seedTimesheets() {
  const who: Record<string, string[]> = {
    aditya: ['BPI', 'NCP'], priya: ['ARM', 'NCP'], karthik: ['ARM', 'BPI'], rahul: ['DPR', 'NCP'], ishaan: ['ARM', 'BPI'], sneha: ['NCP', 'ARM'],
    tanvi: ['ARM', 'NCP'], ananya: ['ARM', 'NCP'], dev: ['NCP', 'ARM'], riya: ['ARM', 'NCP'], aman: ['ARM', 'NCP'],
  };
  const desc: Record<string, string[]> = {
    NCP: ['Platform API work', 'Code review & tech debt', 'Sprint planning'], ARM: ['Checkout revamp', 'Bug fixes from UAT', 'Release prep'],
    BPI: ['UPI autopay integration', 'Settlement reconciliation API'], DPR: ['Airflow DAG migration', 'Data quality checks'],
  };
  // Last 4 weeks of working days; everything before today is submitted, today stays a draft.
  for (let back = 27; back >= 0; back--) {
    const d = addD(TODAY, -back);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    for (const [k, projects] of Object.entries(who)) {
      const emp = e(k);
      if (d < emp.joining) continue;
      const st = attStatus.get(`${emp.id}|${iso(d)}`);
      if (back > 0 && st !== 'PRESENT' && st !== 'LATE' && st !== 'HALF_DAY') continue;
      const total = st === 'HALF_DAY' ? 4 : 8;
      const main = Math.min(total, ri(4, 6));
      const entries = [{ projectId: ids.project.get(projects[0]!)!, hours: main, description: pick(desc[projects[0]!]!) }];
      if (total - main > 0) entries.push({ projectId: ids.project.get(projects[1]!)!, hours: total - main, description: pick(desc[projects[1]!]!) });
      const day = await timesheetService.saveDay(C, emp.id, d, entries);
      if (back === 0 || !day.id) continue; // today stays DRAFT
      await timesheetService.submitDay(C, emp.id, day.id);
      await prisma.timesheetDay.update({ where: { id: day.id }, data: { submittedAt: pastInstant(d, '18:30') } });
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Money: tax declarations, loans, payroll inputs, expenses, travel, encashment
// ---------------------------------------------------------------------------

async function seedMoney() {
  const fy = taxService.currentFy();
  const hr = actor('kavya');
  // ---- Tax declarations ----
  const declare = async (k: string, regime: 'NEW' | 'OLD', items: taxService.DeclarationItem[]) => {
    await taxService.saveMine(C, e(k).id, { fy, regime, items, previousEmployerIncome: 0, previousEmployerTds: 0 }, reqOf(k));
    return prisma.taxDeclaration.findUniqueOrThrow({ where: { employeeId_fy: { employeeId: e(k).id, fy } } });
  };
  const adi = await declare('aditya', 'OLD', [
    { section: '80C', label: 'PPF contribution', declared: 150000 },
    { section: '80D', label: 'Health insurance — self & family', declared: 25000 },
    { section: 'HRA', label: 'House rent', declared: 0, rentPerMonth: 35000, months: 12, landlordName: 'Mr. K. Ramaiah', landlordPan: 'AKRPR4521M', landlordAddress: 'HSR Layout, Bengaluru', metro: true },
  ]);
  await taxService.addProof(C, adi.id, actor('aditya'), { section: '80C', name: 'PPF passbook FY26-27', file: await pdfFile('PPF_passbook_Aditya.pdf', 'PPF Account Statement', ['Account holder: Aditya Kulkarni', 'Deposit: Rs. 1,50,000 (April)', 'State Bank of India, Koramangala branch']) });
  await taxService.submitMine(C, e('aditya').id, fy, reqOf('aditya'));
  const proofs = await prisma.taxProof.findMany({ where: { declarationId: adi.id } });
  await taxService.verify(C, adi.id, { items: [], proofs: proofs.map((p) => ({ id: p.id, status: 'ACCEPTED' as const })), remarks: 'Verified against proofs' }, hr, reqOf('kavya'));
  await declare('priya', 'OLD', [
    { section: '80C', label: 'ELSS mutual funds', declared: 100000 },
    { section: '80CCD1B', label: 'NPS (Tier I)', declared: 50000 },
  ]);
  await taxService.submitMine(C, e('priya').id, fy, reqOf('priya'));
  await declare('vikram', 'OLD', [
    { section: '80C', label: 'Home loan principal + LIC', declared: 150000 },
    { section: '24B', label: 'Home loan interest', declared: 200000 },
    { section: '80D', label: 'Health insurance — parents (senior citizens)', declared: 50000, forParents: true, seniorCitizen: true },
  ]);
  await taxService.submitMine(C, e('vikram').id, fy, reqOf('vikram'));
  await declare('karthik', 'OLD', [{ section: '80C', label: 'LIC premium', declared: 60000 }]);
  const sur = await declare('suresh', 'OLD', [
    { section: 'HRA', label: 'House rent', declared: 0, rentPerMonth: 25000, months: 12, landlordName: 'Mrs. S. Lakshmi', landlordPan: 'BLMPL8812Q', metro: true },
  ]);
  await taxService.submitMine(C, e('suresh').id, fy, reqOf('suresh'));
  await taxService.reject(C, sur.id, 'Rent receipts for Apr–Sep are missing — please upload and resubmit', hr, reqOf('kavya'));

  // ---- Loans ----
  const farhanLoan = await loanService.apply(C, actor('farhan'), { type: 'LOAN', principal: 150000, tenureMonths: 12, reason: 'Home renovation before the wedding season' }, reqOf('farhan'));
  await loanService.decide(C, farhanLoan.id, { decision: 'APPROVED', remarks: 'Approved', actor: actor('neha') }, reqOf('neha'));
  await prisma.loan.update({ where: { id: farhanLoan.id }, data: { startMonth: M(3), appliedOn: pastInstant(addD(M(3), -12)) } });
  await backdateSteps('LOAN', farhanLoan.id, pastInstant(addD(M(3), -12)));
  const manishAdv = await loanService.apply(C, actor('manish'), { type: 'SALARY_ADVANCE', principal: 15000, tenureMonths: 1, reason: 'Two-wheeler repair after an accident' }, reqOf('manish'));
  await loanService.decide(C, manishAdv.id, { decision: 'APPROVED', remarks: 'Recover from next salary', actor: actor('neha') }, reqOf('neha'));
  await prisma.loan.update({ where: { id: manishAdv.id }, data: { startMonth: M(1), appliedOn: pastInstant(addD(M(1), -8)) } });
  await backdateSteps('LOAN', manishAdv.id, pastInstant(addD(M(1), -8)));
  const ishaanAdv = await loanService.apply(C, actor('ishaan'), { type: 'SALARY_ADVANCE', principal: 20000, tenureMonths: 2, reason: "Medical emergency — father's surgery" }, reqOf('ishaan'));
  await prisma.loan.update({ where: { id: ishaanAdv.id }, data: { appliedOn: pastInstant(ago(1)) } });
  await backdateSteps('LOAN', ishaanAdv.id, pastInstant(ago(1)));

  // ---- Payroll inputs (manual) ----
  const input = async (k: string, month: Date, type: 'BONUS' | 'INCENTIVE' | 'REIMBURSEMENT' | 'OTHER_EARNING' | 'DEDUCTION', label: string, amount: number, note = '') => {
    const taxable = type !== 'REIMBURSEMENT' && type !== 'DEDUCTION';
    await payrollInputService.create(C, { employeeId: e(k).id, month, type, label, amount, taxable, note }, e('kavya').id, reqOf('kavya'));
  };
  await input('farhan', M(3), 'INCENTIVE', 'Q1 sales incentive', 25000, '112% of quota');
  await input('pooja', M(3), 'INCENTIVE', 'Q1 sales incentive', 15000, '96% of quota');
  await input('manish', M(3), 'INCENTIVE', 'Q1 sales incentive', 8000);
  await input('priya', M(2), 'BONUS', 'Spot award — checkout revamp', 10000);
  await input('rajesh', M(2), 'OTHER_EARNING', 'Night shift allowance', 4500);
  await input('divya', M(2), 'OTHER_EARNING', 'Night shift allowance', 4500);
  await input('aditya', M(1), 'OTHER_EARNING', 'Referral bonus — successful hire', 25000);
  await input('neha', M(1), 'INCENTIVE', 'Q2 team target achievement', 40000);
  await input('rajesh', M(1), 'OTHER_EARNING', 'Night shift allowance', 4500);
  await input('divya', M(1), 'OTHER_EARNING', 'Night shift allowance', 4500);
  await input('ganesh', M(1), 'DEDUCTION', 'Canteen coupons (excess)', 650);
  for (const k of ['ganesh', 'sunita', 'harish', 'divya', 'rajesh', 'manish', 'lakshmi', 'rohan', 'shreya']) await input(k, M0, 'BONUS', 'Diwali bonus', k === 'sunita' ? 7000 : 10000);
  await input('rajesh', M0, 'OTHER_EARNING', 'Night shift allowance', 4500);
  await input('divya', M0, 'OTHER_EARNING', 'Night shift allowance', 4500);

  // ---- Travel ----
  const trip = async (k: string, t: travelService.TravelInput, decision?: 'APPROVED' | 'REJECTED', remarks?: string, applied = 2) => {
    const r = await travelService.applyTravel(C, e(k).id, t);
    if (decision) await travelService.decideRequest(C, r.id, { decision, remarks, actor: actor(mgrOf(k)) });
    const at0 = pastInstant(addD(minDate(t.departDate, TODAY), -applied), '12:00');
    await prisma.travelRequest.update({ where: { id: r.id }, data: { appliedOn: at0 } });
    await backdateSteps('TRAVEL', r.id, at0);
    return r;
  };
  const ahmDep = prevWorkday(addD(M(1), 9));
  const ahm = await trip('farhan', {
    purpose: 'Client meetings — Adani Digital & Torrent Power renewals', fromCity: 'Mumbai', toCity: 'Ahmedabad', departDate: ahmDep, returnDate: addD(ahmDep, 2),
    mode: 'TRAIN', estimatedCost: 15000, advanceAmount: 8000,
  }, 'APPROVED', 'Approved — keep receipts', 6);
  await trip('neha', {
    purpose: 'Nasscom SaaS Summit + partner meetings', fromCity: 'Mumbai', toCity: 'New Delhi', departDate: nextWorkday(addD(TODAY, 10)), returnDate: nextWorkday(addD(TODAY, 12)),
    mode: 'FLIGHT', estimatedCost: 42000, advanceAmount: 15000,
  }, 'APPROVED', 'Approved');
  await trip('aditya', {
    purpose: 'AWS Community Day — speaker session on event-driven payments', fromCity: 'Bengaluru', toCity: 'Hyderabad', departDate: nextWorkday(addD(TODAY, 16)),
    returnDate: nextWorkday(addD(TODAY, 17)), mode: 'FLIGHT', estimatedCost: 18000, advanceAmount: 5000,
  });
  await trip('siddharth', {
    purpose: 'Customer discovery visits — Pune fintech accounts', fromCity: 'Bengaluru', toCity: 'Pune', departDate: nextWorkday(addD(TODAY, 7)),
    returnDate: nextWorkday(addD(TODAY, 8)), mode: 'FLIGHT', estimatedCost: 24000, advanceAmount: 0,
  });
  await trip('pooja', {
    purpose: 'Dealer meet', fromCity: 'Mumbai', toCity: 'Goa', departDate: nextWorkday(addD(TODAY, 6)), returnDate: nextWorkday(addD(TODAY, 7)),
    mode: 'FLIGHT', estimatedCost: 22000, advanceAmount: 10000,
  }, 'REJECTED', 'Event moved online — no travel needed');

  // ---- Expenses (receipts in MinIO; EXPENSE chain = manager → HR) ----
  type X = [who: string, cat: string, desc: string, amount: number, date: Date, state: 'APPROVED' | 'MGR' | 'PENDING' | 'REJECTED' | 'CANCELLED'];
  const xs: X[] = [
    ['farhan', 'Travel', 'Hotel — 2 nights, Ahmedabad (client visit)', 6500, addD(ahmDep, 1), 'APPROVED'],
    ['farhan', 'Travel', 'Local cabs — Ahmedabad client visits', 1800, addD(ahmDep, 1), 'APPROVED'],
    ['farhan', 'Meals', 'Client lunch — Torrent Power procurement team', 2250, addD(ahmDep, 2), 'APPROVED'],
    ['priya', 'Internet', 'Broadband — August (WFH allowance)', 1180, addD(M(2), 25), 'APPROVED'],
    ['aditya', 'Software', 'JetBrains All Products Pack (annual)', 21900, addD(M(2), 12), 'APPROVED'],
    ['varun', 'Travel', 'Cab to Acme Retail office (UAT)', 640, addD(M(2), 18), 'APPROVED'],
    ['rajesh', 'Meals', 'Late-night dinner during P1 incident', 860, addD(M(1), 16), 'APPROVED'],
    ['nikhil', 'Marketing', 'LinkedIn sponsored post — webinar promotion', 12000, addD(M(1), 5), 'APPROVED'],
    ['karthik', 'Travel', 'Auto + metro to client site (UAT week)', 920, ago(9), 'MGR'],
    ['shreya', 'Software', 'Canva Pro — quarterly', 1497, ago(8), 'MGR'],
    ['aditya', 'Meals', 'Team dinner after the v4.2 release', 6800, ago(3), 'PENDING'],
    ['priya', 'Training', 'Udemy — Advanced TypeScript course', 499, ago(5), 'PENDING'],
    ['suresh', 'Office', 'Tally Prime renewal (finance)', 18000, ago(6), 'PENDING'],
    ['manish', 'Travel', 'Petrol — field visits (no log)', 2400, ago(15), 'REJECTED'],
    ['pooja', 'Meals', 'Coffee with prospect', 420, ago(11), 'CANCELLED'],
  ];
  for (const [k, category, description, amount, date, state] of xs) {
    const receipt = await pdfFile(`receipt-${category.toLowerCase()}-${iso(date)}.pdf`, 'Tax Invoice / Receipt', [
      description, `Amount: Rs. ${amount.toLocaleString('en-IN')} (incl. GST)`, `Date: ${iso(date)}`, `Paid by: ${e(k).name}`, `Invoice no: INV-${digits(6)}`,
    ]);
    const claim = await expenseService.createExpense(C, e(k).id, { category, description, amount, date }, receipt);
    const mgr = mgrOf(k);
    if (state === 'APPROVED' || state === 'MGR' || state === 'REJECTED') {
      await expenseService.decideExpense(C, claim.id, { decision: state === 'REJECTED' ? 'REJECTED' : 'APPROVED', remarks: state === 'REJECTED' ? 'Fuel claims need the trip log' : 'OK', actor: actor(mgr) });
    }
    if (state === 'APPROVED') await expenseService.decideExpense(C, claim.id, { decision: 'APPROVED', remarks: 'Verified', actor: actor(k === 'kavya' ? 'rohan' : 'kavya') });
    if (state === 'CANCELLED') await expenseService.cancelExpense(C, e(k).id, claim.id);
    const t = pastInstant(addD(date, 1), '17:30');
    await prisma.expenseClaim.update({ where: { id: claim.id }, data: { createdAt: t } });
    await backdateSteps('EXPENSE', claim.id, t, 22);
  }
  await travelService.settle(C, ahm.id);
  await prisma.travelRequest.update({ where: { id: ahm.id }, data: { settledOn: pastInstant(addD(ahmDep, 7)) } });

  // ---- Leave encashment ----
  const enc = await encashService.requestEncashment(C, e('aditya').id, { leaveTypeId: ids.leave.get('EL')!, days: 5, reason: 'Encash surplus EL' });
  await encashService.decideEncashment(C, enc.id, { decision: 'APPROVED', remarks: 'Approved', actor: actor('vikram') });
  await encashService.requestEncashment(C, e('priya').id, { leaveTypeId: ids.leave.get('EL')!, days: 4, reason: 'Encash before year end' });
}

// ---------------------------------------------------------------------------
// 9. Former employees (completed exits)
// ---------------------------------------------------------------------------

async function seedFormerEmployees() {
  const hr = actor('kavya');
  const plans: { key: string; lastDay: Date; noticeDays: number }[] = [
    { key: 'varun', lastDay: nextWorkday(addD(M(1), 3)), noticeDays: 30 },
    { key: 'ritu', lastDay: prevWorkday(addD(M(3), -1)), noticeDays: 7 },
  ];
  for (const p of plans) {
    const emp = e(p.key);
    let r;
    if (p.key === 'varun') {
      r = await exitService.resign(C, emp.id, { reason: 'Relocating to Pune to be closer to family', requestedLastDay: TODAY });
      await prisma.resignation.update({ where: { id: r.id }, data: { appliedOn: pastInstant(addD(p.lastDay, -p.noticeDays)) } });
      await exitService.decide(C, r.id, actor('vikram'), { decision: 'APPROVED', remarks: 'Sad to see you go — all the best', approvedLastDay: TODAY });
    } else {
      r = await exitService.initiateExit(C, hr, {
        employeeId: emp.id, exitType: 'TERMINATION', reason: 'Policy violation — misreporting of client visits (confirmed after investigation)', lastWorkingDay: TODAY,
      });
      await prisma.resignation.update({ where: { id: r.id }, data: { appliedOn: pastInstant(addD(p.lastDay, -p.noticeDays)) } });
    }
    const handoverTo = p.key === 'varun' ? 'priya' : 'farhan';
    for (const title of p.key === 'varun'
      ? ['Hand over Acme checkout service ownership', 'Document the payment retry worker runbook']
      : ['Transfer open opportunities in the CRM']) {
      const t = await handoverService.createTask(C, r.id, hr, { title, handoverToId: e(handoverTo).id, dueDate: TODAY });
      await handoverService.completeTask(C, r.id, t.id, actor(p.key), { notes: 'Done — walkthrough completed' });
      await handoverService.verifyTask(C, r.id, t.id, actor(mgrOf(p.key)), { decision: 'VERIFIED', notes: 'Verified' });
    }
    await exitService.scheduleInterview(C, r.id, hr, { at: new Date(Date.now() + 5 * 60_000), interviewerId: e('kavya').id });
    if (p.key === 'varun') {
      await exitService.submitInterview(C, actor('varun'), r.id, {
        answers: exitService.EXIT_INTERVIEW_QUESTIONS.map((q, i) => ({
          question: q,
          answer: ['Family relocation to Pune.', 'The people and the ownership culture.', 'A Pune hub or remote option would have kept me.', 'Very supportive.', 'Yes — AWS training and conference budget.', 'Fair for the market.', 'Healthy; release weeks get intense.', 'Keep investing in the platform team.'][i] ?? '',
        })),
        overallRating: 4, wouldRejoin: true,
      });
    } else {
      await exitService.submitInterview(C, hr, r.id, { answers: [{ question: exitService.EXIT_INTERVIEW_QUESTIONS[0]!, answer: 'Declined to participate (termination).' }], overallRating: undefined, wouldRejoin: false });
    }
    // Assets back.
    const open = await prisma.assetAssignment.findMany({ where: { companyId: C, employeeId: emp.id, returnedOn: null } });
    for (const a of open) await assetService.returnAsset(C, a.assetId, { conditionIn: 'Good', status: 'AVAILABLE', notes: 'Returned at exit' });
    // Clearances.
    const clearances = await prisma.exitClearance.findMany({ where: { resignationId: r.id } });
    for (const c of clearances) {
      const items = clearanceService.itemsOf(c).map((i) => ({ label: i.label, done: true }));
      const dept = c.department as 'MANAGER' | 'IT' | 'FINANCE' | 'ADMIN' | 'HR';
      await clearanceService.updateItems(C, r.id, dept, hr, { items });
      await clearanceService.actClearance(C, r.id, dept, hr, { status: 'CLEARED', remarks: 'All clear' });
    }
    // Back-date the case to the real last day, then separate.
    const lastDay = p.lastDay;
    const appliedOn = pastInstant(addD(lastDay, -p.noticeDays));
    await prisma.resignation.update({
      where: { id: r.id },
      data: { requestedLastDay: lastDay, approvedLastDay: lastDay, appliedOn, exitInterviewAt: at(addD(lastDay, -2), '15:00'), ...(p.key === 'varun' ? { acknowledgedAt: addD(appliedOn, 1) } : {}) },
    });
    await prisma.employee.update({ where: { id: emp.id }, data: { leavingDate: lastDay } });
    await prisma.employeeHistory.updateMany({ where: { companyId: C, employeeId: emp.id, type: 'RESIGNED' }, data: { effectiveDate: dateOnlyUTC(appliedOn), title: `Resigned — requested last working day ${longDate(lastDay)}` } });
    await prisma.employeeHistory.updateMany({ where: { companyId: C, employeeId: emp.id, type: 'NOTICE_PERIOD' }, data: { effectiveDate: dateOnlyUTC(appliedOn), title: `Serving notice period — last working day ${longDate(lastDay)}` } });
    await prisma.exitClearance.updateMany({ where: { resignationId: r.id }, data: { clearedAt: at(lastDay, '17:00') } });
    await prisma.handoverTask.updateMany({ where: { resignationId: r.id }, data: { dueDate: addD(lastDay, -3), completedAt: at(addD(lastDay, -4), '16:00'), verifiedAt: at(addD(lastDay, -3), '11:00') } });
    await prisma.exitInterview.updateMany({ where: { resignationId: r.id }, data: { submittedAt: at(addD(lastDay, -2), '16:00') } });
    await backdateSteps('RESIGNATION', r.id, appliedOn, 30);
    await exitService.completeExit(C, r.id);
    const paidOn = nextWorkday(addD(lastDay, 3));
    await settlementService.computeSettlement(C, r.id);
    await settlementService.approveSettlement(C, r.id, hr);
    await settlementService.markSettlementPaid(C, r.id, hr, { paymentMode: 'NEFT', paymentReference: `HDFCN${digits(12)}`, paidOn });
    await prisma.finalSettlement.update({ where: { resignationId: r.id }, data: { approvedAt: at(addD(lastDay, 1), '15:00'), createdAt: at(lastDay, '18:00') } });
    await exitService.closeCase(C, r.id, hr, p.key === 'varun'
      ? { rehireEligible: true, rehireNote: 'Strong performer — would welcome back (Pune hub / remote)' }
      : { rehireEligible: false, rehireNote: 'Terminated for policy violation — not eligible for rehire' });
    const closed = at(addD(paidOn, 2), '12:00');
    await prisma.resignation.update({ where: { id: r.id }, data: { closedAt: closed } });
    await prisma.employee.update({ where: { id: emp.id }, data: { archivedAt: closed } });
    await prisma.generatedLetter.updateMany({ where: { companyId: C, employeeId: emp.id, type: { in: ['RELIEVING', 'EXPERIENCE'] } }, data: { createdAt: at(lastDay, '17:30') } });
    emp.leaving = lastDay;
  }
}

// ---------------------------------------------------------------------------
// 10. Promotion via transfer
// ---------------------------------------------------------------------------

async function seedPromotion() {
  // ---- Promotion via transfer: Farhan → Senior Account Executive (effective 1st of M-3) ----
  const promo = await transferService.create(C, actor('neha'), {
    employeeId: e('farhan').id, type: 'PROMOTION', toDesignationId: ids.desig.get('Senior Account Executive'), toGradeId: ids.grade.get('G4'),
    incrementPercent: 12, effectiveDate: M(3), reason: 'Consistently above quota for four quarters; owns the top-10 West accounts',
  }, reqOf('neha'));
  await transferService.decide(C, promo.id, actor('kavya'), 'APPROVED', 'Approved — congratulations Farhan!', reqOf('kavya'));
  await prisma.transferRequest.update({ where: { id: promo.id }, data: { createdAt: pastInstant(addD(M(3), -10)), appliedAt: at(M(3), '10:00') } });
  await backdateSteps('TRANSFER', promo.id, pastInstant(addD(M(3), -10)), 48);
}

// ---------------------------------------------------------------------------
// 11. Payroll runs (real engine)
// ---------------------------------------------------------------------------

async function seedPayroll() {
  for (const k of [3, 2, 1]) {
    const month = M(k);
    await payrollInputService.importExpenses(C, month, e('kavya').id, reqOf('kavya'));
    const { run } = await payrollService.generateRun(C, month, { actorEmployeeId: e('kavya').id });
    await payrollService.lockRun(C, run.id);
    await payrollService.approveRun(C, run.id, e('arjun').id);
    await payrollService.publishRun(C, run.id);
    const end = monthEnd(month);
    const paidAt = at(prevWorkday(end), '11:00');
    await payrollService.markRunPaid(C, run.id, { paymentReference: `HDFC-BULK-${iso(end).replace(/-/g, '')}-${digits(4)}`, paymentMode: 'NEFT', paidAt });
    await prisma.payrollRun.update({
      where: { id: run.id },
      data: { createdAt: at(addD(end, -6), '10:00'), lockedAt: at(addD(end, -4), '16:00'), approvedAt: at(addD(end, -3), '12:00'), publishedAt: at(addD(end, -2), '18:00') },
    });
  }
}

async function seedDraftRun() {
  await payrollInputService.importExpenses(C, M0, e('kavya').id, reqOf('kavya'));
  await payrollService.generateRun(C, M0, { actorEmployeeId: e('kavya').id });
}

// ---------------------------------------------------------------------------
// 12. Lifecycle: onboarding, confirmations, transfers, revisions, letters, docs
// ---------------------------------------------------------------------------

async function seedLifecycle() {
  const hr = actor('kavya');
  // ---- Onboarding in progress for recent joiners ----
  for (const k of ['sneha', 'tanvi']) {
    const c = await prisma.onboardingCase.findFirst({ where: { companyId: C, employeeId: e(k).id, status: 'IN_PROGRESS' }, include: { tasks: { orderBy: { sortOrder: 'asc' } } } });
    if (!c) continue;
    for (const t of c.tasks) {
      const doIt = k === 'sneha'
        ? ['Sign and upload the offer letter', 'Upload PAN card', 'Upload Aadhaar card', 'Upload a passport-size photograph', 'Fill in personal & bank details', 'Laptop & official email setup', 'Issue ID card & access card', 'Buddy introduction & team walkthrough'].includes(t.title)
        : ['Laptop & official email setup', 'Issue ID card & access card', 'Fill in personal & bank details', 'Upload PAN card'].includes(t.title);
      if (!doIt || t.done) continue;
      const viewer = t.assigneeRole === 'EMPLOYEE' ? { role: e(k).role, employeeId: e(k).id } : t.assigneeRole === 'MANAGER' ? actor('vikram') : hr;
      const file = t.requiresDocument
        ? t.title.includes('photograph') || t.title.includes('PAN') || t.title.includes('Aadhaar')
          ? fileOf(`${k}_${t.documentCategory.replace(/\W+/g, '_')}.png`, cardPng(t.title.includes('PAN') ? [56, 189, 248] : [251, 191, 36]), 'image/png')
          : await pdfFile(`${k}_${t.title.replace(/\W+/g, '_')}.pdf`, t.title, [`Employee: ${e(k).name}`, 'Signed copy'])
        : undefined;
      await onboardingService.completeTask(C, t.id, viewer, file);
      await prisma.onboardingTask.update({ where: { id: t.id }, data: { doneAt: at(addD(e(k).joining, ri(0, 3)), '15:00') } });
    }
  }

  // ---- Confirmations ----
  await confirmationService.createRequest(C, e('ishaan').id);
  const h = await confirmationService.createRequest(C, e('harish').id);
  await confirmationService.recommend(C, h.id, actor('meera'), { recommendation: 'CONFIRM', comments: 'Ramped up well on the product and the support stack; recommend confirmation.' });
  const kc = await confirmationService.createRequest(C, e('karthik').id);
  await confirmationService.recommend(C, kc.id, actor('vikram'), { recommendation: 'CONFIRM', comments: 'Strong first six months — delivered the UAT fixes for Acme.' });
  await confirmationService.decide(C, kc.id, hr, 'APPROVED', 'Confirmed');
  await prisma.confirmationRequest.update({ where: { id: kc.id }, data: { createdAt: pastInstant(ago(20)) } });
  await prisma.confirmationRequest.update({ where: { id: h.id }, data: { createdAt: pastInstant(ago(8)) } });
  await backdateSteps('CONFIRMATION', h.id, pastInstant(ago(2)));

  // ---- Pending transfers ----
  await transferService.create(C, hr, {
    employeeId: e('karthik').id, type: 'TRANSFER', toDepartmentId: ids.dept.get('Product'), toManagerId: e('siddharth').id,
    effectiveDate: addMonths(M0, 1), reason: 'Moving to the product-engineering pod for the loyalty programme (employee request)',
  }, reqOf('kavya'));
  await transferService.create(C, actor('suresh'), {
    employeeId: e('lakshmi').id, type: 'LOCATION_CHANGE', toOfficeId: ids.office.MUM.id, effectiveDate: addMonths(M0, 1),
    reason: 'Spouse relocating to Mumbai; finance coverage needed at BKC', toGradeId: undefined,
  }, reqOf('suresh'));

  // ---- Pending salary revision (requested by HR → CEO approval) ----
  const adi = await prisma.employee.findUniqueOrThrow({ where: { id: e('aditya').id } });
  const ctcNow = salaryRevisionService.ctcAnnualOf(salaryRevisionService.monthlyFromEmployee(adi));
  await salaryRevisionService.createRevision(C, {
    employeeId: adi.id, effectiveFrom: addMonths(M0, 1), ctcAnnual: Math.round((ctcNow * 1.15) / 10000) * 10000,
    reason: 'Retention — counter to an external offer (critical for the Bharat Payments go-live)',
  }, hr, reqOf('kavya'));

  // ---- Letters (real PDFs) ----
  for (const k of ['sneha', 'aman', 'ishaan', 'harish']) await letterService.generateLetter(C, { type: 'APPOINTMENT', employeeId: e(k).id, createdById: e('kavya').id });
  for (const k of ['priya', 'farhan']) await letterService.generateLetter(C, { type: 'SALARY_CERTIFICATE', employeeId: e(k).id, createdById: e('rohan').id });
  await letterService.generateLetter(C, { type: 'INCREMENT', employeeId: e('aditya').id, createdById: e('kavya').id });

  // ---- Documents ----
  const policies: [string, string[]][] = [
    ['Employee Handbook 2026', ['Our values, code of conduct, working hours and hybrid policy.', 'Benefits: group health insurance (₹5L family floater), term life, NPS.']],
    ['Leave Policy 2026', ['CL 12 · SL 12 · EL 1.5/month (carry-forward up to 30, encashable up to 10/yr).', 'Maternity 26 weeks · Paternity 5 days · Comp-off within 90 days.']],
    ['POSH Policy', ['Prevention of Sexual Harassment at the Workplace.', 'Internal Committee: Kavya Iyer (Presiding Officer), Suresh Iyengar, external member.']],
    ['IT Acceptable Use Policy', ['Laptops are company property; full-disk encryption mandatory.', 'Report lost devices to IT within 2 hours.']],
    ['Travel & Expense Policy', ['Flights economy; hotels up to ₹6,000/night in metros.', 'Claims within 30 days with GST invoices; approval: manager → HR.']],
    [`Holiday Calendar ${Y}`, HOLIDAYS.map(([n, m, d, o]) => `${iso(ymd(Y, m, d))} — ${n}${o ? ' (optional)' : ''}`)],
  ];
  for (const [title, lines] of policies) {
    const buf = await pdfBuffer(title, lines);
    const key = objectKey(C, 'documents', `${title}.pdf`);
    await putObject(key, buf, 'application/pdf');
    await prisma.document.create({ data: { companyId: C, name: `${title}.pdf`, category: 'General', fileKey: key, mimeType: 'application/pdf', size: buf.length, uploadedById: e('kavya').id, uploadedOn: pastInstant(ago(ri(20, 200))) } });
  }
  const personal = ['aditya', 'priya', 'rahul', 'karthik', 'ananya', 'farhan', 'pooja', 'shreya', 'lakshmi', 'rajesh', 'harish', 'ishaan', 'aman', 'dev'];
  for (const k of personal) {
    const emp = e(k);
    const docs: { name: string; category: string; buf: Buffer; mime: string }[] = [
      { name: 'PAN card.png', category: 'Identity', buf: cardPng([56, 189, 248]), mime: 'image/png' },
      { name: 'Aadhaar card.png', category: 'Identity', buf: cardPng([251, 191, 36]), mime: 'image/png' },
      { name: 'Signed offer letter.pdf', category: 'Offer Letter', buf: await pdfBuffer('Offer Letter (signed)', [`${emp.name}`, `Joining date: ${iso(emp.joining)}`, 'Accepted and signed by the employee.']), mime: 'application/pdf' },
      { name: 'Degree certificate.pdf', category: 'Degrees & Certificates', buf: await pdfBuffer('Degree Certificate', [`This is to certify that ${emp.name} has been awarded the degree of Bachelor.`]), mime: 'application/pdf' },
    ];
    if (emp.joining < ymd(Y, 1, 1)) docs.push({ name: `Form 16 FY ${FY_START_YEAR - 1}-${String(FY_START_YEAR % 100).padStart(2, '0')}.pdf`, category: 'Tax Forms', buf: await pdfBuffer('Form 16 (Part A & B)', [`Employee: ${emp.name}`, 'Employer TAN: BLRN12345E']), mime: 'application/pdf' });
    for (const d of docs) {
      const key = objectKey(C, 'documents', d.name);
      await putObject(key, d.buf, d.mime);
      await prisma.document.create({ data: { companyId: C, employeeId: emp.id, name: d.name, category: d.category, fileKey: key, mimeType: d.mime, size: d.buf.length, uploadedById: emp.id, uploadedOn: at(addD(emp.joining, ri(0, 5)), '12:00') } });
    }
  }
}

// ---------------------------------------------------------------------------
// 13. Exits in progress: serving notice + pending resignation
// ---------------------------------------------------------------------------

async function seedOpenExits() {
  const hr = actor('kavya');
  // Dev — resignation approved, serving notice.
  const appliedOn = pastInstant(ago(12), '10:15');
  const lastDay = nextWorkday(addD(dateOnlyUTC(appliedOn), 30));
  const r = await exitService.resign(C, e('dev').id, { reason: "Joining a Master's programme (MBA) at IIM Bangalore", requestedLastDay: lastDay });
  await prisma.resignation.update({ where: { id: r.id }, data: { appliedOn } });
  await exitService.decide(C, r.id, actor('siddharth'), { decision: 'APPROVED', remarks: 'Congratulations on the admission!', approvedLastDay: lastDay });
  await prisma.employeeHistory.updateMany({ where: { companyId: C, employeeId: e('dev').id, type: { in: ['RESIGNED', 'NOTICE_PERIOD'] } }, data: { effectiveDate: dateOnlyUTC(appliedOn) } });
  await prisma.resignation.update({ where: { id: r.id }, data: { acknowledgedAt: addD(appliedOn, 1) } });
  await backdateSteps('RESIGNATION', r.id, appliedOn, 26);
  const tasks: [string, string, number, 'VERIFIED' | 'DONE' | 'PENDING'][] = [
    ['Hand over the loyalty programme PRD and backlog', 'ananya', -5, 'VERIFIED'],
    ['Transfer Jira epics and stakeholder contacts', 'ananya', -2, 'DONE'],
    ['Walk Karthik through the analytics dashboards', 'karthik', 4, 'PENDING'],
    ['Record a Loom on the pricing experiment learnings', 'ananya', 10, 'PENDING'],
  ];
  for (const [title, to, dueOff, status] of tasks) {
    const due = minDate(addD(TODAY, dueOff), lastDay);
    const t = await handoverService.createTask(C, r.id, actor('siddharth'), { title, handoverToId: e(to).id, dueDate: due < TODAY ? TODAY : due });
    if (due < TODAY) await prisma.handoverTask.update({ where: { id: t.id }, data: { dueDate: due } });
    if (status !== 'PENDING') await handoverService.completeTask(C, r.id, t.id, actor('dev'), { notes: 'Shared in Confluence' });
    if (status === 'VERIFIED') await handoverService.verifyTask(C, r.id, t.id, actor('siddharth'), { decision: 'VERIFIED', notes: 'Looks complete' });
  }
  const fin = await prisma.exitClearance.findUniqueOrThrow({ where: { resignationId_department: { resignationId: r.id, department: 'FINANCE' } } });
  await clearanceService.updateItems(C, r.id, 'FINANCE', hr, { items: clearanceService.itemsOf(fin).map((i) => ({ label: i.label, done: true })) });
  await clearanceService.actClearance(C, r.id, 'FINANCE', hr, { status: 'CLEARED', remarks: 'No dues' });
  const it = await prisma.exitClearance.findUniqueOrThrow({ where: { resignationId_department: { resignationId: r.id, department: 'IT' } } });
  await clearanceService.updateItems(C, r.id, 'IT', hr, { items: clearanceService.itemsOf(it).map((i) => ({ label: i.label, done: i.label.startsWith('Data backup') })) });
  await exitService.scheduleInterview(C, r.id, hr, { at: at(prevWorkday(addD(lastDay, -2)), '16:00'), interviewerId: e('kavya').id });
  await settlementService.computeSettlement(C, r.id); // DRAFT F&F for HR to review
  // Rahul — resignation awaiting his manager.
  const rr = await exitService.resign(C, e('rahul').id, { reason: "Pursuing a Master's in Cloud Computing in Germany", requestedLastDay: nextWorkday(addD(TODAY, 30)) });
  await prisma.resignation.update({ where: { id: rr.id }, data: { appliedOn: pastInstant(ago(1), '18:20') } });
  await prisma.employeeHistory.updateMany({ where: { companyId: C, employeeId: e('rahul').id, type: 'RESIGNED' }, data: { effectiveDate: ago(1) } });
  await backdateSteps('RESIGNATION', rr.id, pastInstant(ago(1), '18:20'));
}

// ---------------------------------------------------------------------------
// 14. Talent & engagement
// ---------------------------------------------------------------------------

async function seedTalent() {
  // ---- Certifications & skills ----
  const certs: [string, string, string, number | null, number | null, boolean][] = [
    ['aditya', 'AWS Certified Solutions Architect – Associate', 'Amazon Web Services', 1080, 18, true],
    ['rahul', 'Certified Kubernetes Administrator (CKA)', 'The Linux Foundation', 700, 25, true],
    ['rahul', 'HashiCorp Certified: Terraform Associate', 'HashiCorp', 400, 330, false],
    ['siddharth', 'Project Management Professional (PMP)', 'PMI', 900, 900, true],
    ['shreya', 'Google Ads Search Certification', 'Google', 380, -12, true],
    ['nikhil', 'HubSpot Inbound Marketing', 'HubSpot Academy', 500, 230, true],
    ['suresh', 'Chartered Accountant (Membership)', 'ICAI', 4000, null, true],
    ['riya', 'Google UX Design Professional Certificate', 'Google / Coursera', 800, null, true],
    ['priya', 'Meta Front-End Developer Certificate', 'Meta / Coursera', 300, null, false],
    ['meera', 'Certified Customer Success Manager (CCSM L1)', 'SuccessCOACHING', 600, 120, true],
  ];
  for (const [k, name, issuer, issuedAgo, expiresIn, verified] of certs) {
    let fileKey: string | null = null;
    let fileName = '';
    if (k === 'aditya') {
      const buf = await pdfBuffer(name, [`Awarded to ${e(k).name}`, `Issued by ${issuer}`, `Validation number: AWS-${digits(10)}`]);
      fileName = 'AWS_SAA_certificate.pdf';
      fileKey = objectKey(C, 'certifications', fileName);
      await putObject(fileKey, buf, 'application/pdf');
    }
    await prisma.employeeCertification.create({
      data: {
        companyId: C, employeeId: e(k).id, name, issuer, credentialId: `${issuer.slice(0, 3).toUpperCase()}-${digits(8)}`,
        credentialUrl: `https://verify.example.com/${digits(10)}`, issuedOn: issuedAgo ? ago(issuedAgo) : null,
        expiresOn: expiresIn === null ? null : addD(TODAY, expiresIn), fileKey, fileName, verified, verifiedById: verified ? e('kavya').id : null,
      },
    });
  }
  const skills: Record<string, [string, string, number][]> = {
    aditya: [['Node.js', 'EXPERT', 9], ['System design', 'ADVANCED', 6], ['AWS', 'ADVANCED', 6], ['PostgreSQL', 'ADVANCED', 8]],
    priya: [['React', 'EXPERT', 6], ['TypeScript', 'ADVANCED', 5], ['Node.js', 'ADVANCED', 4]],
    rahul: [['Kubernetes', 'EXPERT', 5], ['Terraform', 'ADVANCED', 4], ['AWS', 'ADVANCED', 6], ['Linux', 'EXPERT', 8]],
    karthik: [['Java', 'ADVANCED', 4], ['React', 'INTERMEDIATE', 2], ['SQL', 'ADVANCED', 4]],
    ishaan: [['Selenium', 'ADVANCED', 2], ['Playwright', 'INTERMEDIATE', 1], ['API testing', 'ADVANCED', 2]],
    sneha: [['React', 'INTERMEDIATE', 2], ['Node.js', 'INTERMEDIATE', 2]],
    ananya: [['Product discovery', 'ADVANCED', 6], ['SQL', 'INTERMEDIATE', 3], ['Figma', 'INTERMEDIATE', 3]],
    riya: [['Figma', 'EXPERT', 8], ['Design systems', 'EXPERT', 5], ['User research', 'ADVANCED', 6]],
    aman: [['Figma', 'ADVANCED', 3], ['Illustration', 'ADVANCED', 4]],
    farhan: [['Enterprise sales', 'EXPERT', 8], ['Negotiation', 'ADVANCED', 8], ['Salesforce CRM', 'ADVANCED', 5]],
    shreya: [['SEO', 'ADVANCED', 4], ['Copywriting', 'ADVANCED', 5], ['Google Analytics', 'INTERMEDIATE', 3]],
    lakshmi: [['Tally Prime', 'EXPERT', 7], ['GST compliance', 'ADVANCED', 6], ['Excel', 'ADVANCED', 8]],
    rajesh: [['Zendesk', 'ADVANCED', 4], ['SQL', 'INTERMEDIATE', 3], ['Linux', 'INTERMEDIATE', 3]],
    rohan: [['Payroll (India)', 'INTERMEDIATE', 3], ['Recruitment', 'ADVANCED', 4]],
  };
  for (const [k, list] of Object.entries(skills)) {
    await prisma.employeeSkill.createMany({
      data: list.map(([skill, level, years], i) => ({ companyId: C, employeeId: e(k).id, skill, level, years, endorsedById: i < 2 ? e(mgrOf(k)).id : null })),
    });
  }

  // ---- Surveys ----
  const pulse = await surveyService.createSurvey(C, e('kavya').id, {
    title: 'Quarterly Pulse — Q2', description: 'Five quick questions on how the last quarter felt.', anonymous: true,
    questions: [
      { text: 'How happy are you at work right now?', type: 'RATING' },
      { text: 'How likely are you to recommend Nimbus as a place to work?', type: 'NPS' },
      { text: 'How was your workload last quarter?', type: 'CHOICE', options: ['Too light', 'About right', 'Too heavy'] },
      { text: 'One thing we should improve', type: 'TEXT', required: false },
    ],
    closesOn: addD(TODAY, 2),
  });
  await surveyService.setStatus(C, pulse.id, 'OPEN');
  const comments = ['More clarity on the promotion process', 'Better snacks in the Mumbai office!', 'Fewer meetings on Fridays', 'Faster laptop refresh cycle', 'More cross-team demos', ''];
  const people = [...E.values()].filter((x) => !x.leaving);
  for (const emp of people.slice(0, 19)) {
    await surveyService.respond(C, pulse.id, emp.id, { q1: ri(3, 5), q2: ri(6, 10), q3: pick(['About right', 'About right', 'Too heavy', 'Too light']), q4: pick(comments) });
  }
  await surveyService.setStatus(C, pulse.id, 'CLOSED');
  await prisma.survey.update({ where: { id: pulse.id }, data: { closesOn: ago(20), createdAt: pastInstant(ago(35)) } });
  await prisma.surveyResponse.updateMany({ where: { surveyId: pulse.id }, data: { submittedAt: ago(28) } });
  const hybrid = await surveyService.createSurvey(C, e('kavya').id, {
    title: `Hybrid Work & Workplace Survey ${Y}`, description: 'Help us plan office days, facilities and tools for next year.', anonymous: false,
    questions: [
      { text: 'How many office days a week work best for you?', type: 'CHOICE', options: ['1 day', '2 days', '3 days', 'Fully remote'] },
      { text: 'Rate the office facilities', type: 'RATING' },
      { text: 'Rate our collaboration tools (Slack, Meet, Jira)', type: 'RATING' },
      { text: 'Anything else?', type: 'TEXT', required: false },
    ],
    closesOn: addD(TODAY, 10),
  });
  await surveyService.setStatus(C, hybrid.id, 'OPEN');
  await prisma.survey.update({ where: { id: hybrid.id }, data: { createdAt: pastInstant(ago(5)) } });
  for (const emp of people.slice(5, 16)) {
    await surveyService.respond(C, hybrid.id, emp.id, { q1: pick(['2 days', '3 days', '3 days', '1 day']), q2: ri(3, 5), q3: ri(3, 5), q4: pick(['Quiet rooms for calls please', 'Shuttle from Whitefield metro', '', 'Standing desks']) });
  }

  // ---- Recognition wall ----
  const kudos: [string, string, string, string, number][] = [
    ['vikram', 'aditya', 'INNOVATOR', 'The UPI autopay retry design is elegant and saved weeks of work. 🙌', 50],
    ['aditya', 'priya', 'TEAM_PLAYER', 'Stayed late to pair with Karthik on the flaky checkout tests. Legend!', 30],
    ['meera', 'rajesh', 'CUSTOMER_HERO', 'Calm, clear and fast during the Acme checkout outage at 2 AM.', 50],
    ['neha', 'farhan', 'GO_GETTER', 'Two renewals closed in one Ahmedabad trip — incredible!', 50],
    ['siddharth', 'ananya', 'INNOVATOR', 'Loyalty discovery insights reshaped our roadmap.', 40],
    ['riya', 'aman', 'THANK_YOU', 'Beautiful illustrations for the onboarding screens.', 20],
    ['kavya', 'rohan', 'THANK_YOU', 'Handled 40+ payroll queries during the tax-declaration window.', 20],
    ['priya', 'karthik', 'TEAM_PLAYER', 'Always happy to review PRs, even on busy days.', 20],
    ['rahul', 'aditya', 'MENTOR', 'Taught me so much about designing for failure.', 30],
    ['karthik', 'priya', 'MENTOR', 'Best onboarding buddy anyone could ask for.', 30],
    ['farhan', 'pooja', 'GO_GETTER', 'Nailed the Torrent demo at one hour’s notice!', 30],
    ['nikhil', 'shreya', 'INNOVATOR', 'The payroll-compliance blog series is our top organic channel now.', 40],
    ['suresh', 'lakshmi', 'THANK_YOU', 'Books closed on day 4 again — thank you!', 20],
    ['arjun', 'vikram', 'TEAM_PLAYER', 'Engineering hit every release date this quarter.', 50],
    ['arjun', 'kavya', 'GO_GETTER', 'Hiring plan on track and offers out in record time.', 50],
    ['divya', 'rajesh', 'MENTOR', 'Patiently taught me the escalation runbook.', 20],
    ['harish', 'divya', 'THANK_YOU', 'Covered my shift when I was unwell.', 10],
    ['ganesh', 'sunita', 'THANK_YOU', 'The Diwali decorations look amazing!', 10],
    ['ishaan', 'karthik', 'TEAM_PLAYER', 'Fixed the test environment so QA could continue.', 20],
    ['ananya', 'riya', 'THANK_YOU', 'Design reviews that make products better every time.', 20],
    ['vikram', 'rahul', 'CUSTOMER_HERO', 'Zero-downtime Kubernetes upgrade. 🚀', 40],
    ['pooja', 'manish', 'GO_GETTER', 'Booked 12 demos in one week!', 20],
    ['meera', 'harish', 'THANK_YOU', 'Wrote 15 help articles in his first months.', 20],
    ['sneha', 'aditya', 'MENTOR', 'Super welcoming first week — thank you for the walkthroughs.', 10],
    ['tanvi', 'priya', 'THANK_YOU', 'Thanks for helping me set up the dev environment on day one!', 10],
    ['shreya', 'nikhil', 'MENTOR', 'Great guidance on the content calendar.', 20],
  ];
  await prisma.recognition.createMany({
    data: kudos.map(([from, to, badge, message, points], i) => ({
      companyId: C, fromEmployeeId: e(from).id, toEmployeeId: e(to).id, badge, message, points,
      createdAt: pastInstant(ago(Math.min(i * 2, 50) + ri(0, 1)), `${10 + (i % 8)}:${String(ri(0, 59)).padStart(2, '0')}`),
    })),
  });

  // ---- Announcements ----
  const ann: [string, string, string, number][] = [
    ['Diwali celebrations 🪔 & office closure', `We celebrate on the Friday before Diwali — rangoli competition, potluck and a surprise performance from 4 PM in both offices. Offices are closed on ${iso(ymd(Y, 11, 9))} (Diwali). Happy Diwali in advance!`, 'Events', 1],
    ['Group health insurance — top-up enrolment open', 'You can add parents / in-laws or buy a ₹10L super top-up at group rates until the end of this month. Enrol from the Benefits section or raise a helpdesk ticket.', 'Benefits', 4],
    ['Updated Travel & Expense Policy', 'Effective this month: hotel caps revised for metros, claims to be filed within 30 days with GST invoices, and every claim is approved by your manager and then HR. Read the policy under Documents.', 'Policy', 9],
    ['Welcome aboard, Sneha and Tanvi! 👋', 'Please welcome Sneha Joshi (Software Engineer) and Tanvi Shah (Associate Software Engineer) to the Engineering team in Bengaluru. Say hello when you see them!', 'People', 7],
    ['Q2 Town Hall — results & roadmap', 'Join Arjun for the Q2 town hall next Thursday at 4 PM (Bengaluru HQ café + Meet link). Submit your questions in advance via the survey link in Slack.', 'General', 16],
  ];
  const everyone = [...E.values()].filter((x) => !x.leaving);
  for (const [title, body, category, days] of ann) {
    const a = await prisma.announcement.create({ data: { companyId: C, title, body, category, authorId: e(category === 'General' ? 'arjun' : 'kavya').id, postedOn: pastInstant(ago(days), '09:30') } });
    const readers = everyone.filter(() => rnd() < (days > 3 ? 0.8 : 0.35));
    await prisma.announcementRead.createMany({ data: readers.map((r) => ({ announcementId: a.id, employeeId: r.id })) });
  }

  // ---- Helpdesk ----
  const tickets: [string, string, string, string, 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED', number][] = [
    ['sneha', 'VPN access to the staging cluster', 'IT', 'Need VPN + kubectl access for the staging cluster to start on my first ticket.', 'IN_PROGRESS', 2],
    ['tanvi', 'GitHub organisation invite not received', 'IT', 'The invite to the nimbus GitHub org did not arrive — please resend.', 'OPEN', 1],
    ['priya', 'Monitor flickering', 'IT', 'The Dell monitor at desk B-14 flickers every few minutes.', 'RESOLVED', 12],
    ['farhan', 'Payslip — incentive missing?', 'Payroll', 'My Q1 incentive is not visible on the payslip breakup in the app.', 'CLOSED', 70],
    ['pooja', 'Add mother to health insurance', 'HR', 'Please add my mother (age 58) under the parental top-up.', 'IN_PROGRESS', 4],
    ['manish', 'Parking slot in BKC', 'Facilities', 'Requesting a two-wheeler parking slot at the BKC office.', 'OPEN', 3],
    ['lakshmi', 'Form 16 correction', 'Payroll', 'Previous employer income needs to be added to my Form 16 calculation.', 'RESOLVED', 30],
    ['rajesh', 'Night-shift cab pickup', 'Facilities', 'The 5:45 AM drop cab has been late three times this week.', 'IN_PROGRESS', 5],
    ['aman', 'Figma licence upgrade', 'IT', 'Need a Figma Professional seat for prototyping.', 'CLOSED', 40],
    ['ishaan', 'Leave balance looks wrong', 'HR', 'My CL balance shows 4.5 instead of 5.', 'OPEN', 1],
  ];
  await prisma.ticket.createMany({
    data: tickets.map(([k, subject, category, description, status, days]) => ({
      companyId: C, employeeId: e(k).id, subject, category, description, status, createdOn: pastInstant(ago(days), '11:00'),
      resolvedAt: status === 'RESOLVED' || status === 'CLOSED' ? pastInstant(ago(Math.max(0, days - 2)), '16:00') : null,
    })),
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function step(label: string, fn: () => Promise<void>) {
  const t = Date.now();
  await fn();
  console.log(`• ${label} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
}

async function summary() {
  const where = { companyId: C };
  const counts: [string, number][] = [
    ['Employees (current)', await prisma.employee.count({ where: { ...where, isActive: true } })],
    ['Former employees', await prisma.employee.count({ where: { ...where, employmentStatus: 'SEPARATED' } })],
    ['Attendance records', await prisma.attendanceRecord.count({ where })],
    ['Regularizations', await prisma.regularizationRequest.count({ where })],
    ['Leave requests', await prisma.leaveRequest.count({ where })],
    ['Leave ledger rows', await prisma.leaveLedger.count({ where })],
    ['Comp-off / encashments', (await prisma.compOffRequest.count({ where })) + (await prisma.leaveEncashment.count({ where }))],
    ['Overtime requests', await prisma.overtimeRequest.count({ where })],
    ['Payroll runs', await prisma.payrollRun.count({ where })],
    ['Payslips', await prisma.payslip.count({ where })],
    ['Payroll inputs', await prisma.payrollInput.count({ where })],
    ['Salary revisions', await prisma.salaryRevision.count({ where })],
    ['Tax declarations', await prisma.taxDeclaration.count({ where })],
    ['Loans', await prisma.loan.count({ where })],
    ['Expense claims', await prisma.expenseClaim.count({ where })],
    ['Travel requests', await prisma.travelRequest.count({ where })],
    ['Timesheet days', await prisma.timesheetDay.count({ where })],
    ['Certifications / skills', (await prisma.employeeCertification.count({ where })) * 1000 + (await prisma.employeeSkill.count({ where }))],
    ['Survey responses', await prisma.surveyResponse.count({ where })],
    ['Kudos', await prisma.recognition.count({ where })],
    ['Requisitions', await prisma.jobRequisition.count({ where })],
    ['Jobs / postings', (await prisma.jobOpening.count({ where })) * 1000 + (await prisma.jobPosting.count({ where }))],
    ['Candidates / applications', (await prisma.candidate.count({ where })) * 1000 + (await prisma.application.count({ where }))],
    ['Interviews', await prisma.interview.count({ where })],
    ['Offers', await prisma.offer.count({ where })],
    ['Onboarding cases', await prisma.onboardingCase.count({ where })],
    ['Assets / assignments', (await prisma.asset.count({ where })) * 1000 + (await prisma.assetAssignment.count({ where }))],
    ['Letters (PDF)', await prisma.generatedLetter.count({ where })],
    ['Documents', await prisma.document.count({ where })],
    ['Exits (resignations)', await prisma.resignation.count({ where })],
    ['Transfers', await prisma.transferRequest.count({ where })],
    ['Career history rows', await prisma.employeeHistory.count({ where })],
    ['Pending approval steps', await prisma.approvalStep.count({ where: { ...where, status: 'PENDING' } })],
  ];
  const fmt = (label: string, n: number) => (label.includes(' / ') && n >= 1000 ? `${Math.floor(n / 1000)} / ${n % 1000}` : String(n));
  console.log('\nCounts');
  for (const [label, n] of counts) console.log(`  ${label.padEnd(28)} ${fmt(label, n)}`);
  const stages = await prisma.application.groupBy({ by: ['stage'], where, _count: { _all: true } });
  console.log(`  Application stages           ${stages.map((s) => `${s.stage}:${s._count._all}`).join(' ')}`);
}

async function main() {
  await ensureBucket();
  await step('clean-up', cleanup);
  await step('company, masters, policies, billing', setupCompany);
  await step('people (encrypted identity, salary, onboarding)', createPeople);
  await step('assets', createAssets);
  await step('leave ledger + requests', seedLeave);
  await step('recruitment funnel (incl. hire via LinkedIn)', async () => {
    tanviJoin = nextWorkday(ago(9));
    await seedRecruitment();
  });
  await step('attendance, regularization, overtime, comp-off', async () => {
    e('varun').leaving = nextWorkday(addD(M(1), 3));
    e('ritu').leaving = prevWorkday(addD(M(3), -1));
    await seedAttendance();
  });
  await step('timesheets', seedTimesheets);
  await step('tax, loans, payroll inputs, travel, expenses, encashment', seedMoney);
  await step('former employees (completed exits)', seedFormerEmployees);
  await step('promotion via transfer', seedPromotion);
  await step('payroll runs (3 paid)', seedPayroll);
  await step('onboarding, confirmations, transfers, letters, documents', seedLifecycle);
  await step('serving notice + pending resignation', seedOpenExits);
  await step('certifications, surveys, kudos, announcements, tickets', seedTalent);
  await step('current-month draft payroll', seedDraftRun);
  const portal = await recruitmentService.createPortalLink(C, APPS.get('Ankita Rane')!, 30);
  portalCandidate = portal.url;

  await summary();
  console.log('\nLogins (password: Admin@12345 for ADMIN, Employee@123 for everyone else)');
  const people = await prisma.employee.findMany({
    where: { companyId: C }, include: { user: { select: { email: true, memberships: { where: { companyId: C }, select: { role: true } } } } },
    orderBy: { employeeCode: 'asc' },
  });
  for (const p of people) {
    const role = p.user.memberships[0]?.role ?? '';
    console.log(`  ${role.padEnd(9)} ${p.user.email.padEnd(24)} ${p.employeeCode}  ${p.name.padEnd(17)} ${p.designation} — ${p.employmentStatus}${p.isActive ? '' : ' (no access)'}`);
  }
  console.log(`\nCandidate portal (Ankita Rane, pre-onboarding): ${portalCandidate}`);
  console.log(`Done in ${((Date.now() - START) / 1000).toFixed(1)}s`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
