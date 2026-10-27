'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate, fmtMoney, fmtTime } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, DatePicker, Empty, ErrorNote, Field, Icon, Input, LongText, Modal, PageHeader, Select, Spinner, Table, Tabs, Td,
  Textarea, statusTone,
} from '@/components/ui';

interface OvertimeRequest {
  id: string;
  date: string;
  minutes: number;
  reason: string;
  status: string;
  remarks: string | null;
  appliedOn: string;
  paidInMonth: string | null;
  employee: { id: string; name: string; employeeCode: string; department: string };
  attendance: { workedMinutes: number | null; overtimeMinutes: number; checkIn: string | null; checkOut: string | null; status: string } | null;
  currentLevel: number | null;
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

interface Detail extends OvertimeRequest {
  trail: TrailStep[];
  payrollInput: { amount: number; month: string; label: string } | null;
}

const hm = (m: number | null | undefined) => (m == null ? '—' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);

export default function OvertimePage() {
  const { session, isManagerial, isCompanyAdmin } = useAuth();
  const tabs = [
    ...(session?.employee ? ['My requests'] : []),
    ...(isManagerial ? ['Team'] : []),
    ...(isCompanyAdmin ? ['Company'] : []),
  ];
  const [tab, setTab] = useState(tabs[0] ?? 'My requests');
  const [status, setStatus] = useState('');
  const scope = tab === 'Team' ? 'team' : tab === 'Company' ? 'company' : 'me';
  const list = useFetch<OvertimeRequest[]>(`/overtime?scope=${scope}${status ? `&status=${status}` : ''}`);
  const [newOpen, setNewOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openDetail = async (id: string) => {
    setError(null);
    try {
      setDetail(await api<Detail>(`/overtime/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const decide = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    const remarks = decision === 'REJECTED' ? (prompt('Reason for rejection (optional)') ?? undefined) : undefined;
    setError(null);
    try {
      await api(`/overtime/${id}/decide`, { method: 'POST', body: { decision, remarks } });
      list.reload();
      if (detail?.id === id) await openDetail(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const cancel = async (id: string) => {
    if (!confirm('Cancel this overtime request?')) return;
    try {
      await api(`/overtime/${id}/cancel`, { method: 'POST' });
      list.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const mine = scope === 'me';
  const totalApproved = (list.data ?? []).filter((r) => r.status === 'APPROVED').reduce((s, r) => s + r.minutes, 0);
  const pending = (list.data ?? []).filter((r) => r.status === 'PENDING').length;

  return (
    <div>
      <PageHeader
        title="Overtime"
        subtitle="Requests are raised automatically at check-out (30+ min) or by the employee; approved overtime is paid at 2× in payroll"
        actions={
          session?.employee ? (
            <Button onClick={() => setNewOpen(true)}>
              <Icon name="plus" className="h-4 w-4" /> Claim overtime
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        {tabs.length > 1 ? <Tabs tabs={tabs} active={tab} onChange={setTab} /> : <div />}
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-500">
            {pending} pending · {hm(totalApproved)} approved
          </span>
          <div className="w-40">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>
      {error && (
        <div className="mb-4">
          <ErrorNote error={error} />
        </div>
      )}

      <Card>
        {list.loading ? (
          <Spinner />
        ) : list.error ? (
          <div className="p-4">
            <ErrorNote error={list.error} />
          </div>
        ) : !list.data || list.data.length === 0 ? (
          <Empty message="No overtime requests" />
        ) : (
          <Table headers={[...(mine ? [] : ['Employee']), 'Date', 'Overtime', 'Punches', 'Reason', 'Status', '']}>
            {list.data.map((r) => (
              <tr key={r.id}>
                {!mine && (
                  <Td className="font-medium text-ink-900">
                    {r.employee.name}
                    <p className="text-xs font-normal text-ink-400">{r.employee.department || r.employee.employeeCode}</p>
                  </Td>
                )}
                <Td>{fmtDate(r.date)}</Td>
                <Td className="font-medium text-ink-900">{hm(r.minutes)}</Td>
                <Td>
                  {r.attendance?.checkIn ? (
                    <span className="text-xs">
                      {fmtTime(r.attendance.checkIn)} → {fmtTime(r.attendance.checkOut)}
                      <br />
                      <span className="text-ink-400">
                        worked {hm(r.attendance.workedMinutes)} · OT {hm(r.attendance.overtimeMinutes)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-xs text-ink-400">no punch</span>
                  )}
                </Td>
                <Td>
                  <LongText text={r.reason} />
                </Td>
                <Td>
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  {r.status === 'PENDING' && r.currentLevel && r.currentLevel > 1 && (
                    <span className="ml-1 text-xs text-ink-400">level {r.currentLevel}</span>
                  )}
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    {!mine && r.status === 'PENDING' && r.employee.id !== session?.employee?.id && (
                      <>
                        <Button onClick={() => void decide(r.id, 'APPROVED')}>Approve</Button>
                        <Button variant="danger" onClick={() => void decide(r.id, 'REJECTED')}>
                          Reject
                        </Button>
                      </>
                    )}
                    {mine && r.status === 'PENDING' && (
                      <Button variant="ghost" onClick={() => void cancel(r.id)}>
                        Cancel
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => void openDetail(r.id)}>
                      Trail
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <NewOvertimeModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onDone={() => {
          setNewOpen(false);
          list.reload();
        }}
      />

      <Modal title="Overtime request" open={!!detail} onClose={() => setDetail(null)}>
        {detail && (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-ink-900">{detail.employee.name}</p>
                <p className="text-sm text-ink-500">
                  {fmtDate(detail.date)} · {hm(detail.minutes)}
                </p>
              </div>
              <Badge tone={statusTone(detail.status)}>{detail.status}</Badge>
            </div>
            {detail.reason && <p className="rounded-xl bg-ink-50 px-3 py-2 text-sm text-ink-600">{detail.reason}</p>}
            {detail.payrollInput && (
              <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {detail.payrollInput.label}: <b>{fmtMoney(detail.payrollInput.amount)}</b> in{' '}
                {new Date(detail.payrollInput.month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })} payroll
              </p>
            )}
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Approval trail</p>
              {detail.trail.length === 0 ? (
                <p className="text-sm text-ink-400">No approval steps</p>
              ) : (
                <ol className="space-y-2">
                  {detail.trail.map((s) => (
                    <li key={s.id} className="flex items-start gap-3 rounded-xl border border-ink-100 px-3 py-2">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-600">
                        {s.level}
                      </span>
                      <div className="flex-1 text-sm">
                        <p className="text-ink-800">
                          {s.approverName ?? 'Approver'} <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                        </p>
                        {s.actedAt && (
                          <p className="text-xs text-ink-400">
                            {s.actedByName ? `${s.actedByName} · ` : ''}
                            {fmtDate(s.actedAt)} {fmtTime(s.actedAt)}
                          </p>
                        )}
                        {s.remarks && <p className="text-xs text-ink-500">“{s.remarks}”</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function NewOvertimeModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState('1');
  const [mins, setMins] = useState('0');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const minutes = (Number(hours) || 0) * 60 + (Number(mins) || 0);
    if (minutes <= 0) return setError('Enter the overtime duration');
    setError(null);
    setBusy(true);
    try {
      await api('/overtime', { method: 'POST', body: { date, minutes, reason } });
      setReason('');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Claim overtime" open={open} onClose={onClose}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <Field label="Date">
          <DatePicker value={date} onChange={setDate} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hours">
            <Input type="number" min={0} max={16} value={hours} onChange={(e) => setHours(e.target.value)} />
          </Field>
          <Field label="Minutes">
            <Input type="number" min={0} max={59} value={mins} onChange={(e) => setMins(e.target.value)} />
          </Field>
        </div>
        <Field label="Reason">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Release deployment, month-end close…" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || reason.trim().length < 3}>
            Submit
          </Button>
        </div>
      </div>
    </Modal>
  );
}
