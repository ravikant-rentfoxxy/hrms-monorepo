'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, DatePicker, Empty, ErrorNote, Field, Input, Modal, PageHeader, Spinner, Table, Tabs, Td, Textarea,
  statusTone,
} from '@/components/ui';
import { EmployeeSelect, errText, humanize, useEmployees } from '@/components/lifecycle';

type Recommendation = 'CONFIRM' | 'EXTEND' | 'TERMINATE';

interface Confirmation {
  id: string;
  dueDate: string;
  recommendation: '' | Recommendation;
  extendByDays: number;
  comments: string;
  status: string;
  decidedAt: string | null;
  createdAt: string;
  awaiting: 'RECOMMENDATION' | 'APPROVAL' | null;
  canDecide: boolean;
  employee: {
    id: string;
    name: string;
    employeeCode: string;
    designation: string;
    department: string;
    joiningDate: string;
    probationEndDate: string | null;
    confirmedOn: string | null;
    managerId: string | null;
    manager: { id: string; name: string } | null;
  };
}

const recTone = (r: string) => (r === 'CONFIRM' ? 'green' : r === 'EXTEND' ? 'amber' : r === 'TERMINATE' ? 'red' : 'slate');

const OPTIONS: { value: Recommendation; title: string; hint: string }[] = [
  { value: 'CONFIRM', title: 'Confirm', hint: 'Performance meets expectations — confirm employment' },
  { value: 'EXTEND', title: 'Extend probation', hint: 'Needs more time — extend by a number of days' },
  { value: 'TERMINATE', title: 'Do not confirm', hint: 'Separate the employee (exit is created on approval)' },
];

function RecommendModal({ item, onClose, onDone }: { item: Confirmation; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState<{ recommendation: Recommendation; extendByDays: string; comments: string }>({
    recommendation: 'CONFIRM',
    extendByDays: '30',
    comments: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await api(`/confirmations/${item.id}/recommend`, {
        method: 'POST',
        body: {
          recommendation: form.recommendation,
          comments: form.comments,
          ...(form.recommendation === 'EXTEND' ? { extendByDays: Number(form.extendByDays) } : {}),
        },
      });
      onDone();
      onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Probation review — ${item.employee.name}`} open onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-ink-500">
          Joined {fmtDate(item.employee.joiningDate)} · probation ends {fmtDate(item.employee.probationEndDate)}
        </p>
        <ErrorNote error={error} />
        <div className="space-y-2">
          {OPTIONS.map((o) => (
            <label
              key={o.value}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-2.5 ${
                form.recommendation === o.value ? 'border-brand-400 bg-brand-50/50' : 'border-ink-200'
              }`}
            >
              <input
                type="radio"
                className="mt-1"
                checked={form.recommendation === o.value}
                onChange={() => setForm({ ...form, recommendation: o.value })}
              />
              <span>
                <span className="block text-sm font-medium text-ink-900">{o.title}</span>
                <span className="block text-xs text-ink-400">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {form.recommendation === 'EXTEND' && (
          <Field label="Extend by (days)">
            <Input type="number" min={1} max={365} value={form.extendByDays} onChange={(e) => setForm({ ...form, extendByDays: e.target.value })} />
          </Field>
        )}
        <Field label="Comments" hint="Performance summary — shared with HR">
          <Textarea rows={4} value={form.comments} onChange={(e) => setForm({ ...form, comments: e.target.value })} />
        </Field>
        <Button onClick={() => void submit()} disabled={busy || form.comments.trim().length < 3} className="w-full">
          {busy ? 'Submitting…' : 'Submit recommendation'}
        </Button>
      </div>
    </Modal>
  );
}

function RaiseModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const employees = useEmployees();
  const [employeeId, setEmployeeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await api('/confirmations', { method: 'POST', body: { employeeId, ...(dueDate ? { dueDate } : {}) } });
      onDone();
      onClose();
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <Modal title="Raise a confirmation review" open onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-ink-500">
          Reviews are raised automatically 15 days before an employee&apos;s probation end date. Use this to start one
          early or for employees without a probation date.
        </p>
        <ErrorNote error={error} />
        <Field label="Employee">
          <EmployeeSelect employees={employees} value={employeeId} onChange={setEmployeeId} />
        </Field>
        <Field label="Due date" hint="Defaults to the probation end date">
          <DatePicker value={dueDate} onChange={setDueDate} clearable />
        </Field>
        <Button onClick={() => void submit()} disabled={!employeeId} className="w-full">
          Raise review
        </Button>
      </div>
    </Modal>
  );
}

