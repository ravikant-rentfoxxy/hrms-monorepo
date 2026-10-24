'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, Card, DatePicker, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Td } from '@/components/ui';
import { BarChart, Progress, errMsg, label } from '@/components/talent';
import { ReviewModal, cycleTone, type Cycle } from '@/components/reviews';
import { useDirectory } from '@/components/recruitment';

const PHASES = ['DRAFT', 'SELF_REVIEW', 'MANAGER_REVIEW', 'CALIBRATION', 'CLOSED'];

type CycleDetail = Cycle & { progress: Record<string, { total: number; submitted: number }>; outcomes: Record<string, number> };

interface CycleReview {
  id: string;
  type: string;
  status: string;
  rating: number | null;
  submittedAt: string | null;
  employee: { id: string; name: string; department: string; designation: string };
  reviewer: { id: string; name: string } | null;
}

interface CalRow {
  id: string;
  status: string;
  finalRating: number | null;
  normalizedRating: number | null;
  incrementPercent: number;
  promotion: boolean;
  newDesignation: string;
  remarks: string;
  employee: { id: string; name: string; employeeCode: string; department: string; designation: string };
  manager: { name: string } | null;
  selfRating: number | null;
  managerRating: number | null;
  peerRating: number | null;
  effectiveRating: number | null;
  suggestedIncrement: number;
}

interface Calibration {
  rows: CalRow[];
  distribution: { rating: number; count: number; actualPercent: number; targetPercent: number; targetCount: number }[];
  rated: number;
  total: number;
  incrementMatrix: Record<string, number>;
}

type Edit = { finalRating: string; normalizedRating: string; incrementPercent: string; promotion: boolean; newDesignation: string; remarks: string };

