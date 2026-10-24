'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Avatar, Badge, Button, Card, DatePicker, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Td } from '@/components/ui';
import { errMsg, label } from '@/components/talent';
import { ReviewModal, cycleTone, type Cycle, type ReviewRow } from '@/components/reviews';

interface MyReviews {
  self: ReviewRow[];
  team: ReviewRow[];
  peer: ReviewRow[];
  outcomes: {
    id: string;
    finalRating: number | null;
    incrementPercent: number;
    promotion: boolean;
    newDesignation: string;
    remarks: string;
    status: string;
    cycle: { id: string; name: string; ratingScale: number };
  }[];
}

const emptyCycle = { name: '', periodStart: '', periodEnd: '', selfReviewDue: '', managerReviewDue: '', ratingScale: '5', includePeer: false };

function ReviewList({ rows, onOpen, showEmployee }: { rows: ReviewRow[]; onOpen: (id: string) => void; showEmployee?: boolean }) {
  if (!rows.length) return <Empty message="Nothing here" />;
  return (
    <Table headers={[showEmployee ? 'Employee' : 'Cycle', showEmployee ? 'Cycle' : 'Due', 'Status', 'Rating', '']}>
      {rows.map((r) => {
        const open = ['SELF_REVIEW', 'MANAGER_REVIEW'].includes(r.cycle.status);
        const due = r.type === 'SELF' ? r.cycle.selfReviewDue : r.cycle.managerReviewDue;
        return (
          <tr key={r.id}>
            <Td>
              {showEmployee ? (
                <div className="flex items-center gap-2">
                  <Avatar name={r.employee.name} />
                  <div>
                    <p className="font-medium text-slate-900">{r.employee.name}</p>
                    <p className="text-xs text-slate-400">{r.employee.designation}</p>
                  </div>
                </div>
              ) : (
                <span className="font-medium">{r.cycle.name}</span>
              )}
            </Td>
            <Td>{showEmployee ? r.cycle.name : due ? fmtDate(due) : '—'}</Td>
            <Td>
              <Badge tone={cycleTone(r.status)}>{label(r.status)}</Badge>
              {!open && <span className="ml-1 text-xs text-slate-400">({label(r.cycle.status)})</span>}
            </Td>
            <Td>{r.rating ? `${r.rating}/${r.cycle.ratingScale}` : '—'}</Td>
            <Td>
              <Button variant="ghost" onClick={() => onOpen(r.id)}>
                {open && r.status === 'PENDING' ? 'Write' : 'View'}
              </Button>
            </Td>
          </tr>
        );
      })}
    </Table>
  );
}

