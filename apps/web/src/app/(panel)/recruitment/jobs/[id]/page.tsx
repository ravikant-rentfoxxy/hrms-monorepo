'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Td, Textarea } from '@/components/ui';
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
      router.replace('/recruitment');
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

  return (
    <div>
      <Link href="/recruitment" className="mb-3 inline-block text-sm text-slate-500 hover:text-indigo-600">
        ← Recruitment
      </Link>
      <PageHeader
        title={j.title}
        subtitle={[j.code, j.department, j.location, j.employmentType, yrs(j.minExperience, j.maxExperience), `Hiring manager: ${j.hiringManager?.name ?? '—'}`]
          .filter(Boolean)
          .join(' · ')}
        actions={
          isCompanyAdmin && (
            <>
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
            </>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-500">
        <StatusBadge status={j.status} />
        <span>
          {j.hired ?? 0}/{j.openings} filled
        </span>
        {j.requisition && (
          <span>
            · From requisition {j.requisition.code} ({label(j.requisition.reason)}, {label(j.requisition.priority)} priority, by {j.requisition.requestedBy?.name ?? '—'})
          </span>
        )}
        {isCompanyAdmin && j.maxCtc !== undefined && (
          <span>
            · Budget {money(j.minCtc)} – {money(j.maxCtc)}
          </span>
        )}
        {isCompanyAdmin && (
          <span className="ml-auto flex gap-1">
            {j.status === 'APPROVED' && <Button variant="ghost" onClick={() => void setStatus('OPEN')}>Open without posting</Button>}
            {j.status === 'OPEN' && <Button variant="ghost" onClick={() => void setStatus('ON_HOLD')}>Put on hold</Button>}
            {j.status === 'ON_HOLD' && <Button variant="ghost" onClick={() => void setStatus('OPEN')}>Resume</Button>}
            {!ended && <Button variant="ghost" onClick={() => void setStatus('CLOSED')}>Close</Button>}
            {!ended && <Button variant="ghost" onClick={() => confirm('Cancel this job? Open postings close too.') && void setStatus('CANCELLED')}>Cancel</Button>}
            {ended && <Button variant="ghost" onClick={() => void setStatus('OPEN')}>Reopen</Button>}
            {!j.applications.length && <Button variant="ghost" onClick={() => void remove()}>Delete</Button>}
          </span>
        )}
      </div>
      {notice && <p className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">{notice}</p>}
      {!addOpen && !postingOpen && !importOpen && !editOpen && !rejectFor && <ErrorNote error={error} />}

      <Card className="mb-4">
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-sm font-semibold text-slate-900">Job postings</h2>
          {isCompanyAdmin && !ended && (
            <Button variant="ghost" onClick={() => openPosting()}>
              + Record posting
            </Button>
          )}
        </div>
        {!j.postings.length ? (
          <Empty message="Not posted anywhere yet — record where this job is advertised (LinkedIn, Naukri, careers page…)" />
        ) : (
          <Table headers={['Platform', 'Posted', 'Expires', 'Status', 'Applications', ...(isCompanyAdmin ? ['Cost', 'Cost / app'] : []), 'Joined', '']}>
            {j.postings.map((p) => (
              <tr key={p.id}>
                <Td>
                  <span className="font-medium">{p.label}</span>
                  {p.url && (
                    <a href={p.url} target="_blank" rel="noreferrer" className="ml-2 text-xs text-indigo-600">
                      View ↗
                    </a>
                  )}
                  <p className="text-xs text-slate-400">{[p.externalId, p.postedBy?.name].filter(Boolean).join(' · ')}</p>
                </Td>
                <Td>{fmtDate(p.postedOn)}</Td>
                <Td>{fmtDate(p.expiresOn)}</Td>
                <Td>
                  <StatusBadge status={p.status} />
                </Td>
                <Td>{p.applications}</Td>
                {isCompanyAdmin && <Td>{money(p.cost)}</Td>}
                {isCompanyAdmin && <Td>{money(p.costPerApplication)}</Td>}
                <Td>{p.hires}</Td>
                <Td>
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
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3">
          {PIPELINE.map(({ stage, title }) => {
            const apps = j.applications.filter((a) => a.stage === stage);
            return (
              <div key={stage} className="w-[220px] shrink-0 rounded-2xl bg-slate-50 p-2.5">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</span>
                  <Badge tone="slate">{apps.length}</Badge>
                </div>
                <div className="space-y-2">
                  {apps.map((a) => (
                    <Card key={a.id} className="p-3">
                      <Link href={`/recruitment/applications/${a.id}`} className="text-sm font-medium text-slate-900 hover:text-indigo-600">
                        {a.candidate.name}
                      </Link>
                      <p className="text-xs text-slate-400">
                        {a.code} · {a.candidate.experienceYears} yrs{a.candidate.currentCompany ? ` · ${a.candidate.currentCompany}` : ''}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <MatchBar score={a.match} />
                        {a.candidate.referredById && <Badge tone="violet">Referral</Badge>}
                        {a.posting ? <Badge tone="slate">{a.posting.label}</Badge> : a.source && <Badge tone="slate">{stageLabel(a.source)}</Badge>}
                        {a.interviews.length > 0 && (
                          <Badge tone="blue">
                            {a.interviews.filter((i) => i.status === 'COMPLETED').length}/{a.interviews.filter((i) => i.status !== 'CANCELLED').length} rounds
                          </Badge>
                        )}
                        {a.offer && <StatusBadge status={a.offer.status} />}
                      </div>
                      {a.assignedTo && <p className="mt-1 text-xs text-slate-400">Owner: {a.assignedTo.name}</p>}
                      {(stage === 'APPLIED' || stage === 'ON_HOLD') && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          <button
                            onClick={() => void screen(a, 'SHORTLISTED')}
                            className="rounded-lg bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                          >
                            Shortlist
                          </button>
                          {stage === 'APPLIED' && (
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
                        </div>
                      )}
                    </Card>
                  ))}
                  {!apps.length && <p className="px-1 py-3 text-center text-xs text-slate-400">—</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {closed.length > 0 && (
        <Card className="mt-4 p-4">
          <button onClick={() => setShowClosed(!showClosed)} className="text-sm font-medium text-slate-600">
            {showClosed ? '▾' : '▸'} Rejected / withdrawn / declined ({closed.length})
          </button>
          {showClosed && (
            <div className="mt-3 divide-y divide-slate-100">
              {closed.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <Link href={`/recruitment/applications/${a.id}`} className="font-medium hover:text-indigo-600">
                      {a.candidate.name}
                    </Link>
                    <span className="ml-2">
                      <StatusBadge status={a.stage} />
                    </span>
                    {a.rejectionReason && <p className="text-xs text-slate-400">{a.rejectionReason}</p>}
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
        </Card>
      )}

      <Modal title="Reject candidate" open={!!rejectFor} onClose={() => setRejectFor(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <p className="text-sm text-slate-500">{rejectFor?.candidate.name}</p>
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
          <p className="text-xs text-slate-400">Postings are recorded manually — HRMS does not publish to job boards automatically yet.</p>
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
              <p className="text-xs text-slate-400">If the email or mobile matches someone already in the talent pool, that record is reused.</p>
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
          <p className="text-sm text-slate-500">
            Columns: name, email, phone, skills, experienceYears, currentCtc, expectedCtc, noticePeriodDays, currentCompany, currentLocation, source,
            externalRef, postingId (optional). Existing candidates (same email or mobile) are linked, not duplicated.{' '}
            <button className="text-indigo-600" onClick={downloadTemplate}>
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
            <p className="text-xs text-slate-400">Posting ids: {livePostings.map((p) => `${p.label} = ${p.id}`).join(' · ')}</p>
          )}
          {importResult && (
            <div>
              <p className="mb-2 text-sm text-slate-600">
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
                        <p className="text-xs text-slate-400">
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
