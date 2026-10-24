'use client';

/** Shared recruitment pieces (requisitions, jobs, pipeline, application, offers, pre-joining pages). */
import { useFetch } from '@/lib/useFetch';
import { Badge, Field, Input, Select, Textarea } from '@/components/ui';
import { label } from '@/components/talent';

export type Tone = 'slate' | 'blue' | 'violet' | 'amber' | 'green' | 'red';

export interface Job {
  id: string;
  code: string | null;
  title: string;
  department: string;
  designation: string;
  location: string;
  employmentType: string;
  openings: number;
  minExperience: number;
  maxExperience: number;
  minCtc?: number;
  maxCtc?: number;
  description: string;
  skills: string;
  qualifications: string;
  status: string;
  hiringManagerId: string | null;
  hiringManager?: { id: string; name: string } | null;
  requisition?: { id: string; code: string } | null;
  pipeline?: Record<string, number>;
  hired?: number;
  active?: number;
  livePostings?: string[];
  postingsCount?: number;
  createdAt: string;
}

/** Kanban columns, in order. */
export const PIPELINE: { stage: string; title: string }[] = [
  { stage: 'APPLIED', title: 'Applied' },
  { stage: 'SHORTLISTED', title: 'Shortlisted' },
  { stage: 'ON_HOLD', title: 'On hold' },
  { stage: 'HR_SCREENED', title: 'HR screened' },
  { stage: 'INTERVIEW_SCHEDULED', title: 'Interview scheduled' },
  { stage: 'INTERVIEW_COMPLETED', title: 'Interviewed' },
  { stage: 'SELECTED', title: 'Selected' },
  { stage: 'OFFERED', title: 'Offered' },
  { stage: 'OFFER_ACCEPTED', title: 'Offer accepted' },
  { stage: 'PRE_ONBOARDING', title: 'Pre-joining' },
  { stage: 'DOCUMENTS_VERIFIED', title: 'Docs verified' },
  { stage: 'READY_TO_JOIN', title: 'Ready to join' },
  { stage: 'JOINED', title: 'Joined' },
];
export const CLOSED_STAGES = ['REJECTED', 'WITHDRAWN', 'OFFER_DECLINED'];
export const ALL_STAGES = [...PIPELINE.map((p) => p.stage), ...CLOSED_STAGES];

export const SOURCES = [
  'CAREERS', 'REFERRAL', 'LINKEDIN', 'NAUKRI', 'INDEED', 'INTERNSHALA', 'FOUNDIT', 'INSTAHYRE', 'JOB_BOARD', 'EMAIL', 'DIRECT',
  'AGENCY', 'WALK_IN', 'OTHER',
];
export const PLATFORMS = ['LINKEDIN', 'NAUKRI', 'INDEED', 'INTERNSHALA', 'FOUNDIT', 'INSTAHYRE', 'CAREERS_PAGE', 'OTHER'];
export const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Intern', 'Consultant'];
export const INTERVIEW_TYPES = ['TECHNICAL', 'HR', 'MANAGERIAL', 'CULTURE', 'ASSIGNMENT', 'OTHER'];
export const RECOMMENDATIONS = ['STRONG_HIRE', 'HIRE', 'NO_HIRE', 'STRONG_NO_HIRE'];

const TONES: Record<string, Tone> = {
  // application stages
  APPLIED: 'slate', SHORTLISTED: 'blue', ON_HOLD: 'amber', HR_SCREENED: 'blue', INTERVIEW_SCHEDULED: 'violet',
  INTERVIEW_COMPLETED: 'violet', SELECTED: 'green', OFFERED: 'amber', OFFER_ACCEPTED: 'green', PRE_ONBOARDING: 'blue',
  DOCUMENTS_VERIFIED: 'blue', READY_TO_JOIN: 'green', JOINED: 'green', REJECTED: 'red', WITHDRAWN: 'slate', OFFER_DECLINED: 'red',
  // legacy
  SCREENING: 'blue', INTERVIEW: 'violet', OFFER: 'amber', HIRED: 'green',
  // jobs / requisitions / postings
  DRAFT: 'slate', PENDING_APPROVAL: 'amber', APPROVED: 'blue', OPEN: 'green', FILLED: 'green', CLOSED: 'slate', CANCELLED: 'slate',
  PUBLISHED: 'blue', ACTIVE: 'green', EXPIRED: 'slate',
  // offers
  SENT: 'blue', NEGOTIATING: 'amber', ACCEPTED: 'green', DECLINED: 'red',
  // interviews
  SCHEDULED: 'blue', COMPLETED: 'green', NO_SHOW: 'red',
  // pre-joining
  INITIATED: 'slate', DOCUMENTS_SUBMITTED: 'amber', PENDING: 'slate', SUBMITTED: 'amber', VERIFIED: 'green',
  NOT_REQUIRED: 'slate', IN_PROGRESS: 'blue', CLEAR: 'green', DISCREPANCY: 'red',
  // referrals
  IN_PROCESS: 'blue', NOT_SELECTED: 'slate',
  // priority
  LOW: 'slate', MEDIUM: 'blue', HIGH: 'amber', CRITICAL: 'red',
};
export const stageTone = (s: string): Tone => TONES[s] ?? 'slate';

