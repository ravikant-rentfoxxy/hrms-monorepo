/**
 * Bulk CSV imports: EMPLOYEES, SALARIES, HOLIDAYS, LEAVE_BALANCES, ATTENDANCE.
 *
 * Two steps, both recorded on an ImportJob:
 *   preview → parse + validate every row (against the file and the database),
 *             store the normalized rows and per-row errors (status PREVIEW);
 *   commit  → apply the valid rows one by one (a failing row never aborts the
 *             rest), store success / failed counts (status COMMITTED, or FAILED
 *             when nothing could be applied).
 */
import { randomBytes } from 'crypto';
import type { AttendanceStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import type { AuditEntry } from '../lib/audit';
import { ApiError } from '../utils/http';
import { parseCsv, toCsv } from '../utils/csv';
import { dateOnlyUTC } from '../utils/geo';
import { createEmployee } from './employee.service';

export const IMPORT_TYPES = ['EMPLOYEES', 'SALARIES', 'HOLIDAYS', 'LEAVE_BALANCES', 'ATTENDANCE'] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

const MAX_ROWS = 5000;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

interface TemplateSpec {
  headers: string[];
  required: string[];
  example: string[];
  notes: string;
}

const TEMPLATES: Record<ImportType, TemplateSpec> = {
  EMPLOYEES: {
    headers: [
      'name', 'email', 'employeeCode', 'designation', 'department', 'phone', 'joiningDate', 'dateOfBirth',
      'managerEmail', 'role', 'gender', 'ctcAnnual', 'location', 'employmentType', 'maritalStatus', 'personalEmail',
      'probationEndDate', 'noticePeriodDays', 'bankName', 'accountNumber', 'ifsc', 'pan', 'uan', 'pfNumber',
      'aadhaarNumber', 'fatherName', 'bloodGroup', 'address', 'emergencyContact',
    ],
    required: ['name', 'email', 'joiningDate'],
    example: [
      'Asha Verma', 'asha.verma@example.com', '', 'Software Engineer', 'Engineering', '9876543210', '2026-04-01',
      '1995-08-14', 'manager@example.com', 'EMPLOYEE', 'FEMALE', '900000', 'Pune', 'Full-time', 'Single',
      'asha@gmail.com', '2026-09-30', '30', 'HDFC Bank', '50100012345678', 'HDFC0001234', 'ABCDE1234F', '',
      '', '', 'Rakesh Verma', 'B+', 'Flat 4, MG Road, Pune', 'Rakesh 9876500000',
    ],
    notes: 'employeeCode blank = auto-generated. role: EMPLOYEE | MANAGER | HR. A temporary password is generated for new logins.',
  },
  SALARIES: {
    headers: ['employeeCode', 'basic', 'hra', 'conveyance', 'medical', 'allowance', 'pfEmployee', 'pfEmployer'],
    required: ['employeeCode', 'basic'],
    example: ['EMP-001', '40000', '16000', '1600', '1250', '12150', '1800', '1800'],
    notes: 'Monthly amounts. A blank amount keeps the current value.',
  },
  HOLIDAYS: {
    headers: ['date', 'name', 'optional'],
    required: ['date', 'name'],
    example: ['2026-12-25', 'Christmas', 'false'],
    notes: 'optional: true / false.',
  },
  LEAVE_BALANCES: {
    headers: ['employeeCode', 'leaveTypeCode', 'balance'],
    required: ['employeeCode', 'leaveTypeCode', 'balance'],
    example: ['EMP-001', 'EL', '12.5'],
    notes: 'Opening balance for the current year (dated 1 Jan); replaces an earlier imported opening balance.',
  },
  ATTENDANCE: {
    headers: ['employeeCode', 'date', 'status', 'checkIn', 'checkOut'],
    required: ['employeeCode', 'date', 'status'],
    example: ['EMP-001', '2026-10-01', 'PRESENT', '09:25', '18:40'],
    notes: 'status: PRESENT | LATE | ABSENT | LEAVE | HOLIDAY | WEEKEND | HALF_DAY. Times are HH:mm in the company timezone.',
  },
};

export function parseType(raw: string): ImportType {
  const t = raw.toUpperCase().replace(/-/g, '_') as ImportType;
  if (!IMPORT_TYPES.includes(t)) throw ApiError.badRequest(`Unknown import type. Use one of: ${IMPORT_TYPES.join(', ')}`);
  return t;
}

export function template(type: ImportType): { fileName: string; csv: string } {
  const t = TEMPLATES[type];
  return { fileName: `${type.toLowerCase()}-template.csv`, csv: toCsv(t.headers, [t.example]) };
}

export function templateInfo() {
  return IMPORT_TYPES.map((type) => ({ type, ...TEMPLATES[type] }));
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Header-insensitive accessor for a parsed CSV row. */
function reader(row: Record<string, string>) {
  const map = new Map(Object.entries(row).map(([k, v]) => [norm(k), v.trim()]));
  return (key: string): string => map.get(norm(key)) ?? '';
}

/** YYYY-MM-DD, DD-MM-YYYY or DD/MM/YYYY → UTC midnight. */
function parseDate(s: string): Date | null {
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < 1900 || y > 2100) return null;
  return date;
}

function parseNum(s: string): number | null {
  const n = Number(s.replace(/[,₹\s]/g, ''));
  return s !== '' && Number.isFinite(n) ? n : null;
}

const parseBool = (s: string): boolean => /^(true|yes|y|1)$/i.test(s);

function parseTime(s: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h < 24 && m < 60 ? { h, m } : null;
}

/** Offset (ms) of `tz` from UTC at instant `at`. */
function tzOffset(tz: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - at.getTime();
  } catch {
    return 0;
  }
}

