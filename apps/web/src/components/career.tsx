'use client';

/**
 * Career & lifecycle building blocks shared by the employee profile, /career,
 * /transfers and /lifecycle pages: employment-status badge, career history,
 * hire-to-retire timeline, skills & certifications panel.
 */

import { useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, DatePicker, Empty, ErrorNote, Field, Input, Modal, Select, Spinner, Table, Td,
} from '@/components/ui';
import { errText, humanize, openUrl } from '@/components/lifecycle';

// ---------------------------------------------------------------- status

export type EmploymentStatus = 'PROBATION' | 'ACTIVE' | 'NOTICE_PERIOD' | 'SEPARATED';

export const EMPLOYMENT_STATUS_LABEL: Record<string, string> = {
  PROBATION: 'On probation',
  ACTIVE: 'Active',
  NOTICE_PERIOD: 'Serving notice',
  SEPARATED: 'Former employee',
};

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'slate'> = {
  PROBATION: 'blue',
  ACTIVE: 'green',
  NOTICE_PERIOD: 'amber',
  SEPARATED: 'slate',
};

export function EmploymentStatusBadge({ status, hideActive = false }: { status?: string | null; hideActive?: boolean }) {
  if (!status || (hideActive && status === 'ACTIVE')) return null;
  return <Badge tone={STATUS_TONE[status] ?? 'slate'}>{EMPLOYMENT_STATUS_LABEL[status] ?? humanize(status)}</Badge>;
}

const PLATFORM_LABEL: Record<string, string> = {
  LINKEDIN: 'LinkedIn', NAUKRI: 'Naukri', INDEED: 'Indeed', INTERNSHALA: 'Internshala', FOUNDIT: 'Foundit',
  INSTAHYRE: 'Instahyre', CAREERS_PAGE: 'Careers page', CAREERS: 'Careers page', REFERRAL: 'Referral',
  JOB_BOARD: 'Job board', AGENCY: 'Agency', DIRECT: 'Direct', EMAIL: 'Email', OTHER: 'Other',
};
export const platformLabel = (p?: string | null) => (p ? (PLATFORM_LABEL[p] ?? humanize(p)) : '');

export interface SourceApplication {
  id: string;
  code: string | null;
  source: string;
  job: { id: string; code: string | null; title: string };
  posting: { id: string; platform: string; platformName: string; externalId: string } | null;
}

/** "Hired via LinkedIn · JOB-2026-0012" badge. */
export function SourceOfHireBadge({ hireSource, application }: { hireSource?: string; application?: SourceApplication | null }) {
  const platform = application?.posting
    ? application.posting.platform === 'OTHER' && application.posting.platformName
      ? application.posting.platformName
      : platformLabel(application.posting.platform)
    : platformLabel(application?.source || hireSource);
  if (!platform && !application) return null;
  return (
    <Badge tone="violet">
      Hired via {platform || 'recruitment'}
      {application?.job.code ? ` · ${application.job.code}` : ''}
    </Badge>
  );
}

// ---------------------------------------------------------------- history

export interface HistoryRow {
  id: string;
  type: string;
  effectiveDate: string;
  title: string;
  reason: string;
  refType: string | null;
  createdByName: string | null;
}

const HISTORY_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'slate'> = {
  JOINED: 'green', CONFIRMED: 'green', REHIRED: 'green', PROMOTION: 'violet', SALARY_REVISION: 'violet',
  PROBATION_EXTENDED: 'amber', NOTICE_PERIOD: 'amber', RESIGNED: 'amber', SEPARATED: 'red',
  TRANSFER: 'blue', DESIGNATION_CHANGE: 'blue', MANAGER_CHANGE: 'blue', GRADE_CHANGE: 'blue', LOCATION_CHANGE: 'blue',
};

