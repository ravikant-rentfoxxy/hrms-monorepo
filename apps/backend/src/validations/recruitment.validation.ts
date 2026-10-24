import { z } from 'zod';

export const JOB_STATUSES = ['DRAFT', 'APPROVED', 'OPEN', 'ON_HOLD', 'FILLED', 'CLOSED', 'CANCELLED'] as const;
export const SOURCES = [
  'CAREERS', 'REFERRAL', 'LINKEDIN', 'NAUKRI', 'INDEED', 'INTERNSHALA', 'FOUNDIT', 'INSTAHYRE', 'JOB_BOARD', 'EMAIL', 'DIRECT',
  'AGENCY', 'WALK_IN', 'OTHER',
] as const;
export const PLATFORMS = ['LINKEDIN', 'NAUKRI', 'INDEED', 'INTERNSHALA', 'FOUNDIT', 'INSTAHYRE', 'CAREERS_PAGE', 'OTHER'] as const;
export const APPLICATION_STAGES = [
  'APPLIED', 'SHORTLISTED', 'ON_HOLD', 'HR_SCREENED', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED', 'SELECTED', 'OFFERED',
  'OFFER_ACCEPTED', 'PRE_ONBOARDING', 'DOCUMENTS_VERIFIED', 'READY_TO_JOIN', 'JOINED', 'REJECTED', 'WITHDRAWN', 'OFFER_DECLINED',
] as const;
export const INTERVIEW_TYPES = ['TECHNICAL', 'HR', 'MANAGERIAL', 'CULTURE', 'ASSIGNMENT', 'OTHER'] as const;
export const INTERVIEW_MODES = ['ONSITE', 'VIDEO', 'PHONE'] as const;
export const INTERVIEW_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'] as const;
export const RECOMMENDATIONS = ['STRONG_HIRE', 'HIRE', 'NO_HIRE', 'STRONG_NO_HIRE'] as const;
export const OFFER_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'NEGOTIATING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN'] as const;
export const REQUISITION_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export const PRE_JOINING_DOC_TYPES = [
  'ID_PROOF', 'ADDRESS_PROOF', 'PAN', 'AADHAAR', 'PHOTO', 'EDUCATION', 'EXPERIENCE', 'RELIEVING', 'PAYSLIPS', 'BANK', 'OTHER',
] as const;
export const BGV_STATUSES = ['NOT_REQUIRED', 'PENDING', 'IN_PROGRESS', 'CLEAR', 'DISCREPANCY'] as const;

const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Intern', 'Consultant'] as const;
const clearableDate = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable()).optional();
const clearableId = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable()).optional();

const decision = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  remarks: z.string().trim().max(1000).optional(),
});

// ---- Requisitions ----

const requisitionBase = z.object({
  title: z.string().trim().min(2).max(160),
  departmentId: clearableId,
  department: z.string().trim().max(120).optional(),
  designation: z.string().trim().max(120).optional(),
  vacancies: z.number().int().min(1).max(500).optional(),
  minExperience: z.number().min(0).max(60).optional(),
  maxExperience: z.number().min(0).max(60).optional(),
  skills: z.string().max(1000).optional(),
  qualifications: z.string().max(1000).optional(),
  location: z.string().trim().max(120).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  budgetMinCtc: z.number().min(0).optional(),
  budgetMaxCtc: z.number().min(0).optional(),
  reason: z.enum(['NEW_POSITION', 'REPLACEMENT', 'EXPANSION']).optional(),
  replacementForId: clearableId,
  justification: z.string().max(5000).optional(),
  description: z.string().max(10000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  targetDate: clearableDate,
  hiringManagerId: clearableId,
});

export const requisitionSchema = requisitionBase.extend({ submit: z.boolean().optional() });
export const requisitionUpdateSchema = requisitionBase.partial();
export const requisitionListQuerySchema = z.object({
  status: z.enum(REQUISITION_STATUSES).optional(),
  scope: z.enum(['mine', 'all']).optional(),
});
export const requisitionReviewSchema = z.object({
  note: z.string().trim().min(3).max(2000),
  sendBack: z.boolean().optional(),
});
export const requisitionDecideSchema = decision;
export const cancelSchema = z.object({ reason: z.string().trim().max(1000).optional() });

// ---- Jobs ----

const ranges = <T extends { minExperience?: number; maxExperience?: number; minCtc?: number; maxCtc?: number }>(v: T) =>
  !(v.maxExperience && v.minExperience !== undefined && v.maxExperience < v.minExperience) &&
  !(v.maxCtc && v.minCtc !== undefined && v.maxCtc < v.minCtc);

export const jobUpdateSchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    department: z.string().trim().max(120),
    designation: z.string().trim().max(120),
    location: z.string().trim().max(120),
    employmentType: z.string().trim().max(40),
    openings: z.number().int().min(1).max(500),
    minExperience: z.number().min(0).max(60),
    maxExperience: z.number().min(0).max(60),
    minCtc: z.number().min(0),
    maxCtc: z.number().min(0),
    description: z.string().max(10000),
    skills: z.string().max(1000),
    qualifications: z.string().max(1000),
    status: z.enum(JOB_STATUSES),
    hiringManagerId: z.string().uuid().nullable(),
  })
  .partial()
  .refine(ranges, { message: 'Max experience / CTC cannot be below the minimum' });

