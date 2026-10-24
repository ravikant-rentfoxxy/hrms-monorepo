'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate, fmtMoney } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, DatePicker, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Stat, Table, Tabs, Td, Textarea,
  statusTone,
} from '@/components/ui';
import { errMsg, extraTone } from '@/components/engage';

interface Travel {
  id: string;
  purpose: string;
  fromCity: string;
  toCity: string;
  departDate: string;
  returnDate: string;
  mode: string;
  estimatedCost: number;
  advanceAmount: number;
  status: string;
  remarks: string | null;
  appliedOn: string;
  settledAmount: number | null;
  settledOn: string | null;
  advanceToBePaid: number;
  employee?: { id: string; name: string; department: string };
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

interface Claim {
  id: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  status: string;
}

interface Settlement {
  claims: Claim[];
  pendingClaims: Claim[];
  claimsTotal: number;
  advance: number;
  settledAmount: number;
}

const MODES = ['FLIGHT', 'TRAIN', 'BUS', 'CAR', 'OTHER'];

function ApplyModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    purpose: '', fromCity: '', toCity: '', departDate: '', returnDate: '', mode: 'FLIGHT', estimatedCost: '', advanceAmount: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await api('/travel', {
        method: 'POST',
        body: { ...form, estimatedCost: Number(form.estimatedCost || 0), advanceAmount: Number(form.advanceAmount || 0) },
      });
      onDone();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New travel request" open onClose={onClose}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <Field label="Purpose">
          <Textarea value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From city">
            <Input value={form.fromCity} onChange={(e) => setForm({ ...form, fromCity: e.target.value })} />
          </Field>
          <Field label="To city">
            <Input value={form.toCity} onChange={(e) => setForm({ ...form, toCity: e.target.value })} />
          </Field>
          <Field label="Depart">
            <DatePicker value={form.departDate} onChange={(v) => setForm({ ...form, departDate: v, returnDate: form.returnDate || v })} />
          </Field>
          <Field label="Return">
            <DatePicker value={form.returnDate} onChange={(v) => setForm({ ...form, returnDate: v })} />
          </Field>
          <Field label="Mode">
            <Select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              {MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label="Estimated cost (₹)">
            <Input type="number" min={0} value={form.estimatedCost} onChange={(e) => setForm({ ...form, estimatedCost: e.target.value })} />
          </Field>
        </div>
        <Field label="Advance needed (₹)" hint="Paid by finance outside payroll and adjusted at settlement">
          <Input type="number" min={0} value={form.advanceAmount} onChange={(e) => setForm({ ...form, advanceAmount: e.target.value })} />
        </Field>
        <Button
          onClick={() => void submit()}
          disabled={busy || form.purpose.length < 3 || !form.fromCity || !form.toCity || !form.departDate || !form.returnDate}
          className="w-full"
        >
          Submit request
        </Button>
      </div>
    </Modal>
  );
}