/** Wall-clock time on `date` in `tz` → UTC instant. */
function zonedToUtc(date: Date, t: { h: number; m: number }, tz: string): Date {
  const guess = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), t.h, t.m);
  return new Date(guess - tzOffset(tz, new Date(guess)));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

// ---------------------------------------------------------------------------
// Row shapes (stored in ImportJob.rows between preview and commit)
// ---------------------------------------------------------------------------

interface EmployeeRow {
  name: string;
  email: string;
  employeeCode?: string;
  designation: string;
  department: string;
  phone: string;
  joiningDate: string;
  dateOfBirth?: string;
  managerEmail?: string;
  role: 'HR' | 'MANAGER' | 'EMPLOYEE';
  gender?: string;
  ctcAnnual?: number;
  location: string;
  employmentType?: string;
  maritalStatus?: string;
  personalEmail?: string;
  probationEndDate?: string;
  noticePeriodDays?: number;
  profile: Record<string, string>;
}

interface SalaryRow {
  employeeId: string;
  employeeCode: string;
  values: Partial<Record<SalaryField, number>>;
}

interface HolidayRow {
  date: string;
  name: string;
  optional: boolean;
}

interface LeaveBalanceRow {
  employeeId: string;
  employeeCode: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  balance: number;
}

interface AttendanceRow {
  employeeId: string;
  employeeCode: string;
  date: string;
  status: AttendanceStatus;
  checkIn?: string;
  checkOut?: string;
}

type RowData = EmployeeRow | SalaryRow | HolidayRow | LeaveBalanceRow | AttendanceRow;

interface Item {
  /** Line number in the file (header = 1). */
  row: number;
  data: RowData | null;
  errors: string[];
  raw: Record<string, string>;
}

interface StoredRows {
  options: { overwrite: boolean };
  items: Item[];
}

interface RowError {
  row: number;
  stage: 'validation' | 'commit';
  errors: string[];
}

const SALARY_FIELDS = {
  basic: 'salaryBasic',
  hra: 'salaryHra',
  conveyance: 'salaryConveyance',
  medical: 'salaryMedical',
  allowance: 'salaryAllowance',
  pfEmployee: 'salaryPfEmployee',
  pfEmployer: 'salaryPfEmployer',
} as const;
type SalaryField = (typeof SALARY_FIELDS)[keyof typeof SALARY_FIELDS];

const PROFILE_FIELDS = [
  'bankName', 'accountNumber', 'ifsc', 'pan', 'uan', 'pfNumber', 'aadhaarNumber', 'fatherName', 'bloodGroup', 'address', 'emergencyContact',
] as const;
const PROFILE_MAX: Record<string, number> = {
  bankName: 120, accountNumber: 30, ifsc: 15, pan: 15, uan: 20, pfNumber: 30, aadhaarNumber: 20, fatherName: 120, bloodGroup: 5, address: 500, emergencyContact: 120,
};

const STATUSES: AttendanceStatus[] = ['PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HOLIDAY', 'WEEKEND', 'HALF_DAY'];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

async function employeeCodeMap(companyId: string) {
  const list = await prisma.employee.findMany({
    where: { companyId },
    select: { id: true, employeeCode: true, isActive: true, user: { select: { email: true } } },
  });
  return {
    byCode: new Map(list.map((e) => [e.employeeCode.toLowerCase(), e])),
    byEmail: new Map(list.map((e) => [e.user.email.toLowerCase(), e])),
  };
}

function requireCols(type: ImportType, header: string[]): void {
  const have = new Set(header.map(norm));
  const missing = TEMPLATES[type].required.filter((c) => !have.has(norm(c)));
  if (missing.length) throw ApiError.badRequest(`Missing required column(s): ${missing.join(', ')}. Download the template for the expected format.`);
}