const NAMES: Record<string, string> = {
  INTERVIEW_COMPLETED: 'Interviewed', PRE_ONBOARDING: 'Pre-joining', HR_SCREENED: 'HR screened', CAREERS_PAGE: 'Careers page',
  LINKEDIN: 'LinkedIn', OFFER_DECLINED: 'Offer declined', NO_SHOW: 'No-show', WALK_IN: 'Walk-in',
};
export const stageLabel = (s: string): string => NAMES[s] ?? label(s);

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={stageTone(status)}>{stageLabel(status)}</Badge>;
}

export const money = (n: number | null | undefined): string => (n || n === 0 ? `₹${Math.round(n).toLocaleString('en-IN')}` : '—');
export const yrs = (min: number, max: number): string =>
  !min && !max ? 'Any experience' : max ? `${min}–${max} yrs` : `${min}+ yrs`;
/** ISO date → YYYY-MM-DD for DatePicker / date inputs. */
export const ymd = (d: string | null | undefined): string => (d ? d.slice(0, 10) : '');
/** Local datetime-local value for an ISO timestamp. */
export const localDateTime = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** The interview has started (or starts within 15 minutes) — feedback / attendance can be recorded. */
export function hasStarted(iso: string): boolean {
  return new Date(iso).getTime() <= Date.now() + 15 * 60_000;
}

/** Small horizontal meter for the match score. */
export function MatchBar({ score }: { score: number }) {
  const color = score >= 75 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <span className="inline-flex items-center gap-1.5" title={`Match score ${score}%`}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-100">
        <span className={`block h-full ${color}`} style={{ width: `${Math.max(4, score)}%` }} />
      </span>
      <span className="text-xs tabular-nums text-slate-500">{score}%</span>
    </span>
  );
}

export function useDirectory() {
  const { data } = useFetch<{ items: { id: string; name: string; department: string; designation: string }[] }>('/employees?pageSize=100');
  return data?.items ?? [];
}

// ---------------------------------------------------------------------------
// Requisition form (managers + HR)
// ---------------------------------------------------------------------------

export const emptyRequisition = {
  title: '', departmentId: '', designation: '', vacancies: '1', minExperience: '0', maxExperience: '0', skills: '',
  qualifications: '', location: '', employmentType: 'Full-time', budgetMinCtc: '', budgetMaxCtc: '', reason: 'NEW_POSITION',
  replacementForId: '', justification: '', description: '', priority: 'MEDIUM', targetDate: '', hiringManagerId: '',
};
export type RequisitionForm = typeof emptyRequisition;

export const requisitionBody = (f: RequisitionForm) => ({
  title: f.title,
  departmentId: f.departmentId || null,
  designation: f.designation,
  vacancies: Number(f.vacancies) || 1,
  minExperience: Number(f.minExperience) || 0,
  maxExperience: Number(f.maxExperience) || 0,
  skills: f.skills,
  qualifications: f.qualifications,
  location: f.location,
  employmentType: f.employmentType,
  budgetMinCtc: Number(f.budgetMinCtc) || 0,
  budgetMaxCtc: Number(f.budgetMaxCtc) || 0,
  reason: f.reason,
  replacementForId: f.reason === 'REPLACEMENT' ? f.replacementForId || null : null,
  justification: f.justification,
  description: f.description,
  priority: f.priority,
  targetDate: f.targetDate || null,
  hiringManagerId: f.hiringManagerId || null,
});