export default function CyclePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const cycle = useFetch<CycleDetail>(`/reviews/cycles/${id}`);
  const [tab, setTab] = useState('Reviews');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const reviews = useFetch<CycleReview[]>(
    tab === 'Reviews' ? `/reviews/cycles/${id}/reviews?${new URLSearchParams({ ...(type ? { type } : {}), ...(status ? { status } : {}) })}` : null
  );
  const cal = useFetch<Calibration>(tab === 'Calibration' ? `/reviews/cycles/${id}/calibration` : null);
  const people = useDirectory();
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [peerOpen, setPeerOpen] = useState(false);
  const [peerForm, setPeerForm] = useState({ employeeId: '', r1: '', r2: '', r3: '' });
  const [datesOpen, setDatesOpen] = useState(false);
  const [dates, setDates] = useState({ selfReviewDue: '', managerReviewDue: '' });

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    try {
      await fn();
      after?.();
      cycle.reload();
      reviews.reload();
      cal.reload();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  if (cycle.loading && !cycle.data) return <Spinner />;
  if (!cycle.data) return <ErrorNote error={cycle.error ?? 'Cycle not found'} />;
  const c = cycle.data;
  const idx = PHASES.indexOf(c.status);
  const next = PHASES[idx + 1];

  const editOf = (r: CalRow): Edit =>
    edits[r.id] ?? {
      finalRating: r.finalRating?.toString() ?? '',
      normalizedRating: r.normalizedRating?.toString() ?? '',
      incrementPercent: String(r.incrementPercent),
      promotion: r.promotion,
      newDesignation: r.newDesignation,
      remarks: r.remarks,
    };
  const setEdit = (r: CalRow, patch: Partial<Edit>) => setEdits({ ...edits, [r.id]: { ...editOf(r), ...patch } });
  const saveRow = (r: CalRow) => {
    const e = editOf(r);
    return run(
      () =>
        api(`/reviews/outcomes/${r.id}`, {
          method: 'PATCH',
          body: {
            finalRating: e.finalRating ? Number(e.finalRating) : null,
            normalizedRating: e.normalizedRating ? Number(e.normalizedRating) : null,
            incrementPercent: Number(e.incrementPercent) || 0,
            promotion: e.promotion,
            newDesignation: e.newDesignation,
            remarks: e.remarks,
          },
        }),
      () => {
        const rest = { ...edits };
        delete rest[r.id];
        setEdits(rest);
      }
    );
  };

  return (
    <div>
      <Link href="/reviews" className="mb-3 inline-block text-sm text-slate-500 hover:text-indigo-600">
        ← Reviews
      </Link>
      <PageHeader
        title={c.name}
        subtitle={`${fmtDate(c.periodStart)} – ${fmtDate(c.periodEnd)} · 1–${c.ratingScale} scale${c.includePeer ? ' · peer reviews' : ''}`}
        actions={
          <>
            {c.status !== 'CLOSED' && (
              <Button
                variant="secondary"
                onClick={() => {
                  setDates({ selfReviewDue: c.selfReviewDue?.slice(0, 10) ?? '', managerReviewDue: c.managerReviewDue?.slice(0, 10) ?? '' });
                  setDatesOpen(true);
                }}
              >
                Due dates
              </Button>
            )}
            {c.status === 'DRAFT' && (
              <>
                <Button
                  variant="secondary"
                  onClick={() =>
                    confirm('Delete this draft cycle?') &&
                    void api(`/reviews/cycles/${id}`, { method: 'DELETE' })
                      .then(() => router.replace('/reviews'))
                      .catch((err: unknown) => setError(errMsg(err)))
                  }
                >
                  Delete
                </Button>
                <Button onClick={() => confirm('Launch? Self reviews open for every active employee.') && void run(() => api(`/reviews/cycles/${id}/launch`, { method: 'POST' }))}>
                  Launch
                </Button>
              </>
            )}
            {['SELF_REVIEW', 'MANAGER_REVIEW', 'CALIBRATION'].includes(c.status) && (
              <>
                <Button variant="secondary" onClick={() => void run(() => api(`/reviews/cycles/${id}/sync`, { method: 'POST' }))}>
                  Sync new joiners
                </Button>
                <Button
                  onClick={() =>
                    confirm(`Move the cycle to ${label(next ?? '')}?`) && void run(() => api(`/reviews/cycles/${id}/advance`, { method: 'POST' }))
                  }
                >
                  Move to {label(next ?? '')}
                </Button>
              </>
            )}
          </>
        }
      />
      <ErrorNote error={error} />

      <div className="mb-4 mt-3 flex flex-wrap items-center gap-2">
        {PHASES.map((p, i) => (
          <div key={p} className="flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                i < idx ? 'bg-emerald-50 text-emerald-700' : i === idx ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {label(p)}
            </span>
            {i < PHASES.length - 1 && <span className="text-slate-300">→</span>}
          </div>
        ))}
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-4">
        {(['SELF', 'MANAGER', 'PEER'] as const).map((t) => {
          const p = c.progress[t] ?? { total: 0, submitted: 0 };
          return (
            <Card key={t} className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label(t)} reviews</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">
                {p.submitted}/{p.total}
              </p>
              <Progress value={p.total ? p.submitted / p.total : 0} className="mt-2" />
            </Card>
          );
        })}
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Outcomes</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {['PROPOSED', 'APPROVED', 'APPLIED'].map((s) => (
              <Badge key={s} tone={cycleTone(s)}>
                {label(s)} {c.outcomes[s] ?? 0}
              </Badge>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">Self due {fmtDate(c.selfReviewDue)} · manager due {fmtDate(c.managerReviewDue)}</p>
        </Card>
      </div>

      <Tabs tabs={['Reviews', ...(['CALIBRATION', 'CLOSED'].includes(c.status) ? ['Calibration'] : [])]} active={tab} onChange={setTab} />

      {tab === 'Reviews' && (
        <Card>
          <div className="flex flex-wrap gap-2 border-b border-slate-100 p-4">
            <Select value={type} onChange={(e) => setType(e.target.value)} className="max-w-[160px]">
              <option value="">All types</option>
              {['SELF', 'MANAGER', 'PEER'].map((t) => (
                <option key={t} value={t}>
                  {label(t)}
                </option>
              ))}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[160px]">
              <option value="">Any status</option>
              <option value="PENDING">Pending</option>
              <option value="SUBMITTED">Submitted</option>
            </Select>
            {c.includePeer && ['SELF_REVIEW', 'MANAGER_REVIEW'].includes(c.status) && (
              <Button
                variant="secondary"
                onClick={() => {
                  setError(null);
                  setPeerForm({ employeeId: '', r1: '', r2: '', r3: '' });
                  setPeerOpen(true);
                }}
              >
                + Peer reviewers
              </Button>
            )}
          </div>
          {reviews.loading ? (
            <Spinner />
          ) : !reviews.data?.length ? (
            <Empty message={c.status === 'DRAFT' ? 'Launch the cycle to create reviews' : 'No reviews match'} />
          ) : (
            <Table headers={['Employee', 'Type', 'Reviewer', 'Status', 'Rating', '']}>
              {reviews.data.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <p className="font-medium text-slate-900">{r.employee.name}</p>
                    <p className="text-xs text-slate-400">{r.employee.department}</p>
                  </Td>
                  <Td>{label(r.type)}</Td>
                  <Td>{r.reviewer?.name ?? '—'}</Td>
                  <Td>
                    <Badge tone={cycleTone(r.status)}>{label(r.status)}</Badge>
                  </Td>
                  <Td>{r.rating ?? '—'}</Td>
                  <Td>
                    <div className="flex gap-1">
                      <Button variant="ghost" onClick={() => setOpenId(r.id)}>
                        View
                      </Button>
                      {r.type === 'PEER' && r.status === 'PENDING' && (
                        <Button variant="ghost" onClick={() => void run(() => api(`/reviews/${r.id}`, { method: 'DELETE' }))}>
                          Remove
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'Calibration' &&
        (cal.loading && !cal.data ? (
          <Spinner />
        ) : cal.data ? (
          <div className="space-y-4">
            <Card className="p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  Rating distribution vs target bell curve ({cal.data.rated}/{cal.data.total} rated)
                </h2>
                <p className="text-xs text-slate-400">
                  Suggested increments:{' '}
                  {Object.entries(cal.data.incrementMatrix)
                    .sort(([a], [b]) => Number(b) - Number(a))
                    .map(([r, p]) => `${r}→${p}%`)
                    .join(' · ')}
                </p>
              </div>
              <BarChart
                data={cal.data.distribution.map((d) => ({
                  label: `Rating ${d.rating}`,
                  value: d.actualPercent,
                  target: d.targetPercent,
                  valueLabel: `${d.actualPercent}`,
                }))}
                valueSuffix="%"
                valueName="Actual % of employees"
                targetLabel="Target %"
              />
              <table className="mt-3 w-full text-xs text-slate-500">
                <tbody>
                  <tr>
                    <td className="pr-2 font-semibold">Employees</td>
                    {cal.data.distribution.map((d) => (
                      <td key={d.rating}>
                        {d.rating}: {d.count} (target {d.targetCount})
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </Card>

            <Card>
              <div className="flex items-center justify-between border-b border-slate-100 p-4">
                <p className="text-sm text-slate-500">Set the final / normalized rating, increment and promotion, then approve.</p>
                {c.status === 'CALIBRATION' && (
                  <Button onClick={() => void run(() => api(`/reviews/cycles/${id}/outcomes/approve`, { method: 'POST', body: {} }))}>
                    Approve all rated
                  </Button>
                )}
              </div>
              {!cal.data.rows.length ? (
                <Empty message="No outcomes yet" />
              ) : (
                <Table headers={['Employee', 'Self / Mgr / Peer', 'Final', 'Normalized', 'Increment %', 'Promotion', 'Remarks', 'Status', '']}>
                  {cal.data.rows.map((r) => {
                    const e = editOf(r);
                    const editable = c.status === 'CALIBRATION' && r.status === 'PROPOSED';
                    const dirty = !!edits[r.id];
                    return (
                      <tr key={r.id}>
                        <Td>
                          <p className="font-medium text-slate-900">{r.employee.name}</p>
                          <p className="text-xs text-slate-400">
                            {r.employee.designation} · {r.manager?.name ?? 'no manager'}
                          </p>
                        </Td>
                        <Td className="whitespace-nowrap text-xs">
                          {r.selfRating ?? '—'} / {r.managerRating ?? '—'} / {r.peerRating ?? '—'}
                        </Td>
                        <Td>
                          <Input className="w-16" type="number" step="0.5" min={1} max={c.ratingScale} value={e.finalRating} disabled={!editable}
                            onChange={(ev) => setEdit(r, { finalRating: ev.target.value })} />
                        </Td>
                        <Td>
                          <Input className="w-16" type="number" step="0.5" min={1} max={c.ratingScale} value={e.normalizedRating} disabled={!editable}
                            onChange={(ev) => setEdit(r, { normalizedRating: ev.target.value })} />
                        </Td>
                        <Td>
                          <Input className="w-16" type="number" step="0.5" min={0} value={e.incrementPercent} disabled={!editable}
                            onChange={(ev) => setEdit(r, { incrementPercent: ev.target.value })} />
                          {editable && Number(e.incrementPercent) !== r.suggestedIncrement && (
                            <p className="mt-0.5 text-[10px] text-slate-400">suggested {r.suggestedIncrement}%</p>
                          )}
                        </Td>
                        <Td>
                          <label className="flex items-center gap-1 text-xs">
                            <input type="checkbox" checked={e.promotion} disabled={!editable} onChange={(ev) => setEdit(r, { promotion: ev.target.checked })} />
                            Promote
                          </label>
                          {e.promotion && (
                            <Input className="mt-1 w-36" placeholder="New designation" value={e.newDesignation} disabled={!editable}
                              onChange={(ev) => setEdit(r, { newDesignation: ev.target.value })} />
                          )}
                        </Td>
                        <Td>
                          <Input className="w-40" value={e.remarks} disabled={!editable} onChange={(ev) => setEdit(r, { remarks: ev.target.value })} />
                        </Td>
                        <Td>
                          <Badge tone={cycleTone(r.status)}>{label(r.status)}</Badge>
                        </Td>
                        <Td>
                          <div className="flex flex-col gap-1">
                            {editable && dirty && (
                              <Button variant="ghost" onClick={() => void saveRow(r)}>
                                Save
                              </Button>
                            )}
                            {editable && !dirty && r.effectiveRating !== null && (
                              <Button
                                variant="ghost"
                                onClick={() => void run(() => api(`/reviews/cycles/${id}/outcomes/approve`, { method: 'POST', body: { ids: [r.id] } }))}
                              >
                                Approve
                              </Button>
                            )}
                            {r.status === 'APPROVED' && (
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  confirm(
                                    `Apply for ${r.employee.name}?${r.incrementPercent > 0 ? ` Creates a ${r.incrementPercent}% salary revision.` : ''}${r.promotion ? ` Designation → ${r.newDesignation}.` : ''}`
                                  ) && void run(() => api(`/reviews/outcomes/${r.id}/apply`, { method: 'POST', body: {} }))
                                }
                              >
                                Apply
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
          </div>
        ) : (
          <ErrorNote error={cal.error} />
        ))}

      <ReviewModal reviewId={openId} onClose={() => setOpenId(null)} onSaved={reviews.reload} />

      <Modal title="Add peer reviewers" open={peerOpen} onClose={() => setPeerOpen(false)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Employee (reviewee)">
            <Select value={peerForm.employeeId} onChange={(e) => setPeerForm({ ...peerForm, employeeId: e.target.value })}>
              <option value="">— select —</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          {(['r1', 'r2', 'r3'] as const).map((k, i) => (
            <Field key={k} label={`Peer ${i + 1}${i ? ' (optional)' : ''}`}>
              <Select value={peerForm[k]} onChange={(e) => setPeerForm({ ...peerForm, [k]: e.target.value })}>
                <option value="">—</option>
                {people
                  .filter((p) => p.id !== peerForm.employeeId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </Field>
          ))}
          <Button
            onClick={() =>
              void run(
                () =>
                  api(`/reviews/cycles/${id}/peers`, {
                    method: 'POST',
                    body: { employeeId: peerForm.employeeId, reviewerIds: [peerForm.r1, peerForm.r2, peerForm.r3].filter(Boolean) },
                  }),
                () => setPeerOpen(false)
              )
            }
            disabled={!peerForm.employeeId || !(peerForm.r1 || peerForm.r2 || peerForm.r3)}
            className="w-full"
          >
            Request peer reviews
          </Button>
        </div>
      </Modal>

      <Modal title="Due dates" open={datesOpen} onClose={() => setDatesOpen(false)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Self review due">
            <DatePicker value={dates.selfReviewDue} onChange={(v) => setDates({ ...dates, selfReviewDue: v })} />
          </Field>
          <Field label="Manager review due">
            <DatePicker value={dates.managerReviewDue} onChange={(v) => setDates({ ...dates, managerReviewDue: v })} />
          </Field>
          <Button
            onClick={() =>
              void run(
                () =>
                  api(`/reviews/cycles/${id}`, {
                    method: 'PATCH',
                    body: { selfReviewDue: dates.selfReviewDue || null, managerReviewDue: dates.managerReviewDue || null },
                  }),
                () => setDatesOpen(false)
              )
            }
            className="w-full"
          >
            Save
          </Button>
        </div>
      </Modal>
    </div>
  );
}