export const jobStatusSchema = z.object({ status: z.enum(JOB_STATUSES) });

export const jobListQuerySchema = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  q: z.string().max(100).optional(),
});

// ---- Postings ----

const postingBase = z.object({
  platform: z.enum(PLATFORMS),
  platformName: z.string().trim().max(80).optional(),
  url: z.union([z.literal(''), z.string().trim().url().max(1000)]).optional(),
  externalId: z.string().trim().max(120).optional(),
  postedOn: clearableDate,
  expiresOn: clearableDate,
  cost: z.number().min(0).max(100_000_000).optional(),
  notes: z.string().max(2000).optional(),
});
export const postingSchema = postingBase.extend({ status: z.enum(['DRAFT', 'PUBLISHED']).optional() });
export const postingUpdateSchema = postingBase.partial();
export const postingStatusSchema = z.object({ status: z.enum(['PUBLISHED', 'ACTIVE', 'CLOSED', 'EXPIRED']) });
export const postingRenewSchema = z.object({ expiresOn: z.coerce.date() });
export const postingListQuerySchema = z.object({
  jobId: z.string().uuid().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ACTIVE', 'EXPIRED', 'CLOSED']).optional(),
  platform: z.enum(PLATFORMS).optional(),
});
export const rangeQuerySchema = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });

// ---- Candidates (multipart: numbers arrive as strings) ----

const candidateBase = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(30).default(''),
  currentCompany: z.string().trim().max(160).optional(),
  currentDesignation: z.string().trim().max(120).optional(),
  currentLocation: z.string().trim().max(120).optional(),
  currentCtc: z.coerce.number().min(0).optional(),
  expectedCtc: z.coerce.number().min(0).optional(),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional(),
  experienceYears: z.coerce.number().min(0).max(60).optional(),
  qualifications: z.string().max(1000).optional(),
  source: z.enum(SOURCES).optional(),
  skills: z.string().max(1000).optional(),
  notes: z.string().max(5000).optional(),
});

export const candidateSchema = candidateBase.extend({
  /** Optionally apply the candidate to a job right away. */
  jobId: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
  postingId: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
  externalRef: z.string().trim().max(120).optional(),
});
export const candidateUpdateSchema = candidateBase.partial();

/** One CSV row of a candidate import (see candidate.service IMPORT_COLUMNS). */
export const importRowSchema = z.object({
  name: z.string().trim().min(2, 'name is required').max(120),
  email: z.string().trim().toLowerCase().email('valid email is required'),
  phone: z.string().trim().max(30).default(''),
  skills: z.string().max(1000).optional(),
  experienceYears: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().min(0).max(60).optional()),
  currentCtc: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().min(0).optional()),
  expectedCtc: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().min(0).optional()),
  noticePeriodDays: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(0).max(365).optional()),
  currentCompany: z.string().trim().max(160).optional(),
  currentLocation: z.string().trim().max(120).optional(),
  source: z.preprocess((v) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase().replace(/[\s-]+/g, '_') : undefined), z.enum(SOURCES).optional()),
  externalRef: z.string().trim().max(120).optional(),
  postingId: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid('postingId must be a posting id').optional()),
});

export const importQuerySchema = z.object({ dryRun: z.enum(['true', 'false']).optional() });

export const candidateListQuerySchema = z.object({
  q: z.string().max(100).optional(),
  source: z.enum(SOURCES).optional(),
  jobId: z.string().uuid().optional(),
  stage: z.enum(APPLICATION_STAGES).optional(),
});