/** Career history, newest first. `employeeId` = 'me' for the signed-in employee. */
export function CareerHistory({ employeeId }: { employeeId: string }) {
  const { data, loading, error } = useFetch<{ items: HistoryRow[] }>(`/career/history/${employeeId}`);
  if (loading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  if (!data || data.items.length === 0) return <Empty message="No career events recorded yet" />;
  return (
    <ol className="relative space-y-5 border-l border-slate-200 pl-6">
      {data.items.map((h) => (
        <li key={h.id} className="relative">
          <span className="absolute -left-[31px] top-1 h-3 w-3 rounded-full bg-indigo-500 ring-4 ring-white" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">{fmtDate(h.effectiveDate)}</span>
            <Badge tone={HISTORY_TONE[h.type] ?? 'slate'}>{humanize(h.type)}</Badge>
          </div>
          <p className="mt-1 text-sm font-medium text-slate-800">{h.title}</p>
          {(h.reason || h.createdByName) && (
            <p className="text-xs text-slate-400">
              {h.reason}
              {h.reason && h.createdByName ? ' · ' : ''}
              {h.createdByName ? `by ${h.createdByName}` : ''}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- lifecycle timeline

export const LIFECYCLE_STAGES: { key: string; label: string }[] = [
  { key: 'REQUISITION', label: 'Job Requisition' },
  { key: 'POSTING', label: 'External Job Posting' },
  { key: 'APPLICATIONS', label: 'Applications Received' },
  { key: 'SCREENING', label: 'Candidate Screening' },
  { key: 'INTERVIEW', label: 'Interview Process' },
  { key: 'SELECTED', label: 'Candidate Selected' },
  { key: 'OFFER_ACCEPTED', label: 'Offer Accepted' },
  { key: 'PRE_ONBOARDING', label: 'Pre-Onboarding' },
  { key: 'JOINED', label: 'Employee Joined' },
  { key: 'ACTIVE', label: 'Active Employee' },
  { key: 'PERFORMANCE_PAYROLL', label: 'Performance & Payroll' },
  { key: 'RESIGNATION', label: 'Resignation / Separation' },
  { key: 'NOTICE', label: 'Notice Period & Handover' },
  { key: 'CLEARANCE', label: 'Exit Clearance' },
  { key: 'SETTLEMENT', label: 'Full & Final Settlement' },
  { key: 'ARCHIVED', label: 'Employee Archived' },
];
const stageLabel = (k: string) => LIFECYCLE_STAGES.find((s) => s.key === k)?.label ?? humanize(k);

interface TimelineData {
  summary: { hiredVia: string | null; left: string | null; currentStage: string };
  items: { date: string; stage: string; title: string; detail: string; refType: string; refId: string }[];
}

/** Hire-to-retire timeline, oldest first, grouped by lifecycle stage. */
export function LifecycleTimeline({ employeeId }: { employeeId: string }) {
  const { data, loading, error } = useFetch<TimelineData>(`/lifecycle/employees/${employeeId}/timeline`);
  if (loading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const reached = new Set(data.items.map((i) => i.stage));
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap gap-1.5">
          {LIFECYCLE_STAGES.map((s) => (
            <span
              key={s.key}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                s.key === data.summary.currentStage
                  ? 'bg-indigo-600 text-white'
                  : reached.has(s.key)
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'bg-slate-50 text-slate-400'
              }`}
            >
              {s.label}
            </span>
          ))}
        </div>
        {(data.summary.hiredVia || data.summary.left) && (
          <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
            {data.summary.hiredVia && <p className="text-slate-700">{data.summary.hiredVia}</p>}
            {data.summary.left && <p className="font-medium text-rose-600">{data.summary.left}</p>}
          </div>
        )}
      </Card>
      <Card className="p-5">
        {data.items.length === 0 ? (
          <Empty message="Nothing recorded yet" />
        ) : (
          <ol className="relative space-y-4 border-l border-slate-200 pl-6">
            {data.items.map((i, idx) => (
              <li key={`${i.refId}-${idx}`} className="relative">
                <span className="absolute -left-[31px] top-1 h-3 w-3 rounded-full bg-indigo-400 ring-4 ring-white" />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500">{fmtDate(i.date)}</span>
                  <Badge tone="slate">{stageLabel(i.stage)}</Badge>
                </div>
                <p className="mt-1 text-sm font-medium text-slate-800">{i.title}</p>
                {i.detail && <p className="text-xs text-slate-400">{i.detail}</p>}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- skills & certifications

export const SKILL_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] as const;

export interface SkillRow {
  id: string;
  employeeId: string;
  skill: string;
  level: string;
  years: number;
  endorsedById: string | null;
  endorsedByName: string | null;
}

export interface CertRow {
  id: string;
  employeeId: string;
  name: string;
  issuer: string;
  credentialId: string;
  credentialUrl: string;
  issuedOn: string | null;
  expiresOn: string | null;
  courseId: string | null;
  verified: boolean;
  hasFile: boolean;
  fileName: string;
  status: string;
  employee?: { id: string; name: string; employeeCode: string; department: string; designation: string };
}

export const CERT_STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = {
  VALID: 'green', EXPIRING: 'amber', EXPIRED: 'red', NO_EXPIRY: 'slate',
};

const LEVEL_TONE: Record<string, 'green' | 'amber' | 'blue' | 'violet' | 'slate'> = {
  BEGINNER: 'slate', INTERMEDIATE: 'blue', ADVANCED: 'violet', EXPERT: 'green',
};
export const SkillLevelBadge = ({ level }: { level: string }) => <Badge tone={LEVEL_TONE[level] ?? 'slate'}>{humanize(level)}</Badge>;

export async function openCertificate(id: string) {
  const { url } = await api<{ url: string }>(`/career/certifications/${id}/file`);
  openUrl(url);
}

/**
 * Skills + certifications of one employee. `employeeId` = 'me' for self-service.
 * The owner edits; the manager endorses skills; ADMIN/HR edit, verify and endorse.
 */
export function SkillsAndCertifications({
  employeeId,
  canEdit,
  canEndorse,
  canVerify,
}: {
  employeeId: string;
  canEdit: boolean;
  canEndorse: boolean;
  canVerify: boolean;
}) {
  const base = employeeId === 'me' ? 'me' : `employee/${employeeId}`;
  const skills = useFetch<SkillRow[]>(`/career/skills/${base}`);
  const certs = useFetch<CertRow[]>(`/career/certifications/${base}`);
  const [skillForm, setSkillForm] = useState<{ id?: string; skill: string; level: string; years: string } | null>(null);
  const [certForm, setCertForm] = useState<CertForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onBehalf = employeeId === 'me' ? {} : { employeeId };

  const saveSkill = async () => {
    if (!skillForm) return;
    setError(null);
    try {
      const body = { skill: skillForm.skill, level: skillForm.level, years: Number(skillForm.years || 0) };
      if (skillForm.id) await api(`/career/skills/${skillForm.id}`, { method: 'PATCH', body });
      else await api('/career/skills', { method: 'POST', body: { ...body, ...onBehalf } });
      setSkillForm(null);
      skills.reload();
    } catch (err) {
      setError(errText(err));
    }
  };
  const act = async (fn: () => Promise<unknown>, reload: () => void) => {
    setError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <div className="space-y-4">
      <ErrorNote error={error} />
      <Card>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Skills</h3>
          {canEdit && (
            <Button variant="secondary" onClick={() => setSkillForm({ skill: '', level: 'INTERMEDIATE', years: '' })}>
              + Add skill
            </Button>
          )}
        </div>
        {skills.loading ? (
          <Spinner />
        ) : !skills.data || skills.data.length === 0 ? (
          <Empty message="No skills listed yet" />
        ) : (
          <Table headers={['Skill', 'Level', 'Years', 'Endorsed', '']}>
            {skills.data.map((s) => (
              <tr key={s.id}>
                <Td className="font-medium text-slate-800">{s.skill}</Td>
                <Td>
                  <SkillLevelBadge level={s.level} />
                </Td>
                <Td>{s.years || '—'}</Td>
                <Td>{s.endorsedByName ? <Badge tone="green">by {s.endorsedByName}</Badge> : <span className="text-slate-400">—</span>}</Td>
                <Td className="whitespace-nowrap text-right">
                  {canEndorse && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void act(() => api(`/career/skills/${s.id}/endorse`, { method: 'POST', body: { endorse: !s.endorsedById } }), skills.reload)
                      }
                    >
                      {s.endorsedById ? 'Withdraw' : 'Endorse'}
                    </Button>
                  )}
                  {canEdit && (
                    <>
                      <Button variant="ghost" onClick={() => setSkillForm({ id: s.id, skill: s.skill, level: s.level, years: String(s.years || '') })}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Remove "${s.skill}"?`)) void act(() => api(`/career/skills/${s.id}`, { method: 'DELETE' }), skills.reload);
                        }}
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Certifications</h3>
          {canEdit && (
            <Button variant="secondary" onClick={() => setCertForm(emptyCert)}>
              + Add certification
            </Button>
          )}
        </div>
        {certs.loading ? (
          <Spinner />
        ) : !certs.data || certs.data.length === 0 ? (
          <Empty message="No certifications yet" />
        ) : (
          <Table headers={['Certification', 'Issued', 'Expires', 'Status', 'Verified', '']}>
            {certs.data.map((c) => (
              <tr key={c.id}>
                <Td>
                  <span className="block font-medium text-slate-800">{c.name}</span>
                  <span className="block text-xs text-slate-400">
                    {[c.issuer, c.credentialId && `ID ${c.credentialId}`, c.courseId && 'internal course'].filter(Boolean).join(' · ')}
                  </span>
                </Td>
                <Td>{c.issuedOn ? fmtDate(c.issuedOn) : '—'}</Td>
                <Td>{c.expiresOn ? fmtDate(c.expiresOn) : '—'}</Td>
                <Td>
                  <Badge tone={CERT_STATUS_TONE[c.status] ?? 'slate'}>{humanize(c.status)}</Badge>
                </Td>
                <Td>{c.verified ? <Badge tone="green">verified</Badge> : <Badge tone="amber">unverified</Badge>}</Td>
                <Td className="whitespace-nowrap text-right">
                  {c.credentialUrl && (
                    <Button variant="ghost" onClick={() => openUrl(c.credentialUrl)}>
                      Link
                    </Button>
                  )}
                  {c.hasFile && (
                    <Button variant="ghost" onClick={() => void act(() => openCertificate(c.id), () => undefined)}>
                      File
                    </Button>
                  )}
                  {canVerify && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void act(() => api(`/career/certifications/${c.id}/verify`, { method: 'POST', body: { verified: !c.verified } }), certs.reload)
                      }
                    >
                      {c.verified ? 'Unverify' : 'Verify'}
                    </Button>
                  )}
                  {(canVerify || (canEdit && !c.verified)) && (
                    <>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          setCertForm({
                            id: c.id, name: c.name, issuer: c.issuer, credentialId: c.credentialId, credentialUrl: c.credentialUrl,
                            issuedOn: c.issuedOn?.slice(0, 10) ?? '', expiresOn: c.expiresOn?.slice(0, 10) ?? '', file: null,
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Delete "${c.name}"?`)) void act(() => api(`/career/certifications/${c.id}`, { method: 'DELETE' }), certs.reload);
                        }}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal title={skillForm?.id ? 'Edit skill' : 'Add skill'} open={!!skillForm} onClose={() => setSkillForm(null)}>
        {skillForm && (
          <div className="space-y-3">
            <Field label="Skill">
              <Input value={skillForm.skill} maxLength={60} onChange={(e) => setSkillForm({ ...skillForm, skill: e.target.value })} placeholder="e.g. React" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Level">
                <Select value={skillForm.level} onChange={(e) => setSkillForm({ ...skillForm, level: e.target.value })}>
                  {SKILL_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {humanize(l)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Years of experience">
                <Input type="number" min={0} max={60} step={0.5} value={skillForm.years} onChange={(e) => setSkillForm({ ...skillForm, years: e.target.value })} />
              </Field>
            </div>
            <Button className="w-full" disabled={!skillForm.skill.trim()} onClick={() => void saveSkill()}>
              Save skill
            </Button>
          </div>
        )}
      </Modal>

      {certForm && (
        <CertificationModal
          form={certForm}
          onBehalf={onBehalf}
          onClose={() => setCertForm(null)}
          onDone={() => {
            setCertForm(null);
            certs.reload();
          }}
        />
      )}
    </div>
  );
}

interface CertForm {
  id?: string;
  name: string;
  issuer: string;
  credentialId: string;
  credentialUrl: string;
  issuedOn: string;
  expiresOn: string;
  file: File | null;
}
const emptyCert: CertForm = { name: '', issuer: '', credentialId: '', credentialUrl: '', issuedOn: '', expiresOn: '', file: null };

function CertificationModal({
  form: initial,
  onBehalf,
  onClose,
  onDone,
}: {
  form: CertForm;
  onBehalf: { employeeId?: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('name', form.name);
      fd.append('issuer', form.issuer);
      fd.append('credentialId', form.credentialId);
      fd.append('credentialUrl', form.credentialUrl);
      fd.append('issuedOn', form.issuedOn);
      fd.append('expiresOn', form.expiresOn);
      if (!form.id && onBehalf.employeeId) fd.append('employeeId', onBehalf.employeeId);
      if (form.file) fd.append('file', form.file);
      await api(form.id ? `/career/certifications/${form.id}` : '/career/certifications', { method: form.id ? 'PATCH' : 'POST', form: fd });
      onDone();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={form.id ? 'Edit certification' : 'Add certification'} open onClose={onClose} wide>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Certification name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="AWS Solutions Architect" />
          </Field>
          <Field label="Issuer">
            <Input value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} placeholder="Amazon Web Services" />
          </Field>
          <Field label="Credential ID">
            <Input value={form.credentialId} onChange={(e) => setForm({ ...form, credentialId: e.target.value })} />
          </Field>
          <Field label="Credential URL">
            <Input value={form.credentialUrl} onChange={(e) => setForm({ ...form, credentialUrl: e.target.value })} placeholder="https://…" />
          </Field>
          <Field label="Issued on">
            <DatePicker clearable value={form.issuedOn} onChange={(v) => setForm({ ...form, issuedOn: v })} />
          </Field>
          <Field label="Expires on" hint="leave empty if it never expires">
            <DatePicker clearable value={form.expiresOn} onChange={(v) => setForm({ ...form, expiresOn: v })} />
          </Field>
        </div>
        <Field label={form.id ? 'Replace certificate file (optional)' : 'Certificate file (optional)'}>
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-indigo-700"
          />
        </Field>
        <Button className="w-full" disabled={busy || form.name.trim().length < 2} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save certification'}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- transfers

export const TRANSFER_TYPES = ['TRANSFER', 'PROMOTION', 'DESIGNATION_CHANGE', 'MANAGER_CHANGE', 'LOCATION_CHANGE'] as const;
export const TRANSFER_TYPE_LABEL: Record<string, string> = {
  TRANSFER: 'Department transfer',
  PROMOTION: 'Promotion',
  DESIGNATION_CHANGE: 'Designation change',
  MANAGER_CHANGE: 'Manager change',
  LOCATION_CHANGE: 'Location change',
};

interface Option {
  id: string;
  name: string;
  code?: string;
}

/** Which target pickers each type shows. */
const TYPE_FIELDS: Record<string, ('department' | 'designation' | 'manager' | 'office' | 'grade' | 'increment')[]> = {
  TRANSFER: ['department', 'manager', 'office'],
  PROMOTION: ['designation', 'grade', 'increment', 'manager'],
  DESIGNATION_CHANGE: ['designation', 'grade'],
  MANAGER_CHANGE: ['manager'],
  LOCATION_CHANGE: ['office', 'manager'],
};

/**
 * Raise a transfer / promotion for one employee (fixed `employee`) or pick
 * from `employees` (the caller's direct reports, or everyone for HR).
 */
export function RaiseTransferModal({
  employee,
  employees,
  onClose,
  onDone,
}: {
  employee?: { id: string; name: string };
  employees?: { id: string; name: string; employeeCode?: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: departments } = useFetch<Option[]>('/masters/departments');
  const { data: designations } = useFetch<Option[]>('/masters/designations');
  const { data: grades } = useFetch<Option[]>('/masters/grades');
  const { data: offices } = useFetch<Option[]>('/offices');
  const { data: managers } = useFetch<{ items: Option[] }>('/employees?pageSize=100');
  const [form, setForm] = useState({
    employeeId: employee?.id ?? '', type: 'PROMOTION', toDepartmentId: '', toDesignationId: '', toManagerId: '', toOfficeId: '',
    toGradeId: '', incrementPercent: '', effectiveDate: new Date().toISOString().slice(0, 10), reason: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fields = TYPE_FIELDS[form.type] ?? [];
  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const pick = (f: string, key: keyof typeof form) => (fields.includes(f as never) && form[key] ? { [key]: form[key] } : {});
      await api('/transfers', {
        method: 'POST',
        body: {
          employeeId: form.employeeId,
          type: form.type,
          ...pick('department', 'toDepartmentId'),
          ...pick('designation', 'toDesignationId'),
          ...pick('manager', 'toManagerId'),
          ...pick('office', 'toOfficeId'),
          ...pick('grade', 'toGradeId'),
          ...(fields.includes('increment') && form.incrementPercent ? { incrementPercent: Number(form.incrementPercent) } : {}),
          effectiveDate: form.effectiveDate,
          reason: form.reason,
        },
      });
      onDone();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  const select = (label: string, key: keyof typeof form, options: Option[] | null | undefined, fmt = (o: Option) => o.name) => (
    <Field label={label}>
      <Select value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}>
        <option value="">— no change —</option>
        {(options ?? []).filter((o) => o.id !== form.employeeId).map((o) => (
          <option key={o.id} value={o.id}>
            {fmt(o)}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <Modal title={employee ? `Transfer / promotion — ${employee.name}` : 'Raise transfer / promotion'} open onClose={onClose} wide>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <div className="grid grid-cols-2 gap-3">
          {!employee && (
            <Field label="Employee">
              <Select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                <option value="">— select —</option>
                {(employees ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.employeeCode ? ` (${e.employeeCode})` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TRANSFER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TRANSFER_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          {fields.includes('department') && select('New department', 'toDepartmentId', departments)}
          {fields.includes('designation') && select('New designation', 'toDesignationId', designations)}
          {fields.includes('grade') && (grades?.length ?? 0) > 0 && select('New grade', 'toGradeId', grades, (g) => `${g.code ?? ''} · ${g.name}`)}
          {fields.includes('manager') && select('New reporting manager', 'toManagerId', managers?.items)}
          {fields.includes('office') && select('New office / location', 'toOfficeId', offices)}
          {fields.includes('increment') && (
            <Field label="Increment %" hint="optional — raised as a salary revision">
              <Input type="number" min={0} max={200} step={0.5} value={form.incrementPercent} onChange={(e) => setForm({ ...form, incrementPercent: e.target.value })} />
            </Field>
          )}
          <Field label="Effective date" hint="today or earlier applies on approval">
            <DatePicker value={form.effectiveDate} onChange={(v) => setForm({ ...form, effectiveDate: v })} />
          </Field>
        </div>
        <Field label="Reason / justification">
          <Input value={form.reason} maxLength={2000} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </Field>
        <p className="text-xs text-slate-400">Goes through the Transfer approval chain (reporting manager → HR by default).</p>
        <Button className="w-full" disabled={busy || !form.employeeId || form.reason.trim().length < 3 || !form.effectiveDate} onClick={() => void submit()}>
          {busy ? 'Submitting…' : 'Submit for approval'}
        </Button>
      </div>
    </Modal>
  );
}
