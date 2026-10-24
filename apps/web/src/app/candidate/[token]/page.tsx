'use client';

/**
 * Candidate portal (public, no login): the token link HR shares. The
 * candidate reviews and answers the offer, uploads the signed copy and their
 * pre-joining documents. Lives outside the (panel) group, so no session/shell.
 */
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { Badge, Button, Card, ErrorNote, Field, Input, Spinner, Textarea } from '@/components/ui';

interface PortalView {
  company: { name: string };
  candidate: { name: string; email: string; code: string | null };
  job: { title: string; department: string; location: string };
  application: { code: string | null; status: string };
  offer: {
    code: string | null;
    status: string;
    designation: string;
    department: string;
    ctcAnnual: number;
    joiningDate: string;
    workLocation: string;
    employmentType: string;
    probationMonths: number;
    noticePeriodDays: number;
    terms: string;
    validUntil: string | null;
    respondedAt: string | null;
    acceptedVia: string;
    counterCtc: number | null;
    negotiationNote: string;
    hasSignedCopy: boolean;
    signedFileName: string;
    letterUrl: string | null;
    canRespond: boolean;
    expired: boolean;
  } | null;
  preJoining: {
    status: string;
    expectedJoiningDate: string;
    confirmedJoiningDate: string | null;
    instructions: string;
    canUpload: boolean;
    documents: { id: string; type: string; name: string; required: boolean; status: string; remarks: string; fileName: string; submittedAt: string | null }[];
  } | null;
  linkExpiresAt: string | null;
}

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic';
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const DOC_TONE: Record<string, 'slate' | 'amber' | 'green' | 'red'> = { PENDING: 'slate', SUBMITTED: 'amber', VERIFIED: 'green', REJECTED: 'red' };
const DOC_TEXT: Record<string, string> = { PENDING: 'To upload', SUBMITTED: 'Under review', VERIFIED: 'Verified', REJECTED: 'Please re-upload' };