export const duplicateCheckQuerySchema = z
  .object({
    email: z.string().trim().toLowerCase().email().optional(),
    phone: z.string().trim().max(30).optional(),
  })
  .refine((v) => v.email || v.phone, { message: 'Pass email or phone' });

export const referralSchema = z.object({
  jobId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(30).default(''),
  currentCompany: z.string().trim().max(160).optional(),
  currentLocation: z.string().trim().max(120).optional(),
  experienceYears: z.coerce.number().min(0).max(60).optional(),
  skills: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
});

// ---- Applications ----

export const applicationSchema = z.object({
  jobId: z.string().uuid(),
  candidateId: z.string().uuid(),
  postingId: z.string().uuid().optional(),
  source: z.enum(SOURCES).optional(),
  externalRef: z.string().trim().max(120).optional(),
});

export const applicationListQuerySchema = z.object({
  jobId: z.string().uuid().optional(),
  stage: z.enum(APPLICATION_STAGES).optional(),
  assigned: z.enum(['me']).optional(),
  open: z.enum(['true', 'false']).optional(),
  q: z.string().max(100).optional(),
});

export const applicationUpdateSchema = z.object({
  assignedToId: z.string().uuid().nullable().optional(),
  postingId: z.string().uuid().nullable().optional(),
  source: z.enum(SOURCES).optional(),
  externalRef: z.string().trim().max(120).optional(),
  screeningNotes: z.string().max(5000).optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
});

export const stageSchema = z
  .object({
    stage: z.enum(['SHORTLISTED', 'ON_HOLD', 'REJECTED', 'WITHDRAWN']),
    reason: z.string().trim().max(1000).optional(),
  })
  .refine((v) => !['REJECTED', 'WITHDRAWN'].includes(v.stage) || (v.reason ?? '').length >= 3, {
    message: 'A reason is required',
    path: ['reason'],
  });

export const screenSchema = z
  .object({
    decision: z.enum(['SHORTLISTED', 'ON_HOLD', 'REJECTED']),
    notes: z.string().max(5000).optional(),
    rating: z.number().int().min(1).max(5).optional(),
    rejectionReason: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.decision !== 'REJECTED' || (v.rejectionReason ?? '').length >= 3, {
    message: 'A rejection reason is required',
    path: ['rejectionReason'],
  });

export const hrScreeningSchema = z.object({
  experienceVerified: z.boolean(),
  experienceYears: z.number().min(0).max(60).optional(),
  currentCtc: z.number().min(0).optional(),
  expectedCtc: z.number().min(0).optional(),
  noticePeriodDays: z.number().int().min(0).max(365).optional(),
  availableFrom: clearableDate,
  interested: z.boolean(),
  notes: z.string().max(5000).optional(),
});

export const recommendSchema = z.object({ note: z.string().trim().min(3).max(2000) });

export const selectSchema = z.object({
  proposedCtc: z.number().positive(),
  proposedJoiningDate: z.coerce.date(),
  note: z.string().trim().max(2000).optional(),
});

export const portalLinkSchema = z.object({ days: z.number().int().min(1).max(90).default(30) });

// ---- Interviews ----

export const interviewSchema = z.object({
  applicationId: z.string().uuid(),
  // A bare number ("1", "2") is stored as "Round 1", "Round 2".
  round: z.string().trim().min(1).max(80).transform((r) => (/^\d+$/.test(r) ? `Round ${r}` : r)),
  interviewType: z.enum(INTERVIEW_TYPES).default('TECHNICAL'),
  scheduledAt: z.coerce.date(),
  durationMinutes: z.number().int().min(10).max(480).default(60),
  mode: z.enum(INTERVIEW_MODES).default('VIDEO'),
  location: z.string().trim().max(500).default(''),
  panelIds: z.array(z.string().uuid()).min(1, 'Add at least one interviewer').max(10),
});

export const interviewUpdateSchema = interviewSchema.omit({ applicationId: true }).partial();

export const interviewListQuerySchema = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  upcoming: z.enum(['true', 'false']).optional(),
  applicationId: z.string().uuid().optional(),
  status: z.enum(INTERVIEW_STATUSES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const interviewCancelSchema = z.object({ reason: z.string().trim().max(1000).optional() });
export const attendanceSchema = z.object({ attended: z.boolean() });

export const interviewFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  recommendation: z.enum(RECOMMENDATIONS),
  feedback: z.string().trim().min(3).max(5000),
  /** HR recording feedback on behalf of a panelist. */
  interviewerId: z.string().uuid().optional(),
});

