'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, Select, Spinner, Stat, Table, Tabs, Td, Textarea } from '@/components/ui';
import { errMsg, label } from '@/components/talent';
import {
  CLOSED_STAGES, CSV_TEMPLATE, CandidateFields, JobFields, MatchBar, PIPELINE, PLATFORMS, StatusBadge, candidateFormData, emptyCandidate,
  jobBody, jobForm, money, stageLabel, useDirectory, yrs, type CandidateForm, type Job, type JobForm,
} from '@/components/recruitment';

interface Posting {
  id: string;
  platform: string;
  platformName: string;
  label: string;
  url: string;
  externalId: string;
  postedOn: string | null;
  expiresOn: string | null;
  cost?: number;
  status: string;
  notes: string;
  applications: number;
  hires: number;
  costPerApplication?: number | null;
  postedBy: { name: string } | null;
}

interface Application {
  id: string;
  code: string | null;
  stage: string;
  rating: number | null;
  rejectionReason: string;
  source: string;
  appliedOn: string;
  match: number;
  assignedTo: { name: string } | null;
  posting: { id: string; label: string } | null;
  candidate: { id: string; code: string | null; name: string; email: string; experienceYears: number; currentCompany: string; referredById: string | null };
  offer: { id: string; code: string | null; status: string } | null;
  interviews: { id: string; round: string; status: string }[];
}

type JobDetail = Job & {
  applications: Application[];
  postings: Posting[];
  requisition: { id: string; code: string; reason: string; priority: string; requestedBy: { name: string } | null } | null;
};

interface PoolCandidate {
  id: string;
  code: string | null;
  name: string;
  email: string;
  applications: { job: { id: string } }[];
}

interface ImportResult {
  dryRun: boolean;
  total: number;
  created: number;
  linked: number;
  alreadyApplied: number;
  errors: number;
  rows: { row: number; name: string; email: string; status: string; message: string; candidateCode?: string | null; applicationCode?: string | null }[];
}

/** The 13 pipeline stages grouped into five phases, so the board fits without sideways scrolling. */
const PHASES: { key: string; title: string; stages: string[] }[] = [
  { key: 'NEW', title: 'New', stages: ['APPLIED', 'ON_HOLD'] },
  { key: 'SCREENING', title: 'Screening', stages: ['SHORTLISTED', 'HR_SCREENED'] },
  { key: 'INTERVIEW', title: 'Interview', stages: ['INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED', 'SELECTED'] },
  { key: 'OFFER', title: 'Offer', stages: ['OFFERED', 'OFFER_ACCEPTED'] },
  { key: 'JOINING', title: 'Joining', stages: ['PRE_ONBOARDING', 'DOCUMENTS_VERIFIED', 'READY_TO_JOIN', 'JOINED'] },
];

