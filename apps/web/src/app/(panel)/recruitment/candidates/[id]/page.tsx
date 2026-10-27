'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Avatar, Badge, Button, Card, Empty, ErrorNote, Field, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';
import { errMsg } from '@/components/talent';
import {
  CandidateFields, StatusBadge, candidateFormData, emptyCandidate, money, stageLabel, type CandidateForm, type Job,
} from '@/components/recruitment';

interface CandidateDetail {
  id: string;
  code: string | null;
  name: string;
  email: string;
  phone: string;
  currentCompany: string;
  currentDesignation: string;
  currentLocation: string;
  currentCtc?: number;
  expectedCtc?: number;
  noticePeriodDays: number;
  experienceYears: number;
  qualifications: string;
  source: string;
  skills: string;
  notes: string;
  resumeName: string;
  hasResume: boolean;
  createdAt: string;
  referredBy: { id: string; name: string } | null;
  applications: {
    id: string;
    code: string | null;
    stage: string;
    rejectionReason: string;
    appliedOn: string;
    source: string;
    job: { id: string; code: string | null; title: string; status: string };
    posting: { platform: string; platformName: string } | null;
    offer: { id: string; code: string | null; status: string } | null;
    interviews: { id: string; status: string }[];
  }[];
}

export default function CandidatePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { isCompanyAdmin } = useAuth();
  const cand = useFetch<CandidateDetail>(`/recruitment/candidates/${id}`);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<CandidateForm>(emptyCandidate);
  const [file, setFile] = useState<File | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState('');

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    try {
      await fn();
      after?.();
      cand.reload();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const openResume = async () => {
    try {
      const { url } = await api<{ url: string }>(`/recruitment/candidates/${id}/resume?inline=true`);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError(errMsg(err));
    }
  };

  if (cand.loading && !cand.data) return <Spinner />;
  if (!cand.data) return <ErrorNote error={cand.error ?? 'Candidate not found'} />;
  const c = cand.data;

  const openEdit = () => {
    setForm({
      ...emptyCandidate,
      name: c.name, email: c.email, phone: c.phone, currentCompany: c.currentCompany, currentDesignation: c.currentDesignation,
      currentLocation: c.currentLocation, experienceYears: String(c.experienceYears), currentCtc: String(c.currentCtc ?? ''),
      expectedCtc: String(c.expectedCtc ?? ''), noticePeriodDays: String(c.noticePeriodDays), qualifications: c.qualifications,
      source: c.source, skills: c.skills, notes: c.notes,
    });
    setFile(null);
    setError(null);
    setEditOpen(true);
  };

  const saveEdit = () =>
    run(
      () => {
        const fields: Partial<CandidateForm> = { ...form, jobId: '', postingId: '', externalRef: '' };
        return api(`/recruitment/candidates/${id}`, { method: 'PATCH', form: candidateFormData(fields, file) });
      },
      () => setEditOpen(false)
    );

  const remove = async () => {
    if (!confirm(`Delete ${c.name} and all their applications? This cannot be undone.`)) return;
    try {
      await api(`/recruitment/candidates/${id}`, { method: 'DELETE' });
      router.replace('/recruitment?tab=Candidates');
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const openApply = async () => {
    setError(null);
    setJobId('');
    setApplyOpen(true);
    try {
      setJobs((await api<Job[]>('/recruitment/jobs')).filter((j) => !['CLOSED', 'FILLED', 'CANCELLED'].includes(j.status)));
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <div>
      <Link href="/recruitment?tab=Candidates" className="mb-3 inline-block text-sm text-ink-500 hover:text-brand-600">
        ← Recruitment
      </Link>
      <PageHeader
        title={c.name}
        subtitle={[c.code, c.email, c.phone].filter(Boolean).join(' · ')}
        actions={
          <>
            {c.hasResume && (
              <Button variant="secondary" onClick={() => void openResume()}>
                Resume
              </Button>
            )}
            {isCompanyAdmin && (
              <>
                <Button variant="secondary" onClick={openEdit}>
                  Edit
                </Button>
                <Button variant="secondary" onClick={() => void remove()}>
                  Delete
                </Button>
                <Button onClick={() => void openApply()}>Apply to job</Button>
              </>
            )}
          </>
        }
      />
      <ErrorNote error={editOpen || applyOpen ? null : error} />
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <Avatar name={c.name} />
            <div>
              <p className="font-medium text-ink-900">{c.name}</p>
              <p className="text-xs text-ink-400">
                {[c.currentDesignation, c.currentCompany].filter(Boolean).join(' at ') || 'No current employer'}
              </p>
            </div>
          </div>
          <dl className="space-y-2 text-sm">
            {[
              ['Experience', `${c.experienceYears} yrs`],
              ['Location', c.currentLocation || '—'],
              ['Notice period', `${c.noticePeriodDays} days`],
              ...(c.currentCtc !== undefined ? [['Current / expected CTC', `${money(c.currentCtc)} / ${money(c.expectedCtc)}`]] : []),
              ['Skills', c.skills || '—'],
              ['Qualifications', c.qualifications || '—'],
              ['Source', stageLabel(c.source)],
              ['Added', fmtDate(c.createdAt)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{k}</dt>
                <dd className="text-ink-700">{v}</dd>
              </div>
            ))}
          </dl>
          {c.referredBy && (
            <p className="mt-3">
              <Badge tone="violet">Referred by {c.referredBy.name}</Badge>
            </p>
          )}
          {c.notes && <p className="mt-3 whitespace-pre-line rounded-xl bg-ink-50 p-3 text-sm text-ink-600">{c.notes}</p>}
        </Card>
        <Card>
          <h2 className="px-5 pt-5 text-sm font-semibold text-ink-900">Applications</h2>
          {!c.applications.length ? (
            <Empty message="In the talent pool — not applied to any job yet" />
          ) : (
            <Table headers={['Application', 'Job', 'Applied', 'Stage', 'Offer']}>
              {c.applications.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <Link href={`/recruitment/applications/${a.id}`} className="font-medium text-brand-600">
                      {a.code ?? 'Open'}
                    </Link>
                    <p className="text-xs text-ink-400">{a.posting ? (a.posting.platformName || stageLabel(a.posting.platform)) : stageLabel(a.source)}</p>
                  </Td>
                  <Td>
                    <Link href={`/recruitment/jobs/${a.job.id}`} className="hover:text-brand-600">
                      {a.job.title}
                    </Link>
                    <p className="text-xs text-ink-400">{a.job.code}</p>
                  </Td>
                  <Td>{fmtDate(a.appliedOn)}</Td>
                  <Td>
                    <StatusBadge status={a.stage} />
                    {a.rejectionReason && <p className="mt-1 text-xs text-ink-400">{a.rejectionReason}</p>}
                  </Td>
                  <Td>{a.offer ? <StatusBadge status={a.offer.status} /> : '—'}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <Modal title="Edit candidate" open={editOpen} onClose={() => setEditOpen(false)} wide>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <CandidateFields form={form} setForm={setForm} />
          <Field label={c.hasResume ? `Replace resume (${c.resumeName})` : 'Resume'}>
            <input type="file" accept=".pdf,.doc,.docx,.rtf,.odt,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
          </Field>
          <Button onClick={() => void saveEdit()} disabled={form.name.length < 2 || !form.email.includes('@')} className="w-full">
            Save
          </Button>
        </div>
      </Modal>

      <Modal title="Apply to a job" open={applyOpen} onClose={() => setApplyOpen(false)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Job">
            <Select value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">— select —</option>
              {jobs
                .filter((j) => !c.applications.some((a) => a.job.id === j.id))
                .map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.code} · {j.title}
                  </option>
                ))}
            </Select>
          </Field>
          <Button
            onClick={() => void run(() => api('/recruitment/applications', { method: 'POST', body: { jobId, candidateId: id } }), () => setApplyOpen(false))}
            disabled={!jobId}
            className="w-full"
          >
            Add application
          </Button>
        </div>
      </Modal>
    </div>
  );
}