// ---- Offers ----

const offerFields = z.object({
  designation: z.string().trim().min(2).max(120),
  department: z.string().trim().max(120).optional(),
  ctcAnnual: z.number().positive(),
  joiningDate: z.coerce.date(),
  workLocation: z.string().trim().max(160).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  probationMonths: z.number().int().min(0).max(24).optional(),
  noticePeriodDays: z.number().int().min(0).max(180).optional(),
  terms: z.string().max(10000).optional(),
  validUntil: clearableDate,
});

export const offerSchema = offerFields.extend({ applicationId: z.string().uuid() });
export const offerUpdateSchema = offerFields.partial();
export const offerListQuerySchema = z.object({ status: z.enum(OFFER_STATUSES).optional(), q: z.string().max(100).optional() });
export const offerDecideSchema = decision;
export const offerSendSchema = z.object({ portalDays: z.number().int().min(1).max(90).optional() });

export const offerRespondSchema = z
  .object({
    response: z.enum(['ACCEPT', 'DECLINE', 'NEGOTIATE']),
    reason: z.string().trim().max(1000).optional(),
    counterCtc: z.number().positive().optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.response !== 'NEGOTIATE' || (v.note ?? '').length >= 3 || !!v.counterCtc, {
    message: 'Add a counter CTC or a note',
    path: ['note'],
  });

export const offerReviseSchema = z.object({
  ctcAnnual: z.number().positive().optional(),
  joiningDate: z.coerce.date().optional(),
  designation: z.string().trim().min(2).max(120).optional(),
  workLocation: z.string().trim().max(160).optional(),
  validUntil: clearableDate,
  terms: z.string().max(10000).optional(),
  note: z.string().trim().min(3).max(2000),
});

export const offerWithdrawSchema = z.object({ reason: z.string().trim().min(3).max(1000) });

// ---- Candidate portal (public) ----

export const portalDeclineSchema = z.object({ reason: z.string().trim().min(3, 'Please tell us why').max(1000) });
export const portalNegotiateSchema = z
  .object({
    counterCtc: z.coerce.number().positive().max(1_000_000_000).optional(),
    note: z.string().trim().max(2000).default(''),
  })
  .refine((v) => v.note.length >= 3 || !!v.counterCtc, { message: 'Add your expected CTC or a note', path: ['note'] });

// ---- Pre-onboarding ----

export const preOnboardingListQuerySchema = z.object({
  status: z.enum(['INITIATED', 'DOCUMENTS_SUBMITTED', 'DOCUMENTS_VERIFIED', 'READY_TO_JOIN', 'JOINED', 'CANCELLED']).optional(),
});

export const preOnboardingUpdateSchema = z.object({
  instructions: z.string().max(10000).optional(),
  expectedJoiningDate: z.coerce.date().optional(),
  bgvRequired: z.boolean().optional(),
  bgvStatus: z.enum(BGV_STATUSES).optional(),
  bgvVendor: z.string().trim().max(160).optional(),
  bgvNotes: z.string().max(5000).optional(),
});

export const confirmJoiningSchema = z.object({ confirmedJoiningDate: z.coerce.date() });
export const preJoiningDocSchema = z.object({
  type: z.enum(PRE_JOINING_DOC_TYPES),
  name: z.string().trim().min(2).max(160),
  required: z.boolean().default(true),
});
export const preJoiningDocUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  required: z.boolean().optional(),
});
export const verifyDocSchema = z.object({
  decision: z.enum(['VERIFIED', 'REJECTED']),
  remarks: z.string().trim().max(1000).optional(),
});
export const preOnboardingCancelSchema = z.object({ reason: z.string().trim().min(3).max(1000) });

export const joinSchema = z.object({
  joiningDate: z.coerce.date().optional(),
  role: z.enum(['HR', 'MANAGER', 'EMPLOYEE']).default('EMPLOYEE'),
  managerId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  designationId: z.string().uuid().nullable().optional(),
  gradeId: z.string().uuid().nullable().optional(),
  officeId: z.string().uuid().nullable().optional(),
  shiftId: z.string().uuid().nullable().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  probationMonths: z.number().int().min(0).max(24).optional(),
  noticePeriodDays: z.number().int().min(0).max(180).optional(),
  ctcAnnual: z.number().positive().optional(),
  assetIds: z.array(z.string().uuid()).max(20).optional(),
});

export const statsQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  jobId: z.string().uuid().optional(),
});
