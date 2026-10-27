'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate, fmtMoney } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, DatePicker, Empty, ErrorNote, Field, Input, LongText, Modal, PageHeader, Select, Spinner, Table, Tabs, Td,
  Textarea, statusTone,
} from '@/components/ui';
import {
  BalanceCards, LeaveNav, Trail, fmtDays, waitingOn,
  type Balance, type CompOffRequest, type Encashment, type LeaveRequest, type LeaveType, type TrailStep,
} from './leave-common';

interface Preview {
  ok: boolean;
  days: number;
  available: number | null;
  balanceAfter: number | null;
  holidays: string[];
  error: string | null;
}

/* ------------------------------- Apply leave ------------------------------- */

function ApplyModal({ types, onClose, onDone }: { types: LeaveType[]; onClose: () => void; onDone: () => void }) {
  const usable = types.filter((t) => t.isActive);
  const [form, setForm] = useState({ leaveTypeId: usable[0]?.id ?? '', fromDate: '', toDate: '', halfDay: false, reason: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const type = usable.find((t) => t.id === form.leaveTypeId);
  const singleDay = !!form.fromDate && form.fromDate === form.toDate;

  // Server-side dry run so the employee sees policy errors and the real day count before submitting.
  useEffect(() => {
    if (!form.leaveTypeId || !form.fromDate || !form.toDate) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api<Preview>('/leaves/preview', {
        method: 'POST',
        body: { leaveTypeId: form.leaveTypeId, fromDate: form.fromDate, toDate: form.toDate, halfDay: form.halfDay && singleDay },
      })
        .then((p) => !cancelled && setPreview(p))
        .catch(() => !cancelled && setPreview(null));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [form.leaveTypeId, form.fromDate, form.toDate, form.halfDay, singleDay]);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await api('/leaves', { method: 'POST', body: { ...form, halfDay: form.halfDay && singleDay } });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const rules = type
    ? [
        type.minNoticeDays > 0 && `${type.minNoticeDays} day(s) notice`,
        type.maxConsecutive > 0 && `max ${type.maxConsecutive} day(s) at a time`,
        !type.allowHalfDay && 'no half days',
        type.sandwichRule && 'weekends/holidays in between count',
        type.allowNegative && `may go ${type.maxNegative} day(s) negative`,
        !type.isPaid && 'unpaid',
      ].filter(Boolean)
    : [];

  return (
    <Modal title="Apply for leave" open onClose={onClose}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <Field label="Leave type">
          <Select value={form.leaveTypeId} onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value, halfDay: false })}>
            {usable.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.code})
              </option>
            ))}
          </Select>
        </Field>
        {rules.length > 0 && <p className="text-xs text-ink-500">Policy: {rules.join(' · ')}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <DatePicker value={form.fromDate} onChange={(v) => setForm({ ...form, fromDate: v, toDate: form.toDate && form.toDate >= v ? form.toDate : v })} />
          </Field>
          <Field label="To">
            <DatePicker value={form.toDate} onChange={(v) => setForm({ ...form, toDate: v })} />
          </Field>
        </div>
        {singleDay && type?.allowHalfDay && (
          <label className="flex items-center gap-2 text-sm text-ink-600">
            <input type="checkbox" checked={form.halfDay} onChange={(e) => setForm({ ...form, halfDay: e.target.checked })} />
            Half day
          </label>
        )}
        {preview && form.fromDate && form.toDate && (
          <div
            className={`rounded-xl border px-3.5 py-2.5 text-sm ${
              preview.ok ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-amber-100 bg-amber-50 text-amber-800'
            }`}
          >
            {preview.ok ? (
              <>
                {fmtDays(preview.days)} day(s) of leave · balance after: {fmtDays(preview.balanceAfter ?? 0)}
                {preview.holidays.length > 0 && <span className="block text-xs">Holidays excluded: {preview.holidays.join(', ')}</span>}
              </>
            ) : (
              preview.error
            )}
          </div>
        )}
        <Field label="Reason">
          <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </Field>
        <Button
          onClick={() => void submit()}
          disabled={busy || !form.fromDate || !form.toDate || form.reason.trim().length < 3 || preview?.ok === false}
          className="w-full"
        >
          Submit request
        </Button>
      </div>
    </Modal>
  );
}

/* ------------------------------ Comp-off / encash ------------------------------ */

function CompOffModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ workDate: '', days: '1', reason: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await api('/leaves/comp-off', { method: 'POST', body: { ...form, days: Number(form.days) } });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Request comp-off" open onClose={onClose}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <p className="text-sm text-ink-500">
          Claim a day off for a weekend or company holiday you worked. You must have checked in on that day.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Day worked">
            <DatePicker value={form.workDate} onChange={(v) => setForm({ ...form, workDate: v })} />
          </Field>
          <Field label="Credit">
            <Select value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })}>
              <option value="1">Full day</option>
              <option value="0.5">Half day</option>
            </Select>
          </Field>
        </div>
        <Field label="What did you work on?">
          <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </Field>
        <Button onClick={() => void submit()} disabled={busy || !form.workDate || form.reason.trim().length < 3} className="w-full">
          Submit request
        </Button>
      </div>
    </Modal>
  );
}

function EncashModal({ balances, onClose, onDone }: { balances: Balance[]; onClose: () => void; onDone: () => void }) {
  const eligible = balances.filter((b) => b.leaveType.encashable && b.available > 0);
  const [form, setForm] = useState({ leaveTypeId: eligible[0]?.leaveType.id ?? '', days: '1', reason: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const b = eligible.find((x) => x.leaveType.id === form.leaveTypeId);
  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await api('/leaves/encashments', {
        method: 'POST',
        body: { leaveTypeId: form.leaveTypeId, days: Number(form.days), reason: form.reason || undefined },
      });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Encash leave" open onClose={onClose}>
      {eligible.length === 0 ? (
        <Empty message="You have no encashable leave balance" />
      ) : (
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Leave type">
            <Select value={form.leaveTypeId} onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}>
              {eligible.map((x) => (
                <option key={x.leaveType.id} value={x.leaveType.id}>
                  {x.leaveType.name} — {fmtDays(x.available)} available
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Days"
            hint={
              b
                ? `Up to ${fmtDays(b.leaveType.maxEncashDays > 0 ? Math.min(b.available, b.leaveType.maxEncashDays) : b.available)} day(s). Paid at basic ÷ 26 per day with payroll.`
                : undefined
            }
          >
            <Input type="number" min="0.5" step="0.5" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
          </Field>
          <Field label="Note (optional)">
            <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
          <Button onClick={() => void submit()} disabled={busy || !form.leaveTypeId || !(Number(form.days) > 0)} className="w-full">
            Submit request
          </Button>
        </div>
      )}
    </Modal>
  );
}

/* --------------------------------- Decide --------------------------------- */

function DecideModal({
  title,
  summary,
  steps,
  path,
  onClose,
  onDone,
}: {
  title: string;
  summary: React.ReactNode;
  steps?: TrailStep[];
  path: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decide = async (decision: 'APPROVED' | 'REJECTED') => {
    setError(null);
    setBusy(true);
    try {
      await api(path, { method: 'POST', body: { decision, remarks: remarks || undefined } });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={title} open onClose={onClose}>
      <div className="space-y-4">
        <ErrorNote error={error} />
        <div className="text-sm text-ink-700">{summary}</div>
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Approval trail</p>
          <Trail steps={steps} />
        </div>
        <Field label="Remarks (optional)">
          <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button onClick={() => void decide('APPROVED')} disabled={busy} className="flex-1">
            Approve
          </Button>
          <Button variant="danger" onClick={() => void decide('REJECTED')} disabled={busy} className="flex-1">
            Reject
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DetailModal({ request, onClose }: { request: LeaveRequest; onClose: () => void }) {
  return (
    <Modal title={`${request.leaveType.name} · ${fmtDays(request.days)} day(s)`} open onClose={onClose}>
      <div className="space-y-4 text-sm text-ink-700">
        <div className="flex items-center gap-2">
          <Badge tone={statusTone(request.status)}>{request.status}</Badge>
          {request.employee && <span className="font-medium">{request.employee.name}</span>}
        </div>
        <p>
          {fmtDate(request.fromDate)} → {fmtDate(request.toDate)}
          {request.halfDay && ' (half day)'}
        </p>
        <p className="text-ink-500">{request.reason}</p>
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Approval trail</p>
          <Trail steps={request.approvalSteps} />
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------------- Page ---------------------------------- */

const SCOPES = ['Awaiting me', 'All pending'] as const;

export default function LeavesPage() {
  const { session, isManagerial, isCompanyAdmin } = useAuth();
  const hasEmployee = !!session?.employee;
  const [tab, setTab] = useState(hasEmployee ? 'My leaves' : 'Approvals');
  const [approvalScope, setApprovalScope] = useState<(typeof SCOPES)[number]>('Awaiting me');
  const tabs = [
    ...(hasEmployee ? ['My leaves'] : []),
    ...(isManagerial ? ['Approvals'] : []),
    'Comp-off',
    'Encashment',
  ];
  const pendingScope = approvalScope === 'Awaiting me' ? 'approvals' : isCompanyAdmin ? 'company' : 'team';

  const types = useFetch<LeaveType[]>('/leaves/types');
  const balances = useFetch<Balance[]>(hasEmployee ? '/leaves/balance' : null);
  const mine = useFetch<LeaveRequest[]>(tab === 'My leaves' ? '/leaves?scope=me' : null);
  const approvals = useFetch<LeaveRequest[]>(tab === 'Approvals' ? `/leaves?status=PENDING&scope=${pendingScope}` : null);
  const compOffMine = useFetch<CompOffRequest[]>(tab === 'Comp-off' && hasEmployee ? '/leaves/comp-off?scope=me' : null);
  const compOffPending = useFetch<CompOffRequest[]>(
    tab === 'Comp-off' && isManagerial ? `/leaves/comp-off?status=PENDING&scope=${pendingScope}` : null
  );
  const encMine = useFetch<Encashment[]>(tab === 'Encashment' && hasEmployee ? '/leaves/encashments?scope=me' : null);
  const encPending = useFetch<Encashment[]>(
    tab === 'Encashment' && isManagerial ? `/leaves/encashments?status=PENDING&scope=${pendingScope}` : null
  );

  const [modal, setModal] = useState<'apply' | 'compoff' | 'encash' | null>(null);
  const [detail, setDetail] = useState<LeaveRequest | null>(null);
  const [deciding, setDeciding] = useState<
    | { kind: 'leave'; r: LeaveRequest }
    | { kind: 'compoff'; r: CompOffRequest }
    | { kind: 'encash'; r: Encashment }
    | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>, after: () => void) => {
    setActionError(null);
    try {
      await fn();
      after();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const cancelLeave = (id: string) =>
    run(() => api(`/leaves/${id}/cancel`, { method: 'POST' }), () => {
      mine.reload();
      balances.reload();
    });

  const scopeToggle = isManagerial && (
    <div className="mb-3 flex gap-2">
      {SCOPES.map((s) => (
        <Button key={s} variant={approvalScope === s ? 'secondary' : 'ghost'} onClick={() => setApprovalScope(s)}>
          {s}
        </Button>
      ))}
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Leaves"
        subtitle="Requests, approvals, comp-off and encashment"
        actions={
          hasEmployee ? (
            <>
              <Button variant="secondary" onClick={() => setModal('compoff')}>
                Comp-off
              </Button>
              <Button variant="secondary" onClick={() => setModal('encash')} disabled={!balances.data}>
                Encash
              </Button>
              <Button onClick={() => setModal('apply')}>+ Apply leave</Button>
            </>
          ) : undefined
        }
      />
      <LeaveNav />

      {balances.data && <BalanceCards balances={balances.data} />}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="mb-3">
        <ErrorNote error={actionError} />
      </div>

      {tab === 'My leaves' && (
        <Card>
          {mine.loading ? (
            <Spinner />
          ) : !mine.data || mine.data.length === 0 ? (
            <Empty message="No leave requests yet" />
          ) : (
            <Table headers={['Type', 'Dates', 'Days', 'Reason', 'Status', 'Approval', '']}>
              {mine.data.map((r) => (
                <tr key={r.id} className="cursor-pointer" onClick={() => setDetail(r)}>
                  <Td>
                    <Badge tone="violet">{r.leaveType.code}</Badge>
                  </Td>
                  <Td>
                    {fmtDate(r.fromDate)} → {fmtDate(r.toDate)}
                    {r.halfDay && ' (half)'}
                  </Td>
                  <Td>{fmtDays(r.days)}</Td>
                  <Td>
                  <LongText text={r.reason} />
                </Td>
                  <Td>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </Td>
                  <Td className="text-xs text-ink-500">{waitingOn(r.approvalSteps) ?? r.approver?.name ?? '—'}</Td>
                  <Td>
                    {(r.status === 'PENDING' || r.status === 'APPROVED') && (
                      <span onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" onClick={() => void cancelLeave(r.id)}>
                          Cancel
                        </Button>
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'Approvals' && (
        <>
          {scopeToggle}
          <Card>
            {approvals.loading ? (
              <Spinner />
            ) : !approvals.data || approvals.data.length === 0 ? (
              <Empty message="Nothing waiting for approval 🎉" />
            ) : (
              <Table headers={['Employee', 'Type', 'Dates', 'Days', 'Reason', 'Waiting on', '']}>
                {approvals.data.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium text-ink-900">{r.employee?.name}</Td>
                    <Td>
                      <Badge tone="violet">{r.leaveType.code}</Badge>
                    </Td>
                    <Td>
                      {fmtDate(r.fromDate)} → {fmtDate(r.toDate)}
                      {r.halfDay && ' (half)'}
                    </Td>
                    <Td>{fmtDays(r.days)}</Td>
                    <Td>
                  <LongText text={r.reason} />
                </Td>
                    <Td className="text-xs text-ink-500">{waitingOn(r.approvalSteps) ?? 'Reporting manager'}</Td>
                    <Td>
                      <Button onClick={() => setDeciding({ kind: 'leave', r })}>Review</Button>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}

      {tab === 'Comp-off' && (
        <div className="space-y-4">
          {isManagerial && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-ink-700">Pending approval</h2>
              {scopeToggle}
              <Card>
                {compOffPending.loading ? (
                  <Spinner />
                ) : !compOffPending.data || compOffPending.data.length === 0 ? (
                  <Empty message="No comp-off requests waiting" />
                ) : (
                  <Table headers={['Employee', 'Day worked', 'Credit', 'Reason', 'Waiting on', '']}>
                    {compOffPending.data.map((r) => (
                      <tr key={r.id}>
                        <Td className="font-medium text-ink-900">{r.employee?.name}</Td>
                        <Td>{fmtDate(r.workDate)}</Td>
                        <Td>{fmtDays(r.days)} day</Td>
                        <Td>
                  <LongText text={r.reason} />
                </Td>
                        <Td className="text-xs text-ink-500">{waitingOn(r.approvalSteps) ?? 'Reporting manager'}</Td>
                        <Td>
                          <Button onClick={() => setDeciding({ kind: 'compoff', r })}>Review</Button>
                        </Td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>
            </div>
          )}
          {hasEmployee && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-ink-700">My comp-off requests</h2>
              <Card>
                {compOffMine.loading ? (
                  <Spinner />
                ) : !compOffMine.data || compOffMine.data.length === 0 ? (
                  <Empty message="No comp-off requests yet" />
                ) : (
                  <Table headers={['Day worked', 'Credit', 'Reason', 'Status', 'Approval', '']}>
                    {compOffMine.data.map((r) => (
                      <tr key={r.id}>
                        <Td>{fmtDate(r.workDate)}</Td>
                        <Td>{fmtDays(r.days)} day</Td>
                        <Td>
                  <LongText text={r.reason} />
                </Td>
                        <Td>
                          <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                        </Td>
                        <Td className="text-xs text-ink-500">{waitingOn(r.approvalSteps) ?? r.remarks ?? '—'}</Td>
                        <Td>
                          {r.status === 'PENDING' && (
                            <Button
                              variant="ghost"
                              onClick={() => void run(() => api(`/leaves/comp-off/${r.id}/cancel`, { method: 'POST' }), compOffMine.reload)}
                            >
                              Withdraw
                            </Button>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>
            </div>
          )}
        </div>
      )}

      {tab === 'Encashment' && (
        <div className="space-y-4">
          {isManagerial && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-ink-700">Pending approval</h2>
              {scopeToggle}
              <Card>
                {encPending.loading ? (
                  <Spinner />
                ) : !encPending.data || encPending.data.length === 0 ? (
                  <Empty message="No encashment requests waiting" />
                ) : (
                  <Table headers={['Employee', 'Type', 'Days', 'Est. amount', 'Waiting on', '']}>
                    {encPending.data.map((r) => (
                      <tr key={r.id}>
                        <Td className="font-medium text-ink-900">{r.employee?.name}</Td>
                        <Td>
                          <Badge tone="violet">{r.leaveType.code}</Badge>
                        </Td>
                        <Td>{fmtDays(r.days)}</Td>
                        <Td>{fmtMoney(r.amount)}</Td>
                        <Td className="text-xs text-ink-500">{waitingOn(r.approvalSteps) ?? 'Reporting manager'}</Td>
                        <Td>
                          <Button onClick={() => setDeciding({ kind: 'encash', r })}>Review</Button>
                        </Td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>
            </div>
          )}
          {hasEmployee && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-ink-700">My encashments</h2>
              <Card>
                {encMine.loading ? (
                  <Spinner />
                ) : !encMine.data || encMine.data.length === 0 ? (
                  <Empty message="No encashment requests yet" />
                ) : (
                  <Table headers={['Applied', 'Type', 'Days', 'Amount', 'Status', 'Payroll month', '']}>
                    {encMine.data.map((r) => (
                      <tr key={r.id}>
                        <Td>{fmtDate(r.appliedOn)}</Td>
                        <Td>
                          <Badge tone="violet">{r.leaveType.code}</Badge>
                        </Td>
                        <Td>{fmtDays(r.days)}</Td>
                        <Td>{fmtMoney(r.amount)}</Td>
                        <Td>
                          <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                        </Td>
                        <Td>
                          {r.paidInMonth
                            ? new Date(r.paidInMonth).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
                            : (waitingOn(r.approvalSteps) ?? '—')}
                        </Td>
                        <Td>
                          {r.status === 'PENDING' && (
                            <Button
                              variant="ghost"
                              onClick={() =>
                                void run(() => api(`/leaves/encashments/${r.id}/cancel`, { method: 'POST' }), () => {
                                  encMine.reload();
                                  balances.reload();
                                })
                              }
                            >
                              Withdraw
                            </Button>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>
            </div>
          )}
        </div>
      )}

      {modal === 'apply' && types.data && (
        <ApplyModal
          types={types.data}
          onClose={() => setModal(null)}
          onDone={() => {
            mine.reload();
            balances.reload();
          }}
        />
      )}
      {modal === 'compoff' && (
        <CompOffModal
          onClose={() => setModal(null)}
          onDone={() => {
            setTab('Comp-off');
            compOffMine.reload();
          }}
        />
      )}
      {modal === 'encash' && balances.data && (
        <EncashModal
          balances={balances.data}
          onClose={() => setModal(null)}
          onDone={() => {
            setTab('Encashment');
            encMine.reload();
            balances.reload();
          }}
        />
      )}
      {detail && <DetailModal request={detail} onClose={() => setDetail(null)} />}
      {deciding?.kind === 'leave' && (
        <DecideModal
          title="Leave request"
          path={`/leaves/${deciding.r.id}/decide`}
          steps={deciding.r.approvalSteps}
          summary={
            <>
              <p className="font-medium text-ink-900">
                {deciding.r.employee?.name} · {deciding.r.leaveType.name}
              </p>
              <p>
                {fmtDate(deciding.r.fromDate)} → {fmtDate(deciding.r.toDate)} · {fmtDays(deciding.r.days)} day(s)
                {deciding.r.halfDay && ' (half day)'}
              </p>
              <p className="mt-1 text-ink-500">{deciding.r.reason}</p>
            </>
          }
          onClose={() => setDeciding(null)}
          onDone={approvals.reload}
        />
      )}
      {deciding?.kind === 'compoff' && (
        <DecideModal
          title="Comp-off request"
          path={`/leaves/comp-off/${deciding.r.id}/decide`}
          steps={deciding.r.approvalSteps}
          summary={
            <>
              <p className="font-medium text-ink-900">{deciding.r.employee?.name}</p>
              <p>
                Worked on {fmtDate(deciding.r.workDate)} · {fmtDays(deciding.r.days)} day credit
              </p>
              <p className="mt-1 text-ink-500">{deciding.r.reason}</p>
            </>
          }
          onClose={() => setDeciding(null)}
          onDone={compOffPending.reload}
        />
      )}
      {deciding?.kind === 'encash' && (
        <DecideModal
          title="Leave encashment"
          path={`/leaves/encashments/${deciding.r.id}/decide`}
          steps={deciding.r.approvalSteps}
          summary={
            <>
              <p className="font-medium text-ink-900">
                {deciding.r.employee?.name} · {deciding.r.leaveType.name}
              </p>
              <p>
                {fmtDays(deciding.r.days)} day(s) · approx. {fmtMoney(deciding.r.amount)} (basic ÷ 26 per day, recomputed on
                approval)
              </p>
            </>
          }
          onClose={() => setDeciding(null)}
          onDone={encPending.reload}
        />
      )}
    </div>
  );
}
