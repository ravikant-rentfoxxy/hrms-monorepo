'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate, fmtTime } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { errMsg, label } from '@/components/talent';
import {
  EMPLOYMENT_TYPES, INTERVIEW_TYPES, hasStarted, MatchBar, RECOMMENDATIONS, StatusBadge, localDateTime, money, stageLabel, useDirectory, ymd, yrs,
} from '@/components/recruitment';

interface PanelRow {
  id: string;
  interviewerId: string;
  interviewer: { name: string } | null;
  rating: number | null;
  recommendation: string;
  feedback: string;
  submittedAt: string | null;
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
  panel: PanelRow[];
  panelNames: string[];
}

interface Offer {
  id: string;
  code: string | null;
  status: string;
  designation?: string;
  department?: string;
  ctcAnnual?: number;
  joiningDate?: string;
  workLocation?: string;
  employmentType?: string;
  probationMonths?: number;
  noticePeriodDays?: number;
  terms?: string;
  validUntil?: string | null;
  counterCtc?: number | null;
  negotiationNote?: string;
  declineReason?: string;
  acceptedVia?: string;
  letterDocumentId?: string | null;
  signedFileName?: string;
  revisions?: { ctcAnnual: number; joiningDate: string; designation: string; changedAt: string; note: string }[] | null;
  sentAt?: string | null;
  respondedAt?: string | null;
  employeeId?: string | null;
  canDecide?: boolean;
  pendingWith?: string | null;
  trail?: { id: string; level: number; status: string; approverName: string | null; actedByName: string | null; remarks: string | null }[];
}

interface Detail {
  id: string;
  code: string | null;
  stage: string;
  rating: number | null;
  rejectionReason: string;
  source: string;
  externalRef: string;
  screeningNotes: string;
  hrScreening: {
    experienceVerified: boolean; experienceYears: number; currentCtc: number; expectedCtc: number; noticePeriodDays: number;
    availableFrom: string | null; interested: boolean; notes: string; screenedAt: string;
  } | null;
  recommendationNote: string;
  proposedCtc?: number | null;
  proposedJoiningDate: string | null;
  appliedOn: string;
  assignedToId: string | null;
  assignedTo: { name: string } | null;
  recommendedBy: { name: string } | null;
  hiringManager: { name: string } | null;
  candidate: {
    id: string; code: string | null; name: string; email: string; phone: string; currentCompany: string; currentDesignation: string;
    currentLocation: string; currentCtc?: number; expectedCtc?: number; noticePeriodDays: number; experienceYears: number; skills: string;
    qualifications: string; source: string; hasResume: boolean; referredBy: { name: string } | null; notes: string;
  };
  job: {
    id: string; code: string | null; title: string; department: string; designation: string; location: string; employmentType: string;
    minExperience: number; maxExperience: number; minCtc?: number; maxCtc?: number; skills: string; qualifications: string; status: string;
  };
  posting: { label: string } | null;
  match: {
    score: number;
    skills: { matched: string[]; missing: string[]; percent: number | null };
    experience: { fit: string };
    location: { match: boolean | null };
  };
  interviews: Interview[];
  feedbackSummary: {
    rounds: number; completedRounds: number; feedbackSubmitted: number; feedbackPending: number; averageRating: number | null;
    tally: Record<string, number>; perRound: { id: string; round: string; status: string; averageRating: number | null }[];
  } | null;
  offer: Offer | null;
  preOnboarding: { id: string; status: string } | null;
  portal: { active: boolean; expiresAt: string | null } | null;
  history: { id: string; fromStage: string; toStage: string; note: string; createdAt: string; actor: { name: string } | null }[];
  permissions: { manage: boolean; hr: boolean; hiringManager: boolean };
}

const SCREENABLE = ['APPLIED', 'ON_HOLD', 'SHORTLISTED', 'HR_SCREENED'];
const SCHEDULABLE = ['APPLIED', 'SHORTLISTED', 'HR_SCREENED', 'ON_HOLD', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED'];
const SELECTABLE = ['INTERVIEW_COMPLETED', 'HR_SCREENED', 'SHORTLISTED', 'ON_HOLD', 'SELECTED'];
const CLOSED = ['REJECTED', 'WITHDRAWN', 'OFFER_DECLINED', 'JOINED', 'HIRED'];

function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <div className="flex flex-wrap gap-1">{actions}</div>
      </div>
      {children}
    </Card>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{k}</dt>
      <dd className="text-sm text-slate-700">{v}</dd>
    </div>
  );
}

const emptyInterview = { round: '', interviewType: 'TECHNICAL', scheduledAt: '', durationMinutes: '60', mode: 'VIDEO', location: '', panelIds: [] as string[] };