async function validateEmployees(companyId: string, rows: Record<string, string>[]): Promise<Item[]> {
  const { byCode, byEmail } = await employeeCodeMap(companyId);
  const fileEmails = new Set(rows.map((r) => reader(r)('email').toLowerCase()).filter(Boolean));
  const superAdmins = new Set(
    (await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', email: { in: [...fileEmails] } }, select: { email: true } })).map((u) => u.email.toLowerCase())
  );
  const seenEmail = new Set<string>();
  const seenCode = new Set<string>();
  return rows.map((raw, i) => {
    const get = reader(raw);
    const errors: string[] = [];
    const name = get('name');
    const email = get('email').toLowerCase();
    const code = get('employeeCode');
    if (name.length < 2 || name.length > 120) errors.push('name must be 2–120 characters');
    if (!EMAIL_RE.test(email)) errors.push('email is not valid');
    else if (seenEmail.has(email)) errors.push('email appears more than once in the file');
    else if (byEmail.has(email)) errors.push('an employee with this email already exists in this company');
    else if (superAdmins.has(email)) errors.push('this email belongs to the platform super admin');
    seenEmail.add(email);
    if (code) {
      if (code.length > 30) errors.push('employeeCode must be at most 30 characters');
      else if (seenCode.has(code.toLowerCase())) errors.push('employeeCode appears more than once in the file');
      else if (byCode.has(code.toLowerCase())) errors.push(`employeeCode "${code}" is already taken`);
      seenCode.add(code.toLowerCase());
    }
    const joining = parseDate(get('joiningDate'));
    if (!joining) errors.push('joiningDate must be a valid date (YYYY-MM-DD)');
    const dobRaw = get('dateOfBirth');
    const dob = dobRaw ? parseDate(dobRaw) : null;
    if (dobRaw && !dob) errors.push('dateOfBirth is not a valid date');
    if (dob && dob >= dateOnlyUTC()) errors.push('dateOfBirth must be in the past');
    const probRaw = get('probationEndDate');
    const prob = probRaw ? parseDate(probRaw) : null;
    if (probRaw && !prob) errors.push('probationEndDate is not a valid date');
    if (prob && joining && prob < joining) errors.push('probationEndDate is before joiningDate');
    const roleRaw = (get('role') || 'EMPLOYEE').toUpperCase();
    if (!['HR', 'MANAGER', 'EMPLOYEE'].includes(roleRaw)) errors.push('role must be EMPLOYEE, MANAGER or HR');
    const genderRaw = get('gender').toUpperCase();
    const gender = ({ M: 'MALE', F: 'FEMALE', MALE: 'MALE', FEMALE: 'FEMALE', OTHER: 'OTHER', O: 'OTHER' } as Record<string, string>)[genderRaw];
    if (genderRaw && !gender) errors.push('gender must be MALE, FEMALE or OTHER');
    const ctcRaw = get('ctcAnnual');
    const ctc = ctcRaw ? parseNum(ctcRaw) : null;
    if (ctcRaw && (ctc === null || ctc < 0 || ctc > 1_200_000_000)) errors.push('ctcAnnual must be a positive amount');
    const noticeRaw = get('noticePeriodDays');
    const notice = noticeRaw ? parseNum(noticeRaw) : null;
    if (noticeRaw && (notice === null || !Number.isInteger(notice) || notice < 0 || notice > 365)) errors.push('noticePeriodDays must be 0–365');
    const managerEmail = get('managerEmail').toLowerCase();
    if (managerEmail) {
      if (managerEmail === email) errors.push('managerEmail cannot be the employee themself');
      else if (!byEmail.has(managerEmail) && !fileEmails.has(managerEmail)) errors.push(`manager "${managerEmail}" is neither an employee nor in this file`);
    }
    const personalEmail = get('personalEmail');
    if (personalEmail && !EMAIL_RE.test(personalEmail)) errors.push('personalEmail is not valid');
    const phone = get('phone');
    if (phone.length > 20) errors.push('phone must be at most 20 characters');
    for (const [k, max] of [['designation', 80], ['department', 80], ['location', 120], ['employmentType', 30]] as const) {
      if (get(k).length > max) errors.push(`${k} must be at most ${max} characters`);
    }
    const profile: Record<string, string> = {};
    for (const f of PROFILE_FIELDS) {
      const v = get(f);
      if (!v) continue;
      if (v.length > (PROFILE_MAX[f] ?? 120)) errors.push(`${f} is too long`);
      profile[f] = f === 'ifsc' || f === 'pan' ? v.toUpperCase() : v;
    }
    const data: EmployeeRow = {
      name,
      email,
      ...(code ? { employeeCode: code } : {}),
      designation: get('designation'),
      department: get('department'),
      phone,
      joiningDate: joining ? iso(joining) : '',
      ...(dob ? { dateOfBirth: iso(dob) } : {}),
      ...(managerEmail ? { managerEmail } : {}),
      role: roleRaw as EmployeeRow['role'],
      ...(gender ? { gender } : {}),
      ...(ctc !== null ? { ctcAnnual: ctc } : {}),
      location: get('location'),
      ...(get('employmentType') ? { employmentType: get('employmentType') } : {}),
      ...(get('maritalStatus') ? { maritalStatus: get('maritalStatus') } : {}),
      ...(personalEmail ? { personalEmail } : {}),
      ...(prob ? { probationEndDate: iso(prob) } : {}),
      ...(notice !== null ? { noticePeriodDays: notice } : {}),
      profile,
    };
    return { row: i + 2, data: errors.length ? null : data, errors, raw };
  });
}

async function validateSalaries(companyId: string, rows: Record<string, string>[]): Promise<Item[]> {
  const { byCode } = await employeeCodeMap(companyId);
  const seen = new Set<string>();
  return rows.map((raw, i) => {
    const get = reader(raw);
    const errors: string[] = [];
    const code = get('employeeCode');
    const emp = byCode.get(code.toLowerCase());
    if (!code) errors.push('employeeCode is required');
    else if (!emp) errors.push(`no employee with code "${code}"`);
    else if (seen.has(emp.id)) errors.push('employee appears more than once in the file');
    if (emp) seen.add(emp.id);
    const values: Partial<Record<SalaryField, number>> = {};
    for (const [col, field] of Object.entries(SALARY_FIELDS)) {
      const v = get(col);
      if (v === '') {
        if (col === 'basic') errors.push('basic is required');
        continue;
      }
      const n = parseNum(v);
      if (n === null || n < 0 || n > 10_000_000) errors.push(`${col} must be an amount between 0 and 1,00,00,000`);
      else values[field] = Math.round(n * 100) / 100;
    }
    return {
      row: i + 2,
      data: errors.length || !emp ? null : { employeeId: emp.id, employeeCode: emp.employeeCode, values },
      errors,
      raw,
    };
  });
}

async function validateHolidays(companyId: string, rows: Record<string, string>[]): Promise<Item[]> {
  const seen = new Set<string>();
  void companyId;
  return rows.map((raw, i) => {
    const get = reader(raw);
    const errors: string[] = [];
    const date = parseDate(get('date'));
    const name = get('name');
    if (!date) errors.push('date must be a valid date (YYYY-MM-DD)');
    if (name.length < 2 || name.length > 80) errors.push('name must be 2–80 characters');
    const key = `${date ? iso(date) : ''}|${name.toLowerCase()}`;
    if (date && name && seen.has(key)) errors.push('holiday appears more than once in the file');
    seen.add(key);
    return {
      row: i + 2,
      data: errors.length || !date ? null : { date: iso(date), name, optional: parseBool(get('optional')) },
      errors,
      raw,
    };
  });
}

async function validateLeaveBalances(companyId: string, rows: Record<string, string>[]): Promise<Item[]> {
  const [{ byCode }, types] = await Promise.all([
    employeeCodeMap(companyId),
    prisma.leaveType.findMany({ where: { companyId }, select: { id: true, code: true, allowNegative: true, maxNegative: true, isActive: true } }),
  ]);
  const typeByCode = new Map(types.map((t) => [t.code.toUpperCase(), t]));
  const seen = new Set<string>();
  return rows.map((raw, i) => {
    const get = reader(raw);
    const errors: string[] = [];
    const code = get('employeeCode');
    const emp = byCode.get(code.toLowerCase());
    if (!emp) errors.push(code ? `no employee with code "${code}"` : 'employeeCode is required');
    const typeCode = get('leaveTypeCode').toUpperCase();
    const type = typeByCode.get(typeCode);
    if (!type) errors.push(typeCode ? `no leave type with code "${typeCode}"` : 'leaveTypeCode is required');
    else if (!type.isActive) errors.push(`leave type "${typeCode}" is inactive`);
    const balance = parseNum(get('balance'));
    if (balance === null) errors.push('balance must be a number');
    else if (balance > 366) errors.push('balance cannot exceed 366 days');
    else if (balance < 0 && !(type?.allowNegative && -balance <= type.maxNegative)) errors.push('balance cannot be negative for this leave type');
    else if (Math.round(balance * 2) !== balance * 2) errors.push('balance must be in steps of 0.5');
    if (emp && type) {
      const key = `${emp.id}:${type.id}`;
      if (seen.has(key)) errors.push('employee + leave type appears more than once in the file');
      seen.add(key);
    }
    return {
      row: i + 2,
      data:
        errors.length || !emp || !type || balance === null
          ? null
          : { employeeId: emp.id, employeeCode: emp.employeeCode, leaveTypeId: type.id, leaveTypeCode: type.code, balance },
      errors,
      raw,
    };
  });
}

async function validateAttendance(companyId: string, rows: Record<string, string>[], overwrite: boolean): Promise<Item[]> {
  const { byCode } = await employeeCodeMap(companyId);
  const today = dateOnlyUTC();
  const parsed = rows.map((raw) => {
    const get = reader(raw);
    return { raw, get, emp: byCode.get(get('employeeCode').toLowerCase()), date: parseDate(get('date')) };
  });
  // Existing punched records for the (employee, date) pairs in the file.
  const pairs = parsed.filter((p) => p.emp && p.date);
  const dates = pairs.map((p) => p.date as Date);
  const existing =
    pairs.length === 0
      ? []
      : await prisma.attendanceRecord.findMany({
          where: {
            companyId,
            employeeId: { in: [...new Set(pairs.map((p) => p.emp!.id))] },
            date: { gte: new Date(Math.min(...dates.map((d) => d.getTime()))), lte: new Date(Math.max(...dates.map((d) => d.getTime()))) },
            checkIn: { not: null },
          },
          select: { employeeId: true, date: true },
        });
  const punched = new Set(existing.map((r) => `${r.employeeId}:${iso(r.date)}`));
  const seen = new Set<string>();
  return parsed.map(({ raw, get, emp, date }, i) => {
    const errors: string[] = [];
    const code = get('employeeCode');
    if (!emp) errors.push(code ? `no employee with code "${code}"` : 'employeeCode is required');
    if (!date) errors.push('date must be a valid date (YYYY-MM-DD)');
    else if (date > today) errors.push('date cannot be in the future');
    const status = get('status').toUpperCase().replace(/[\s-]+/g, '_') as AttendanceStatus;
    if (!STATUSES.includes(status)) errors.push(`status must be one of ${STATUSES.join(', ')}`);
    const inRaw = get('checkIn');
    const outRaw = get('checkOut');
    const tIn = inRaw ? parseTime(inRaw) : null;
    const tOut = outRaw ? parseTime(outRaw) : null;
    if (inRaw && !tIn) errors.push('checkIn must be HH:mm');
    if (outRaw && !tOut) errors.push('checkOut must be HH:mm');
    if (outRaw && !inRaw) errors.push('checkOut needs a checkIn');
    if (tIn && tOut && tOut.h * 60 + tOut.m <= tIn.h * 60 + tIn.m) errors.push('checkOut must be after checkIn');
    if (emp && date) {
      const key = `${emp.id}:${iso(date)}`;
      if (seen.has(key)) errors.push('employee + date appears more than once in the file');
      seen.add(key);
      if (punched.has(key) && !overwrite) errors.push('a punched record already exists for this day (re-upload with overwrite to replace it)');
    }
    return {
      row: i + 2,
      data:
        errors.length || !emp || !date
          ? null
          : {
              employeeId: emp.id,
              employeeCode: emp.employeeCode,
              date: iso(date),
              status,
              ...(inRaw ? { checkIn: inRaw } : {}),
              ...(outRaw ? { checkOut: outRaw } : {}),
            },
      errors,
      raw,
    };
  });
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export interface PreviewOptions {
  overwrite: boolean;
  createdById: string | null;
}

export async function preview(companyId: string, type: ImportType, file: { name: string; buffer: Buffer }, opts: PreviewOptions) {
  const text = file.buffer.toString('utf8');
  if (text.includes('\u0000')) throw ApiError.badRequest('The file does not look like a CSV (binary content). Save it as CSV (UTF-8).');
  const [header, ...body] = parseCsv(text);
  if (!header) throw ApiError.badRequest('The file is empty');
  requireCols(type, header);
  if (body.length === 0) throw ApiError.badRequest('The file has a header row but no data rows');
  if (body.length > MAX_ROWS) throw ApiError.badRequest(`At most ${MAX_ROWS} rows per import (this file has ${body.length})`);
  const keys = header.map((h) => h.trim());
  const rows = body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));

  const items =
    type === 'EMPLOYEES'
      ? await validateEmployees(companyId, rows)
      : type === 'SALARIES'
        ? await validateSalaries(companyId, rows)
        : type === 'HOLIDAYS'
          ? await validateHolidays(companyId, rows)
          : type === 'LEAVE_BALANCES'
            ? await validateLeaveBalances(companyId, rows)
            : await validateAttendance(companyId, rows, opts.overwrite);

  const errors: RowError[] = items.filter((it) => it.errors.length).map((it) => ({ row: it.row, stage: 'validation', errors: it.errors }));
  const stored: StoredRows = { options: { overwrite: opts.overwrite }, items };
  const job = await prisma.importJob.create({
    data: {
      companyId,
      type,
      fileName: file.name.slice(0, 200),
      status: 'PREVIEW',
      total: items.length,
      success: 0,
      failed: errors.length,
      rows: json(stored),
      errors: json(errors),
      createdById: opts.createdById,
    },
  });
  return { ...summary(job), columns: keys, rows: items.map(({ row, errors: e, raw }) => ({ row, valid: e.length === 0, errors: e, values: raw })) };
}