function DetailModal({
  id, onClose, canDecide, canSettle, onChanged,
}: { id: string; onClose: () => void; canDecide: boolean; canSettle: boolean; onChanged: () => void }) {
  const { data, loading } = useFetch<Travel & { trail: TrailStep[] }>(`/travel/${id}`);
  const settlement = useFetch<Settlement>(canSettle ? `/travel/${id}/settlement` : null);
  const [remarks, setRemarks] = useState('');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      onChanged();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const selectedClaims = settlement.data?.claims.filter((c) => !excluded.includes(c.id)) ?? [];
  const selectedTotal = selectedClaims.reduce((s, c) => s + c.amount, 0);
  const net = selectedTotal - (data?.advanceAmount ?? 0);

  return (
    <Modal title="Travel request" open onClose={onClose} wide>
      {loading || !data ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <ErrorNote error={error} />
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-slate-400">Trip</p>
              <p className="font-medium text-slate-900">
                {data.fromCity} → {data.toCity} · {data.mode}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Dates</p>
              <p className="font-medium text-slate-900">
                {fmtDate(data.departDate)} – {fmtDate(data.returnDate)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Estimated / advance</p>
              <p className="font-medium text-slate-900">
                {fmtMoney(data.estimatedCost)} / {fmtMoney(data.advanceAmount)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Status</p>
              <Badge tone={statusTone(data.status)}>{data.status}</Badge>
              {data.settledOn && <Badge tone="blue">Settled {fmtDate(data.settledOn)}</Badge>}
            </div>
          </div>
          <p className="text-sm text-slate-600">{data.purpose}</p>
          {data.trail.length > 0 && (
            <ol className="space-y-1.5 text-xs text-slate-500">
              {data.trail.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2">
                  <Badge tone={extraTone(s.status)}>L{s.level} {s.status}</Badge>
                  <span>{s.actedByName ?? s.approverName ?? '—'}</span>
                  {s.remarks && <span className="italic">“{s.remarks}”</span>}
                </li>
              ))}
            </ol>
          )}

          {canDecide && data.status === 'PENDING' && (
            <>
              <Field label="Remarks">
                <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </Field>
              <div className="flex gap-2">
                <Button
                  disabled={busy}
                  onClick={() => void act(() => api(`/travel/${id}/decide`, { method: 'POST', body: { decision: 'APPROVED', ...(remarks ? { remarks } : {}) } }))}
                >
                  Approve
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => void act(() => api(`/travel/${id}/decide`, { method: 'POST', body: { decision: 'REJECTED', ...(remarks ? { remarks } : {}) } }))}
                >
                  Reject
                </Button>
              </div>
            </>
          )}

          {canSettle && data.status === 'APPROVED' && settlement.data && (
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="mb-2 text-sm font-semibold text-slate-900">Settlement</p>
              {data.settledOn ? (
                <p className="text-sm text-slate-600">
                  Settled: {data.settledAmount !== null && data.settledAmount >= 0 ? 'pay employee' : 'recover'}{' '}
                  {fmtMoney(Math.abs(data.settledAmount ?? 0))}
                </p>
              ) : (
                <>
                  {settlement.data.claims.length === 0 ? (
                    <p className="text-sm text-slate-500">No approved expense claims dated within the trip.</p>
                  ) : (
                    <ul className="mb-3 divide-y divide-slate-100 text-sm">
                      {settlement.data.claims.map((c) => (
                        <li key={c.id} className="flex items-center gap-2 py-1.5">
                          <input
                            type="checkbox"
                            className="accent-indigo-600"
                            checked={!excluded.includes(c.id)}
                            onChange={(e) => setExcluded(e.target.checked ? excluded.filter((x) => x !== c.id) : [...excluded, c.id])}
                          />
                          <span className="flex-1">
                            {fmtDate(c.date)} · {c.category} · {c.description}
                          </span>
                          <span className="font-medium">{fmtMoney(c.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {settlement.data.pendingClaims.length > 0 && (
                    <p className="mb-2 text-xs text-amber-600">
                      {settlement.data.pendingClaims.length} claim(s) in this period are still pending approval and are not included.
                    </p>
                  )}
                  <p className="mb-3 text-sm text-slate-600">
                    Claims {fmtMoney(selectedTotal)} − advance {fmtMoney(data.advanceAmount)} ={' '}
                    <span className={`font-semibold ${net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {net >= 0 ? `pay employee ${fmtMoney(net)}` : `recover ${fmtMoney(-net)}`}
                    </span>
                  </p>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void act(() => api(`/travel/${id}/settle`, { method: 'POST', body: { claimIds: selectedClaims.map((c) => c.id) } }))
                    }
                  >
                    Settle trip
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function TravelTable({
  path, empty, withEmployee, canDecide, canSettle, canCancel,
}: { path: string; empty: string; withEmployee?: boolean; canDecide?: boolean; canSettle?: boolean; canCancel?: boolean }) {
  const { data, loading, error, reload } = useFetch<Travel[]>(path);
  const [open, setOpen] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const cancel = async (id: string) => {
    if (!window.confirm('Cancel this travel request?')) return;
    setActionError(null);
    try {
      await api(`/travel/${id}/cancel`, { method: 'POST' });
      reload();
    } catch (err) {
      setActionError(errMsg(err));
    }
  };

  return (
    <Card>
      <ErrorNote error={error ?? actionError} />
      {loading ? (
        <Spinner />
      ) : !data || data.length === 0 ? (
        <Empty message={empty} />
      ) : (
        <Table headers={[...(withEmployee ? ['Employee'] : []), 'Trip', 'Dates', 'Mode', 'Estimate', 'Advance', 'Status', '']}>
          {data.map((t) => (
            <tr key={t.id}>
              {withEmployee && <Td className="font-medium text-slate-900">{t.employee?.name}</Td>}
              <Td>
                <span className="font-medium text-slate-900">
                  {t.fromCity} → {t.toCity}
                </span>
                <span className="block max-w-56 truncate text-xs text-slate-400">{t.purpose}</span>
              </Td>
              <Td>
                {fmtDate(t.departDate)} – {fmtDate(t.returnDate)}
              </Td>
              <Td>{t.mode}</Td>
              <Td>{fmtMoney(t.estimatedCost)}</Td>
              <Td>
                {fmtMoney(t.advanceAmount)}
                {t.advanceToBePaid > 0 && <span className="block text-xs text-amber-600">to be paid</span>}
              </Td>
              <Td>
                <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                {t.settledOn && (
                  <span className="block text-xs text-slate-400">
                    settled {(t.settledAmount ?? 0) >= 0 ? 'pay' : 'recover'} {fmtMoney(Math.abs(t.settledAmount ?? 0))}
                  </span>
                )}
              </Td>
              <Td>
                <div className="flex gap-1">
                  <Button variant="ghost" onClick={() => setOpen(t.id)}>
                    {canDecide && t.status === 'PENDING' ? 'Review' : canSettle && t.status === 'APPROVED' && !t.settledOn ? 'Settle' : 'View'}
                  </Button>
                  {canCancel && t.status === 'PENDING' && (
                    <Button variant="ghost" onClick={() => void cancel(t.id)}>
                      Cancel
                    </Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {open && (
        <DetailModal id={open} onClose={() => setOpen(null)} canDecide={!!canDecide} canSettle={!!canSettle} onChanged={reload} />
      )}
    </Card>
  );
}

export default function TravelPage() {
  const { session, isManagerial, isCompanyAdmin } = useAuth();
  const tabs = [
    ...(session?.employee ? ['My trips'] : []),
    ...(isManagerial ? ['Approvals'] : []),
    ...(isCompanyAdmin ? ['Advances due', 'All trips'] : []),
  ];
  const [tab, setTab] = useState(tabs[0] ?? 'Approvals');
  const [applyOpen, setApplyOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const advances = useFetch<Travel[]>(isCompanyAdmin ? '/travel?scope=company&advancesDue=true' : null);

  return (
    <div>
      <PageHeader
        title="Travel"
        subtitle="Trip requests, approvals, advances and settlement"
        actions={session?.employee ? <Button onClick={() => setApplyOpen(true)}>+ New request</Button> : undefined}
      />
      {isCompanyAdmin && advances.data && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Advances to be paid" value={fmtMoney(advances.data.reduce((s, t) => s + t.advanceToBePaid, 0))} icon="wallet" />
          <Stat label="Trips awaiting settlement" value={advances.data.length} icon="plane" />
        </div>
      )}
      {tabs.length > 1 && <Tabs tabs={tabs} active={tab} onChange={setTab} />}
      {tab === 'My trips' && (
        <TravelTable key={`me-${version}`} path="/travel?scope=me" empty="No travel requests yet" canCancel />
      )}
      {tab === 'Approvals' && (
        <TravelTable path="/travel?scope=approvals" empty="Nothing waiting for approval 🎉" withEmployee canDecide />
      )}
      {tab === 'Advances due' && (
        <TravelTable path="/travel?scope=company&advancesDue=true" empty="No outstanding advances" withEmployee canSettle />
      )}
      {tab === 'All trips' && <TravelTable path="/travel?scope=company" empty="No travel requests" withEmployee canDecide canSettle />}
      {applyOpen && <ApplyModal onClose={() => setApplyOpen(false)} onDone={() => setVersion((v) => v + 1)} />}
    </div>
  );
}