export default function CandidatePortalPage() {
  const { token } = useParams<{ token: string }>();
  const base = `/public/candidate/${encodeURIComponent(token)}`;
  const [data, setData] = useState<PortalView | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'decline' | 'negotiate' | null>(null);
  const [reason, setReason] = useState('');
  const [counter, setCounter] = useState('');
  const [note, setNote] = useState('');
  const [declined, setDeclined] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<PortalView>(base, { skipAuth: true }));
      setFatal(null);
    } catch (err) {
      setFatal(err instanceof Error ? err.message : 'This link is not valid');
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    // Initial fetch; state updates land asynchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const act = async (fn: () => Promise<PortalView | null>, msg: string) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const next = await fn();
      if (next) setData(next);
      setNotice(msg);
      setMode(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const upload = (path: string, file: File | undefined, msg: string) => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    void act(() => api<PortalView>(`${base}${path}`, { method: 'POST', form, skipAuth: true }), msg);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (declined) {
    return (
      <Shell>
        <Card className="p-6 text-center">
          <h1 className="text-lg font-semibold text-slate-900">Thank you for letting us know</h1>
          <p className="mt-2 text-sm text-slate-500">We have recorded that you declined the offer. We wish you all the best.</p>
        </Card>
      </Shell>
    );
  }

  if (fatal || !data) {
    return (
      <Shell>
        <Card className="p-6 text-center">
          <h1 className="text-lg font-semibold text-slate-900">Link unavailable</h1>
          <p className="mt-2 text-sm text-slate-500">{fatal ?? 'This link is invalid or has expired. Please contact HR for a new link.'}</p>
        </Card>
      </Shell>
    );
  }

  const { offer, preJoining } = data;

  return (
    <Shell company={data.company.name}>
      <div className="space-y-4">
        <Card className="p-5">
          <p className="text-sm text-slate-500">Hello,</p>
          <h1 className="text-xl font-semibold text-slate-900">{data.candidate.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {data.job.title}
            {data.job.department && ` · ${data.job.department}`}
            {data.job.location && ` · ${data.job.location}`}
            {data.application.code && ` · Ref ${data.application.code}`}
          </p>
        </Card>

        {notice && <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">{notice}</p>}
        <ErrorNote error={error} />

        {offer ? (
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Your offer{offer.code ? ` · ${offer.code}` : ''}</h2>
              <Badge tone={offer.status === 'ACCEPTED' ? 'green' : offer.status === 'NEGOTIATING' ? 'amber' : 'blue'}>
                {offer.status === 'ACCEPTED' ? 'Accepted' : offer.status === 'NEGOTIATING' ? 'Under discussion' : offer.expired ? 'Expired' : 'Awaiting your response'}
              </Badge>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              {[
                ['Designation', offer.designation],
                ['Department', offer.department || '—'],
                ['Annual CTC', inr(offer.ctcAnnual)],
                ['Joining date', fmtDate(offer.joiningDate)],
                ['Work location', offer.workLocation || '—'],
                ['Employment type', offer.employmentType],
                ['Probation', offer.probationMonths ? `${offer.probationMonths} months` : 'None'],
                ['Notice period', `${offer.noticePeriodDays} days`],
                ['Respond by', fmtDate(offer.validUntil)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{k}</dt>
                  <dd className="text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>
            {offer.terms && <p className="mt-3 whitespace-pre-line rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{offer.terms}</p>}
            {offer.status === 'NEGOTIATING' && (
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                You asked{offer.counterCtc ? ` for ${inr(offer.counterCtc)}` : ''}: {offer.negotiationNote || '—'}. HR will get back to you with a revised offer;
                you can still accept the current one.
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {offer.letterUrl && (
                <a href={offer.letterUrl} rel="noreferrer">
                  <Button variant="secondary">Download offer letter</Button>
                </a>
              )}
              {offer.canRespond && (
                <>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      confirm('Accept this offer? This is your digital acceptance.') &&
                      void act(() => api<PortalView>(`${base}/offer/accept`, { method: 'POST', skipAuth: true }), 'Congratulations! Your acceptance has been recorded.')
                    }
                  >
                    Accept offer
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => setMode('negotiate')}>
                    Discuss / negotiate
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setMode('decline')}>
                    Decline
                  </Button>
                </>
              )}
              {['SENT', 'NEGOTIATING', 'ACCEPTED'].includes(offer.status) && (
                <label className="inline-flex cursor-pointer items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
                  {offer.hasSignedCopy ? 'Replace signed copy' : 'Upload signed offer letter'}
                  <input type="file" accept={ACCEPT} className="hidden" onChange={(e) => upload('/offer/signed', e.target.files?.[0], 'Signed copy uploaded. Thank you!')} />
                </label>
              )}
            </div>
            {offer.hasSignedCopy && <p className="mt-2 text-xs text-slate-400">Signed copy on file: {offer.signedFileName}</p>}
            {offer.status === 'ACCEPTED' && offer.respondedAt && (
              <p className="mt-2 text-xs text-slate-400">
                Accepted on {fmtDate(offer.respondedAt)}
                {offer.acceptedVia === 'PORTAL' ? ' (digitally, on this page)' : ''}.
              </p>
            )}

            {mode === 'decline' && (
              <div className="mt-4 space-y-2 rounded-xl border border-slate-100 p-3">
                <Field label="Reason for declining">
                  <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <Button
                  variant="danger"
                  disabled={busy || reason.trim().length < 3}
                  onClick={async () => {
                    setError(null);
                    setBusy(true);
                    try {
                      await api(`${base}/offer/decline`, { method: 'POST', body: { reason }, skipAuth: true });
                      setDeclined(true);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Something went wrong');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Decline offer
                </Button>
              </div>
            )}
            {mode === 'negotiate' && (
              <div className="mt-4 space-y-2 rounded-xl border border-slate-100 p-3">
                <Field label="Expected annual CTC (₹, optional)">
                  <Input type="number" min={0} value={counter} onChange={(e) => setCounter(e.target.value)} />
                </Field>
                <Field label="What would you like to discuss?">
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <Button
                  disabled={busy || (note.trim().length < 3 && !Number(counter))}
                  onClick={() =>
                    void act(
                      () =>
                        api<PortalView>(`${base}/offer/negotiate`, {
                          method: 'POST',
                          body: { note, ...(Number(counter) ? { counterCtc: Number(counter) } : {}) },
                          skipAuth: true,
                        }),
                      'Sent to HR. They will get back to you.'
                    )
                  }
                >
                  Send to HR
                </Button>
              </div>
            )}
          </Card>
        ) : (
          <Card className="p-5">
            <p className="text-sm text-slate-500">There is nothing for you to act on right now. HR will share updates on this page.</p>
          </Card>
        )}

        {preJoining && (
          <Card className="p-5">
            <h2 className="text-base font-semibold text-slate-900">Before you join</h2>
            <p className="mt-1 text-sm text-slate-500">
              Joining date: {fmtDate(preJoining.confirmedJoiningDate ?? preJoining.expectedJoiningDate)}
              {preJoining.confirmedJoiningDate ? ' (confirmed)' : ''}
            </p>
            {preJoining.instructions && <p className="mt-3 whitespace-pre-line rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{preJoining.instructions}</p>}
            <ul className="mt-4 divide-y divide-slate-100">
              {preJoining.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {d.name} {!d.required && <span className="text-xs font-normal text-slate-400">(optional)</span>}
                    </p>
                    {d.fileName && <p className="text-xs text-slate-400">{d.fileName}</p>}
                    {d.status === 'REJECTED' && d.remarks && <p className="text-xs text-rose-600">{d.remarks}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={DOC_TONE[d.status] ?? 'slate'}>{DOC_TEXT[d.status] ?? d.status}</Badge>
                    {preJoining.canUpload && d.status !== 'VERIFIED' && (
                      <label className="cursor-pointer rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50">
                        {d.fileName ? 'Replace' : 'Upload'}
                        <input type="file" accept={ACCEPT} className="hidden" onChange={(e) => upload(`/documents/${d.id}`, e.target.files?.[0], `${d.name} uploaded.`)} />
                      </label>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-400">PDF, JPG, PNG, WEBP or HEIC files. After you join, sign in with {data.candidate.email} using “Forgot password” to set your password.</p>
          </Card>
        )}

        {data.linkExpiresAt && <p className="text-center text-xs text-slate-400">This private link is valid until {fmtDate(data.linkExpiresAt)}. Please do not share it.</p>}
      </div>
    </Shell>
  );
}

function Shell({ children, company }: { children: React.ReactNode; company?: string }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold text-slate-900">{company || 'Candidate portal'}</span>
          <span className="text-xs text-slate-400">Candidate portal</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