function summary(job: { id: string; type: string; fileName: string; status: string; total: number; success: number; failed: number; createdAt: Date; errors: Prisma.JsonValue }) {
  const errors = (Array.isArray(job.errors) ? job.errors : []) as unknown as RowError[];
  const invalid = errors.filter((e) => e.stage === 'validation').length;
  return {
    id: job.id,
    type: job.type,
    fileName: job.fileName,
    status: job.status,
    total: job.total,
    valid: job.total - invalid,
    invalid,
    success: job.success,
    failed: job.failed,
    createdAt: job.createdAt,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export interface CommitOptions {
  /** Employee (or user) id of the admin committing. */
  actorEmployeeId: string | null;
  audit: (entry: AuditEntry) => Promise<void>;
}

interface Credential {
  row: number;
  name: string;
  email: string;
  employeeCode: string;
  /** null when the email already had a login (existing password unchanged). */
  tempPassword: string | null;
}

export async function commit(companyId: string, jobId: string, opts: CommitOptions) {
  const job = await prisma.importJob.findFirst({ where: { id: jobId, companyId } });
  if (!job) throw ApiError.notFound('Import not found');
  if (job.status !== 'PREVIEW') throw ApiError.conflict(`This import is already ${job.status.toLowerCase()}`);
  // Claim the job so a double click cannot apply it twice.
  const claimed = await prisma.importJob.updateMany({ where: { id: job.id, status: 'PREVIEW' }, data: { status: 'PROCESSING' } });
  if (claimed.count === 0) throw ApiError.conflict('This import is already being processed');

  const stored = job.rows as unknown as StoredRows | null;
  const items = stored?.items ?? [];
  const valid = items.filter((it) => it.data && it.errors.length === 0);
  const failures: RowError[] = ((Array.isArray(job.errors) ? job.errors : []) as unknown as RowError[]).filter((e) => e.stage === 'validation');
  const credentials: Credential[] = [];
  const warnings: { row: number; message: string }[] = [];
  let success = 0;

  try {
    const ctx = await commitContext(companyId);
    const created: { row: number; employeeId: string; managerEmail?: string }[] = [];
    for (const it of valid) {
      try {
        switch (job.type as ImportType) {
          case 'EMPLOYEES': {
            const r = await applyEmployee(companyId, it.row, it.data as EmployeeRow, ctx, opts);
            credentials.push(r.credential);
            if (r.warning) warnings.push({ row: it.row, message: r.warning });
            created.push({ row: it.row, employeeId: r.employeeId, managerEmail: (it.data as EmployeeRow).managerEmail });
            break;
          }
          case 'SALARIES':
            await applySalary(companyId, it.data as SalaryRow, opts, job.id);
            break;
          case 'HOLIDAYS':
            await applyHoliday(companyId, it.data as HolidayRow);
            break;
          case 'LEAVE_BALANCES':
            await applyLeaveBalance(companyId, it.data as LeaveBalanceRow, opts, job.id);
            break;
          case 'ATTENDANCE':
            await applyAttendance(companyId, it.data as AttendanceRow, ctx, stored?.options.overwrite ?? false, opts, job.id);
            break;
        }
        success += 1;
      } catch (err) {
        failures.push({ row: it.row, stage: 'commit', errors: [errorMessage(err)] });
      }
    }

    // Second pass: managers, now that every row's employee exists.
    if (created.some((c) => c.managerEmail)) {
      const { byEmail } = await employeeCodeMap(companyId);
      for (const c of created) {
        if (!c.managerEmail) continue;
        const mgr = byEmail.get(c.managerEmail);
        if (!mgr) {
          warnings.push({ row: c.row, message: `manager ${c.managerEmail} not found — set the manager manually` });
          continue;
        }
        await prisma.employee.update({ where: { id: c.employeeId }, data: { managerId: mgr.id } });
      }
    }
  } catch (err) {
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', success, failed: job.total - success, errors: json([...failures, { row: 0, stage: 'commit', errors: [errorMessage(err)] }]) },
    });
    throw err;
  }

  failures.sort((a, b) => a.row - b.row);
  const updated = await prisma.importJob.update({
    where: { id: job.id },
    data: {
      status: success === 0 && items.length > 0 ? 'FAILED' : 'COMMITTED',
      success,
      failed: job.total - success,
      errors: json(failures),
    },
  });
  await opts.audit({
    entity: 'ImportJob',
    entityId: job.id,
    action: 'COMMIT',
    after: { type: job.type, fileName: job.fileName, total: job.total, success, failed: job.total - success },
  });
  return {
    ...summary(updated),
    warnings,
    /** Shown once to the admin — temporary passwords are never stored. */
    credentials,
  };
}

