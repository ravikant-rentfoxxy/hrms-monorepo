'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate, fmtTime } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, Empty, ErrorNote, Field, Icon, Input, Modal, PageHeader, Select, Spinner, Stat, Table, Tabs, Td, Textarea, type IconName,
} from '@/components/ui';
import { HBarList, errMsg, label, pct } from '@/components/talent';
import {
  ALL_STAGES, CandidateFields, hasStarted, PIPELINE, RECOMMENDATIONS, RequisitionFields, SOURCES, StatusBadge, candidateFormData, emptyCandidate,
  emptyRequisition, money, requisitionBody, stageLabel, useDirectory, yrs, type CandidateForm, type Job, type RequisitionForm,
} from '@/components/recruitment';

interface Requisition {
  id: string;
  code: string;
  title: string;
  department: string;
  departmentId: string | null;
  designation: string;
  vacancies: number;
  minExperience: number;
  maxExperience: number;
  skills: string;
  qualifications: string;
  location: string;
  employmentType: string;
  budgetMinCtc: number;
  budgetMaxCtc: number;
  reason: string;
  replacementForId: string | null;
  justification: string;
  description: string;
  priority: string;
  targetDate: string | null;
  status: string;
  hrReviewNote: string;
  requestedById: string;
  hiringManagerId: string | null;
  requestedBy: { name: string } | null;
  hiringManager: { name: string } | null;
  replacementFor: { name: string } | null;
  pendingWith: string | null;
  canDecide: boolean;
  submittedAt: string | null;
  createdAt: string;
  job: { id: string; code: string | null; status: string } | null;
}

interface TrailStep {
  id: string;
  level: number;
  status: string;
  approverName: string | null;
  actedByName: string | null;
  remarks: string | null;
  actedAt: string | null;
}

interface Candidate {
  id: string;
  code: string | null;
  name: string;
  email: string;
  phone: string;
  source: string;
  experienceYears: number;
  currentCompany: string;
  currentLocation: string;
  hasResume: boolean;
  createdAt: string;
  referredBy: { id: string; name: string } | null;
  applications: { id: string; code: string | null; stage: string; job: { id: string; code: string | null; title: string } }[];
}

interface Interview {
  id: string;
  round: string;
  interviewType: string;
  scheduledAt: string;
  durationMinutes: number;
  mode: string;
  location: string;
  status: string;
  attended: boolean | null;
  rating: number | null;
  recommendation: string;
  panelNames: string[];
  isPanelist: boolean;
  myFeedback: { rating: number | null; recommendation: string; feedback: string; submittedAt: string | null } | null;
  application: { id: string; code: string | null; job: { id: string; title: string }; candidate: { id: string; name: string; email: string } };
}

interface Offer {
  id: string;
  code: string | null;
  designation: string;
  ctcAnnual: number;
  joiningDate: string;
  validUntil: string | null;
  status: string;
  employeeId: string | null;
  pendingWith: string | null;
  hasSignedCopy: boolean;
  application: { id: string; code: string | null; stage: string; job: { title: string }; candidate: { id: string; name: string; email: string } };
}

interface PreJoining {
  id: string;
  status: string;
  expectedJoiningDate: string;
  confirmedJoiningDate: string | null;
  bgvRequired: boolean;
  bgvStatus: string;
  documentsRequired: number;
  documentsSubmitted: number;
  documentsVerified: number;
  application: { id: string; code: string | null; candidate: { name: string; email: string }; job: { title: string }; offer: { designation: string } | null };
}

interface Stats {
  totalApplications: number;
  funnel: { stage: string; reached: number }[];
  avgTimeToHireDays: number | null;
  avgTimeToFillDays: number | null;
  offerAcceptanceRate: number | null;
  sources: { source: string; applications: number; interviewed: number; offered: number; hired: number; hireRate: number }[];
  jobs: Record<string, { count: number; openings: number }>;
}

interface PlatformStat {
  platform: string;
  postings: number;
  cost: number;
  applications: number;
  hires: number;
  costPerApplication: number | null;
  costPerHire: number | null;
}

interface OpenJob {
  id: string;
  code: string | null;
  title: string;
  department: string;
  location: string;
  employmentType: string;
  openings: number;
  minExperience: number;
  maxExperience: number;
  description: string;
  skills: string;
}

interface Referral {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  applications: { id: string; status: string; job: { id: string; title: string } }[];
}

interface IntakeResult {
  candidate: { id: string; code: string | null; name: string };
  application: { id: string; code: string | null } | null;
  duplicateOf: { code: string | null; name: string; matchedOn: string } | null;
  alreadyApplied: boolean;
}

/** Who a request is waiting on: a role step ("HR", "ADMIN") or a named approver. Admins can clear HR steps. */
const pendingWithLabel = (who: string): string =>
  who === 'HR' ? 'HR or Admin' : who === 'ADMIN' ? 'management (Admin)' : who === 'MANAGER' ? 'a manager' : label(who);

/** The hiring process in order; each step opens its tab. */
const HIRING_STEPS: { tab: string; title: string; hint: string; icon: IconName }[] = [
  { tab: 'Requisitions', title: 'Request', hint: 'Raise & approve a hire', icon: 'tasks' },
  { tab: 'Jobs', title: 'Post job', hint: 'Publish approved openings', icon: 'megaphone' },
  { tab: 'Candidates', title: 'Candidates', hint: 'Add & screen applicants', icon: 'users' },
  { tab: 'Interviews', title: 'Interview', hint: 'Schedule & give feedback', icon: 'calendar' },
  { tab: 'Offers', title: 'Offer', hint: 'Send & track offers', icon: 'banknote' },
  { tab: 'Pre-joining', title: 'Pre-joining', hint: 'Documents & joining date', icon: 'check' },
];

/** Requisition filters; MINE = pending requests the viewer can approve. */
const REQ_FILTERS: [string, string][] = [
  ['', 'All'],
  ['MINE', 'Needs my approval'],
  ['PENDING_APPROVAL', 'Waiting for approval'],
  ['DRAFT', 'Drafts'],
  ['APPROVED', 'Approved'],
  ['REJECTED', 'Rejected'],
  ['CANCELLED', 'Cancelled'],
];