const emptyPosting = { platform: 'LINKEDIN', platformName: '', url: '', externalId: '', postedOn: '', expiresOn: '', cost: '', notes: '', status: 'PUBLISHED' };

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { isCompanyAdmin } = useAuth();
  const job = useFetch<JobDetail>(`/recruitment/jobs/${id}`);
  const people = useDirectory();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [phase, setPhase] = useState('ALL');

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<JobForm | null>(null);
  const [postingOpen, setPostingOpen] = useState<{ id?: string } | null>(null);
  const [postingForm, setPostingForm] = useState(emptyPosting);
  const [renewFor, setRenewFor] = useState<Posting | null>(null);
  const [renewDate, setRenewDate] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [addTab, setAddTab] = useState('New candidate');
  const [candForm, setCandForm] = useState<CandidateForm>(emptyCandidate);
  const [candFile, setCandFile] = useState<File | null>(null);
  const [pool, setPool] = useState<PoolCandidate[]>([]);
  const [poolQ, setPoolQ] = useState('');
  const [pick, setPick] = useState('');
  const [pickPosting, setPickPosting] = useState('');

  const [importOpen, setImportOpen] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const [rejectFor, setRejectFor] = useState<Application | null>(null);
  const [reason, setReason] = useState('');

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    try {
      await fn();
      after?.();
      job.reload();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  if (job.loading && !job.data) return <Spinner />;
  if (!job.data) return <ErrorNote error={job.error ?? 'Job not found'} />;
  const j = job.data;
  const ended = ['CLOSED', 'FILLED', 'CANCELLED'].includes(j.status);
  const closed = j.applications.filter((a) => CLOSED_STAGES.includes(a.stage));
  const poolOptions = pool.filter(
    (c) => !c.applications.some((a) => a.job.id === id) && (!poolQ || `${c.name} ${c.email} ${c.code}`.toLowerCase().includes(poolQ.toLowerCase()))
  );
  const livePostings = j.postings.filter((p) => !['CLOSED', 'EXPIRED'].includes(p.status));

  const setStatus = (status: string) => run(() => api(`/recruitment/jobs/${id}/status`, { method: 'POST', body: { status } }));

  const saveEdit = () =>
    form && run(() => api(`/recruitment/jobs/${id}`, { method: 'PATCH', body: jobBody(form) }), () => setEditOpen(false));

  const remove = async () => {
    if (!confirm('Delete this job? This cannot be undone.')) return;
    try {
      await api(`/recruitment/jobs/${id}`, { method: 'DELETE' });
      router.replace('/recruitment?tab=Jobs');
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const openPosting = (p?: Posting) => {
    setError(null);
    setPostingForm(
      p
        ? {
            platform: p.platform, platformName: p.platformName, url: p.url, externalId: p.externalId, postedOn: p.postedOn?.slice(0, 10) ?? '',
            expiresOn: p.expiresOn?.slice(0, 10) ?? '', cost: String(p.cost ?? ''), notes: p.notes, status: p.status,
          }
        : emptyPosting
    );
    setPostingOpen({ id: p?.id });
  };

  const savePosting = () =>
    run(
      () => {
        const body = {
          platform: postingForm.platform,
          platformName: postingForm.platformName,
          url: postingForm.url,
          externalId: postingForm.externalId,
          postedOn: postingForm.postedOn || null,
          expiresOn: postingForm.expiresOn || null,
          cost: Number(postingForm.cost) || 0,
          notes: postingForm.notes,
        };
        return postingOpen?.id
          ? api(`/recruitment/postings/${postingOpen.id}`, { method: 'PATCH', body })
          : api(`/recruitment/jobs/${id}/postings`, { method: 'POST', body: { ...body, status: postingForm.status } });
      },
      () => setPostingOpen(null)
    );

  const postingStatus = (p: Posting, status: string) => run(() => api(`/recruitment/postings/${p.id}/status`, { method: 'POST', body: { status } }));
  const removePosting = (p: Posting) => {
    if (!confirm(`Delete the ${p.label} posting?`)) return;
    void run(() => api(`/recruitment/postings/${p.id}`, { method: 'DELETE' }));
  };

  const openAdd = async () => {
    setError(null);
    setPick('');
    setPickPosting('');
    setCandForm(emptyCandidate);
    setCandFile(null);
    setAddOpen(true);
    try {
      setPool(await api<PoolCandidate[]>('/recruitment/candidates'));
    } catch {
      setPool([]);
    }
  };

  const addCandidate = () =>
    run(
      async () => {
        if (addTab === 'New candidate') {
          const r = await api<{ candidate: { code: string | null; name: string }; duplicateOf: { code: string | null; matchedOn: string } | null; alreadyApplied: boolean }>(
            '/recruitment/candidates',
            { method: 'POST', form: candidateFormData({ ...candForm, jobId: id }, candFile) }
          );
          setNotice(
            r.alreadyApplied
              ? `${r.candidate.name} had already applied to this job.`
              : r.duplicateOf
                ? `Existing candidate ${r.duplicateOf.code ?? ''} (matched by ${r.duplicateOf.matchedOn}) added to this job.`
                : `${r.candidate.code} ${r.candidate.name} added.`
          );
        } else {
          await api('/recruitment/applications', { method: 'POST', body: { jobId: id, candidateId: pick, ...(pickPosting ? { postingId: pickPosting } : {}) } });
        }
      },
      () => setAddOpen(false)
    );

  const runImport = async (dryRun: boolean) => {
    if (!csvFile) return;
    setError(null);
    const fd = new FormData();
    fd.append('file', csvFile);
    try {
      const r = await api<ImportResult>(`/recruitment/jobs/${id}/candidates/import?dryRun=${dryRun}`, { method: 'POST', form: fd });
      setImportResult(r);
      if (!dryRun) job.reload();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const screen = (a: Application, decision: string, rejectionReason?: string) =>
    run(
      () => api(`/recruitment/applications/${a.id}/screen`, { method: 'POST', body: { decision, ...(rejectionReason ? { rejectionReason } : {}) } }),
      () => {
        setRejectFor(null);
        setReason('');
      }
    );

  const reopen = (a: Application) => run(() => api(`/recruitment/applications/${a.id}/stage`, { method: 'POST', body: { stage: 'SHORTLISTED', reason: 'Reopened' } }));

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'candidates-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const active = j.applications.filter((a) => !CLOSED_STAGES.includes(a.stage));
  const inPhase = (key: string) => active.filter((a) => (PHASES.find((ph) => ph.key === key)?.stages ?? []).includes(a.stage));
  const shown = phase === 'ALL' ? active : inPhase(phase);
  const stageTitle = (st: string) => PIPELINE.find((x) => x.stage === st)?.title ?? stageLabel(st);
  const newCount = inPhase('NEW').length;

  // One plain-language "what to do next" for the job's current state.
  const next: { text: string; action?: { label: string; onClick: () => void } } | null =
    j.status === 'FILLED'
      ? { text: 'All positions are filled. Close the job once onboarding is done.' }
      : j.status === 'CLOSED' || j.status === 'CANCELLED'
        ? { text: `This job is ${j.status.toLowerCase()}. Reopen it to hire again.` }
        : j.status === 'ON_HOLD'
          ? { text: 'This job is on hold — resume it to continue hiring.', action: isCompanyAdmin ? { label: 'Resume', onClick: () => void setStatus('OPEN') } : undefined }
          : !j.postings.length && j.status === 'APPROVED'
            ? {
                text: 'Next: advertise this job. Record where it is posted (LinkedIn, Naukri, careers page) — publishing a posting opens the job.',
                action: isCompanyAdmin ? { label: '+ Record posting', onClick: () => openPosting() } : undefined,
              }
            : !active.length
              ? { text: 'Next: add candidates who applied, or import them from a CSV.', action: isCompanyAdmin ? { label: '+ Add candidate', onClick: () => void openAdd() } : undefined }
              : newCount
                ? { text: `${newCount} new applicant${newCount > 1 ? 's' : ''} waiting to be screened — shortlist, hold or reject them.`, action: { label: 'Show them', onClick: () => setPhase('NEW') } }
                : null;

  return (
    <div className="min-w-0">
      <Link href="/recruitment?tab=Jobs" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-brand-600">
        ← Back to jobs
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight text-ink-900">{j.title}</h1>
            <StatusBadge status={j.status} />
          </div>
          <p className="mt-0.5 text-sm text-ink-500">{[j.code, j.department, j.location, j.employmentType].filter(Boolean).join(' · ')}</p>
        </div>
        {isCompanyAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setError(null);
                setForm(jobForm(j));
                setEditOpen(true);
              }}
            >
              Edit
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setError(null);
                setCsvFile(null);
                setImportResult(null);
                setImportOpen(true);
              }}
              disabled={ended}
            >
              Import CSV
            </Button>
            <Button onClick={() => void openAdd()} disabled={ended}>
              + Add candidate
            </Button>
          </div>
        )}
      </div>

      {next && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3">
          <p className="text-sm text-brand-900">{next.text}</p>
          {next.action && (
            <Button variant="secondary" onClick={next.action.onClick}>
              {next.action.label}
            </Button>
          )}
        </div>
      )}
      {notice && <p className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">{notice}</p>}
      {!addOpen && !postingOpen && !importOpen && !editOpen && !rejectFor && <ErrorNote error={error} />}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Positions filled" value={`${j.hired ?? 0} / ${j.openings}`} icon="check" />
        <Stat label="Candidates in process" value={active.filter((a) => a.stage !== 'JOINED').length} icon="users" />
        <Stat label="Live postings" value={livePostings.length} icon="megaphone" />
        {isCompanyAdmin && j.maxCtc !== undefined ? (
          <Stat label="Budget (CTC / yr)" value={<span className="text-lg">{money(j.minCtc)} – {money(j.maxCtc)}</span>} icon="banknote" />
        ) : (
          <Stat label="Experience" value={<span className="text-lg">{yrs(j.minExperience, j.maxExperience)}</span>} icon="briefcase" />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
              <div>
                <h2 className="text-sm font-semibold text-ink-900">Candidates</h2>
                <p className="text-xs text-ink-400">Pick a stage to filter. Open a candidate to schedule interviews, make an offer or move them on.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 px-5 pt-3">
              {[{ key: 'ALL', title: 'All', count: active.length }, ...PHASES.map((ph) => ({ key: ph.key, title: ph.title, count: inPhase(ph.key).length }))].map((ph) => (
                <button
                  key={ph.key}
                  onClick={() => setPhase(ph.key)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    phase === ph.key ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                  }`}
                >
                  {ph.title} <span className={phase === ph.key ? 'text-brand-200' : 'text-ink-400'}>{ph.count}</span>
                </button>
              ))}
            </div>
            {!shown.length ? (
              <Empty message={active.length ? 'Nobody at this stage' : 'No candidates yet'} />
            ) : (
              <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((a) => (
                  <div key={a.id} className="flex min-w-0 flex-col rounded-xl border border-ink-200 p-3.5 transition-shadow hover:shadow-md">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/recruitment/applications/${a.id}`} className="block truncate text-sm font-semibold text-ink-900 hover:text-brand-600">
                          {a.candidate.name}
                        </Link>
                        <p className="truncate text-xs text-ink-400">
                          {a.candidate.experienceYears} yrs{a.candidate.currentCompany ? ` · ${a.candidate.currentCompany}` : ''}
                        </p>
                      </div>
                      <Badge tone="blue">{stageTitle(a.stage)}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <MatchBar score={a.match} />
                      {a.candidate.referredById && <Badge tone="violet">Referral</Badge>}
                      {a.posting ? <Badge tone="slate">{a.posting.label}</Badge> : a.source && <Badge tone="slate">{stageLabel(a.source)}</Badge>}
                      {a.interviews.length > 0 && (
                        <Badge tone="slate">
                          {a.interviews.filter((i) => i.status === 'COMPLETED').length}/{a.interviews.filter((i) => i.status !== 'CANCELLED').length} rounds
                        </Badge>
                      )}
                      {a.offer && <StatusBadge status={a.offer.status} />}
                    </div>
                    {a.assignedTo && <p className="mt-1 text-xs text-ink-400">Owner: {a.assignedTo.name}</p>}
                    <div className="mt-auto flex flex-wrap gap-1 pt-3">
                      {(a.stage === 'APPLIED' || a.stage === 'ON_HOLD') && (
                        <>
                          <button
                            onClick={() => void screen(a, 'SHORTLISTED')}
                            className="rounded-lg bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
                          >
                            Shortlist
                          </button>
                          {a.stage === 'APPLIED' && (
                            <button
                              onClick={() => void screen(a, 'ON_HOLD')}
                              className="rounded-lg bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
                            >
                              Hold
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setError(null);
                              setReason('');
                              setRejectFor(a);
                            }}
                            className="rounded-lg bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      <Link href={`/recruitment/applications/${a.id}`} className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50">
                        Open →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {closed.length > 0 && (
              <div className="border-t border-ink-100 px-5 py-3">
                <button onClick={() => setShowClosed(!showClosed)} className="text-sm font-medium text-ink-600">
                  {showClosed ? '▾' : '▸'} Rejected / withdrawn / declined ({closed.length})
                </button>
                {showClosed && (
                  <div className="mt-2 divide-y divide-ink-100">
                    {closed.map((a) => (
                      <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                        <div className="min-w-0">
                          <Link href={`/recruitment/applications/${a.id}`} className="font-medium hover:text-brand-600">
                            {a.candidate.name}
                          </Link>
                          <span className="ml-2">
                            <StatusBadge status={a.stage} />
                          </span>
                          {a.rejectionReason && <p className="text-xs text-ink-400">{a.rejectionReason}</p>}
                        </div>
                        {isCompanyAdmin && !ended && (
                          <Button variant="ghost" onClick={() => void reopen(a)}>
                            Reopen
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
              <div>
                <h2 className="text-sm font-semibold text-ink-900">Where it&apos;s advertised</h2>
                <p className="text-xs text-ink-400">Job boards and pages this opening is posted on. Recorded manually.</p>
              </div>
              {isCompanyAdmin && !ended && (
                <Button variant="ghost" onClick={() => openPosting()}>
                  + Record posting
                </Button>
              )}
            </div>
            {!j.postings.length ? (
              <Empty message="Not posted anywhere yet" />
            ) : (
              <div className="divide-y divide-ink-100 px-5 pb-2 pt-2">
                {j.postings.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-900">
                        {p.label}
                        <StatusBadge status={p.status} />
                        {p.url && (
                          <a href={p.url} target="_blank" rel="noreferrer" className="text-xs font-normal text-brand-600">
                            View ↗
                          </a>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {[
                          `Posted ${fmtDate(p.postedOn)}`,
                          p.expiresOn && `expires ${fmtDate(p.expiresOn)}`,
                          `${p.applications} applied`,
                          `${p.hires} joined`,
                          isCompanyAdmin && p.cost ? `cost ${money(p.cost)}${p.costPerApplication ? ` (${money(p.costPerApplication)} / application)` : ''}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    {isCompanyAdmin && (
                      <div className="flex flex-wrap gap-1">
                        {p.status === 'DRAFT' && <Button variant="ghost" onClick={() => void postingStatus(p, 'PUBLISHED')}>Publish</Button>}
                        {p.status === 'PUBLISHED' && <Button variant="ghost" onClick={() => void postingStatus(p, 'ACTIVE')}>Mark active</Button>}
                        {!ended && (
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setError(null);
                              setRenewDate('');
                              setRenewFor(p);
                            }}
                          >
                            {['EXPIRED', 'CLOSED'].includes(p.status) ? 'Renew' : 'Extend'}
                          </Button>
                        )}
                        {!['CLOSED', 'EXPIRED'].includes(p.status) && <Button variant="ghost" onClick={() => void postingStatus(p, 'CLOSED')}>Close</Button>}
                        <Button variant="ghost" onClick={() => openPosting(p)}>
                          Edit
                        </Button>
                        {p.applications === 0 && (
                          <Button variant="ghost" onClick={() => removePosting(p)}>
                            Delete
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink-900">Job details</h2>
            <dl className="space-y-2.5 text-sm">
              {(
                [
                  ['Hiring manager', j.hiringManager?.name ?? '—'],
                  ['Designation', j.designation || '—'],
                  ['Openings', j.openings],
                  ['Experience', yrs(j.minExperience, j.maxExperience)],
                  ['Skills', j.skills || '—'],
                  ['Qualifications', j.qualifications || '—'],
                  [
                    'Requisition',
                    j.requisition
                      ? `${j.requisition.code} · ${label(j.requisition.reason)} · ${label(j.requisition.priority)} priority · by ${j.requisition.requestedBy?.name ?? '—'}`
                      : '—',
                  ],
                ] as [string, string | number][]
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{k}</dt>
                  <dd className="break-words text-ink-700">{v}</dd>
                </div>
              ))}
            </dl>
            {j.description && (
              <details className="mt-3 border-t border-ink-100 pt-3">
                <summary className="cursor-pointer text-sm font-medium text-ink-600">Job description</summary>
                <p className="mt-2 whitespace-pre-line break-words text-sm text-ink-600">{j.description}</p>
              </details>
            )}
          </Card>
          {isCompanyAdmin && (
            <Card className="p-5">
              <h2 className="mb-1 text-sm font-semibold text-ink-900">Job status</h2>
              <p className="mb-3 text-xs text-ink-400">Open it to take candidates, pause it, or close it when hiring is done.</p>
              <div className="flex flex-wrap gap-2">
                {j.status === 'APPROVED' && <Button variant="secondary" onClick={() => void setStatus('OPEN')}>Open without posting</Button>}
                {j.status === 'OPEN' && <Button variant="secondary" onClick={() => void setStatus('ON_HOLD')}>Put on hold</Button>}
                {j.status === 'ON_HOLD' && <Button variant="secondary" onClick={() => void setStatus('OPEN')}>Resume</Button>}
                {!ended && <Button variant="secondary" onClick={() => void setStatus('CLOSED')}>Close job</Button>}
                {ended && <Button variant="secondary" onClick={() => void setStatus('OPEN')}>Reopen</Button>}
                {!ended && (
                  <Button variant="ghost" onClick={() => confirm('Cancel this job? Open postings close too.') && void setStatus('CANCELLED')}>
                    Cancel job
                  </Button>
                )}
                {!j.applications.length && (
                  <Button variant="ghost" onClick={() => void remove()}>
                    Delete
                  </Button>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      <Modal title="Reject candidate" open={!!rejectFor} onClose={() => setRejectFor(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <p className="text-sm text-ink-500">{rejectFor?.candidate.name}</p>
          <Field label="Reason">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button variant="danger" onClick={() => rejectFor && void screen(rejectFor, 'REJECTED', reason)} disabled={reason.trim().length < 3} className="w-full">
            Reject
          </Button>
        </div>
      </Modal>

      <Modal title="Edit job" open={editOpen} onClose={() => setEditOpen(false)} wide>
        <ErrorNote error={error} />
        {form && (
          <div className="mt-3">
            <JobFields form={form} setForm={setForm} people={people} />
          </div>
        )}
        <Button onClick={() => void saveEdit()} disabled={!form || form.title.length < 2} className="mt-4 w-full">
          Save
        </Button>
      </Modal>

      <Modal title={postingOpen?.id ? 'Edit posting' : 'Record a job posting'} open={!!postingOpen} onClose={() => setPostingOpen(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Platform">
              <Select value={postingForm.platform} onChange={(e) => setPostingForm({ ...postingForm, platform: e.target.value })}>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {stageLabel(p)}
                  </option>
                ))}
              </Select>
            </Field>
            {postingForm.platform === 'OTHER' ? (
              <Field label="Platform name">
                <Input value={postingForm.platformName} onChange={(e) => setPostingForm({ ...postingForm, platformName: e.target.value })} />
              </Field>
            ) : (
              <Field label="Posting ID on platform">
                <Input value={postingForm.externalId} onChange={(e) => setPostingForm({ ...postingForm, externalId: e.target.value })} />
              </Field>
            )}
          </div>
          <Field label="Posting URL">
            <Input value={postingForm.url} onChange={(e) => setPostingForm({ ...postingForm, url: e.target.value })} placeholder="https://…" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Posted on">
              <Input type="date" value={postingForm.postedOn} onChange={(e) => setPostingForm({ ...postingForm, postedOn: e.target.value })} />
            </Field>
            <Field label="Expires on">
              <Input type="date" value={postingForm.expiresOn} onChange={(e) => setPostingForm({ ...postingForm, expiresOn: e.target.value })} />
            </Field>
            <Field label="Cost (₹)">
              <Input type="number" min={0} value={postingForm.cost} onChange={(e) => setPostingForm({ ...postingForm, cost: e.target.value })} />
            </Field>
          </div>
          {!postingOpen?.id && (
            <Field label="Status">
              <Select value={postingForm.status} onChange={(e) => setPostingForm({ ...postingForm, status: e.target.value })}>
                <option value="PUBLISHED">Published (opens the job)</option>
                <option value="DRAFT">Draft</option>
              </Select>
            </Field>
          )}
          <Field label="Notes">
            <Textarea rows={2} value={postingForm.notes} onChange={(e) => setPostingForm({ ...postingForm, notes: e.target.value })} />
          </Field>
          <p className="text-xs text-ink-400">Postings are recorded manually — HRMS does not publish to job boards automatically yet.</p>
          <Button onClick={() => void savePosting()} disabled={postingForm.platform === 'OTHER' && !postingForm.platformName.trim()} className="w-full">
            Save posting
          </Button>
        </div>
      </Modal>

      <Modal title={`Renew ${renewFor?.label ?? ''} posting`} open={!!renewFor} onClose={() => setRenewFor(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="New expiry date">
            <Input type="date" value={renewDate} onChange={(e) => setRenewDate(e.target.value)} />
          </Field>
          <Button
            onClick={() =>
              renewFor && void run(() => api(`/recruitment/postings/${renewFor.id}/renew`, { method: 'POST', body: { expiresOn: renewDate } }), () => setRenewFor(null))
            }
            disabled={!renewDate}
            className="w-full"
          >
            Renew & activate
          </Button>
        </div>
      </Modal>

      <Modal title="Add candidate to this job" open={addOpen} onClose={() => setAddOpen(false)} wide>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Tabs tabs={['New candidate', 'From talent pool']} active={addTab} onChange={setAddTab} />
          {addTab === 'New candidate' ? (
            <>
              <p className="text-xs text-ink-400">If the email or mobile matches someone already in the talent pool, that record is reused.</p>
              <CandidateFields form={candForm} setForm={setCandForm} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Came through posting">
                  <Select value={candForm.postingId} onChange={(e) => setCandForm({ ...candForm, postingId: e.target.value })}>
                    <option value="">— direct / referral / email —</option>
                    {livePostings.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="External ref">
                  <Input value={candForm.externalRef} onChange={(e) => setCandForm({ ...candForm, externalRef: e.target.value })} />
                </Field>
              </div>
              <Field label="Resume (PDF / Word)">
                <input type="file" accept=".pdf,.doc,.docx,.rtf,.odt,.txt" onChange={(e) => setCandFile(e.target.files?.[0] ?? null)} className="text-sm" />
              </Field>
            </>
          ) : (
            <>
              <Input placeholder="Search talent pool…" value={poolQ} onChange={(e) => setPoolQ(e.target.value)} />
              <Field label="Candidate">
                <Select value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">— select —</option>
                  {poolOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name} ({c.email})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Came through posting">
                <Select value={pickPosting} onChange={(e) => setPickPosting(e.target.value)}>
                  <option value="">— none —</option>
                  {livePostings.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
          <Button
            onClick={() => void addCandidate()}
            disabled={addTab === 'New candidate' ? candForm.name.length < 2 || !candForm.email.includes('@') : !pick}
            className="w-full"
          >
            Add to pipeline
          </Button>
        </div>
      </Modal>

      <Modal title="Import candidates (CSV)" open={importOpen} onClose={() => setImportOpen(false)} wide>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <p className="text-sm text-ink-500">
            Columns: name, email, phone, skills, experienceYears, currentCtc, expectedCtc, noticePeriodDays, currentCompany, currentLocation, source,
            externalRef, postingId (optional). Existing candidates (same email or mobile) are linked, not duplicated.{' '}
            <button className="text-brand-600" onClick={downloadTemplate}>
              Download template
            </button>
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              setCsvFile(e.target.files?.[0] ?? null);
              setImportResult(null);
            }}
            className="text-sm"
          />
          {livePostings.length > 0 && (
            <p className="text-xs text-ink-400">Posting ids: {livePostings.map((p) => `${p.label} = ${p.id}`).join(' · ')}</p>
          )}
          {importResult && (
            <div>
              <p className="mb-2 text-sm text-ink-600">
                {importResult.dryRun ? 'Preview' : 'Imported'}: {importResult.created} new · {importResult.linked} existing · {importResult.alreadyApplied} already applied ·{' '}
                <span className={importResult.errors ? 'text-rose-600' : ''}>{importResult.errors} errors</span>
              </p>
              <div className="max-h-72 overflow-y-auto">
                <Table headers={['Row', 'Name', 'Email', 'Result']}>
                  {importResult.rows.map((r) => (
                    <tr key={r.row}>
                      <Td>{r.row}</Td>
                      <Td>{r.name}</Td>
                      <Td>{r.email}</Td>
                      <Td>
                        <Badge tone={r.status === 'ERROR' ? 'red' : r.status === 'CREATED' ? 'green' : 'amber'}>{label(r.status)}</Badge>
                        <p className="text-xs text-ink-400">
                          {r.message}
                          {r.applicationCode ? ` · ${r.applicationCode}` : ''}
                        </p>
                      </Td>
                    </tr>
                  ))}
                </Table>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void runImport(true)} disabled={!csvFile} className="flex-1">
              Preview
            </Button>
            <Button onClick={() => void runImport(false)} disabled={!csvFile || (importResult?.dryRun === false)} className="flex-1">
              Import
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