export function RequisitionFields({
  form,
  setForm,
  people,
  departments,
}: {
  form: RequisitionForm;
  setForm: (f: RequisitionForm) => void;
  people: { id: string; name: string }[];
  departments: { id: string; name: string }[];
}) {
  const set = (k: keyof RequisitionForm) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Job title">
          <Input value={form.title} onChange={set('title')} placeholder="e.g. Senior Backend Engineer" />
        </Field>
        <Field label="Designation">
          <Input value={form.designation} onChange={set('designation')} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field
          label="Department"
          hint={departments.length === 0 ? 'No departments yet — HR can add them under Settings → Masters' : undefined}
        >
          <Select value={form.departmentId} onChange={set('departmentId')}>
            <option value="">{departments.length === 0 ? '— none set up —' : '— select —'}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vacancies">
          <Input type="number" min={1} value={form.vacancies} onChange={set('vacancies')} />
        </Field>
        <Field label="Employment type">
          <Select value={form.employmentType} onChange={set('employmentType')}>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Field label="Min exp (yrs)">
          <Input type="number" min={0} value={form.minExperience} onChange={set('minExperience')} />
        </Field>
        <Field label="Max exp (yrs)">
          <Input type="number" min={0} value={form.maxExperience} onChange={set('maxExperience')} />
        </Field>
        <Field label="Budget min CTC (₹/yr)">
          <Input type="number" min={0} value={form.budgetMinCtc} onChange={set('budgetMinCtc')} />
        </Field>
        <Field label="Budget max CTC (₹/yr)">
          <Input type="number" min={0} value={form.budgetMaxCtc} onChange={set('budgetMaxCtc')} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Skills" hint="Comma separated — used for the match score">
          <Input value={form.skills} onChange={set('skills')} />
        </Field>
        <Field label="Qualifications">
          <Input value={form.qualifications} onChange={set('qualifications')} />
        </Field>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Field label="Location">
          <Input value={form.location} onChange={set('location')} />
        </Field>
        <Field label="Reason">
          <Select value={form.reason} onChange={set('reason')}>
            {['NEW_POSITION', 'REPLACEMENT', 'EXPANSION'].map((r) => (
              <option key={r} value={r}>
                {label(r)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={form.priority} onChange={set('priority')}>
            {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((r) => (
              <option key={r} value={r}>
                {label(r)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Target date">
          <Input type="date" value={form.targetDate} onChange={set('targetDate')} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {form.reason === 'REPLACEMENT' && (
          <Field label="Replacing">
            <Select value={form.replacementForId} onChange={set('replacementForId')}>
              <option value="">— select employee —</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Hiring manager" hint="Defaults to you">
          <Select value={form.hiringManagerId} onChange={set('hiringManagerId')}>
            <option value="">— me —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Business justification">
        <Textarea rows={3} value={form.justification} onChange={set('justification')} />
      </Field>
      <Field label="Job description">
        <Textarea rows={4} value={form.description} onChange={set('description')} />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Job edit form (HR)
// ---------------------------------------------------------------------------

export const jobForm = (j: Job) => ({
  title: j.title, department: j.department, designation: j.designation, location: j.location, employmentType: j.employmentType,
  openings: String(j.openings), minExperience: String(j.minExperience), maxExperience: String(j.maxExperience),
  minCtc: String(j.minCtc ?? 0), maxCtc: String(j.maxCtc ?? 0), description: j.description, skills: j.skills,
  qualifications: j.qualifications, hiringManagerId: j.hiringManagerId ?? '',
});
export type JobForm = ReturnType<typeof jobForm>;

export const jobBody = (f: JobForm) => ({
  title: f.title,
  department: f.department,
  designation: f.designation,
  location: f.location,
  employmentType: f.employmentType,
  openings: Number(f.openings) || 1,
  minExperience: Number(f.minExperience) || 0,
  maxExperience: Number(f.maxExperience) || 0,
  minCtc: Number(f.minCtc) || 0,
  maxCtc: Number(f.maxCtc) || 0,
  description: f.description,
  skills: f.skills,
  qualifications: f.qualifications,
  hiringManagerId: f.hiringManagerId || null,
});

export function JobFields({ form, setForm, people }: { form: JobForm; setForm: (f: JobForm) => void; people: { id: string; name: string }[] }) {
  const set = (k: keyof JobForm) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Title">
          <Input value={form.title} onChange={set('title')} />
        </Field>
        <Field label="Designation">
          <Input value={form.designation} onChange={set('designation')} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Department">
          <Input value={form.department} onChange={set('department')} />
        </Field>
        <Field label="Location">
          <Input value={form.location} onChange={set('location')} />
        </Field>
        <Field label="Type">
          <Select value={form.employmentType} onChange={set('employmentType')}>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-5 gap-3">
        <Field label="Openings">
          <Input type="number" min={1} value={form.openings} onChange={set('openings')} />
        </Field>
        <Field label="Min exp">
          <Input type="number" min={0} value={form.minExperience} onChange={set('minExperience')} />
        </Field>
        <Field label="Max exp">
          <Input type="number" min={0} value={form.maxExperience} onChange={set('maxExperience')} />
        </Field>
        <Field label="Min CTC">
          <Input type="number" min={0} value={form.minCtc} onChange={set('minCtc')} />
        </Field>
        <Field label="Max CTC">
          <Input type="number" min={0} value={form.maxCtc} onChange={set('maxCtc')} />
        </Field>
      </div>
      <Field label="Hiring manager">
        <Select value={form.hiringManagerId} onChange={set('hiringManagerId')}>
          <option value="">— none —</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Skills" hint="Comma separated">
          <Input value={form.skills} onChange={set('skills')} />
        </Field>
        <Field label="Qualifications">
          <Input value={form.qualifications} onChange={set('qualifications')} />
        </Field>
      </div>
      <Field label="Description">
        <Textarea rows={5} value={form.description} onChange={set('description')} />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Candidate form (HR)
// ---------------------------------------------------------------------------

export const emptyCandidate = {
  name: '', email: '', phone: '', currentCompany: '', currentDesignation: '', currentLocation: '', experienceYears: '',
  currentCtc: '', expectedCtc: '', noticePeriodDays: '', qualifications: '', source: 'CAREERS', skills: '', notes: '',
  jobId: '', postingId: '', externalRef: '',
};
export type CandidateForm = typeof emptyCandidate;

export function CandidateFields({
  form,
  setForm,
  onBlurContact,
  showSource = true,
}: {
  form: CandidateForm;
  setForm: (f: CandidateForm) => void;
  onBlurContact?: () => void;
  showSource?: boolean;
}) {
  const set = (k: keyof CandidateForm) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Name">
          <Input value={form.name} onChange={set('name')} />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={set('email')} onBlur={onBlurContact} />
        </Field>
        <Field label="Mobile">
          <Input value={form.phone} onChange={set('phone')} onBlur={onBlurContact} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Current company">
          <Input value={form.currentCompany} onChange={set('currentCompany')} />
        </Field>
        <Field label="Current designation">
          <Input value={form.currentDesignation} onChange={set('currentDesignation')} />
        </Field>
        <Field label="Current location">
          <Input value={form.currentLocation} onChange={set('currentLocation')} />
        </Field>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Field label="Experience (yrs)">
          <Input type="number" min={0} value={form.experienceYears} onChange={set('experienceYears')} />
        </Field>
        <Field label="Current CTC">
          <Input type="number" min={0} value={form.currentCtc} onChange={set('currentCtc')} />
        </Field>
        <Field label="Expected CTC">
          <Input type="number" min={0} value={form.expectedCtc} onChange={set('expectedCtc')} />
        </Field>
        <Field label="Notice (days)">
          <Input type="number" min={0} value={form.noticePeriodDays} onChange={set('noticePeriodDays')} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Skills" hint="Comma separated">
          <Input value={form.skills} onChange={set('skills')} />
        </Field>
        <Field label="Qualifications">
          <Input value={form.qualifications} onChange={set('qualifications')} />
        </Field>
      </div>
      {showSource && (
        <Field label="Source">
          <Select value={form.source} onChange={set('source')}>
            {SOURCES.filter((s) => s !== 'REFERRAL').map((s) => (
              <option key={s} value={s}>
                {stageLabel(s)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Notes">
        <Textarea rows={2} value={form.notes} onChange={set('notes')} />
      </Field>
    </div>
  );
}

/** FormData for multipart candidate create / update (empty values are left out). */
export function candidateFormData(form: Partial<CandidateForm>, file: File | null): FormData {
  const fd = new FormData();
  Object.entries(form).forEach(([k, v]) => {
    if (v !== '' && v !== undefined) fd.append(k, v);
  });
  if (file) fd.append('file', file);
  return fd;
}

export const CSV_TEMPLATE =
  'name,email,phone,skills,experienceYears,currentCtc,expectedCtc,noticePeriodDays,currentCompany,currentLocation,source,externalRef,postingId\n' +
  'Priya Sharma,priya@example.com,+91 98765 43210,"React, Node.js",4,1200000,1600000,30,Acme Corp,Bengaluru,NAUKRI,NK-123456,\n';
