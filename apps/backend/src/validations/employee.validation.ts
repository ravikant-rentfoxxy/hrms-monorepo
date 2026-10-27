import { z } from 'zod';
import { passwordRule } from './auth.validation';

/** Optional date where null / '' clears the value. */
const clearableDate = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable()).optional();
/** Optional uuid link where null / '' clears it. */
const clearableId = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable()).optional();

export const employeeProfileSchema = z.object({
  name: z.string().min(2).max(120),
  designation: z.string().max(80).optional(),
  department: z.string().max(80).optional(),
  phone: z.string().max(20).optional(),
  location: z.string().max(120).optional(),
  joiningDate: z.coerce.date().optional(),
  // Last working day; null/'' clears it (employee no longer exiting).
  leavingDate: z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable()).optional(),
  dateOfBirth: z.coerce.date().optional(),
  managerId: z.string().uuid().nullable().optional(),
  bloodGroup: z.string().max(5).optional(),
  address: z.string().max(500).optional(),
  emergencyContact: z.string().max(120).optional(),
  bankName: z.string().max(120).optional(),
  accountNumber: z.string().max(30).optional(),
  ifsc: z.string().max(15).optional(),
  pan: z.string().max(15).optional(),
  // Statutory & identity (shown in the app's "My financial information").
  pfNumber: z.string().max(30).optional(),
  uan: z.string().max(20).optional(),
  aadhaarNumber: z.string().max(20).optional(),
  fatherName: z.string().max(120).optional(),
  employmentType: z.string().max(30).optional(),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  // Monthly salary structure — settable by ADMIN/HR only (enforced in the
  // service). HR types basic/HRA/allowance and both PF amounts; sub total,
  // CTC and net pay are always derived. salaryCtc remains an API convenience
  // that derives a standard structure.
  salaryCtc: z.number().min(0).max(100_000_000).optional(),
  salaryBasic: z.number().min(0).max(10_000_000).optional(),
  salaryHra: z.number().min(0).max(10_000_000).optional(),
  salaryConveyance: z.number().min(0).max(1_000_000).optional(),
  salaryMedical: z.number().min(0).max(1_000_000).optional(),
  salaryAllowance: z.number().min(0).max(10_000_000).optional(),
  salaryPfEmployer: z.number().min(0).max(1_000_000).optional(),
  salaryPfEmployee: z.number().min(0).max(1_000_000).optional(),
  // Master-data links; the text department / designation follow the master's name.
  departmentId: clearableId,
  designationId: clearableId,
  gradeId: clearableId,
  officeId: clearableId,
  workMode: z.enum(['OFFICE', 'REMOTE', 'FIELD']).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', '']).optional(),
  maritalStatus: z.enum(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', '']).optional(),
  personalEmail: z.union([z.string().email().max(160).toLowerCase(), z.literal('')]).optional(),
  probationEndDate: clearableDate,
  confirmedOn: clearableDate,
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional(),
  esiNumber: z.string().max(20).optional(),
  taxRegime: z.enum(['NEW', 'OLD']).optional(),
});

export const createEmployeeSchema = employeeProfileSchema.extend({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128).optional(),
  // Employee ID is auto-generated ("RF-011") when omitted — the normal case.
  employeeCode: z.string().min(1).max(30).optional(),
  role: z.enum(['HR', 'MANAGER', 'EMPLOYEE', 'FINANCE']).default('EMPLOYEE'),
});

export const setRoleSchema = z.object({ role: z.enum(['EMPLOYEE', 'MANAGER', 'HR', 'FINANCE']) });

export const updateEmployeeSchema = employeeProfileSchema.partial().extend({
  employeeCode: z.string().min(1).max(30).optional(),
  isActive: z.boolean().optional(),
  // Written on the career-history rows of a department / designation / grade / manager / location change.
  changeReason: z.string().trim().max(500).optional(),
  effectiveDate: z.coerce.date().optional(),
});

export const directoryQuerySchema = z.object({
  q: z.string().max(100).optional(),
  department: z.string().max(80).optional(),
  departmentId: z.string().uuid().optional(),
  // CURRENT (default) | PROBATION | ACTIVE | NOTICE_PERIOD | SEPARATED (former employees, ADMIN/HR) | ALL (ADMIN/HR)
  status: z.enum(['CURRENT', 'PROBATION', 'ACTIVE', 'NOTICE_PERIOD', 'SEPARATED', 'ALL']).optional(),
  rehireEligible: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const orgChartQuerySchema = z.object({ rootId: z.string().uuid().optional() });

/** HR / Admin sets an employee's login password (e.g. a joiner who has none yet). */
export const setPasswordSchema = z.object({ password: passwordRule });