const errorMessage = (err: unknown): string =>
  err instanceof ApiError
    ? err.message
    : (err as { code?: string }).code === 'P2002'
      ? 'A record with this value already exists'
      : err instanceof Error
        ? err.message
        : 'Failed';

async function commitContext(companyId: string) {
  const [company, departments, designations] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true, workStart: true } }),
    prisma.department.findMany({ where: { companyId }, select: { id: true, name: true } }),
    prisma.designation.findMany({ where: { companyId }, select: { id: true, name: true } }),
  ]);
  return {
    tz: company?.timezone ?? 'Asia/Kolkata',
    workStart: parseTime(company?.workStart ?? '09:30') ?? { h: 9, m: 30 },
    departments: new Map(departments.map((d) => [d.name.toLowerCase(), d.id])),
    designations: new Map(designations.map((d) => [d.name.toLowerCase(), d.id])),
  };
}
type CommitContext = Awaited<ReturnType<typeof commitContext>>;

/** Readable random temporary password, e.g. "Hr-7fK2pQ9x". */
function tempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(10);
  return `Hr-${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

async function applyEmployee(companyId: string, row: number, d: EmployeeRow, ctx: CommitContext, opts: CommitOptions) {
  const existingUser = await prisma.user.findUnique({ where: { email: d.email }, select: { id: true } });
  const password = existingUser ? undefined : tempPassword();
  const { employee } = await createEmployee(companyId, {
    name: d.name,
    email: d.email,
    password,
    role: d.role,
    employeeCode: d.employeeCode,
    designation: d.designation,
    department: d.department,
    phone: d.phone,
    location: d.location,
    joiningDate: new Date(d.joiningDate),
    ...(d.dateOfBirth ? { dateOfBirth: new Date(d.dateOfBirth) } : {}),
    ...(d.employmentType ? { employmentType: d.employmentType } : {}),
    ...(d.ctcAnnual !== undefined ? { salaryCtc: Math.round(d.ctcAnnual / 12) } : {}),
    ...d.profile,
  });

  // Fields createEmployee does not take: master links and personal details.
  let warning: string | undefined;
  const extra: Prisma.EmployeeUncheckedUpdateInput = {
    ...(d.gender ? { gender: d.gender } : {}),
    ...(d.maritalStatus ? { maritalStatus: d.maritalStatus } : {}),
    ...(d.personalEmail ? { personalEmail: d.personalEmail } : {}),
    ...(d.probationEndDate ? { probationEndDate: new Date(d.probationEndDate) } : {}),
    ...(d.noticePeriodDays !== undefined ? { noticePeriodDays: d.noticePeriodDays } : {}),
  };
  const deptId = d.department ? ctx.departments.get(d.department.toLowerCase()) : undefined;
  if (deptId) extra.departmentId = deptId;
  const desigId = d.designation ? ctx.designations.get(d.designation.toLowerCase()) : undefined;
  if (desigId) extra.designationId = desigId;
  if (Object.keys(extra).length) {
    try {
      await prisma.employee.update({ where: { id: employee.id }, data: extra });
    } catch (err) {
      warning = `created, but some details were not saved: ${errorMessage(err)}`;
    }
  }

  await opts.audit({
    entity: 'Employee',
    entityId: employee.id,
    action: 'CREATE',
    after: { employeeCode: employee.employeeCode, name: employee.name, email: d.email, role: d.role, source: 'import' },
  });
  await notify(companyId, [employee.id], {
    event: 'employee.created',
    title: 'Welcome aboard',
    body: password
      ? `Your account has been created. Sign in with ${d.email} and the temporary password shared by HR, then change it.`
      : `You have been added to the company. Sign in with your existing ${d.email} account.`,
    link: '/profile',
    email: true,
  });
  return {
    employeeId: employee.id,
    warning,
    credential: { row, name: employee.name, email: d.email, employeeCode: employee.employeeCode, tempPassword: password ?? null },
  };
}

async function applySalary(companyId: string, d: SalaryRow, opts: CommitOptions, jobId: string) {
  const select = {
    salaryBasic: true, salaryHra: true, salaryConveyance: true, salaryMedical: true, salaryAllowance: true, salaryPfEmployee: true, salaryPfEmployer: true,
  } as const;
  const { before, after } = await prisma.$transaction(async (tx) => {
    const before = await tx.employee.findFirst({ where: { id: d.employeeId, companyId }, select });
    if (!before) throw ApiError.notFound('Employee no longer exists');
    const after = await tx.employee.update({ where: { id: d.employeeId }, data: d.values, select });
    return { before, after };
  });
  const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => before[k] !== after[k]);
  if (changed.length === 0) return;
  await opts.audit({
    entity: 'Employee',
    entityId: d.employeeId,
    action: 'UPDATE',
    before: { ...Object.fromEntries(changed.map((k) => [k, before[k]])) },
    after: { ...Object.fromEntries(changed.map((k) => [k, after[k]])), source: `import ${jobId}` },
  });
}

async function applyHoliday(companyId: string, d: HolidayRow) {
  const date = new Date(d.date);
  await prisma.holiday.upsert({
    where: { companyId_date_name: { companyId, date, name: d.name } },
    create: { companyId, date, name: d.name, optional: d.optional },
    update: { optional: d.optional },
  });
}

async function applyLeaveBalance(companyId: string, d: LeaveBalanceRow, opts: CommitOptions, jobId: string) {
  const year = dateOnlyUTC().getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const dec31 = new Date(Date.UTC(year, 11, 31));
  const previous = await prisma.$transaction(async (tx) => {
    const emp = await tx.employee.findFirst({ where: { id: d.employeeId, companyId }, select: { id: true } });
    if (!emp) throw ApiError.notFound('Employee no longer exists');
    const where = { companyId, employeeId: d.employeeId, leaveTypeId: d.leaveTypeId, kind: 'OPENING', date: { gte: jan1, lte: dec31 } };
    const old = await tx.leaveLedger.findMany({ where, select: { change: true } });
    await tx.leaveLedger.deleteMany({ where });
    await tx.leaveLedger.create({
      data: {
        companyId,
        employeeId: d.employeeId,
        leaveTypeId: d.leaveTypeId,
        date: jan1,
        change: d.balance,
        kind: 'OPENING',
        reason: `Opening balance ${year} (import)`,
        refId: jobId,
        createdById: opts.actorEmployeeId,
      },
    });
    return old.reduce((s, o) => s + o.change, 0);
  });
  await opts.audit({
    entity: 'LeaveLedger',
    entityId: d.employeeId,
    action: 'ADJUSTMENT',
    before: { leaveType: d.leaveTypeCode, opening: previous },
    after: { leaveType: d.leaveTypeCode, opening: d.balance, year, source: `import ${jobId}` },
  });
}

async function applyAttendance(
  companyId: string,
  d: AttendanceRow,
  ctx: CommitContext,
  overwrite: boolean,
  opts: CommitOptions,
  jobId: string
) {
  const date = new Date(d.date);
  const tIn = d.checkIn ? parseTime(d.checkIn) : null;
  const tOut = d.checkOut ? parseTime(d.checkOut) : null;
  const checkIn = tIn ? zonedToUtc(date, tIn, ctx.tz) : null;
  const checkOut = tOut ? zonedToUtc(date, tOut, ctx.tz) : null;
  const workedMinutes = checkIn && checkOut ? Math.round((checkOut.getTime() - checkIn.getTime()) / 60000) : null;
  const lateMinutes = tIn ? Math.max(0, tIn.h * 60 + tIn.m - (ctx.workStart.h * 60 + ctx.workStart.m)) : 0;
  const data = {
    status: d.status,
    checkIn,
    checkOut,
    workedMinutes,
    lateMinutes: d.status === 'LATE' || d.status === 'PRESENT' || d.status === 'HALF_DAY' ? lateMinutes : 0,
    isAutoMarked: false,
    note: 'Imported',
  };
  const before = await prisma.$transaction(async (tx) => {
    const existing = await tx.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: d.employeeId, date } } });
    if (existing && existing.companyId !== companyId) throw ApiError.forbidden();
    if (existing?.checkIn && !overwrite) throw ApiError.conflict('A punched record exists for this day (use overwrite)');
    await tx.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId: d.employeeId, date } },
      create: { companyId, employeeId: d.employeeId, date, ...data },
      update: data,
    });
    return existing;
  });
  if (before && !before.isAutoMarked) {
    await opts.audit({
      entity: 'AttendanceRecord',
      entityId: before.id,
      action: 'UPDATE',
      before: { status: before.status, checkIn: before.checkIn, checkOut: before.checkOut },
      after: { status: data.status, checkIn, checkOut, source: `import ${jobId}` },
    });
  }
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export async function list(companyId: string) {
  const jobs = await prisma.importJob.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, type: true, fileName: true, status: true, total: true, success: true, failed: true, createdAt: true, createdById: true },
  });
  const ids = [...new Set(jobs.map((j) => j.createdById).filter((x): x is string => !!x))];
  const people = await prisma.employee.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(people.map((p) => [p.id, p.name]));
  return jobs.map(({ createdById, ...j }) => ({ ...j, createdBy: createdById ? (names.get(createdById) ?? null) : null }));
}

export async function get(companyId: string, id: string) {
  const job = await prisma.importJob.findFirst({ where: { id, companyId } });
  if (!job) throw ApiError.notFound('Import not found');
  const stored = job.rows as unknown as StoredRows | null;
  const items = stored?.items ?? [];
  const columns = items[0] ? Object.keys(items[0].raw) : [];
  return {
    ...summary(job),
    overwrite: stored?.options.overwrite ?? false,
    columns,
    rows: items.slice(0, 1000).map(({ row, errors, raw }) => ({ row, valid: errors.length === 0, errors, values: raw })),
  };
}