/** One plain-language line under a requisition's status. */
const reqNextStep = (r: Pick<Requisition, 'status' | 'canDecide' | 'pendingWith'>): string =>
  ({
    DRAFT: 'Not submitted yet',
    PENDING_APPROVAL: r.canDecide ? 'Waiting for your approval' : `Waiting for ${pendingWithLabel(r.pendingWith ?? 'HR')}`,
    APPROVED: 'Job opening created',
    REJECTED: 'Not approved',
    CANCELLED: 'Withdrawn',
  })[r.status] ?? '';

export default function RecruitmentPage() {
  // useSearchParams needs a Suspense boundary.
  return (
    <Suspense fallback={<Spinner />}>
      <Recruitment />
    </Suspense>
  );
}

function Recruitment() {
  const { session, isManagerial, isCompanyAdmin } = useAuth();
  const router = useRouter();
  const tabs = [
    ...(isManagerial ? ['Requisitions', 'Jobs', 'Candidates'] : []),
    'Interviews',
    ...(isCompanyAdmin ? ['Offers', 'Pre-joining', 'Reports'] : []),
    'Careers & referrals',
  ];
  // The open step lives in ?tab= so Back from a job / candidate page returns to it.
  const searchParams = useSearchParams();
  const wanted = searchParams.get('tab');
  const tab = wanted && tabs.includes(wanted) ? wanted : (tabs[0] as string);
  const setTab = (t: string) => router.replace(`/recruitment?tab=${encodeURIComponent(t)}`, { scroll: false });
  const people = useDirectory();
  const departments = useFetch<{ id: string; name: string }[]>(isManagerial ? '/masters/departments' : null).data ?? [];

  const [reqStatus, setReqStatus] = useState('');
  const reqQuery = reqStatus === 'MINE' ? 'PENDING_APPROVAL' : reqStatus;
  const requisitions = useFetch<Requisition[]>(tab === 'Requisitions' ? `/recruitment/requisitions${reqQuery ? `?status=${reqQuery}` : ''}` : null);
  const reqRows = (requisitions.data ?? []).filter((r) => reqStatus !== 'MINE' || r.canDecide);
  // Drives the "N to approve" badge on the Request step.
  const pendingReqs = useFetch<Requisition[]>(isManagerial ? '/recruitment/requisitions?status=PENDING_APPROVAL' : null);
  const toApprove = pendingReqs.data?.filter((r) => r.canDecide).length ?? 0;
  const [jobStatus, setJobStatus] = useState('');
  const jobs = useFetch<Job[]>(tab === 'Jobs' ? `/recruitment/jobs${jobStatus ? `?status=${jobStatus}` : ''}` : null);
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [stage, setStage] = useState('');
  const candidates = useFetch<Candidate[]>(
    tab === 'Candidates'
      ? `/recruitment/candidates?${new URLSearchParams({ ...(q ? { q } : {}), ...(source ? { source } : {}), ...(stage ? { stage } : {}) })}`
      : null
  );
  const [interviewScope, setInterviewScope] = useState<'mine' | 'all'>('mine');
  const interviews = useFetch<Interview[]>(tab === 'Interviews' ? `/recruitment/interviews?scope=${interviewScope}` : null);
  const [offerStatus, setOfferStatus] = useState('');
  const offers = useFetch<Offer[]>(tab === 'Offers' ? `/recruitment/offers${offerStatus ? `?status=${offerStatus}` : ''}` : null);
  const preJoining = useFetch<PreJoining[]>(tab === 'Pre-joining' ? '/recruitment/pre-onboarding' : null);
  const stats = useFetch<Stats>(tab === 'Reports' ? '/recruitment/stats' : null);
  const platforms = useFetch<PlatformStat[]>(tab === 'Reports' ? '/recruitment/postings/stats' : null);
  const openJobs = useFetch<OpenJob[]>(tab === 'Careers & referrals' ? '/recruitment/jobs/open' : null);
  const referrals = useFetch<Referral[]>(tab === 'Careers & referrals' && session?.employee ? '/recruitment/referrals/mine' : null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Requisitions
  const [reqOpen, setReqOpen] = useState<{ id?: string } | null>(null);
  const [reqForm, setReqForm] = useState<RequisitionForm>(emptyRequisition);
  const [reqView, setReqView] = useState<(Requisition & { trail: TrailStep[] }) | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [remarks, setRemarks] = useState('');

  // Candidates
  const [candOpen, setCandOpen] = useState(false);
  const [candForm, setCandForm] = useState<CandidateForm>(emptyCandidate);
  const [candFile, setCandFile] = useState<File | null>(null);
  const [dup, setDup] = useState<string | null>(null);
  const jobOptions = useFetch<Job[]>(candOpen ? '/recruitment/jobs' : null);

  // Referrals / feedback
  const [refJob, setRefJob] = useState<OpenJob | null>(null);
  const [refForm, setRefForm] = useState({ name: '', email: '', phone: '', currentCompany: '', experienceYears: '', skills: '', notes: '' });
  const [refFile, setRefFile] = useState<File | null>(null);
  const [fbFor, setFbFor] = useState<Interview | null>(null);
  const [fbForm, setFbForm] = useState({ rating: '4', recommendation: 'HIRE', feedback: '' });

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    try {
      await fn();
      after?.();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  // ---- Requisitions ----

  const openNewReq = () => {
    setError(null);
    setReqForm(emptyRequisition);
    setReqOpen({});
  };

  const openReq = async (id: string) => {
    setError(null);
    setReviewNote('');
    setRemarks('');
    try {
      setReqView(await api<Requisition & { trail: TrailStep[] }>(`/recruitment/requisitions/${id}`));
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const editReq = (r: Requisition) => {
    setReqForm({
      title: r.title, departmentId: r.departmentId ?? '', designation: r.designation, vacancies: String(r.vacancies),
      minExperience: String(r.minExperience), maxExperience: String(r.maxExperience), skills: r.skills, qualifications: r.qualifications,
      location: r.location, employmentType: r.employmentType, budgetMinCtc: String(r.budgetMinCtc || ''), budgetMaxCtc: String(r.budgetMaxCtc || ''),
      reason: r.reason, replacementForId: r.replacementForId ?? '', justification: r.justification, description: r.description,
      priority: r.priority, targetDate: r.targetDate?.slice(0, 10) ?? '', hiringManagerId: r.hiringManagerId ?? '',
    });
    setReqView(null);
    setReqOpen({ id: r.id });
  };

  const saveReq = (submit: boolean) =>
    run(
      async () => {
        const body = requisitionBody(reqForm);
        if (reqOpen?.id) {
          await api(`/recruitment/requisitions/${reqOpen.id}`, { method: 'PATCH', body });
          if (submit) await api(`/recruitment/requisitions/${reqOpen.id}/submit`, { method: 'POST' });
        } else {
          await api('/recruitment/requisitions', { method: 'POST', body: { ...body, submit } });
        }
      },
      () => {
        setReqOpen(null);
        setNotice(submit ? 'Requisition submitted. HR or an Admin will approve it.' : 'Requisition saved as draft.');
        requisitions.reload();
        pendingReqs.reload();
      }
    );

  const reqAction = (path: string, body?: unknown, msg?: string) =>
    reqView &&
    run(
      () => api(`/recruitment/requisitions/${reqView.id}/${path}`, { method: 'POST', body }),
      () => {
        setReqView(null);
        if (msg) setNotice(msg);
        requisitions.reload();
        pendingReqs.reload();
      }
    );

  // ---- Candidates ----

  const checkDup = async () => {
    if (!candForm.email.includes('@') && candForm.phone.replace(/\D/g, '').length < 10) return;
    try {
      const params = new URLSearchParams({
        ...(candForm.email.includes('@') ? { email: candForm.email } : {}),
        ...(candForm.phone.replace(/\D/g, '').length >= 10 ? { phone: candForm.phone } : {}),
      });
      const r = await api<{ exists: boolean; candidate: { code: string | null; name: string; matchedOn: string; applications: { job: { title: string } }[] } | null }>(
        `/recruitment/candidates/check?${params}`
      );
      setDup(
        r.exists && r.candidate
          ? `Matches existing candidate ${r.candidate.code ?? ''} ${r.candidate.name} (same ${r.candidate.matchedOn}). Saving will link to that record` +
              (r.candidate.applications.length ? ` — already applied to: ${r.candidate.applications.map((a) => a.job.title).join(', ')}.` : '.')
          : null
      );
    } catch {
      setDup(null);
    }
  };

  const saveCandidate = () =>
    run(async () => {
      const r = await api<IntakeResult>('/recruitment/candidates', { method: 'POST', form: candidateFormData(candForm, candFile) });
      setCandOpen(false);
      setCandFile(null);
      setCandForm(emptyCandidate);
      setNotice(
        r.duplicateOf
          ? `Linked to existing candidate ${r.duplicateOf.code ?? r.duplicateOf.name} (matched by ${r.duplicateOf.matchedOn})` +
              (r.alreadyApplied ? ' — they had already applied to this job.' : r.application ? ` · application ${r.application.code}` : '.')
          : `Added ${r.candidate.code} ${r.candidate.name}${r.application ? ` · application ${r.application.code}` : ''}.`
      );
      candidates.reload();
    });

  const submitReferral = () =>
    refJob &&
    run(async () => {
      const form = new FormData();
      form.append('jobId', refJob.id);
      Object.entries(refForm).forEach(([k, v]) => {
        if (v !== '') form.append(k, v);
      });
      if (refFile) form.append('file', refFile);
      await api('/recruitment/referrals', { method: 'POST', form });
      setRefJob(null);
      setRefForm({ name: '', email: '', phone: '', currentCompany: '', experienceYears: '', skills: '', notes: '' });
      setRefFile(null);
      setNotice('Thanks! Your referral has been sent to HR.');
      referrals.reload();
    });

  const submitFeedback = () =>
    fbFor &&
    run(
      () =>
        api(`/recruitment/interviews/${fbFor.id}/feedback`, {
          method: 'POST',
          body: { rating: Number(fbForm.rating), recommendation: fbForm.recommendation, feedback: fbForm.feedback },
        }),
      () => {
        setFbFor(null);
        interviews.reload();
      }
    );

  const markAttendance = (iv: Interview, attended: boolean) =>
    run(() => api(`/recruitment/interviews/${iv.id}/attendance`, { method: 'POST', body: { attended } }), interviews.reload);

  return (
    <div>
      <PageHeader
        title="Recruitment"
        subtitle={isManagerial ? 'Follow the hiring steps below — pick one to see what needs doing.' : 'Your interviews, open positions and referrals'}
        actions={
          <>
            {isCompanyAdmin && (
              <Button
                variant="secondary"
                onClick={() => {
                  setError(null);
                  setDup(null);
                  setCandOpen(true);
                }}
              >
                + Candidate
              </Button>
            )}
            {isManagerial && session?.employee && <Button onClick={openNewReq}>+ Request a hire</Button>}
          </>
        }
      />
      {isManagerial ? (
        <div className="mb-5 space-y-3">
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {HIRING_STEPS.filter((s) => tabs.includes(s.tab)).map((s, i) => {
              const on = tab === s.tab;
              return (
                <li key={s.tab}>
                  <button
                    onClick={() => setTab(s.tab)}
                    className={`relative flex h-full w-full items-start gap-2.5 rounded-xl border p-3 text-left transition-all ${
                      on ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100' : 'border-ink-200 bg-white hover:border-ink-300 hover:shadow-sm'
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${on ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-500'}`}
                    >
                      <Icon name={s.icon} className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-400">Step {i + 1}</span>
                      <span className={`block text-sm font-semibold ${on ? 'text-brand-700' : 'text-ink-800'}`}>{s.title}</span>
                      <span className="block text-xs leading-snug text-ink-500">{s.hint}</span>
                    </span>
                    {s.tab === 'Requisitions' && toApprove > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                        {toApprove} to approve
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap gap-2">
            {tabs
              .filter((t) => !HIRING_STEPS.some((s) => s.tab === t))
              .map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    tab === t ? 'bg-ink-800 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                  }`}
                >
                  {t}
                </button>
              ))}
          </div>
        </div>
      ) : (
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
      )}
      {notice && (
        <p className="mb-4 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">{notice}</p>
      )}
      {!reqView && !reqOpen && !candOpen && !refJob && !fbFor && <ErrorNote error={error} />}

      {tab === 'Requisitions' && (
        <Card>
          <div className="grid gap-3 border-b border-ink-100 bg-ink-50/60 p-4 text-sm sm:grid-cols-3">
            {[
              ['1', 'Raise the request', 'Fill in the role, openings and budget. Save as draft or submit.'],
              ['2', 'One approval', 'Any HR or Admin approves it — including the HR or Admin who raised it.'],
              ['3', 'Job is created', 'The approved request becomes a job opening, ready to post.'],
            ].map(([n, t, d]) => (
              <div key={n} className="flex gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{n}</span>
                <div>
                  <p className="font-semibold text-ink-800">{t}</p>
                  <p className="text-xs text-ink-500">{d}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 border-b border-ink-100 p-4">
            {REQ_FILTERS.map(([value, text]) => (
              <button
                key={value}
                onClick={() => setReqStatus(value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  reqStatus === value ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                }`}
              >
                {text}
                {value === 'MINE' && toApprove > 0 && ` (${toApprove})`}
              </button>
            ))}
          </div>
          {requisitions.loading ? (
            <Spinner />
          ) : !reqRows.length ? (
            <Empty message={reqStatus === 'MINE' ? 'Nothing waiting for your approval' : 'No requisitions here'} />
          ) : (
            <Table headers={['Role', 'Requested by', 'Openings', 'Budget (CTC)', 'Status', '']}>
              {reqRows.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-ink-50" onClick={() => void openReq(r.id)}>
                  <Td>
                    <p className="flex items-center gap-2 font-medium text-ink-900">
                      {r.title}
                      {['HIGH', 'CRITICAL'].includes(r.priority) && <StatusBadge status={r.priority} />}
                    </p>
                    <p className="text-xs text-ink-400">
                      {r.code} · {[r.department, r.location, label(r.reason)].filter(Boolean).join(' · ')}
                    </p>
                  </Td>
                  <Td>
                    {r.requestedBy?.name ?? '—'}
                    <p className="text-xs text-ink-400">{fmtDate(r.createdAt)}</p>
                  </Td>
                  <Td>{r.vacancies}</Td>
                  <Td className="whitespace-nowrap">
                    {money(r.budgetMinCtc)} – {money(r.budgetMaxCtc)}
                  </Td>
                  <Td>
                    <StatusBadge status={r.status} />
                    <p className={`mt-1 text-xs ${r.canDecide ? 'font-medium text-amber-600' : 'text-ink-400'}`}>{reqNextStep(r)}</p>
                  </Td>
                  <Td className="text-right">
                    {r.canDecide ? (
                      // The row click opens the review; this is the visible cue.
                      <Button>Review</Button>
                    ) : r.job ? (
                      <Link href={`/recruitment/jobs/${r.job.id}`} onClick={(e) => e.stopPropagation()} className="text-sm font-medium text-brand-600">
                        {r.job.code} →
                      </Link>
                    ) : (
                      <span className="text-sm text-ink-400">View</span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'Jobs' && (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 p-4">
            <Select value={jobStatus} onChange={(e) => setJobStatus(e.target.value)} className="max-w-[200px]">
              <option value="">All statuses</option>
              {['APPROVED', 'OPEN', 'ON_HOLD', 'FILLED', 'CLOSED', 'CANCELLED'].map((s) => (
                <option key={s} value={s}>
                  {stageLabel(s)}
                </option>
              ))}
            </Select>
            <p className="text-xs text-ink-400">Jobs are created from approved requisitions. Add a posting to open a job.</p>
          </div>
          {jobs.loading ? (
            <Spinner />
          ) : !jobs.data?.length ? (
            <Empty message={isCompanyAdmin ? 'No job openings yet — approve a requisition first' : 'You are not the hiring manager for any job'} />
          ) : (
            <Table headers={['Job', 'Hiring manager', 'Status', 'Filled', 'Posted on', 'Pipeline']}>
              {jobs.data.map((j) => (
                <tr key={j.id} className="group cursor-pointer hover:bg-ink-50" onClick={() => router.push(`/recruitment/jobs/${j.id}`)}>
                  <Td>
                    <Link
                      href={`/recruitment/jobs/${j.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium text-ink-900 group-hover:text-brand-600"
                    >
                      {j.title}
                    </Link>
                    <p className="text-xs text-ink-400">
                      {[j.code, j.department, j.location, j.employmentType].filter(Boolean).join(' · ')}
                    </p>
                  </Td>
                  <Td>{j.hiringManager?.name ?? '—'}</Td>
                  <Td>
                    <StatusBadge status={j.status} />
                  </Td>
                  <Td>
                    {j.hired ?? 0}/{j.openings}
                  </Td>
                  <Td>
                    {j.livePostings?.length ? (
                      <span className="text-xs text-ink-600">{j.livePostings.join(', ')}</span>
                    ) : (
                      <span className="text-xs text-ink-400">Not posted</span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {PIPELINE.map(({ stage: s }) =>
                        j.pipeline?.[s] ? (
                          <Badge key={s} tone="slate">
                            {stageLabel(s)} {j.pipeline[s]}
                          </Badge>
                        ) : null
                      )}
                      {!j.active && !j.hired && <span className="text-xs text-ink-400">No candidates</span>}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'Candidates' && (
        <Card>
          <div className="flex flex-wrap gap-2 border-b border-ink-100 p-4">
            <Input placeholder="Search name, email, ID, skills, mobile…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
            <Select value={source} onChange={(e) => setSource(e.target.value)} className="max-w-[180px]">
              <option value="">All sources</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {stageLabel(s)}
                </option>
              ))}
            </Select>
            <Select value={stage} onChange={(e) => setStage(e.target.value)} className="max-w-[200px]">
              <option value="">Any stage</option>
              {ALL_STAGES.map((s) => (
                <option key={s} value={s}>
                  {stageLabel(s)}
                </option>
              ))}
            </Select>
          </div>
          {candidates.loading ? (
            <Spinner />
          ) : !candidates.data?.length ? (
            <Empty message="No candidates found" />
          ) : (
            <Table headers={['Candidate', 'Source', 'Experience', 'Applications', 'Added']}>
              {candidates.data.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link href={`/recruitment/candidates/${c.id}`} className="font-medium text-ink-900 hover:text-brand-600">
                      {c.name}
                    </Link>
                    <p className="text-xs text-ink-400">
                      {c.code} · {c.email}
                      {c.phone && ` · ${c.phone}`}
                    </p>
                  </Td>
                  <Td>
                    <Badge tone={c.source === 'REFERRAL' ? 'violet' : 'slate'}>{stageLabel(c.source)}</Badge>
                    {c.referredBy && <p className="mt-1 text-xs text-ink-400">by {c.referredBy.name}</p>}
                  </Td>
                  <Td>
                    {c.experienceYears} yrs
                    <p className="text-xs text-ink-400">{[c.currentCompany, c.currentLocation].filter(Boolean).join(' · ')}</p>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {c.applications.map((a) => (
                        <Link key={a.id} href={`/recruitment/applications/${a.id}`}>
                          <StatusBadge status={a.stage} />
                          <span className="ml-1 text-xs text-ink-500">{a.job.title}</span>
                        </Link>
                      ))}
                      {!c.applications.length && <span className="text-xs text-ink-400">Talent pool</span>}
                    </div>
                  </Td>
                  <Td>{fmtDate(c.createdAt)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'Interviews' && (
        <Card>
          {isManagerial && (
            <div className="border-b border-ink-100 p-4">
              <Select value={interviewScope} onChange={(e) => setInterviewScope(e.target.value as 'mine' | 'all')} className="max-w-[260px]">
                <option value="mine">Interviews I am on the panel for</option>
                <option value="all">{isCompanyAdmin ? 'All interviews' : 'Interviews for my jobs'}</option>
              </Select>
            </div>
          )}
          {interviews.loading ? (
            <Spinner />
          ) : !interviews.data?.length ? (
            <Empty message="No interviews" />
          ) : (
            <Table headers={['When', 'Candidate', 'Round', 'Panel', 'Status', '']}>
              {interviews.data.map((iv) => {
                const started = hasStarted(iv.scheduledAt);
                return (
                  <tr key={iv.id}>
                    <Td>
                      {fmtDate(iv.scheduledAt)}
                      <p className="text-xs text-ink-400">
                        {fmtTime(iv.scheduledAt)} · {iv.durationMinutes} min · {label(iv.mode)}
                      </p>
                    </Td>
                    <Td>
                      {isManagerial ? (
                        <Link href={`/recruitment/applications/${iv.application.id}`} className="font-medium hover:text-brand-600">
                          {iv.application.candidate.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{iv.application.candidate.name}</span>
                      )}
                      <p className="text-xs text-ink-400">{iv.application.job.title}</p>
                    </Td>
                    <Td>
                      {iv.round}
                      <p className="text-xs text-ink-400">{label(iv.interviewType)}</p>
                      {iv.location && (
                        <p className="max-w-[200px] truncate text-xs text-ink-400">
                          {/^https?:\/\//.test(iv.location) ? (
                            <a href={iv.location} target="_blank" rel="noreferrer" className="text-brand-600">
                              Join link
                            </a>
                          ) : (
                            iv.location
                          )}
                        </p>
                      )}
                    </Td>
                    <Td>
                      <span className="text-xs">{iv.panelNames.join(', ') || '—'}</span>
                    </Td>
                    <Td>
                      <StatusBadge status={iv.status} />
                      {iv.myFeedback?.submittedAt && (
                        <p className="mt-1 text-xs text-ink-500">
                          You: {iv.myFeedback.rating}/5 · {label(iv.myFeedback.recommendation)}
                        </p>
                      )}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {iv.isPanelist && started && (iv.status === 'SCHEDULED' || iv.status === 'COMPLETED') && (
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setError(null);
                              setFbForm({
                                rating: String(iv.myFeedback?.rating ?? 4),
                                recommendation: iv.myFeedback?.recommendation || 'HIRE',
                                feedback: iv.myFeedback?.feedback ?? '',
                              });
                              setFbFor(iv);
                            }}
                          >
                            {iv.myFeedback?.submittedAt ? 'Edit feedback' : 'Give feedback'}
                          </Button>
                        )}
                        {iv.isPanelist && started && iv.status === 'SCHEDULED' && iv.attended === null && !iv.myFeedback?.submittedAt && (
                          <Button variant="ghost" onClick={() => void markAttendance(iv, false)}>
                            No-show
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      )}

      {tab === 'Offers' && (
        <Card>
          <div className="border-b border-ink-100 p-4">
            <Select value={offerStatus} onChange={(e) => setOfferStatus(e.target.value)} className="max-w-[220px]">
              <option value="">All statuses</option>
              {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'NEGOTIATING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN'].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </Select>
          </div>
          {offers.loading ? (
            <Spinner />
          ) : !offers.data?.length ? (
            <Empty message="No offers yet" />
          ) : (
            <Table headers={['Offer', 'Candidate', 'Designation', 'CTC', 'Joining', 'Valid until', 'Status']}>
              {offers.data.map((o) => (
                <tr key={o.id}>
                  <Td>
                    <Link href={`/recruitment/applications/${o.application.id}`} className="font-medium text-brand-600">
                      {o.code ?? 'Offer'}
                    </Link>
                  </Td>
                  <Td>
                    {o.application.candidate.name}
                    <p className="text-xs text-ink-400">{o.application.job.title}</p>
                  </Td>
                  <Td>{o.designation}</Td>
                  <Td>{money(o.ctcAnnual)}</Td>
                  <Td>{fmtDate(o.joiningDate)}</Td>
                  <Td>{fmtDate(o.validUntil)}</Td>
                  <Td>
                    <StatusBadge status={o.employeeId ? 'JOINED' : o.status} />
                    {o.pendingWith && <p className="mt-1 text-xs text-ink-400">with {pendingWithLabel(o.pendingWith)}</p>}
                    {o.hasSignedCopy && <p className="mt-1 text-xs text-ink-400">Signed copy on file</p>}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'Pre-joining' && (
        <Card>
          {preJoining.loading ? (
            <Spinner />
          ) : !preJoining.data?.length ? (
            <Empty message="No one in pre-joining — it starts when a candidate accepts an offer" />
          ) : (
            <Table headers={['Candidate', 'Joining', 'Documents', 'BGV', 'Status']}>
              {preJoining.data.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <Link href={`/recruitment/pre-onboarding/${p.id}`} className="font-medium text-ink-900 hover:text-brand-600">
                      {p.application.candidate.name}
                    </Link>
                    <p className="text-xs text-ink-400">
                      {p.application.offer?.designation ?? p.application.job.title} · {p.application.code}
                    </p>
                  </Td>
                  <Td>
                    {fmtDate(p.confirmedJoiningDate ?? p.expectedJoiningDate)}
                    <p className="text-xs text-ink-400">{p.confirmedJoiningDate ? 'Confirmed' : 'Expected'}</p>
                  </Td>
                  <Td>
                    {p.documentsVerified}/{p.documentsRequired} verified
                    <p className="text-xs text-ink-400">{p.documentsSubmitted} submitted</p>
                  </Td>
                  <Td>{p.bgvRequired ? <StatusBadge status={p.bgvStatus} /> : <span className="text-xs text-ink-400">Not required</span>}</Td>
                  <Td>
                    <StatusBadge status={p.status} />
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'Reports' &&
        (stats.loading || !stats.data ? (
          <Spinner />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Open jobs" value={stats.data.jobs.OPEN?.count ?? 0} icon="briefcase" />
              <Stat label="Applications" value={stats.data.totalApplications} icon="users" />
              <Stat label="Avg time to hire" value={stats.data.avgTimeToHireDays !== null ? `${stats.data.avgTimeToHireDays} d` : '—'} icon="clock" />
              <Stat label="Offer acceptance" value={pct(stats.data.offerAcceptanceRate)} icon="check" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <h2 className="mb-4 text-sm font-semibold text-ink-900">Funnel (applications reaching each stage)</h2>
                <HBarList data={stats.data.funnel.map((f) => ({ label: label(f.stage), value: f.reached }))} total={stats.data.totalApplications} />
                <p className="mt-3 text-xs text-ink-400">
                  Avg time to fill (job opened → joining): {stats.data.avgTimeToFillDays !== null ? `${stats.data.avgTimeToFillDays} days` : '—'}
                </p>
              </Card>
              <Card>
                <h2 className="px-5 pt-5 text-sm font-semibold text-ink-900">Source effectiveness</h2>
                {!stats.data.sources.length ? (
                  <Empty message="No applications yet" />
                ) : (
                  <Table headers={['Source', 'Applied', 'Interviewed', 'Offered', 'Joined', 'Hire rate']}>
                    {stats.data.sources.map((s) => (
                      <tr key={s.source}>
                        <Td>{stageLabel(s.source)}</Td>
                        <Td>{s.applications}</Td>
                        <Td>{s.interviewed}</Td>
                        <Td>{s.offered}</Td>
                        <Td>{s.hired}</Td>
                        <Td>{pct(s.hireRate, 1)}</Td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>
            </div>
            <Card>
              <h2 className="px-5 pt-5 text-sm font-semibold text-ink-900">Job-board performance</h2>
              {!platforms.data?.length ? (
                <Empty message="No postings recorded yet" />
              ) : (
                <Table headers={['Platform', 'Postings', 'Spend', 'Applications', 'Cost / application', 'Joined', 'Cost / hire']}>
                  {platforms.data.map((p) => (
                    <tr key={p.platform}>
                      <Td>{p.platform}</Td>
                      <Td>{p.postings}</Td>
                      <Td>{money(p.cost)}</Td>
                      <Td>{p.applications}</Td>
                      <Td>{money(p.costPerApplication)}</Td>
                      <Td>{p.hires}</Td>
                      <Td>{money(p.costPerHire)}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          </div>
        ))}

      {tab === 'Careers & referrals' && (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-3">
            {openJobs.loading ? (
              <Spinner />
            ) : !openJobs.data?.length ? (
              <Card>
                <Empty message="No open positions right now" />
              </Card>
            ) : (
              openJobs.data.map((j) => (
                <Card key={j.id} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-sm font-semibold text-ink-900">{j.title}</h2>
                      <p className="text-xs text-ink-500">
                        {[j.code, j.department, j.location, j.employmentType, yrs(j.minExperience, j.maxExperience)].filter(Boolean).join(' · ')}
                      </p>
                      {j.skills && <p className="mt-1 text-xs text-ink-400">Skills: {j.skills}</p>}
                      {j.description && <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-ink-600">{j.description}</p>}
                    </div>
                    {session?.employee && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setError(null);
                          setNotice(null);
                          setRefJob(j);
                        }}
                      >
                        Refer
                      </Button>
                    )}
                  </div>
                </Card>
              ))
            )}
          </div>
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink-900">My referrals</h2>
            {!referrals.data?.length ? (
              <p className="text-sm text-ink-400">You haven&apos;t referred anyone yet.</p>
            ) : (
              <div className="space-y-3">
                {referrals.data.map((r) => (
                  <div key={r.id} className="border-b border-ink-100 pb-2 last:border-0">
                    <p className="text-sm font-medium text-ink-800">{r.name}</p>
                    {r.applications.map((a) => (
                      <div key={a.id} className="mt-1 flex items-center justify-between text-xs text-ink-500">
                        <span>{a.job.title}</span>
                        <StatusBadge status={a.status} />
                      </div>
                    ))}
                    <p className="mt-1 text-xs text-ink-400">Referred {fmtDate(r.createdAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      <Modal title={reqOpen?.id ? 'Edit requisition' : 'New hiring requisition'} open={!!reqOpen} onClose={() => setReqOpen(null)} wide>
        <ErrorNote error={error} />
        <div className="mt-3">
          <RequisitionFields form={reqForm} setForm={setReqForm} people={people} departments={departments} />
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={() => void saveReq(false)} disabled={reqForm.title.length < 2} className="flex-1">
            Save draft
          </Button>
          <Button
            onClick={() => void saveReq(true)}
            disabled={
              reqForm.title.length < 2 ||
              reqForm.justification.trim().length < 10 ||
              !Number(reqForm.budgetMaxCtc) ||
              (reqForm.reason === 'REPLACEMENT' && !reqForm.replacementForId)
            }
            className="flex-1"
          >
            Submit for approval
          </Button>
        </div>
        <p className="mt-2 text-xs text-ink-400">
          <span className="text-rose-500">*</span> Required to submit. Submitting sends it to HR and Admins; one approval creates the job opening. A draft only needs a job title.
        </p>
      </Modal>

      <Modal title={reqView ? `${reqView.code} · ${reqView.title}` : ''} open={!!reqView} onClose={() => setReqView(null)} wide>
        {reqView && (
          <div className="space-y-4">
            <ErrorNote error={error} />
            <RequisitionProgress status={reqView.status} />
            {reqView.status === 'PENDING_APPROVAL' && !reqView.canDecide && (
              <p className="rounded-xl bg-sky-50 px-3 py-2.5 text-sm text-sky-800">
                {reqView.requestedById === session?.employee?.id
                  ? 'Waiting for approval from HR or an Admin. You can’t approve your own request.'
                  : 'Waiting for approval from HR or an Admin.'}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={reqView.status} />
              <StatusBadge status={reqView.priority} />
              {reqView.job && (
                <Link href={`/recruitment/jobs/${reqView.job.id}`} className="text-sm font-medium text-brand-600">
                  Open job {reqView.job.code} →
                </Link>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
              {[
                ['Department', reqView.department || '—'],
                ['Designation', reqView.designation || '—'],
                ['Vacancies', reqView.vacancies],
                ['Experience', yrs(reqView.minExperience, reqView.maxExperience)],
                ['Budget', `${money(reqView.budgetMinCtc)} – ${money(reqView.budgetMaxCtc)}`],
                ['Location', reqView.location || '—'],
                ['Type', reqView.employmentType],
                ['Reason', `${label(reqView.reason)}${reqView.replacementFor ? ` (${reqView.replacementFor.name})` : ''}`],
                ['Target date', fmtDate(reqView.targetDate)],
                ['Requested by', reqView.requestedBy?.name ?? '—'],
                ['Hiring manager', reqView.hiringManager?.name ?? '—'],
                ['Skills', reqView.skills || '—'],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{k}</dt>
                  <dd className="text-ink-700">{v}</dd>
                </div>
              ))}
            </dl>
            {reqView.justification && (
              <div className="rounded-xl bg-ink-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Why this hire is needed</p>
                <p className="mt-1 whitespace-pre-line text-sm text-ink-600">{reqView.justification}</p>
              </div>
            )}
            {reqView.hrReviewNote && (
              <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                <span className="font-semibold">HR note:</span> {reqView.hrReviewNote}
              </p>
            )}
            {reqView.trail.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Approval history</h3>
                <ol className="space-y-1.5 text-sm">
                  {reqView.trail.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={s.status} />
                      <span className="text-ink-700">
                        {s.actedByName ?? (s.approverName === 'HR' ? 'HR or Admin' : label(s.approverName ?? ''))}
                      </span>
                      {s.actedAt && <span className="text-xs text-ink-400">{fmtDate(s.actedAt)}</span>}
                      {s.remarks && <span className="text-xs text-ink-500">“{s.remarks}”</span>}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {reqView.canDecide && reqView.status === 'PENDING_APPROVAL' && (
              <div className="space-y-3 rounded-xl border border-brand-100 bg-brand-50/40 p-4">
                <div>
                  <h3 className="text-sm font-semibold text-ink-900">Your decision</h3>
                  <p className="text-xs text-ink-500">One approval is enough — approving creates the job opening straight away.</p>
                </div>
                <Field label="Comment for the requester" hint="Optional to approve or reject; needed to send it back.">
                  <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() =>
                      void reqAction('decide', { decision: 'APPROVED', remarks: remarks.trim() || undefined }, 'Approved — the job opening has been created.')
                    }
                  >
                    Approve &amp; create job
                  </Button>
                  {isCompanyAdmin && (
                    <Button
                      variant="secondary"
                      disabled={remarks.trim().length < 3}
                      onClick={() => void reqAction('review', { note: remarks.trim(), sendBack: true }, 'Sent back to the requester for changes.')}
                    >
                      Send back for changes
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    onClick={() => void reqAction('decide', { decision: 'REJECTED', remarks: remarks.trim() || undefined }, 'Requisition rejected.')}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            )}

            {isCompanyAdmin && !reqView.canDecide && ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(reqView.status) && (
              <div className="space-y-2 rounded-xl border border-ink-100 p-3">
                <Field label="Add a note for the requester">
                  <Textarea rows={2} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
                </Field>
                <Button variant="secondary" disabled={reviewNote.trim().length < 3} onClick={() => void reqAction('review', { note: reviewNote }, 'Note added.')}>
                  Add note
                </Button>
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-4">
              {reqView.status === 'DRAFT' && (reqView.requestedById === session?.employee?.id || isCompanyAdmin) && (
                <>
                  <Button variant="secondary" onClick={() => editReq(reqView)}>
                    Edit
                  </Button>
                  <Button onClick={() => void reqAction('submit', undefined, 'Requisition submitted. HR or an Admin will approve it.')}>
                    Submit for approval
                  </Button>
                </>
              )}
              {['DRAFT', 'PENDING_APPROVAL'].includes(reqView.status) && (reqView.requestedById === session?.employee?.id || isCompanyAdmin) && (
                <Button variant="ghost" onClick={() => void reqAction('cancel', {}, 'Requisition cancelled.')}>
                  Cancel request
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal title="Add candidate" open={candOpen} onClose={() => setCandOpen(false)} wide>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <CandidateFields form={candForm} setForm={setCandForm} onBlurContact={() => void checkDup()} />
          {dup && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">{dup}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Apply to job (optional)">
              <Select value={candForm.jobId} onChange={(e) => setCandForm({ ...candForm, jobId: e.target.value })}>
                <option value="">— talent pool only —</option>
                {(jobOptions.data ?? [])
                  .filter((j) => !['CLOSED', 'FILLED', 'CANCELLED'].includes(j.status))
                  .map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.code} · {j.title}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="External ref (platform application id)">
              <Input value={candForm.externalRef} onChange={(e) => setCandForm({ ...candForm, externalRef: e.target.value })} />
            </Field>
          </div>
          <Field label="Resume (PDF / Word)">
            <input type="file" accept=".pdf,.doc,.docx,.rtf,.odt,.txt" onChange={(e) => setCandFile(e.target.files?.[0] ?? null)} className="text-sm" />
          </Field>
          <Button onClick={() => void saveCandidate()} disabled={candForm.name.length < 2 || !candForm.email.includes('@')} className="w-full">
            {dup ? 'Link existing candidate' : 'Add candidate'}
          </Button>
        </div>
      </Modal>

      <Modal title={`Refer for ${refJob?.title ?? ''}`} open={!!refJob} onClose={() => setRefJob(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Candidate name">
            <Input value={refForm.name} onChange={(e) => setRefForm({ ...refForm, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email">
              <Input type="email" value={refForm.email} onChange={(e) => setRefForm({ ...refForm, email: e.target.value })} />
            </Field>
            <Field label="Mobile">
              <Input value={refForm.phone} onChange={(e) => setRefForm({ ...refForm, phone: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Current company">
              <Input value={refForm.currentCompany} onChange={(e) => setRefForm({ ...refForm, currentCompany: e.target.value })} />
            </Field>
            <Field label="Experience (yrs)">
              <Input type="number" value={refForm.experienceYears} onChange={(e) => setRefForm({ ...refForm, experienceYears: e.target.value })} />
            </Field>
          </div>
          <Field label="Skills">
            <Input value={refForm.skills} onChange={(e) => setRefForm({ ...refForm, skills: e.target.value })} />
          </Field>
          <Field label="Why are they a good fit?">
            <Textarea value={refForm.notes} onChange={(e) => setRefForm({ ...refForm, notes: e.target.value })} />
          </Field>
          <Field label="Resume (optional)">
            <input type="file" accept=".pdf,.doc,.docx,.rtf,.odt,.txt" onChange={(e) => setRefFile(e.target.files?.[0] ?? null)} className="text-sm" />
          </Field>
          <Button onClick={() => void submitReferral()} disabled={refForm.name.length < 2 || !refForm.email.includes('@')} className="w-full">
            Submit referral
          </Button>
        </div>
      </Modal>

      <Modal title="Interview feedback" open={!!fbFor} onClose={() => setFbFor(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <p className="text-sm text-ink-500">
            {fbFor?.round} · {fbFor?.application.candidate.name} ({fbFor?.application.job.title})
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rating (1–5)">
              <Select value={fbForm.rating} onChange={(e) => setFbForm({ ...fbForm, rating: e.target.value })}>
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Recommendation">
              <Select value={fbForm.recommendation} onChange={(e) => setFbForm({ ...fbForm, recommendation: e.target.value })}>
                {RECOMMENDATIONS.map((r) => (
                  <option key={r} value={r}>
                    {label(r)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Feedback">
            <Textarea rows={5} value={fbForm.feedback} onChange={(e) => setFbForm({ ...fbForm, feedback: e.target.value })} />
          </Field>
          <Button onClick={() => void submitFeedback()} disabled={fbForm.feedback.trim().length < 3} className="w-full">
            Submit feedback
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/** Submitted → Approved → Job created, for the requisition dialog. */
function RequisitionProgress({ status }: { status: string }) {
  if (status === 'REJECTED' || status === 'CANCELLED') {
    return (
      <p className={`rounded-xl px-3 py-2.5 text-sm ${status === 'REJECTED' ? 'bg-rose-50 text-rose-700' : 'bg-ink-100 text-ink-600'}`}>
        {status === 'REJECTED' ? 'This request was not approved.' : 'This request was cancelled.'}
      </p>
    );
  }
  const done = { DRAFT: 0, PENDING_APPROVAL: 1, APPROVED: 3 }[status] ?? 0;
  const steps = ['Submitted', 'Approved by HR or Admin', 'Job created'];
  return (
    <ol className="flex items-center gap-2">
      {steps.map((s, i) => {
        const complete = i < done;
        const current = i === done;
        return (
          <li key={s} className="flex flex-1 items-center gap-2">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                complete ? 'bg-emerald-500 text-white' : current ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-400'
              }`}
            >
              {complete ? <Icon name="check" className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={`text-xs font-medium ${complete || current ? 'text-ink-800' : 'text-ink-400'}`}>{s}</span>
            {i < steps.length - 1 && <span className={`h-px flex-1 ${complete ? 'bg-emerald-300' : 'bg-ink-200'}`} />}
          </li>
        );
      })}
    </ol>
  );
}