export default function ApplicationPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  const app = useFetch<Detail>(`/recruitment/applications/${id}`);
  const people = useDirectory();
  const me = session?.employee?.id;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<string | null>(null);

  const [screenForm, setScreenForm] = useState({ notes: '', rating: '', reason: '' });
  const [hrForm, setHrForm] = useState({ experienceVerified: 'true', experienceYears: '', currentCtc: '', expectedCtc: '', noticePeriodDays: '', availableFrom: '', interested: 'true', notes: '' });
  const [ivEdit, setIvEdit] = useState<Interview | null>(null);
  const [ivForm, setIvForm] = useState(emptyInterview);
  const ivMissing = [
    !ivForm.round.trim() && 'round',
    !ivForm.scheduledAt && 'date & time',
    ivForm.panelIds.length === 0 && 'at least one interviewer',
  ].filter((x): x is string => !!x);
  const [fbFor, setFbFor] = useState<{ iv: Interview; interviewerId: string } | null>(null);
  const [fbForm, setFbForm] = useState({ rating: '4', recommendation: 'HIRE', feedback: '' });
  const [text, setText] = useState('');
  const [selForm, setSelForm] = useState({ proposedCtc: '', proposedJoiningDate: '', note: '' });
  const [offerForm, setOfferForm] = useState({
    designation: '', department: '', ctcAnnual: '', joiningDate: '', workLocation: '', employmentType: 'Full-time', probationMonths: '6',
    noticePeriodDays: '30', terms: '', validUntil: '',
  });
  const [respForm, setRespForm] = useState({ response: 'ACCEPT', reason: '', counterCtc: '', note: '' });
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [stageForm, setStageForm] = useState({ stage: 'REJECTED', reason: '' });

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    try {
      await fn();
      setModal(null);
      after?.();
      app.reload();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  // Open the tab during the click (browsers block window.open after an await), then point it at the file.
  const openUrl = async (path: string) => {
    setError(null);
    const tab = window.open('', '_blank');
    try {
      const { url } = await api<{ url: string }>(path);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.location.assign(url);
      }
    } catch (err) {
      tab?.close();
      setError(errMsg(err));
    }
  };

  const show = (m: string) => {
    setError(null);
    setModal(m);
  };

  if (app.loading && !app.data) return <Spinner />;
  if (!app.data) return <ErrorNote error={app.error ?? 'Application not found'} />;
  const a = app.data;
  const { hr, manage } = a.permissions;
  const offer = a.offer;
  const closed = CLOSED.includes(a.stage);

  const openInterview = (iv?: Interview) => {
    setIvEdit(iv ?? null);
    setIvForm(
      iv
        ? {
            round: iv.round, interviewType: iv.interviewType, scheduledAt: localDateTime(iv.scheduledAt), durationMinutes: String(iv.durationMinutes),
            mode: iv.mode, location: iv.location, panelIds: iv.panel.map((p) => p.interviewerId),
          }
        : { ...emptyInterview, panelIds: me ? [me] : [] }
    );
    show('interview');
  };

  const saveInterview = () => {
    const body = {
      round: ivForm.round,
      interviewType: ivForm.interviewType,
      scheduledAt: new Date(ivForm.scheduledAt).toISOString(),
      durationMinutes: Number(ivForm.durationMinutes) || 60,
      mode: ivForm.mode,
      location: ivForm.location,
      panelIds: ivForm.panelIds,
    };
    return run(() =>
      ivEdit
        ? api(`/recruitment/interviews/${ivEdit.id}`, { method: 'PATCH', body })
        : api('/recruitment/interviews', { method: 'POST', body: { ...body, applicationId: a.id } })
    );
  };

  const openOffer = () => {
    setOfferForm({
      designation: offer?.designation ?? a.job.designation ?? a.job.title,
      department: offer?.department ?? a.job.department,
      ctcAnnual: String(offer?.ctcAnnual ?? a.proposedCtc ?? ''),
      joiningDate: ymd(offer?.joiningDate ?? a.proposedJoiningDate),
      workLocation: offer?.workLocation ?? a.job.location,
      employmentType: offer?.employmentType ?? a.job.employmentType ?? 'Full-time',
      probationMonths: String(offer?.probationMonths ?? 6),
      noticePeriodDays: String(offer?.noticePeriodDays ?? 30),
      terms: offer?.terms ?? '',
      validUntil: ymd(offer?.validUntil ?? null),
    });
    show(offer?.status === 'DRAFT' ? 'offer-edit' : offer && ['SENT', 'NEGOTIATING', 'APPROVED'].includes(offer.status) ? 'offer-revise' : 'offer-new');
  };

  const offerBody = () => ({
    designation: offerForm.designation,
    department: offerForm.department,
    ctcAnnual: Number(offerForm.ctcAnnual),
    joiningDate: offerForm.joiningDate,
    workLocation: offerForm.workLocation,
    employmentType: offerForm.employmentType,
    probationMonths: Number(offerForm.probationMonths) || 0,
    noticePeriodDays: Number(offerForm.noticePeriodDays) || 0,
    terms: offerForm.terms,
    validUntil: offerForm.validUntil || null,
  });

  const saveOffer = () =>
    run(async () => {
      if (modal === 'offer-revise' && offer) {
        const r = await api<{ needsApproval: boolean; warnings: string[] }>(`/recruitment/offers/${offer.id}/revise`, {
          method: 'POST',
          body: {
            ctcAnnual: Number(offerForm.ctcAnnual), joiningDate: offerForm.joiningDate, designation: offerForm.designation,
            workLocation: offerForm.workLocation, validUntil: offerForm.validUntil || null, terms: offerForm.terms, note: text,
          },
        });
        setNotice(`Offer revised${r.needsApproval ? ' — the higher CTC went back for approval' : ' — send it again to the candidate'}. ${r.warnings.join(' ')}`);
        return;
      }
      const r =
        modal === 'offer-edit' && offer
          ? await api<{ warnings: string[] }>(`/recruitment/offers/${offer.id}`, { method: 'PATCH', body: offerBody() })
          : await api<{ warnings: string[] }>('/recruitment/offers', { method: 'POST', body: { ...offerBody(), applicationId: a.id } });
      setNotice(r.warnings.length ? `Offer saved. ⚠ ${r.warnings.join(' ')}` : 'Offer saved as draft — submit it for approval.');
    });

  const offerAction = (path: string, body?: unknown, msg?: string) =>
    offer && run(() => api(`/recruitment/offers/${offer.id}/${path}`, { method: 'POST', body }), msg ? () => setNotice(msg) : undefined);

  const sendOffer = () =>
    offer &&
    run(async () => {
      const r = await api<{ portalUrl: string }>(`/recruitment/offers/${offer.id}/send`, { method: 'POST', body: {} });
      setPortalUrl(r.portalUrl);
      setModal('portal');
    }).then(() => setModal('portal'));

  const createPortalLink = () =>
    run(async () => {
      const r = await api<{ url: string }>(`/recruitment/applications/${a.id}/portal-link`, { method: 'POST', body: { days: 30 } });
      setPortalUrl(r.url);
    }).then(() => setModal('portal'));

  const uploadSigned = async (file: File | undefined) => {
    if (!file || !offer) return;
    const fd = new FormData();
    fd.append('file', file);
    await run(() => api(`/recruitment/offers/${offer.id}/signed`, { method: 'POST', form: fd }), () => setNotice('Signed copy uploaded.'));
  };

  const fbCanEdit = (p: PanelRow) => p.interviewerId === me || hr;

  return (
    <div>
      <Link href={`/recruitment/jobs/${a.job.id}`} className="mb-3 inline-block text-sm text-slate-500 hover:text-indigo-600">
        ← {a.job.code} {a.job.title}
      </Link>
      <PageHeader
        title={a.candidate.name}
        subtitle={[a.code, a.candidate.code, a.candidate.email, a.candidate.phone].filter(Boolean).join(' · ')}
        actions={
          <>
            {a.candidate.hasResume && (
              <Button variant="secondary" onClick={() => void openUrl(`/recruitment/candidates/${a.candidate.id}/resume?inline=true`)}>
                Resume
              </Button>
            )}
            <Link href={`/recruitment/candidates/${a.candidate.id}`}>
              <Button variant="secondary">Profile</Button>
            </Link>
            {manage && !closed && (
              <Button variant="danger" onClick={() => { setStageForm({ stage: 'REJECTED', reason: '' }); show('stage'); }}>
                Reject / withdraw
              </Button>
            )}
            {hr && ['REJECTED', 'WITHDRAWN', 'OFFER_DECLINED'].includes(a.stage) && (
              <Button variant="secondary" onClick={() => void run(() => api(`/recruitment/applications/${a.id}/stage`, { method: 'POST', body: { stage: 'SHORTLISTED', reason: 'Reopened' } }))}>
                Reopen
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-500">
        <StatusBadge status={a.stage} />
        {a.rejectionReason && <span className="text-rose-600">{a.rejectionReason}</span>}
        <span>· Applied {fmtDate(a.appliedOn)} via {a.posting?.label ?? stageLabel(a.source || a.candidate.source)}</span>
        {a.externalRef && <span>· Ref {a.externalRef}</span>}
        {a.candidate.referredBy && <Badge tone="violet">Referred by {a.candidate.referredBy.name}</Badge>}
        <span>· Owner: {a.assignedTo?.name ?? '—'}</span>
        {hr && (
          <Select
            value={a.assignedToId ?? ''}
            onChange={(e) => void run(() => api(`/recruitment/applications/${a.id}`, { method: 'PATCH', body: { assignedToId: e.target.value || null } }))}
            className="max-w-[200px]"
          >
            <option value="">— assign owner —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      {notice && <p className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">{notice}</p>}
      {!modal && <ErrorNote error={error} />}

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-4">
          <Section title="Candidate vs job requirements" actions={<MatchBar score={a.match.score} />}>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Candidate</p>
                <Row k="Experience" v={`${a.candidate.experienceYears} yrs`} />
                <Row k="Current" v={[a.candidate.currentDesignation, a.candidate.currentCompany].filter(Boolean).join(' at ') || '—'} />
                <Row k="Location" v={a.candidate.currentLocation || '—'} />
                <Row k="Skills" v={a.candidate.skills || '—'} />
                <Row k="Qualifications" v={a.candidate.qualifications || '—'} />
                <Row k="Notice" v={`${a.candidate.noticePeriodDays} days`} />
                {hr && <Row k="Current / expected CTC" v={`${money(a.candidate.currentCtc)} / ${money(a.candidate.expectedCtc)}`} />}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Job</p>
                <Row k="Experience" v={<>{yrs(a.job.minExperience, a.job.maxExperience)} <Badge tone={a.match.experience.fit === 'IN_RANGE' || a.match.experience.fit === 'ANY' ? 'green' : 'amber'}>{label(a.match.experience.fit)}</Badge></>} />
                <Row k="Role" v={a.job.designation || a.job.title} />
                <Row k="Location" v={<>{a.job.location || '—'} {a.match.location.match !== null && <Badge tone={a.match.location.match ? 'green' : 'amber'}>{a.match.location.match ? 'Match' : 'Different'}</Badge>}</>} />
                <Row
                  k={`Skills${a.match.skills.percent !== null ? ` (${a.match.skills.percent}% match)` : ''}`}
                  v={
                    <span className="flex flex-wrap gap-1">
                      {a.match.skills.matched.map((s) => <Badge key={s} tone="green">{s}</Badge>)}
                      {a.match.skills.missing.map((s) => <Badge key={s} tone="red">{s}</Badge>)}
                      {!a.match.skills.matched.length && !a.match.skills.missing.length && '—'}
                    </span>
                  }
                />
                <Row k="Qualifications" v={a.job.qualifications || '—'} />
                {hr && a.job.maxCtc !== undefined && <Row k="Budget" v={`${money(a.job.minCtc)} – ${money(a.job.maxCtc)}`} />}
              </div>
            </div>
          </Section>

          <Section
            title="Screening"
            actions={
              manage &&
              SCREENABLE.includes(a.stage) && (
                <>
                  <Button variant="ghost" onClick={() => { setScreenForm({ notes: a.screeningNotes, rating: String(a.rating ?? ''), reason: '' }); show('screen'); }}>
                    Review resume
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const s = a.hrScreening;
                      setHrForm({
                        experienceVerified: String(s?.experienceVerified ?? true), experienceYears: String(s?.experienceYears ?? a.candidate.experienceYears),
                        currentCtc: String(s?.currentCtc ?? a.candidate.currentCtc ?? ''), expectedCtc: String(s?.expectedCtc ?? a.candidate.expectedCtc ?? ''),
                        noticePeriodDays: String(s?.noticePeriodDays ?? a.candidate.noticePeriodDays), availableFrom: s?.availableFrom ?? '',
                        interested: String(s?.interested ?? true), notes: s?.notes ?? '',
                      });
                      show('hr');
                    }}
                  >
                    HR screening call
                  </Button>
                </>
              )
            }
          >
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-slate-400">Rating:</span> {a.rating ? `${a.rating}/5` : '—'}
              </p>
              {a.screeningNotes && <p className="whitespace-pre-line text-slate-600">{a.screeningNotes}</p>}
              {a.hrScreening ? (
                <div className="rounded-xl bg-slate-50 p-3 text-slate-600">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">HR call · {fmtDate(a.hrScreening.screenedAt)}</p>
                  <p>
                    Experience {a.hrScreening.experienceYears} yrs ({a.hrScreening.experienceVerified ? 'verified' : 'not verified'}) · notice{' '}
                    {a.hrScreening.noticePeriodDays} days · available {a.hrScreening.availableFrom ? fmtDate(a.hrScreening.availableFrom) : '—'} ·{' '}
                    {a.hrScreening.interested ? 'interested' : 'not interested'}
                  </p>
                  {hr && <p>CTC {money(a.hrScreening.currentCtc)} → expects {money(a.hrScreening.expectedCtc)}</p>}
                  {a.hrScreening.notes && <p className="mt-1 whitespace-pre-line">{a.hrScreening.notes}</p>}
                </div>
              ) : (
                <p className="text-xs text-slate-400">No HR screening call recorded yet.</p>
              )}
            </div>
          </Section>

          <Section
            title="Interviews"
            actions={
              manage &&
              SCHEDULABLE.includes(a.stage) && (
                <Button variant="ghost" onClick={() => openInterview()}>
                  + Schedule round
                </Button>
              )
            }
          >
            {!a.interviews.length ? (
              <p className="text-sm text-slate-400">No interviews yet.</p>
            ) : (
              <div className="space-y-3">
                {a.interviews.map((iv) => {
                  const started = hasStarted(iv.scheduledAt);
                  return (
                    <div key={iv.id} className="rounded-xl border border-slate-100 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-slate-900">
                            {iv.round} <span className="text-xs text-slate-400">· {label(iv.interviewType)}</span>
                          </p>
                          <p className="text-xs text-slate-500">
                            {fmtDate(iv.scheduledAt)} {fmtTime(iv.scheduledAt)} · {iv.durationMinutes} min · {label(iv.mode)}
                            {iv.location && ` · ${iv.location}`}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <StatusBadge status={iv.status} />
                          {iv.attended === false && <Badge tone="red">No-show</Badge>}
                          {manage && iv.status === 'SCHEDULED' && (
                            <>
                              <Button variant="ghost" onClick={() => openInterview(iv)}>Reschedule</Button>
                              <Button variant="ghost" onClick={() => void run(() => api(`/recruitment/interviews/${iv.id}/cancel`, { method: 'POST', body: {} }))}>Cancel</Button>
                              {started && iv.attended === null && !iv.panel.some((p) => p.submittedAt) && (
                                <Button variant="ghost" onClick={() => void run(() => api(`/recruitment/interviews/${iv.id}/attendance`, { method: 'POST', body: { attended: false } }))}>
                                  No-show
                                </Button>
                              )}
                            </>
                          )}
                          {manage && iv.status === 'NO_SHOW' && (
                            <Button variant="ghost" onClick={() => void run(() => api(`/recruitment/interviews/${iv.id}/attendance`, { method: 'POST', body: { attended: true } }))}>
                              Mark attended
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 divide-y divide-slate-50">
                        {iv.panel.map((p) => (
                          <div key={p.interviewerId} className="flex items-start justify-between gap-2 py-1.5 text-sm">
                            <div>
                              <span className="font-medium text-slate-700">{p.interviewer?.name ?? '—'}</span>
                              {p.submittedAt ? (
                                <>
                                  <span className="ml-2 text-xs text-slate-500">
                                    {p.rating}/5 · {label(p.recommendation)}
                                  </span>
                                  {p.feedback && <p className="whitespace-pre-line text-xs text-slate-500">{p.feedback}</p>}
                                </>
                              ) : (
                                <span className="ml-2 text-xs text-slate-400">feedback pending</span>
                              )}
                            </div>
                            {fbCanEdit(p) && started && ['SCHEDULED', 'COMPLETED'].includes(iv.status) && (
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  setFbForm({ rating: String(p.rating ?? 4), recommendation: p.recommendation || 'HIRE', feedback: p.feedback });
                                  setFbFor({ iv, interviewerId: p.interviewerId });
                                  show('feedback');
                                }}
                              >
                                {p.submittedAt ? 'Edit' : p.interviewerId === me ? 'Give feedback' : 'Record'}
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {a.history.length > 0 && (
            <Section title="Stage history">
              <ol className="space-y-1.5 text-sm">
                {a.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-2">
                    <span className="w-28 text-xs text-slate-400">
                      {fmtDate(h.createdAt)} {fmtTime(h.createdAt)}
                    </span>
                    {h.fromStage && h.fromStage !== h.toStage && (
                      <>
                        <span className="text-xs text-slate-500">{stageLabel(h.fromStage)}</span>
                        <span className="text-xs text-slate-300">→</span>
                      </>
                    )}
                    <StatusBadge status={h.toStage} />
                    {h.note && <span className="text-xs text-slate-500">{h.note}</span>}
                    {h.actor && <span className="text-xs text-slate-400">· {h.actor.name}</span>}
                  </li>
                ))}
              </ol>
            </Section>
          )}
        </div>

        <div className="space-y-4">
          {a.feedbackSummary && a.feedbackSummary.rounds > 0 && (
            <Section title="Feedback summary">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-50 p-2">
                  <p className="text-lg font-semibold">{a.feedbackSummary.averageRating ?? '—'}</p>
                  <p className="text-xs text-slate-400">Avg rating</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-2">
                  <p className="text-lg font-semibold">
                    {a.feedbackSummary.completedRounds}/{a.feedbackSummary.rounds}
                  </p>
                  <p className="text-xs text-slate-400">Rounds done</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-2">
                  <p className="text-lg font-semibold">{a.feedbackSummary.feedbackPending}</p>
                  <p className="text-xs text-slate-400">Pending</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {RECOMMENDATIONS.map((r) => (
                  <Badge key={r} tone={r.includes('NO') ? 'red' : 'green'}>
                    {label(r)}: {a.feedbackSummary?.tally[r] ?? 0}
                  </Badge>
                ))}
              </div>
              <ul className="mt-3 space-y-1 text-sm">
                {a.feedbackSummary.perRound.map((r) => (
                  <li key={r.id} className="flex justify-between">
                    <span>{r.round}</span>
                    <span className="text-slate-500">{r.averageRating ?? '—'}/5</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Selection">
            <div className="space-y-2 text-sm">
              {a.recommendationNote ? (
                <p className="rounded-xl bg-emerald-50 p-3 text-emerald-800">
                  <span className="font-semibold">Recommended by {a.recommendedBy?.name ?? '—'}:</span> {a.recommendationNote}
                </p>
              ) : (
                <p className="text-xs text-slate-400">The hiring manager ({a.hiringManager?.name ?? '—'}) has not recommended yet.</p>
              )}
              {(a.proposedJoiningDate || a.proposedCtc) && (
                <p>
                  Proposed: {hr ? money(a.proposedCtc) : ''} · joining {fmtDate(a.proposedJoiningDate)}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {manage && SELECTABLE.concat(['INTERVIEW_SCHEDULED']).includes(a.stage) && (
                  <Button variant="secondary" onClick={() => { setText(a.recommendationNote); show('recommend'); }}>
                    Recommend for hire
                  </Button>
                )}
                {hr && SELECTABLE.includes(a.stage) && (
                  <Button
                    onClick={() => {
                      setSelForm({ proposedCtc: String(a.proposedCtc ?? a.candidate.expectedCtc ?? ''), proposedJoiningDate: ymd(a.proposedJoiningDate), note: '' });
                      show('select');
                    }}
                  >
                    {a.stage === 'SELECTED' ? 'Update proposal' : 'Select candidate'}
                  </Button>
                )}
              </div>
            </div>
          </Section>

          {hr && (
            <Section
              title={`Offer${offer?.code ? ` · ${offer.code}` : ''}`}
              actions={offer && <StatusBadge status={offer.employeeId ? 'JOINED' : offer.status} />}
            >
              {!offer ? (
                a.stage === 'SELECTED' ? (
                  <Button onClick={openOffer}>Create offer</Button>
                ) : (
                  <p className="text-xs text-slate-400">Select the candidate first (proposed CTC and joining date).</p>
                )
              ) : (
                <div className="space-y-3 text-sm">
                  <dl className="grid grid-cols-2 gap-2">
                    <Row k="Designation" v={offer.designation} />
                    <Row k="CTC" v={money(offer.ctcAnnual)} />
                    <Row k="Joining" v={fmtDate(offer.joiningDate)} />
                    <Row k="Valid until" v={fmtDate(offer.validUntil)} />
                    <Row k="Location" v={offer.workLocation || '—'} />
                    <Row k="Probation / notice" v={`${offer.probationMonths} mo / ${offer.noticePeriodDays} days`} />
                  </dl>
                  {offer.status === 'NEGOTIATING' && (
                    <p className="rounded-xl bg-amber-50 p-3 text-amber-800">
                      Candidate counter: {money(offer.counterCtc)} — {offer.negotiationNote}
                    </p>
                  )}
                  {offer.declineReason && <p className="text-rose-600">Declined: {offer.declineReason}</p>}
                  {offer.acceptedVia && <p className="text-emerald-700">Accepted via {label(offer.acceptedVia)} on {fmtDate(offer.respondedAt)}</p>}
                  {offer.trail && offer.trail.length > 0 && (
                    <ol className="space-y-1 text-xs text-slate-500">
                      {offer.trail.map((s) => (
                        <li key={s.id}>
                          Level {s.level}: {label(s.status)} {s.actedByName ? `by ${s.actedByName}` : `(${label(s.approverName ?? '')})`}
                          {s.remarks ? ` — ${s.remarks}` : ''}
                        </li>
                      ))}
                    </ol>
                  )}
                  {!!offer.revisions?.length && (
                    <details className="text-xs text-slate-500">
                      <summary className="cursor-pointer">Earlier versions ({offer.revisions.length})</summary>
                      <ul className="mt-1 space-y-1">
                        {offer.revisions.map((r, i) => (
                          <li key={i}>
                            {fmtDate(r.changedAt)}: {money(r.ctcAnnual)} · joining {fmtDate(r.joiningDate)} — {r.note}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {offer.status === 'DRAFT' && (
                      <>
                        <Button variant="secondary" onClick={openOffer}>Edit</Button>
                        <Button onClick={() => void offerAction('submit', undefined, 'Submitted for approval.')}>Submit for approval</Button>
                      </>
                    )}
                    {offer.status === 'PENDING_APPROVAL' && offer.canDecide && (
                      <>
                        <Button onClick={() => void offerAction('decide', { decision: 'APPROVED' }, 'Offer approved.')}>Approve</Button>
                        <Button variant="secondary" onClick={() => { setText(''); show('offer-reject'); }}>Send back</Button>
                      </>
                    )}
                    {offer.status === 'PENDING_APPROVAL' && !offer.canDecide && (
                      <p className="text-sm text-slate-500">
                        Waiting for {offer.pendingWith === 'ADMIN' ? 'management (Admin)' : offer.pendingWith === 'HR' ? 'HR' : 'the approver'} to
                        approve — they&apos;ll find it under Approvals. You can&apos;t approve an offer you submitted.
                      </p>
                    )}
                    {['APPROVED', 'SENT', 'NEGOTIATING', 'ACCEPTED'].includes(offer.status) && (
                      <>
                        <Button variant="secondary" onClick={() => void offerAction('letter', undefined, 'Offer letter generated.')}>
                          {offer.letterDocumentId ? 'Regenerate letter' : 'Generate letter'}
                        </Button>
                        {offer.letterDocumentId && (
                          <Button variant="secondary" onClick={() => void openUrl(`/recruitment/offers/${offer.id}/letter`)}>View letter</Button>
                        )}
                      </>
                    )}
                    {['APPROVED', 'SENT', 'NEGOTIATING'].includes(offer.status) && (
                      <Button onClick={() => void sendOffer()}>{offer.status === 'APPROVED' ? 'Send to candidate' : 'Re-send link'}</Button>
                    )}
                    {['SENT', 'NEGOTIATING'].includes(offer.status) && (
                      <>
                        <Button variant="secondary" onClick={() => { setRespForm({ response: 'ACCEPT', reason: '', counterCtc: '', note: '' }); show('respond'); }}>
                          Record response
                        </Button>
                        <Button variant="secondary" onClick={() => { setText(''); openOffer(); }}>Revise</Button>
                      </>
                    )}
                    {['SENT', 'NEGOTIATING', 'ACCEPTED'].includes(offer.status) && !offer.employeeId && (
                      <label className="inline-flex cursor-pointer items-center rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                        Upload signed copy
                        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic" className="hidden" onChange={(e) => void uploadSigned(e.target.files?.[0])} />
                      </label>
                    )}
                    {offer.signedFileName && (
                      <Button variant="ghost" onClick={() => void openUrl(`/recruitment/offers/${offer.id}/signed`)}>Signed copy</Button>
                    )}
                    {['DECLINED', 'EXPIRED', 'WITHDRAWN'].includes(offer.status) && ['SELECTED', 'OFFER_DECLINED', 'OFFERED'].includes(a.stage) && (
                      <Button onClick={openOffer}>Re-issue offer</Button>
                    )}
                    {!['DECLINED', 'EXPIRED', 'WITHDRAWN'].includes(offer.status) && !offer.employeeId && (
                      <Button variant="ghost" onClick={() => { setText(''); show('withdraw'); }}>Withdraw</Button>
                    )}
                  </div>
                </div>
              )}
            </Section>
          )}

          {hr && (
            <Section title="Candidate portal">
              <p className="mb-2 text-sm text-slate-500">
                {a.portal?.active ? `Link active until ${fmtDate(a.portal.expiresAt)}.` : 'No active link.'} The candidate uses it to answer the offer and upload
                documents — no login needed.
              </p>
              <div className="flex flex-wrap gap-1">
                {!closed && <Button variant="secondary" onClick={() => void createPortalLink()}>{a.portal?.active ? 'New link' : 'Create link'}</Button>}
                {a.portal?.active && (
                  <Button variant="ghost" onClick={() => void run(() => api(`/recruitment/applications/${a.id}/portal-link`, { method: 'DELETE' }))}>Revoke</Button>
                )}
              </div>
            </Section>
          )}

          {hr && (a.preOnboarding || a.stage === 'OFFER_ACCEPTED') && (
            <Section title="Pre-joining">
              {a.preOnboarding ? (
                <Link href={`/recruitment/pre-onboarding/${a.preOnboarding.id}`} className="flex items-center justify-between text-sm">
                  <StatusBadge status={a.preOnboarding.status} />
                  <span className="font-medium text-indigo-600">Open checklist →</span>
                </Link>
              ) : (
                <Button onClick={() => void run(() => api(`/recruitment/applications/${a.id}/pre-onboarding`, { method: 'POST' }))}>Start pre-joining</Button>
              )}
            </Section>
          )}
        </div>
      </div>

      {/* ---- Modals ---- */}

      <Modal title="Resume screening" open={modal === 'screen'} onClose={() => setModal(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Rating (1–5)">
            <Select value={screenForm.rating} onChange={(e) => setScreenForm({ ...screenForm, rating: e.target.value })}>
              <option value="">—</option>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
          <Field label="Screening notes">
            <Textarea rows={4} value={screenForm.notes} onChange={(e) => setScreenForm({ ...screenForm, notes: e.target.value })} />
          </Field>
          <Field label="Rejection reason (if rejecting)">
            <Input value={screenForm.reason} onChange={(e) => setScreenForm({ ...screenForm, reason: e.target.value })} />
          </Field>
          <div className="flex gap-2">
            {(['SHORTLISTED', 'ON_HOLD', 'REJECTED'] as const).map((d) => (
              <Button
                key={d}
                variant={d === 'REJECTED' ? 'danger' : d === 'ON_HOLD' ? 'secondary' : 'primary'}
                disabled={d === 'REJECTED' && screenForm.reason.trim().length < 3}
                onClick={() =>
                  void run(() =>
                    api(`/recruitment/applications/${a.id}/screen`, {
                      method: 'POST',
                      body: {
                        decision: d, notes: screenForm.notes, ...(screenForm.rating ? { rating: Number(screenForm.rating) } : {}),
                        ...(d === 'REJECTED' ? { rejectionReason: screenForm.reason } : {}),
                      },
                    })
                  )
                }
                className="flex-1"
              >
                {d === 'SHORTLISTED' ? 'Shortlist' : d === 'ON_HOLD' ? 'Hold' : 'Reject'}
              </Button>
            ))}
          </div>
        </div>
      </Modal>

      <Modal title="HR screening call" open={modal === 'hr'} onClose={() => setModal(null)} wide>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <div className="grid grid-cols-3 gap-3">
            <Field label="Experience (yrs)">
              <Input type="number" value={hrForm.experienceYears} onChange={(e) => setHrForm({ ...hrForm, experienceYears: e.target.value })} />
            </Field>
            <Field label="Experience verified?">
              <Select value={hrForm.experienceVerified} onChange={(e) => setHrForm({ ...hrForm, experienceVerified: e.target.value })}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </Select>
            </Field>
            <Field label="Interested?">
              <Select value={hrForm.interested} onChange={(e) => setHrForm({ ...hrForm, interested: e.target.value })}>
                <option value="true">Yes</option>
                <option value="false">No — withdraw</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <Field label="Current CTC">
              <Input type="number" value={hrForm.currentCtc} onChange={(e) => setHrForm({ ...hrForm, currentCtc: e.target.value })} />
            </Field>
            <Field label="Expected CTC">
              <Input type="number" value={hrForm.expectedCtc} onChange={(e) => setHrForm({ ...hrForm, expectedCtc: e.target.value })} />
            </Field>
            <Field label="Notice (days)">
              <Input type="number" value={hrForm.noticePeriodDays} onChange={(e) => setHrForm({ ...hrForm, noticePeriodDays: e.target.value })} />
            </Field>
            <Field label="Available from">
              <Input type="date" value={hrForm.availableFrom} onChange={(e) => setHrForm({ ...hrForm, availableFrom: e.target.value })} />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea rows={3} value={hrForm.notes} onChange={(e) => setHrForm({ ...hrForm, notes: e.target.value })} />
          </Field>
          <Button
            className="w-full"
            onClick={() =>
              void run(() =>
                api(`/recruitment/applications/${a.id}/hr-screening`, {
                  method: 'POST',
                  body: {
                    experienceVerified: hrForm.experienceVerified === 'true',
                    interested: hrForm.interested === 'true',
                    ...(hrForm.experienceYears ? { experienceYears: Number(hrForm.experienceYears) } : {}),
                    ...(hrForm.currentCtc ? { currentCtc: Number(hrForm.currentCtc) } : {}),
                    ...(hrForm.expectedCtc ? { expectedCtc: Number(hrForm.expectedCtc) } : {}),
                    ...(hrForm.noticePeriodDays ? { noticePeriodDays: Number(hrForm.noticePeriodDays) } : {}),
                    availableFrom: hrForm.availableFrom || null,
                    notes: hrForm.notes,
                  },
                })
              )
            }
          >
            Save screening call
          </Button>
        </div>
      </Modal>

      <Modal title={ivEdit ? 'Reschedule interview' : 'Schedule interview'} open={modal === 'interview'} onClose={() => setModal(null)} wide>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <div className="grid grid-cols-3 gap-3">
            <Field label="Round">
              <Input value={ivForm.round} onChange={(e) => setIvForm({ ...ivForm, round: e.target.value })} placeholder="e.g. Technical round 1" />
            </Field>
            <Field label="Type">
              <Select value={ivForm.interviewType} onChange={(e) => setIvForm({ ...ivForm, interviewType: e.target.value })}>
                {INTERVIEW_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
              </Select>
            </Field>
            <Field label="Mode">
              <Select value={ivForm.mode} onChange={(e) => setIvForm({ ...ivForm, mode: e.target.value })}>
                {['VIDEO', 'PHONE', 'ONSITE'].map((m) => <option key={m} value={m}>{label(m)}</option>)}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Date & time">
              <Input type="datetime-local" value={ivForm.scheduledAt} onChange={(e) => setIvForm({ ...ivForm, scheduledAt: e.target.value })} />
            </Field>
            <Field label="Duration (min)">
              <Input type="number" min={10} value={ivForm.durationMinutes} onChange={(e) => setIvForm({ ...ivForm, durationMinutes: e.target.value })} />
            </Field>
            <Field label={ivForm.mode === 'ONSITE' ? 'Location' : 'Meeting link / number'}>
              <Input value={ivForm.location} onChange={(e) => setIvForm({ ...ivForm, location: e.target.value })} />
            </Field>
          </div>
          <Field label="Panel (first = lead)">
            <div className="flex flex-wrap gap-1">
              {ivForm.panelIds.map((pid) => (
                <button
                  key={pid}
                  onClick={() => setIvForm({ ...ivForm, panelIds: ivForm.panelIds.filter((x) => x !== pid) })}
                  className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700"
                >
                  {people.find((p) => p.id === pid)?.name ?? 'Interviewer'} ×
                </button>
              ))}
            </div>
            <Select
              value=""
              onChange={(e) => e.target.value && setIvForm({ ...ivForm, panelIds: [...ivForm.panelIds, e.target.value] })}
              className="mt-2"
            >
              <option value="">+ add interviewer</option>
              {people.filter((p) => !ivForm.panelIds.includes(p.id)).map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {p.designation}</option>
              ))}
            </Select>
          </Field>
          <p className="text-xs text-slate-400">The panel and the candidate are notified, with a reminder the day before.</p>
          {ivMissing.length > 0 && <p className="text-xs text-amber-600">Still needed: {ivMissing.join(', ')}</p>}
          <Button onClick={() => void saveInterview()} disabled={ivMissing.length > 0} className="w-full">
            {ivEdit ? 'Save' : 'Schedule'}
          </Button>
        </div>
      </Modal>

      <Modal title="Interview feedback" open={modal === 'feedback'} onClose={() => setModal(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <p className="text-sm text-slate-500">
            {fbFor?.iv.round}
            {fbFor && fbFor.interviewerId !== me && ` · on behalf of ${fbFor.iv.panel.find((p) => p.interviewerId === fbFor.interviewerId)?.interviewer?.name ?? ''}`}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rating (1–5)">
              <Select value={fbForm.rating} onChange={(e) => setFbForm({ ...fbForm, rating: e.target.value })}>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </Field>
            <Field label="Recommendation">
              <Select value={fbForm.recommendation} onChange={(e) => setFbForm({ ...fbForm, recommendation: e.target.value })}>
                {RECOMMENDATIONS.map((r) => <option key={r} value={r}>{label(r)}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Feedback">
            <Textarea rows={5} value={fbForm.feedback} onChange={(e) => setFbForm({ ...fbForm, feedback: e.target.value })} />
          </Field>
          <Button
            className="w-full"
            disabled={fbForm.feedback.trim().length < 3}
            onClick={() =>
              fbFor &&
              void run(() =>
                api(`/recruitment/interviews/${fbFor.iv.id}/feedback`, {
                  method: 'POST',
                  body: {
                    rating: Number(fbForm.rating), recommendation: fbForm.recommendation, feedback: fbForm.feedback,
                    ...(fbFor.interviewerId !== me ? { interviewerId: fbFor.interviewerId } : {}),
                  },
                })
              )
            }
          >
            Submit feedback
          </Button>
        </div>
      </Modal>

      <Modal title="Recommend for hire" open={modal === 'recommend'} onClose={() => setModal(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Why should we hire this candidate?">
            <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Button className="w-full" disabled={text.trim().length < 3} onClick={() => void run(() => api(`/recruitment/applications/${a.id}/recommend`, { method: 'POST', body: { note: text } }))}>
            Recommend
          </Button>
        </div>
      </Modal>

      <Modal title="Select candidate" open={modal === 'select'} onClose={() => setModal(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          {a.job.maxCtc !== undefined && <p className="text-sm text-slate-500">Budget: {money(a.job.minCtc)} – {money(a.job.maxCtc)} · expects {money(a.candidate.expectedCtc)}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Proposed CTC (₹/yr)">
              <Input type="number" value={selForm.proposedCtc} onChange={(e) => setSelForm({ ...selForm, proposedCtc: e.target.value })} />
            </Field>
            <Field label="Proposed joining date">
              <Input type="date" value={selForm.proposedJoiningDate} onChange={(e) => setSelForm({ ...selForm, proposedJoiningDate: e.target.value })} />
            </Field>
          </div>
          {!!a.job.maxCtc && Number(selForm.proposedCtc) > a.job.maxCtc && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">Above the approved budget — the offer approver will see this.</p>
          )}
          <Field label="Note">
            <Input value={selForm.note} onChange={(e) => setSelForm({ ...selForm, note: e.target.value })} />
          </Field>
          <Button
            className="w-full"
            disabled={!Number(selForm.proposedCtc) || !selForm.proposedJoiningDate}
            onClick={() =>
              void run(async () => {
                const r = await api<{ warnings: string[] }>(`/recruitment/applications/${a.id}/select`, {
                  method: 'POST',
                  body: { proposedCtc: Number(selForm.proposedCtc), proposedJoiningDate: selForm.proposedJoiningDate, ...(selForm.note ? { note: selForm.note } : {}) },
                });
                setNotice(r.warnings.length ? `Selected. ⚠ ${r.warnings.join(' ')}` : 'Selected — create the offer next.');
              })
            }
          >
            Select
          </Button>
        </div>
      </Modal>

      <Modal
        title={modal === 'offer-revise' ? 'Revise offer' : modal === 'offer-edit' ? 'Edit offer' : 'Create offer'}
        open={modal === 'offer-new' || modal === 'offer-edit' || modal === 'offer-revise'}
        onClose={() => setModal(null)}
        wide
      >
        <div className="space-y-3">
          <ErrorNote error={error} />
          {offer?.status === 'NEGOTIATING' && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Candidate asked for {money(offer.counterCtc)}: {offer.negotiationNote}
            </p>
          )}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Designation">
              <Input value={offerForm.designation} onChange={(e) => setOfferForm({ ...offerForm, designation: e.target.value })} />
            </Field>
            <Field label="Department">
              <Input value={offerForm.department} disabled={modal === 'offer-revise'} onChange={(e) => setOfferForm({ ...offerForm, department: e.target.value })} />
            </Field>
            <Field label="CTC (₹/yr)">
              <Input type="number" value={offerForm.ctcAnnual} onChange={(e) => setOfferForm({ ...offerForm, ctcAnnual: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Joining date">
              <Input type="date" value={offerForm.joiningDate} onChange={(e) => setOfferForm({ ...offerForm, joiningDate: e.target.value })} />
            </Field>
            <Field label="Work location">
              <Input value={offerForm.workLocation} onChange={(e) => setOfferForm({ ...offerForm, workLocation: e.target.value })} />
            </Field>
            <Field label="Valid until" hint="Default: 7 days">
              <Input type="date" value={offerForm.validUntil} onChange={(e) => setOfferForm({ ...offerForm, validUntil: e.target.value })} />
            </Field>
          </div>
          {modal !== 'offer-revise' && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Employment type">
                <Select value={offerForm.employmentType} onChange={(e) => setOfferForm({ ...offerForm, employmentType: e.target.value })}>
                  {EMPLOYMENT_TYPES.map((t) => <option key={t}>{t}</option>)}
                </Select>
              </Field>
              <Field label="Probation (months)">
                <Input type="number" min={0} value={offerForm.probationMonths} onChange={(e) => setOfferForm({ ...offerForm, probationMonths: e.target.value })} />
              </Field>
              <Field label="Notice period (days)">
                <Input type="number" min={0} value={offerForm.noticePeriodDays} onChange={(e) => setOfferForm({ ...offerForm, noticePeriodDays: e.target.value })} />
              </Field>
            </div>
          )}
          <Field label="Additional terms">
            <Textarea rows={3} value={offerForm.terms} onChange={(e) => setOfferForm({ ...offerForm, terms: e.target.value })} />
          </Field>
          {modal === 'offer-revise' && (
            <Field label="What changed (kept in the offer history)">
              <Input value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
          )}
          <p className="text-xs text-slate-400">Every offer needs approval before it is sent. A revised offer with a higher CTC is approved again.</p>
          <Button
            className="w-full"
            disabled={!offerForm.designation || !Number(offerForm.ctcAnnual) || !offerForm.joiningDate || (modal === 'offer-revise' && text.trim().length < 3)}
            onClick={() => void saveOffer()}
          >
            Save
          </Button>
        </div>
      </Modal>

      <Modal title="Send offer back" open={modal === 'offer-reject'} onClose={() => setModal(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Remarks">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Button variant="danger" className="w-full" onClick={() => void offerAction('decide', { decision: 'REJECTED', remarks: text || undefined }, 'Offer sent back to draft.')}>
            Reject / send back
          </Button>
        </div>
      </Modal>

      <Modal title="Record candidate's response" open={modal === 'respond'} onClose={() => setModal(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Response">
            <Select value={respForm.response} onChange={(e) => setRespForm({ ...respForm, response: e.target.value })}>
              <option value="ACCEPT">Accepted</option>
              <option value="DECLINE">Declined</option>
              <option value="NEGOTIATE">Wants to negotiate</option>
            </Select>
          </Field>
          {respForm.response === 'DECLINE' && (
            <Field label="Reason">
              <Input value={respForm.reason} onChange={(e) => setRespForm({ ...respForm, reason: e.target.value })} />
            </Field>
          )}
          {respForm.response === 'NEGOTIATE' && (
            <>
              <Field label="Counter CTC (₹/yr)">
                <Input type="number" value={respForm.counterCtc} onChange={(e) => setRespForm({ ...respForm, counterCtc: e.target.value })} />
              </Field>
              <Field label="Note">
                <Input value={respForm.note} onChange={(e) => setRespForm({ ...respForm, note: e.target.value })} />
              </Field>
            </>
          )}
          <Button
            className="w-full"
            onClick={() =>
              void offerAction('respond', {
                response: respForm.response,
                ...(respForm.reason ? { reason: respForm.reason } : {}),
                ...(respForm.counterCtc ? { counterCtc: Number(respForm.counterCtc) } : {}),
                ...(respForm.note ? { note: respForm.note } : {}),
              })
            }
          >
            Save
          </Button>
        </div>
      </Modal>

      <Modal title="Withdraw offer" open={modal === 'withdraw'} onClose={() => setModal(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Reason">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Button variant="danger" className="w-full" disabled={text.trim().length < 3} onClick={() => void offerAction('withdraw', { reason: text }, 'Offer withdrawn.')}>
            Withdraw offer
          </Button>
        </div>
      </Modal>

      <Modal title="Close application" open={modal === 'stage'} onClose={() => setModal(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Action">
            <Select value={stageForm.stage} onChange={(e) => setStageForm({ ...stageForm, stage: e.target.value })}>
              <option value="REJECTED">Reject (company decision)</option>
              <option value="WITHDRAWN">Withdrawn (candidate dropped out)</option>
              {['APPLIED', 'SHORTLISTED', 'HR_SCREENED', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED'].includes(a.stage) && <option value="ON_HOLD">Put on hold</option>}
            </Select>
          </Field>
          <Field label="Reason">
            <Textarea value={stageForm.reason} onChange={(e) => setStageForm({ ...stageForm, reason: e.target.value })} />
          </Field>
          <p className="text-xs text-slate-400">Scheduled interviews are cancelled and any open offer / pre-joining is withdrawn.</p>
          <Button
            variant="danger"
            className="w-full"
            disabled={stageForm.stage !== 'ON_HOLD' && stageForm.reason.trim().length < 3}
            onClick={() => void run(() => api(`/recruitment/applications/${a.id}/stage`, { method: 'POST', body: { stage: stageForm.stage, ...(stageForm.reason ? { reason: stageForm.reason } : {}) } }))}
          >
            Confirm
          </Button>
        </div>
      </Modal>

      <Modal title="Candidate portal link" open={modal === 'portal'} onClose={() => setModal(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <p className="text-sm text-slate-500">
            Share this link with {a.candidate.name} (email / WhatsApp). It is shown only once — creating a new link disables the old one.
          </p>
          {portalUrl && (
            <div className="flex gap-2">
              <Input readOnly value={portalUrl} onFocus={(e) => e.target.select()} />
              <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(portalUrl)}>Copy</Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