export default function ConfirmationsPage() {
  const { isCompanyAdmin } = useAuth();
  const [tab, setTab] = useState('Pending');
  const status = tab === 'Pending' ? 'PENDING' : tab === 'Approved' ? 'APPROVED' : 'REJECTED';
  const { data, loading, error, reload } = useFetch<Confirmation[]>(`/confirmations?status=${status}`);
  const [recommending, setRecommending] = useState<Confirmation | null>(null);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const decide = async (c: Confirmation, decision: 'APPROVED' | 'REJECTED') => {
    setActionError(null);
    const remarks = decision === 'REJECTED' ? window.prompt('Reason for rejecting the recommendation?') ?? undefined : undefined;
    if (decision === 'REJECTED' && remarks === undefined) return;
    try {
      await api(`/confirmations/${c.id}/decide`, { method: 'POST', body: { decision, ...(remarks ? { remarks } : {}) } });
      reload();
    } catch (err) {
      setActionError(errText(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Probation confirmations"
        subtitle="Manager recommends, HR approves — confirmation letters are issued automatically"
        actions={isCompanyAdmin ? <Button onClick={() => setRaiseOpen(true)}>+ Raise review</Button> : undefined}
      />
      <Tabs tabs={['Pending', 'Approved', 'Rejected']} active={tab} onChange={setTab} />
      <ErrorNote error={actionError ?? error} />
      <Card className={actionError || error ? 'mt-3' : ''}>
        {loading ? (
          <Spinner />
        ) : !data || data.length === 0 ? (
          <Empty message={tab === 'Pending' ? 'No probation reviews due' : 'Nothing here yet'} />
        ) : (
          <Table headers={['Employee', 'Manager', 'Joined', 'Probation ends', 'Recommendation', 'Status', '']}>
            {data.map((c) => (
              <tr key={c.id}>
                <Td>
                  <p className="font-medium text-ink-900">{c.employee.name}</p>
                  <p className="text-xs text-ink-400">
                    {c.employee.employeeCode} · {c.employee.designation || '—'}
                  </p>
                </Td>
                <Td>{c.employee.manager?.name ?? '—'}</Td>
                <Td>{fmtDate(c.employee.joiningDate)}</Td>
                <Td>{fmtDate(c.employee.probationEndDate ?? c.dueDate)}</Td>
                <Td>
                  {c.recommendation ? (
                    <div>
                      <Badge tone={recTone(c.recommendation)}>
                        {humanize(c.recommendation)}
                        {c.recommendation === 'EXTEND' ? ` +${c.extendByDays}d` : ''}
                      </Badge>
                      {c.comments && <p className="mt-1 max-w-56 truncate text-xs text-ink-400" title={c.comments}>{c.comments}</p>}
                    </div>
                  ) : (
                    <span className="text-xs text-ink-400">Awaiting manager</span>
                  )}
                </Td>
                <Td>
                  <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                  {c.decidedAt && <span className="block text-xs text-ink-400">{fmtDate(c.decidedAt)}</span>}
                </Td>
                <Td>
                  {c.status === 'PENDING' && c.awaiting === 'RECOMMENDATION' && (
                    <Button variant="secondary" onClick={() => setRecommending(c)}>
                      Recommend
                    </Button>
                  )}
                  {c.status === 'PENDING' && c.canDecide && (
                    <div className="flex gap-2">
                      <Button onClick={() => void decide(c, 'APPROVED')}>Approve</Button>
                      <Button variant="danger" onClick={() => void decide(c, 'REJECTED')}>
                        Reject
                      </Button>
                    </div>
                  )}
                  {c.status === 'PENDING' && c.awaiting === 'APPROVAL' && !c.canDecide && (
                    <span className="text-xs text-ink-400">With approver</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {recommending && <RecommendModal item={recommending} onClose={() => setRecommending(null)} onDone={reload} />}
      {raiseOpen && <RaiseModal onClose={() => setRaiseOpen(false)} onDone={reload} />}
    </div>
  );
}
