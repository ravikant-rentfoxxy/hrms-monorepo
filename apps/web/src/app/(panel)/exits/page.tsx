'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, DatePicker, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Stat, Table, Tabs, Td,
  Textarea,
} from '@/components/ui';
import { EmployeeSelect, errText, humanize, useEmployees } from '@/components/lifecycle';
import { type ExitRow, ExitStatusBadge, StageBar, clearanceTone, exitStatusLabel } from './exit-ui';

function ResignModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ reason: '', requestedLastDay: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await api('/exits', {
        method: 'POST',
        body: { reason: form.reason, ...(form.requestedLastDay ? { requestedLastDay: form.requestedLastDay } : {}) },
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
    <Modal title="Submit resignation" open onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-500">
          Your resignation goes to your manager / HR for approval. You can withdraw it while it is pending.
        </p>
        <ErrorNote error={error} />
        <Field label="Reason">
          <Textarea rows={4} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </Field>
        <Field label="Requested last working day" hint="Leave blank to serve your full notice period">
          <DatePicker value={form.requestedLastDay} onChange={(v) => setForm({ ...form, requestedLastDay: v })} clearable />
        </Field>
        <Button variant="danger" onClick={() => void submit()} disabled={busy || form.reason.trim().length < 3} className="w-full">
          {busy ? 'Submitting…' : 'Submit resignation'}
        </Button>
      </div>
    </Modal>
  );
}

function InitiateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const employees = useEmployees();
  const [form, setForm] = useState({ employeeId: '', exitType: 'TERMINATION', reason: '', lastWorkingDay: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await api('/exits/initiate', { method: 'POST', body: form });
      onDone();
      onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Initiate an exit" open onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-500">
          For terminations, retirements, contract ends and absconding. The exit is approved immediately and clearances open.
        </p>
        <ErrorNote error={error} />
        <Field label="Employee">
          <EmployeeSelect employees={employees} value={form.employeeId} onChange={(id) => setForm({ ...form, employeeId: id })} />
        </Field>
        <Field label="Exit type">
          <Select value={form.exitType} onChange={(e) => setForm({ ...form, exitType: e.target.value })}>
            {['TERMINATION', 'RETIREMENT', 'END_OF_CONTRACT', 'ABSCONDING'].map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Last working day">
          <DatePicker value={form.lastWorkingDay} onChange={(v) => setForm({ ...form, lastWorkingDay: v })} />
        </Field>
        <Field label="Reason">
          <Textarea rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </Field>
        <Button
          variant="danger"
          onClick={() => void submit()}
          disabled={busy || !form.employeeId || !form.lastWorkingDay || form.reason.trim().length < 3}
          className="w-full"
        >
          Initiate exit
        </Button>
      </div>
    </Modal>
  );
}

const TABS = ['Pending approval', 'Serving notice', 'Clearance & F&F', 'F&F overdue', 'Closed', 'All'] as const;
type Tab = (typeof TABS)[number];

function inTab(r: ExitRow, tab: Tab): boolean {
  switch (tab) {
    case 'Pending approval':
      return r.status === 'PENDING';
    case 'Serving notice':
      return r.status === 'APPROVED' && r.notice.serving;
    case 'Clearance & F&F':
      return (r.status === 'COMPLETED' || (r.status === 'APPROVED' && !r.notice.serving)) && !r.closedAt;
    case 'F&F overdue':
      return r.fnfOverdue;
    case 'Closed':
      return !!r.closedAt;
    default:
      return true;
  }
}

export default function ExitsPage() {
  const { session, isManagerial, isCompanyAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>('Pending approval');
  const [q, setQ] = useState('');
  const list = useFetch<ExitRow[]>(isManagerial ? `/exits?scope=${isCompanyAdmin ? 'company' : 'team'}` : '/exits?scope=me');
  const mine = useFetch<ExitRow[]>(session?.employee && isManagerial ? '/exits?scope=me' : null);
  const [resignOpen, setResignOpen] = useState(false);
  const [initiateOpen, setInitiateOpen] = useState(false);

  const own = (isManagerial ? mine.data : list.data) ?? [];
  const activeOwn = own.find((r) => r.status === 'PENDING' || r.status === 'APPROVED');
  const reload = () => {
    list.reload();
    mine.reload();
  };

  const all = useMemo(() => list.data ?? [], [list.data]);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all
      .filter((r) => !isManagerial || inTab(r, tab))
      .filter(
        (r) =>
          !term ||
          r.employee.name.toLowerCase().includes(term) ||
          r.employee.employeeCode.toLowerCase().includes(term) ||
          (r.code ?? '').toLowerCase().includes(term)
      );
  }, [all, tab, q, isManagerial]);
  const count = (t: Tab) => all.filter((r) => inTab(r, t)).length;

  return (
    <div>
      <PageHeader
        title="Exits"
        subtitle="Resignations, notice & handover, clearances, full & final settlement, letters and archive"
        actions={
          <>
            {session?.employee && !activeOwn && (
              <Button variant="secondary" onClick={() => setResignOpen(true)}>
                Resign
              </Button>
            )}
            {isCompanyAdmin && <Button onClick={() => setInitiateOpen(true)}>+ Initiate exit</Button>}
          </>
        }
      />

      {activeOwn && (
        <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-60 flex-1">
            <p className="text-sm font-semibold text-slate-900">
              Your exit {activeOwn.code ? `(${activeOwn.code}) ` : ''}— {exitStatusLabel(activeOwn).toLowerCase()}
            </p>
            <p className="text-xs text-slate-400">
              Last working day {fmtDate(activeOwn.approvedLastDay ?? activeOwn.requestedLastDay)}
              {activeOwn.notice.serving && ` · ${activeOwn.notice.remainingDays} day(s) of notice left`}
              {activeOwn.handoverCount > 0 && ` · handover ${activeOwn.handoverVerified}/${activeOwn.handoverCount} verified`}
            </p>
            <div className="mt-2 max-w-sm">
              <StageBar stage={activeOwn.stage} />
            </div>
          </div>
          <Link
            href={`/exits/${activeOwn.id}`}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Open
          </Link>
        </Card>
      )}

      {isManagerial && (
        <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Pending approval" value={count('Pending approval')} icon="history" />
          <Stat label="Serving notice" value={count('Serving notice')} icon="clock" />
          <Stat label="Clearance & F&F" value={count('Clearance & F&F')} icon="check" />
          {isCompanyAdmin ? (
            <Stat label="F&F overdue" value={count('F&F overdue')} icon="wallet" accent={count('F&F overdue') ? 'text-rose-600' : undefined} />
          ) : (
            <Stat label="Closed" value={count('Closed')} icon="door" />
          )}
        </div>
      )}

      {isManagerial && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Tabs tabs={TABS.filter((t) => isCompanyAdmin || t !== 'F&F overdue')} active={tab} onChange={(t) => setTab(t as Tab)} />
          <div className="w-64">
            <Input placeholder="Search name, ID or case" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      )}

      <Card>
        {list.loading ? (
          <Spinner />
        ) : list.error ? (
          <div className="p-5">
            <ErrorNote error={list.error} />
          </div>
        ) : rows.length === 0 ? (
          <Empty message="No exits here" />
        ) : (
          <Table headers={['Case', 'Employee', 'Type', 'Last day', 'Stage', 'Clearance', 'F&F', 'Status', '']}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td>
                  <span className="font-mono text-xs text-slate-600">{r.code ?? '—'}</span>
                  <span className="block text-xs text-slate-400">{fmtDate(r.appliedOn)}</span>
                </Td>
                <Td>
                  <p className="font-medium text-slate-900">{r.employee.name}</p>
                  <p className="text-xs text-slate-400">
                    {r.employee.employeeCode} · {r.employee.designation || '—'}
                  </p>
                </Td>
                <Td>
                  <Badge tone={r.exitType === 'RESIGNATION' ? 'blue' : 'red'}>{humanize(r.exitType)}</Badge>
                </Td>
                <Td>
                  {fmtDate(r.approvedLastDay ?? r.requestedLastDay)}
                  {r.notice.serving && <span className="block text-xs text-slate-400">{r.notice.remainingDays}d left</span>}
                  {r.shortfallDays > 0 && <span className="block text-xs text-rose-500">{r.shortfallDays}d shortfall</span>}
                  {r.lastDayChangeStatus === 'PENDING' && <span className="block text-xs text-amber-600">change requested</span>}
                </Td>
                <Td>
                  <StageBar stage={r.stage} compact />
                </Td>
                <Td>
                  {r.clearanceCount ? (
                    <Badge tone={clearanceTone(r.clearanceStatus)}>
                      {r.clearedCount}/{r.clearanceCount} · {humanize(r.clearanceStatus)}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </Td>
                <Td>
                  {r.settlement ? (
                    <Badge tone={r.settlement.status === 'PAID' ? 'green' : r.settlement.status === 'APPROVED' ? 'blue' : 'amber'}>
                      {r.settlement.status}
                    </Badge>
                  ) : (
                    '—'
                  )}
                  {r.fnfOverdue && (
                    <span className="mt-1 block text-xs font-medium text-rose-600">
                      Overdue{r.settlement?.dueDate ? ` (due ${fmtDate(r.settlement.dueDate)})` : ''}
                    </span>
                  )}
                </Td>
                <Td>
                  <ExitStatusBadge r={r} />
                </Td>
                <Td>
                  <Link href={`/exits/${r.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
                    Details
                  </Link>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {resignOpen && <ResignModal onClose={() => setResignOpen(false)} onDone={reload} />}
      {initiateOpen && <InitiateModal onClose={() => setInitiateOpen(false)} onDone={reload} />}
    </div>
  );
}