export default function ReviewsPage() {
  const { session, isCompanyAdmin, isManagerial } = useAuth();
  const tabs = [...(session?.employee ? ['My reviews'] : []), ...(isManagerial ? ['Team reviews'] : []), ...(isCompanyAdmin ? ['Cycles'] : [])];
  const [tab, setTab] = useState(tabs[0] ?? 'Cycles');
  const my = useFetch<MyReviews>(session?.employee ? '/reviews/my' : null);
  const cycles = useFetch<Cycle[]>(tab === 'Cycles' ? '/reviews/cycles' : null);
  const [openId, setOpenId] = useState<string | null>(null);

  const [cycleOpen, setCycleOpen] = useState(false);
  const [form, setForm] = useState(emptyCycle);
  const [error, setError] = useState<string | null>(null);

  const createCycle = async () => {
    setError(null);
    try {
      await api('/reviews/cycles', {
        method: 'POST',
        body: {
          name: form.name,
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          selfReviewDue: form.selfReviewDue || null,
          managerReviewDue: form.managerReviewDue || null,
          ratingScale: Number(form.ratingScale),
          includePeer: form.includePeer,
        },
      });
      setCycleOpen(false);
      setForm(emptyCycle);
      cycles.reload();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Performance reviews"
        subtitle="Self, manager and peer reviews, calibration and outcomes"
        actions={
          isCompanyAdmin && (
            <Button
              onClick={() => {
                setError(null);
                setCycleOpen(true);
              }}
            >
              + New cycle
            </Button>
          )
        }
      />
      {tabs.length > 1 && <Tabs tabs={tabs} active={tab} onChange={setTab} />}

      {tab === 'My reviews' &&
        (my.loading ? (
          <Spinner />
        ) : (
          <div className="space-y-4">
            <ErrorNote error={my.error} />
            {(my.data?.outcomes.length ?? 0) > 0 && (
              <div className="grid gap-3 md:grid-cols-2">
                {my.data?.outcomes.map((o) => (
                  <Card key={o.id} className="p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{o.cycle.name} · final outcome</p>
                    <div className="mt-2 flex items-end gap-4">
                      <span className="text-3xl font-semibold text-indigo-700">
                        {o.finalRating ?? '—'}
                        <span className="text-base text-slate-400">/{o.cycle.ratingScale}</span>
                      </span>
                      {o.incrementPercent > 0 && <Badge tone="green">{o.incrementPercent}% increment</Badge>}
                      {o.promotion && <Badge tone="violet">Promoted to {o.newDesignation}</Badge>}
                    </div>
                    {o.remarks && <p className="mt-2 text-sm text-slate-600">{o.remarks}</p>}
                  </Card>
                ))}
              </div>
            )}
            <Card>
              <h2 className="px-5 pt-5 text-sm font-semibold text-slate-900">Self reviews</h2>
              <ReviewList rows={my.data?.self ?? []} onOpen={setOpenId} />
            </Card>
            {(my.data?.peer.length ?? 0) > 0 && (
              <Card>
                <h2 className="px-5 pt-5 text-sm font-semibold text-slate-900">Peer reviews requested from you</h2>
                <ReviewList rows={my.data?.peer ?? []} onOpen={setOpenId} showEmployee />
              </Card>
            )}
          </div>
        ))}

      {tab === 'Team reviews' && (
        <Card>
          {my.loading ? <Spinner /> : <ReviewList rows={my.data?.team ?? []} onOpen={setOpenId} showEmployee />}
          <p className="px-5 pb-4 text-xs text-slate-400">
            Manager reviews for your direct reports. Their self review is shown inside each review once submitted.
          </p>
        </Card>
      )}

      {tab === 'Cycles' && (
        <Card>
          {cycles.loading ? (
            <Spinner />
          ) : !cycles.data?.length ? (
            <Empty message="No review cycles yet" />
          ) : (
            <Table headers={['Cycle', 'Period', 'Phase', 'Self', 'Manager', 'Due dates']}>
              {cycles.data.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link href={`/reviews/${c.id}`} className="font-medium text-slate-900 hover:text-indigo-600">
                      {c.name}
                    </Link>
                    <p className="text-xs text-slate-400">
                      1–{c.ratingScale} scale{c.includePeer ? ' · peer reviews' : ''}
                    </p>
                  </Td>
                  <Td>
                    {fmtDate(c.periodStart)} – {fmtDate(c.periodEnd)}
                  </Td>
                  <Td>
                    <Badge tone={cycleTone(c.status)}>{label(c.status)}</Badge>
                  </Td>
                  <Td>{c.progress?.SELF ? `${c.progress.SELF.submitted}/${c.progress.SELF.total}` : '—'}</Td>
                  <Td>{c.progress?.MANAGER ? `${c.progress.MANAGER.submitted}/${c.progress.MANAGER.total}` : '—'}</Td>
                  <Td>
                    <p className="text-xs">Self: {fmtDate(c.selfReviewDue)}</p>
                    <p className="text-xs">Manager: {fmtDate(c.managerReviewDue)}</p>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      <ReviewModal reviewId={openId} onClose={() => setOpenId(null)} onSaved={my.reload} />

      <Modal title="New review cycle" open={cycleOpen} onClose={() => setCycleOpen(false)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Name">
            <Input placeholder="e.g. H2 2026 annual review" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Period start">
              <DatePicker value={form.periodStart} onChange={(v) => setForm({ ...form, periodStart: v })} />
            </Field>
            <Field label="Period end">
              <DatePicker value={form.periodEnd} onChange={(v) => setForm({ ...form, periodEnd: v })} />
            </Field>
            <Field label="Self review due">
              <DatePicker value={form.selfReviewDue} onChange={(v) => setForm({ ...form, selfReviewDue: v })} />
            </Field>
            <Field label="Manager review due">
              <DatePicker value={form.managerReviewDue} onChange={(v) => setForm({ ...form, managerReviewDue: v })} />
            </Field>
          </div>
          <Field label="Rating scale">
            <Select value={form.ratingScale} onChange={(e) => setForm({ ...form, ratingScale: e.target.value })}>
              {[3, 4, 5, 7, 10].map((n) => (
                <option key={n} value={n}>
                  1 – {n}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.includePeer} onChange={(e) => setForm({ ...form, includePeer: e.target.checked })} />
            Include peer reviews (up to 3 peers per employee)
          </label>
          <Button onClick={() => void createCycle()} disabled={form.name.length < 2 || !form.periodStart || !form.periodEnd} className="w-full">
            Create cycle (draft)
          </Button>
        </div>
      </Modal>
    </div>
  );
}
