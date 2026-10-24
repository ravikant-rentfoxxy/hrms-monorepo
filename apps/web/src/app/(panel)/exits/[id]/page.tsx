'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate, fmtMoney, fmtTime } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, DatePicker, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Td, Textarea,
} from '@/components/ui';
import { EmployeeSelect, errText, humanize, openUrl, useEmployees } from '@/components/lifecycle';
import {
  type ExitEmployee, type Notice, type Stage, ExitStatusBadge, MiniStat, Section, StageStepper, clearanceTone,
} from '../exit-ui';

interface ChecklistItem {
  label: string;
  done: boolean;
  key?: string;
  auto?: boolean;
  note?: string;
}

interface Clearance {
  id: string;
  department: string;
  status: string;
  items: ChecklistItem[];
  dues: number;
  remarks: string;
  clearedAt: string | null;
  clearedByName: string | null;
}

interface Step {
  id: string;
  level: number;
  status: string;
  approverName: string | null;
  actedByName: string | null;
  remarks: string | null;
  actedAt: string | null;
}

interface Item {
  label: string;
  type: 'EARNING' | 'DEDUCTION';
  amount: number;
  code?: string;
  note?: string;
  refIds?: string[];
}

interface Settlement {
  id: string;
  status: string;
  items: Item[];
  netAmount: number;
  lastWorkingDay: string;
  dueDate: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  paidOn: string | null;
  paymentMode: string;
  paymentReference: string;
  overdue: boolean;
  updatedAt: string;
}

interface HandoverTask {
  id: string;
  title: string;
  description: string;
  handoverToId: string | null;
  handoverToName: string | null;
  dueDate: string | null;
  status: string;
  completedAt: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  notes: string;
  overdue: boolean;
}

interface Letter {
  id: string;
  type: string;
  title: string;
  createdAt: string;
  issuedByName: string | null;
}

interface ExitDetail {
  id: string;
  code: string | null;
  exitType: string;
  reason: string;
  status: string;
  appliedOn: string;
  noticePeriodDays: number;
  requestedLastDay: string;
  approvedLastDay: string | null;
  shortfallDays: number;
  noticeWaived: boolean;
  remarks: string | null;
  acknowledgedAt: string | null;
  lastDayChangeTo: string | null;
  lastDayChangeReason: string;
  lastDayChangeStatus: string;
  lastDayChangeByName: string | null;
  lastDayChangeByEmployee: boolean;
  exitInterviewAt: string | null;
  exitInterviewerId: string | null;
  exitInterviewerName: string | null;
  closedAt: string | null;
  approverName: string | null;
  employee: ExitEmployee & { manager: { id: string; name: string } | null };
  clearances: Clearance[];
  clearanceStatus: string;
  handoverTasks: HandoverTask[];
  letters: Letter[];
  notice: Notice;
  stage: Stage;
  closeBlockers: string[];
  fnfOverdue: boolean;
  interview: {
    answers?: { question: string; answer: string }[];
    overallRating?: number | null;
    wouldRejoin?: boolean | null;
    submittedAt: string;
  } | null;
  settlement: Settlement | null;
  trail: Step[];
  assets: { id: string; tag: string; name: string; category: string; cost: number; department: string; issuedOn: string }[];
  questions: string[];
  can: {
    manage: boolean;
    decide: boolean;
    planHandover: boolean;
    completeHandover: boolean;
    clearManager: boolean;
    requestLastDayChange: boolean;
    decideLastDayChange: boolean;
    interview: boolean;
    close: boolean;
  };
}

interface NoticeSummary {
  from: string;
  to: string;
  attendance: { present: number; late: number; halfDay: number; absent: number; leave: number; holidays: number; recorded: number };
  leaves: { id: string; leaveType: string; fromDate: string; toDate: string; days: number; status: string; isPaid: boolean }[];
  leaveDaysApproved: number;
  leaveDaysPending: number;
}

const LETTER_LABELS: Record<string, string> = {
  RESIGNATION_ACKNOWLEDGEMENT: 'Resignation acknowledgement',
  RELIEVING: 'Relieving letter',
  EXPERIENCE: 'Experience certificate',
};
const PAYMENT_MODES = ['BANK_TRANSFER', 'NEFT', 'RTGS', 'IMPS', 'UPI', 'CHEQUE', 'CASH'];

/** Runs an action with busy / error state. */
function useAction(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      after?.();
      onDone();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function Timeline({ data }: { data: ExitDetail }) {
  const lastDay = data.approvedLastDay ?? data.requestedLastDay;
  const events: { label: string; detail?: string; date?: string | null; tone: string }[] = [
    {
      label: data.exitType === 'RESIGNATION' ? 'Resignation submitted' : `${humanize(data.exitType)} initiated`,
      detail: data.reason,
      date: data.appliedOn,
      tone: 'bg-indigo-500',
    },
    ...data.trail.map((s) => ({
      label: `Level ${s.level} — ${s.approverName ?? 'Approver'}: ${humanize(s.status)}`,
      detail: [s.actedByName && s.actedByName !== s.approverName ? `by ${s.actedByName}` : '', s.remarks ?? ''].filter(Boolean).join(' · '),
      date: s.actedAt,
      tone: s.status === 'APPROVED' ? 'bg-emerald-500' : s.status === 'REJECTED' ? 'bg-rose-500' : s.status === 'PENDING' ? 'bg-amber-400' : 'bg-slate-300',
    })),
    ...(data.acknowledgedAt ? [{ label: 'Resignation acknowledged', date: data.acknowledgedAt, tone: 'bg-emerald-500' }] : []),
    ...(data.status === 'WITHDRAWN' ? [{ label: 'Withdrawn by the employee', tone: 'bg-slate-400' }] : []),
    ...(data.exitInterviewAt
      ? [{ label: 'Exit interview', detail: data.exitInterviewerName ? `with ${data.exitInterviewerName}` : undefined, date: data.exitInterviewAt, tone: 'bg-sky-400' }]
      : []),
    ...(['APPROVED', 'COMPLETED'].includes(data.status)
      ? [
          {
            label: `Last working day${data.status === 'COMPLETED' ? '' : ' (planned)'}`,
            detail: data.shortfallDays > 0 ? `${data.shortfallDays} days notice shortfall` : data.noticeWaived ? 'Notice waived' : 'Notice served',
            date: lastDay,
            tone: 'bg-sky-500',
          },
        ]
      : []),
    ...(data.status === 'COMPLETED' ? [{ label: 'Separated — access revoked', date: data.employee.separatedOn, tone: 'bg-violet-500' }] : []),
    ...(data.closedAt ? [{ label: 'Case closed — profile archived', date: data.closedAt, tone: 'bg-slate-500' }] : []),
  ];
  return (
    <ol className="space-y-4 px-5 py-4">
      {events.map((e, i) => (
        <li key={i} className="flex gap-3">
          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${e.tone}`} />
          <div>
            <p className="text-sm font-medium text-slate-800">{e.label}</p>
            {e.detail && <p className="text-xs text-slate-500">{e.detail}</p>}
            {e.date && <p className="text-xs text-slate-400">{fmtDate(e.date)}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function DecideBox({ data, onDone }: { data: ExitDetail; onDone: () => void }) {
  const { isCompanyAdmin } = useAuth();
  const [form, setForm] = useState({ approvedLastDay: data.requestedLastDay.slice(0, 10), noticeWaived: false, remarks: '' });
  const { busy, error, run } = useAction(onDone);

  const decide = (decision: 'APPROVED' | 'REJECTED') =>
    run(() =>
      api(`/exits/${data.id}/decide`, {
        method: 'POST',
        body: {
          decision,
          ...(form.remarks ? { remarks: form.remarks } : {}),
          ...(decision === 'APPROVED' ? { approvedLastDay: form.approvedLastDay, ...(isCompanyAdmin ? { noticeWaived: form.noticeWaived } : {}) } : {}),
        },
      })
    );

  return (
    <Section title="Review resignation">
      <div className="space-y-3 p-5">
        <ErrorNote error={error} />
        <p className="text-sm text-slate-600">
          Review the reason, the handover needed and the notice terms ({data.noticePeriodDays} days). Confirm the last working day to accept.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Confirmed last working day" hint={`Requested: ${fmtDate(data.requestedLastDay)}`}>
            <DatePicker value={form.approvedLastDay} onChange={(v) => setForm({ ...form, approvedLastDay: v })} />
          </Field>
          {isCompanyAdmin && (
            <label className="flex items-center gap-2 pt-6 text-sm text-slate-600">
              <input type="checkbox" checked={form.noticeWaived} onChange={(e) => setForm({ ...form, noticeWaived: e.target.checked })} />
              Waive notice shortfall recovery
            </label>
          )}
        </div>
        <Field label="Remarks">
          <Textarea rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
        </Field>
        <div className="flex gap-2">
          <Button onClick={() => void decide('APPROVED')} disabled={busy || !form.approvedLastDay}>
            Accept resignation
          </Button>
          <Button variant="danger" onClick={() => void decide('REJECTED')} disabled={busy}>
            Reject
          </Button>
        </div>
      </div>
    </Section>
  );
}

function NoticeCard({ data, onDone }: { data: ExitDetail; onDone: () => void }) {
  const { isCompanyAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ lastDay: '', reason: '' });
  const [decision, setDecision] = useState({ remarks: '', noticeWaived: false });
  const { busy, error, run } = useAction(onDone);
  const lastDay = data.approvedLastDay ?? data.requestedLastDay;
  const pending = data.lastDayChangeStatus === 'PENDING' && data.lastDayChangeTo;
  const early = pending && data.lastDayChangeTo! < lastDay;
  const n = data.notice;
  const pct = n.totalDays ? Math.round((n.servedDays / n.totalDays) * 100) : 100;

  const request = () =>
    run(
      () => api(`/exits/${data.id}/last-day-change`, { method: 'POST', body: form }),
      () => {
        setOpen(false);
        setForm({ lastDay: '', reason: '' });
      }
    );
  const decide = (d: 'APPROVED' | 'REJECTED') =>
    run(() =>
      api(`/exits/${data.id}/last-day-change/decide`, {
        method: 'POST',
        body: {
          decision: d,
          ...(decision.remarks ? { remarks: decision.remarks } : {}),
          ...(isCompanyAdmin && d === 'APPROVED' && early && data.lastDayChangeByEmployee ? { noticeWaived: decision.noticeWaived } : {}),
        },
      })
    );

  return (
    <Section
      title="Notice period"
      actions={
        data.can.requestLastDayChange && (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            {isCompanyAdmin ? 'Change last working day' : 'Request early release / extension'}
          </Button>
        )
      }
    >
      <div className="space-y-4 p-5">
        <ErrorNote error={error} />
        <div className="grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">Notice period</p>
            <p className="font-semibold text-slate-900">{data.noticePeriodDays} days</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Served</p>
            <p className="font-semibold text-slate-900">
              {n.servedDays} / {n.totalDays} days
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Remaining</p>
            <p className="font-semibold text-slate-900">{n.serving ? `${n.remainingDays} days` : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Shortfall</p>
            <p className={`font-semibold ${data.shortfallDays ? 'text-rose-600' : 'text-slate-900'}`}>
              {data.noticeWaived ? 'Waived' : data.shortfallDays ? `${data.shortfallDays} days (recovered in F&F)` : 'None'}
            </p>
          </div>
        </div>
        {['APPROVED', 'COMPLETED'].includes(data.status) && (
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
          </div>
        )}

        {pending && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
            <p className="font-semibold text-amber-900">
              {early ? 'Early release' : 'Notice extension'} requested by {data.lastDayChangeByName ?? '—'}: {fmtDate(lastDay)} →{' '}
              {fmtDate(data.lastDayChangeTo)}
            </p>
            <p className="mt-1 whitespace-pre-line text-amber-800">{data.lastDayChangeReason}</p>
            {early && data.lastDayChangeByEmployee && (
              <p className="mt-1 text-xs text-amber-700">Employee-requested early release: the unserved days are recovered in F&F unless HR waives them.</p>
            )}
            {data.can.decideLastDayChange && (
              <div className="mt-3 space-y-2">
                <Input placeholder="Remarks (optional)" value={decision.remarks} onChange={(e) => setDecision({ ...decision, remarks: e.target.value })} />
                {isCompanyAdmin && early && data.lastDayChangeByEmployee && (
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={decision.noticeWaived}
                      onChange={(e) => setDecision({ ...decision, noticeWaived: e.target.checked })}
                    />
                    Waive the notice shortfall
                  </label>
                )}
                <div className="flex gap-2">
                  <Button onClick={() => void decide('APPROVED')} disabled={busy}>
                    Approve
                  </Button>
                  <Button variant="danger" onClick={() => void decide('REJECTED')} disabled={busy}>
                    Reject
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        {!pending && data.lastDayChangeStatus && (
          <p className="text-xs text-slate-500">
            Last change request ({fmtDate(data.lastDayChangeTo)}) was {data.lastDayChangeStatus.toLowerCase()}.
          </p>
        )}
      </div>

      <Modal title={isCompanyAdmin ? 'Change last working day' : 'Request early release / extension'} open={open} onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Current last working day: <b>{fmtDate(lastDay)}</b>.{' '}
            {isCompanyAdmin ? 'The change applies immediately.' : 'HR or the reporting manager approves the request.'}
          </p>
          <ErrorNote error={error} />
          <Field label="New last working day">
            <DatePicker value={form.lastDay} onChange={(v) => setForm({ ...form, lastDay: v })} />
          </Field>
          <Field label="Reason">
            <Textarea rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
          <Button className="w-full" onClick={() => void request()} disabled={busy || !form.lastDay || form.reason.trim().length < 3}>
            {isCompanyAdmin ? 'Apply change' : 'Submit request'}
          </Button>
        </div>
      </Modal>
    </Section>
  );
}

function NoticeAttendance({ id }: { id: string }) {
  const { data, loading, error } = useFetch<NoticeSummary>(`/exits/${id}/notice-summary`);
  return (
    <Section title="Attendance & leave during notice">
      {loading ? (
        <Spinner />
      ) : error || !data ? (
        <div className="p-5">
          <ErrorNote error={error ?? 'Not available'} />
        </div>
      ) : (
        <div className="space-y-3 p-5">
          <p className="text-xs text-slate-400">
            {fmtDate(data.from)} – {fmtDate(data.to)}
          </p>
          <div className="grid grid-cols-3 gap-3 text-center text-sm sm:grid-cols-5">
            {[
              ['Present', data.attendance.present, 'text-emerald-600'],
              ['Late', data.attendance.late, 'text-amber-600'],
              ['Half day', data.attendance.halfDay, 'text-amber-600'],
              ['Absent', data.attendance.absent, 'text-rose-600'],
              ['On leave', data.attendance.leave, 'text-violet-600'],
            ].map(([label, value, tone]) => (
              <div key={label as string} className="rounded-xl bg-slate-50 p-3">
                <p className={`text-lg font-semibold ${tone as string}`}>{value as number}</p>
                <p className="text-xs text-slate-500">{label as string}</p>
              </div>
            ))}
          </div>
          {data.leaves.length > 0 ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {data.leaves.map((l) => (
                <li key={l.id} className="flex items-center justify-between py-2">
                  <span>
                    {l.leaveType} · {fmtDate(l.fromDate)}
                    {l.toDate !== l.fromDate && ` – ${fmtDate(l.toDate)}`}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    {l.days}d <Badge tone={l.status === 'APPROVED' ? 'green' : 'amber'}>{humanize(l.status)}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">No leave during the notice period.</p>
          )}
          <p className="text-xs text-slate-500">
            Leave approved {data.leaveDaysApproved}d · pending {data.leaveDaysPending}d
          </p>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Handover
// ---------------------------------------------------------------------------

function HandoverModal({ data, task, onClose, onDone }: { data: ExitDetail; task: HandoverTask | null; onClose: () => void; onDone: () => void }) {
  const employees = useEmployees().filter((e) => e.id !== data.employee.id);
  const [form, setForm] = useState({
    title: task?.title ?? '',
    description: task?.description ?? '',
    handoverToId: task?.handoverToId ?? '',
    dueDate: task?.dueDate?.slice(0, 10) ?? '',
  });
  const { busy, error, run } = useAction(onDone);
  const submit = () =>
    run(
      () =>
        api(task ? `/exits/${data.id}/handover/${task.id}` : `/exits/${data.id}/handover`, {
          method: task ? 'PATCH' : 'POST',
          body: { ...form, handoverToId: form.handoverToId || null, dueDate: form.dueDate || null },
        }),
      onClose
    );
  return (
    <Modal title={task ? 'Edit handover task' : 'New handover task'} open onClose={onClose}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <Field label="Task">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Hand over vendor contracts" />
        </Field>
        <Field label="Details">
          <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Hand over to">
          <EmployeeSelect employees={employees} value={form.handoverToId} onChange={(id) => setForm({ ...form, handoverToId: id })} placeholder="Colleague (optional)" />
        </Field>
        <Field label="Due date" hint={`On or before the last working day (${fmtDate(data.approvedLastDay ?? data.requestedLastDay)})`}>
          <DatePicker value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} clearable />
        </Field>
        <Button className="w-full" onClick={() => void submit()} disabled={busy || form.title.trim().length < 2}>
          {task ? 'Save' : 'Assign task'}
        </Button>
      </div>
    </Modal>
  );
}

function HandoverTab({ data, onDone }: { data: ExitDetail; onDone: () => void }) {
  const [editing, setEditing] = useState<HandoverTask | 'new' | null>(null);
  const [noteFor, setNoteFor] = useState<{ task: HandoverTask; mode: 'done' | 'verify' | 'reopen' } | null>(null);
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction(onDone);
  const tasks = data.handoverTasks;
  const verified = tasks.filter((t) => t.status === 'VERIFIED').length;

  const act = () => {
    if (!noteFor) return;
    const { task, mode } = noteFor;
    void run(
      () =>
        mode === 'done'
          ? api(`/exits/${data.id}/handover/${task.id}/done`, { method: 'POST', body: note ? { notes: note } : {} })
          : api(`/exits/${data.id}/handover/${task.id}/verify`, {
              method: 'POST',
              body: { decision: mode === 'verify' ? 'VERIFIED' : 'REOPEN', ...(note ? { notes: note } : {}) },
            }),
      () => {
        setNoteFor(null);
        setNote('');
      }
    );
  };
  const remove = (t: HandoverTask) => {
    if (!window.confirm(`Remove "${t.title}"?`)) return;
    void run(() => api(`/exits/${data.id}/handover/${t.id}`, { method: 'DELETE' }));
  };

  return (
    <Section
      title={`Handover (${verified}/${tasks.length} verified)`}
      actions={data.can.planHandover && <Button onClick={() => setEditing('new')}>+ Add task</Button>}
    >
      <ErrorNote error={error} />
      {tasks.length === 0 ? (
        <Empty message={data.can.planHandover ? 'Assign the work to hand over, with the colleague receiving it' : 'No handover tasks yet'} />
      ) : (
        <Table headers={['Task', 'Hand over to', 'Due', 'Status', '']}>
          {tasks.map((t) => (
            <tr key={t.id}>
              <Td className="max-w-80">
                <p className="font-medium text-slate-900">{t.title}</p>
                {t.description && <p className="text-xs text-slate-500">{t.description}</p>}
                {t.notes && <p className="mt-1 whitespace-pre-line text-xs text-slate-400">{t.notes}</p>}
              </Td>
              <Td>{t.handoverToName ?? '—'}</Td>
              <Td>
                {t.dueDate ? fmtDate(t.dueDate) : '—'}
                {t.overdue && <span className="block text-xs text-rose-600">Overdue</span>}
              </Td>
              <Td>
                <Badge tone={t.status === 'VERIFIED' ? 'green' : t.status === 'DONE' ? 'blue' : 'amber'}>{humanize(t.status)}</Badge>
                {t.verifiedByName && <span className="block text-xs text-slate-400">{t.verifiedByName} · {fmtDate(t.verifiedAt)}</span>}
              </Td>
              <Td>
                <div className="flex flex-wrap justify-end gap-1">
                  {data.can.completeHandover && t.status === 'PENDING' && (
                    <Button variant="ghost" onClick={() => setNoteFor({ task: t, mode: 'done' })}>
                      Mark done
                    </Button>
                  )}
                  {data.can.planHandover && t.status === 'DONE' && (
                    <>
                      <Button variant="ghost" onClick={() => setNoteFor({ task: t, mode: 'verify' })}>
                        Verify
                      </Button>
                      <Button variant="ghost" onClick={() => setNoteFor({ task: t, mode: 'reopen' })}>
                        Send back
                      </Button>
                    </>
                  )}
                  {data.can.planHandover && t.status !== 'VERIFIED' && (
                    <>
                      <Button variant="ghost" onClick={() => setEditing(t)}>
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => remove(t)} disabled={busy}>
                        Remove
                      </Button>
                    </>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {editing && <HandoverModal data={data} task={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={onDone} />}
      <Modal
        title={noteFor?.mode === 'done' ? 'Mark task done' : noteFor?.mode === 'verify' ? 'Verify handover' : 'Send back to the employee'}
        open={!!noteFor}
        onClose={() => setNoteFor(null)}
      >
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-800">{noteFor?.task.title}</p>
          <Field label={noteFor?.mode === 'reopen' ? 'What is missing?' : 'Notes (optional)'}>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button className="w-full" onClick={act} disabled={busy || (noteFor?.mode === 'reopen' && !note.trim())}>
            Confirm
          </Button>
        </div>
      </Modal>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Clearance
// ---------------------------------------------------------------------------

function ClearanceCard({ c, data, canAct, onDone }: { c: Clearance; data: ExitDetail; canAct: boolean; onDone: () => void }) {
  const assets = data.assets.filter((a) => a.department === c.department);
  const [signOff, setSignOff] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [form, setForm] = useState({ dues: String(c.dues || ''), remarks: c.remarks, assetsNotReturned: false, force: false });
  const { busy, error, run } = useAction(onDone);
  const editable = canAct && c.status !== 'CLEARED';
  const open = c.items.filter((i) => !i.done);

  const saveItems = (items: { label: string; done: boolean }[], after?: () => void) =>
    run(() => api(`/exits/${data.id}/clearances/${c.department}/items`, { method: 'PATCH', body: { items } }), after);
  const toggle = (idx: number) => void saveItems(c.items.map((i, j) => ({ label: i.label, done: j === idx ? !i.done : i.done })));
  const addItem = () =>
    void saveItems([...c.items.map((i) => ({ label: i.label, done: i.done })), { label: newItem.trim(), done: false }], () => setNewItem(''));
  const submit = (status: 'CLEARED' | 'PENDING') =>
    run(
      () =>
        api(`/exits/${data.id}/clearances/${c.department}`, {
          method: 'POST',
          body: {
            status,
            remarks: form.remarks,
            ...(form.dues ? { dues: Number(form.dues) } : {}),
            ...(assets.length > 0 ? { assetsNotReturned: form.assetsNotReturned } : {}),
            ...(open.length > 0 ? { force: form.force } : {}),
          },
        }),
      () => setSignOff(false)
    );

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-900">{c.department === 'MANAGER' ? 'Reporting manager' : humanize(c.department)}</p>
          {c.clearedByName && (
            <p className="text-xs text-slate-400">
              Cleared by {c.clearedByName} · {fmtDate(c.clearedAt)}
            </p>
          )}
        </div>
        <Badge tone={clearanceTone(c.status)}>{humanize(c.status)}</Badge>
      </div>
      <ErrorNote error={error} />
      <ul className="space-y-1.5">
        {c.items.map((i, idx) => (
          <li key={i.label} className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={i.done} disabled={!editable || busy} onChange={() => toggle(idx)} />
            <span className={i.done ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-800'}>
              {i.label}
              {i.auto && <span className="ml-1.5 text-[10px] font-semibold uppercase text-emerald-600">auto</span>}
              {i.note && <span className="block text-xs text-slate-400 no-underline">{i.note}</span>}
            </span>
          </li>
        ))}
      </ul>
      {editable && (
        <div className="mt-2 flex gap-2">
          <Input placeholder="Add checklist item" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
          <Button variant="secondary" onClick={addItem} disabled={busy || !newItem.trim()}>
            Add
          </Button>
        </div>
      )}
      {assets.length > 0 && c.status !== 'CLEARED' && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Still with the employee: {assets.map((a) => `${a.name} (${a.tag}) ${fmtMoney(a.cost)}`).join(', ')}
        </p>
      )}
      {(c.remarks || c.dues > 0) && (
        <p className="mt-2 text-xs text-slate-500">
          {c.dues > 0 && <span className="font-medium text-rose-600">Dues {fmtMoney(c.dues)} · </span>}
          {c.remarks}
        </p>
      )}
      {canAct && (
        <div className="mt-3 flex gap-2">
          {c.status !== 'CLEARED' ? (
            <Button onClick={() => setSignOff(true)}>Sign off</Button>
          ) : (
            <Button variant="secondary" onClick={() => void submit('PENDING')} disabled={busy}>
              Reopen
            </Button>
          )}
        </div>
      )}
      <Modal title={`Clear ${c.department === 'MANAGER' ? 'manager' : humanize(c.department)} clearance`} open={signOff} onClose={() => setSignOff(false)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          {assets.length > 0 && (
            <label className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.assetsNotReturned}
                onChange={(e) => setForm({ ...form, assetsNotReturned: e.target.checked })}
              />
              {assets.length} asset(s) not returned — recover the cost in F&F
            </label>
          )}
          {open.length > 0 && (
            <label className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-1" checked={form.force} onChange={(e) => setForm({ ...form, force: e.target.checked })} />
              Clear with {open.length} open item(s): {open.map((i) => i.label).join(', ')} (explain in remarks)
            </label>
          )}
          <Field label="Other dues to recover (₹)">
            <Input type="number" min={0} value={form.dues} onChange={(e) => setForm({ ...form, dues: e.target.value })} />
          </Field>
          <Field label="Remarks">
            <Textarea rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </Field>
          <Button className="w-full" onClick={() => void submit('CLEARED')} disabled={busy}>
            Mark cleared
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

function ClearanceTab({ data, onDone }: { data: ExitDetail; onDone: () => void }) {
  if (data.clearances.length === 0) return <Card><Empty message="Clearances open once the exit is approved" /></Card>;
  return (
    <div>
      <p className="mb-3 text-sm text-slate-600">
        Overall clearance: <Badge tone={clearanceTone(data.clearanceStatus)}>{humanize(data.clearanceStatus)}</Badge>{' '}
        <span className="text-xs text-slate-400">Items marked “auto” were ticked from handover, asset, loan and interview records.</span>
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.clearances.map((c) => (
          <ClearanceCard
            key={`${c.id}-${c.status}-${c.items.map((i) => (i.done ? 1 : 0)).join('')}`}
            c={c}
            data={data}
            canAct={data.status === 'APPROVED' && (data.can.manage || (c.department === 'MANAGER' && data.can.clearManager))}
            onDone={onDone}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exit interview
// ---------------------------------------------------------------------------

function InterviewForm({ data, onDone }: { data: ExitDetail; onDone: () => void }) {
  const existing = data.interview?.answers ?? [];
  const [answers, setAnswers] = useState<string[]>(data.questions.map((q) => existing.find((a) => a.question === q)?.answer ?? ''));
  const [rating, setRating] = useState(String(data.interview?.overallRating ?? ''));
  const [rejoin, setRejoin] = useState(data.interview?.wouldRejoin == null ? '' : data.interview.wouldRejoin ? 'yes' : 'no');
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction(onDone);

  const submit = () =>
    run(
      () =>
        api(`/exits/${data.id}/interview`, {
          method: 'POST',
          body: {
            answers: data.questions.map((question, i) => ({ question, answer: answers[i] ?? '' })),
            ...(rating ? { overallRating: Number(rating) } : {}),
            ...(rejoin ? { wouldRejoin: rejoin === 'yes' } : {}),
          },
        }),
      () => setSaved(true)
    );

  return (
    <div className="space-y-3 p-5">
      <ErrorNote error={error} />
      {data.questions.map((q, i) => (
        <Field key={q} label={`${i + 1}. ${q}`}>
          <Textarea rows={2} value={answers[i] ?? ''} onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))} />
        </Field>
      ))}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Overall experience (1–5)">
          <Select value={rating} onChange={(e) => setRating(e.target.value)}>
            <option value="">—</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {'★'.repeat(n)} {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Would rejoin us?">
          <Select value={rejoin} onChange={(e) => setRejoin(e.target.value)}>
            <option value="">—</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        </Field>
      </div>
      <Button onClick={() => void submit()} disabled={busy || answers.every((a) => !a.trim())}>
        {data.interview ? 'Update answers' : 'Submit exit interview'}
      </Button>
      {saved && <span className="ml-3 text-sm text-emerald-600">Saved</span>}
    </div>
  );
}

function InterviewTab({ data, onDone }: { data: ExitDetail; onDone: () => void }) {
  const { session } = useAuth();
  const isSelf = session?.employee?.id === data.employee.id;
  const employees = useEmployees(data.can.manage).filter((e) => e.id !== data.employee.id);
  const [form, setForm] = useState({ at: toLocalInput(data.exitInterviewAt), interviewerId: data.exitInterviewerId ?? '' });
  const [record, setRecord] = useState(false);
  const { busy, error, run } = useAction(onDone);
  const schedule = () =>
    run(() =>
      api(`/exits/${data.id}/interview/schedule`, {
        method: 'POST',
        body: { at: new Date(form.at).toISOString(), interviewerId: form.interviewerId || null },
      })
    );

  return (
    <div className="space-y-5">
      <Section title="Schedule">
        <div className="space-y-3 p-5">
          <ErrorNote error={error} />
          <p className="text-sm text-slate-700">
            {data.exitInterviewAt ? (
              <>
                Scheduled on <b>{fmtDate(data.exitInterviewAt)}</b> at <b>{fmtTime(data.exitInterviewAt)}</b>
                {data.exitInterviewerName && <> with <b>{data.exitInterviewerName}</b></>}.
              </>
            ) : (
              'Not scheduled yet.'
            )}
          </p>
          {data.can.manage && ['APPROVED', 'COMPLETED'].includes(data.status) && !data.closedAt && (
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field label="Date & time">
                <Input type="datetime-local" value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value })} />
              </Field>
              <Field label="Interviewer">
                <EmployeeSelect employees={employees} value={form.interviewerId} onChange={(id) => setForm({ ...form, interviewerId: id })} placeholder="Me" />
              </Field>
              <Button onClick={() => void schedule()} disabled={busy || !form.at}>
                {data.exitInterviewAt ? 'Reschedule' : 'Schedule'}
              </Button>
            </div>
          )}
        </div>
      </Section>
      <Section
        title="Exit interview"
        actions={
          data.can.manage && data.can.interview && !record && (
            <Button variant="secondary" onClick={() => setRecord(true)}>
              {data.interview ? 'Edit answers' : 'Record answers'}
            </Button>
          )
        }
      >
        {(isSelf && data.can.interview) || record ? (
          <InterviewForm data={data} onDone={onDone} />
        ) : !data.interview ? (
          <Empty message="The exit interview has not been submitted yet" />
        ) : !data.interview.answers ? (
          <p className="p-5 text-sm text-slate-600">Submitted on {fmtDate(data.interview.submittedAt)}.</p>
        ) : (
          <div className="space-y-3 p-5">
            {data.interview.answers.map((a, i) => (
              <div key={i}>
                <p className="text-xs font-semibold text-slate-500">{a.question}</p>
                <p className="whitespace-pre-line text-sm text-slate-800">{a.answer || '—'}</p>
              </div>
            ))}
            <p className="text-sm text-slate-600">
              Rating: {data.interview.overallRating ? '★'.repeat(data.interview.overallRating) : '—'} · Would rejoin:{' '}
              {data.interview.wouldRejoin == null ? '—' : data.interview.wouldRejoin ? 'Yes' : 'No'} · submitted {fmtDate(data.interview.submittedAt)}
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full & final
// ---------------------------------------------------------------------------

function PayModal({ data, onClose, onDone }: { data: ExitDetail; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ paymentMode: 'BANK_TRANSFER', paymentReference: '', paidOn: new Date().toISOString().slice(0, 10) });
  const { busy, error, run } = useAction(onDone);
  const net = data.settlement?.netAmount ?? 0;
  return (
    <Modal title="Record F&F payment" open onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          {net >= 0 ? 'Net payable' : 'Net recoverable'}: <b>{fmtMoney(Math.abs(net))}</b>
        </p>
        <ErrorNote error={error} />
        <Field label="Payment mode">
          <Select value={form.paymentMode} onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}>
            {PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {humanize(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference" hint="UTR / transaction ID / cheque number">
          <Input value={form.paymentReference} onChange={(e) => setForm({ ...form, paymentReference: e.target.value })} />
        </Field>
        <Field label="Paid on">
          <DatePicker value={form.paidOn} onChange={(v) => setForm({ ...form, paidOn: v })} />
        </Field>
        <Button
          className="w-full"
          onClick={() =>
            void run(
              () =>
                api(`/exits/${data.id}/settlement/pay`, {
                  method: 'POST',
                  body: { paymentMode: form.paymentMode, paidOn: form.paidOn, ...(form.paymentReference.trim() ? { paymentReference: form.paymentReference.trim() } : {}) },
                }),
              onClose
            )
          }
          disabled={busy || !form.paidOn || (form.paymentMode !== 'CASH' && Math.abs(net) > 0 && !form.paymentReference.trim())}
        >
          Mark as paid
        </Button>
      </div>
    </Modal>
  );
}

function SettlementEditor({ data, manage, onDone }: { data: ExitDetail; manage: boolean; onDone: () => void }) {
  const { session } = useAuth();
  const s = data.settlement;
  const [items, setItems] = useState<Item[]>(s?.items ?? []);
  const [dirty, setDirty] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [due, setDue] = useState(s?.dueDate?.slice(0, 10) ?? '');
  const { busy, error, run, setError } = useAction(onDone);
  const isAdmin = session?.role === 'ADMIN' || session?.role === 'SUPER_ADMIN';
  const editable = manage && s?.status === 'DRAFT';

  const compute = () =>
    run(async () => {
      const res = await api<Settlement>(`/exits/${data.id}/settlement/compute`, { method: 'POST' });
      setItems(res.items);
      setDue(res.dueDate?.slice(0, 10) ?? '');
      setDirty(false);
    });
  const save = () => run(() => api(`/exits/${data.id}/settlement`, { method: 'PUT', body: { items } }), () => setDirty(false));
  const approve = () => run(() => api(`/exits/${data.id}/settlement/approve`, { method: 'POST' }));
  const saveDue = () => run(() => api(`/exits/${data.id}/settlement/due-date`, { method: 'PATCH', body: { dueDate: due } }));
  const pdf = async () => {
    try {
      const { url } = await api<{ url: string }>(`/exits/${data.id}/settlement/pdf?inline=true`);
      openUrl(url);
    } catch (err) {
      setError(errText(err));
    }
  };

  const patch = (i: number, p: Partial<Item>) => {
    setItems(items.map((it, j) => (j === i ? { ...it, ...p } : it)));
    setDirty(true);
  };
  const earnings = items.filter((i) => i.type === 'EARNING').reduce((a, i) => a + (Number(i.amount) || 0), 0);
  const deductions = items.filter((i) => i.type === 'DEDUCTION').reduce((a, i) => a + (Number(i.amount) || 0), 0);

  return (
    <Section
      title="Full & final settlement"
      actions={
        <>
          {s && <Badge tone={s.status === 'PAID' ? 'green' : s.status === 'APPROVED' ? 'blue' : 'amber'}>{s.status}</Badge>}
          {s?.overdue && <Badge tone="red">Overdue</Badge>}
          {manage && (!s || editable) && !data.closedAt && (
            <Button variant="secondary" onClick={() => void compute()} disabled={busy}>
              {s ? 'Recompute' : 'Compute F&F'}
            </Button>
          )}
          {s && (
            <Button variant="ghost" onClick={() => void pdf()}>
              Statement PDF
            </Button>
          )}
        </>
      }
    >
      <div className="p-5">
        <ErrorNote error={error} />
        {!s ? (
          <Empty message="Compute the settlement to see earnings, statutory dues and recoveries" />
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 rounded-xl border border-slate-100 p-4 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Due by (Code on Wages: 2 working days)</p>
                {manage && s.status !== 'PAID' ? (
                  <div className="mt-1 flex items-center gap-2">
                    <DatePicker value={due} onChange={setDue} />
                    {due !== (s.dueDate?.slice(0, 10) ?? '') && due && (
                      <Button variant="ghost" onClick={() => void saveDue()} disabled={busy}>
                        Save
                      </Button>
                    )}
                  </div>
                ) : (
                  <p className={`font-semibold ${s.overdue ? 'text-rose-600' : 'text-slate-900'}`}>{fmtDate(s.dueDate)}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-slate-500">Approved</p>
                <p className="font-semibold text-slate-900">{s.approvedAt ? `${fmtDate(s.approvedAt)}${s.approvedByName ? ` · ${s.approvedByName}` : ''}` : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Paid</p>
                <p className="font-semibold text-slate-900">
                  {s.paidOn ? `${fmtDate(s.paidOn)} · ${humanize(s.paymentMode || 'BANK_TRANSFER')}` : '—'}
                </p>
                {s.paymentReference && <p className="text-xs text-slate-400">Ref {s.paymentReference}</p>}
              </div>
            </div>
            <div className="-mx-5">
              <Table headers={['Component', 'Type', 'Amount (₹)', '']}>
                {items.map((it, i) => (
                  <tr key={i}>
                    <Td>
                      {editable ? (
                        <Input value={it.label} onChange={(e) => patch(i, { label: e.target.value })} />
                      ) : (
                        <span className="text-slate-800">{it.label}</span>
                      )}
                    </Td>
                    <Td>
                      {editable ? (
                        <Select value={it.type} onChange={(e) => patch(i, { type: e.target.value as Item['type'] })} className="w-36!">
                          <option value="EARNING">Earning</option>
                          <option value="DEDUCTION">Deduction</option>
                        </Select>
                      ) : (
                        <Badge tone={it.type === 'EARNING' ? 'green' : 'red'}>{humanize(it.type)}</Badge>
                      )}
                    </Td>
                    <Td>
                      {editable ? (
                        <Input type="number" min={0} value={it.amount} onChange={(e) => patch(i, { amount: Number(e.target.value) })} className="w-36!" />
                      ) : (
                        fmtMoney(it.amount)
                      )}
                    </Td>
                    <Td>
                      {editable && (
                        <Button variant="ghost" onClick={() => (setItems(items.filter((_, j) => j !== i)), setDirty(true))}>
                          Remove
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
            {editable && (
              <Button
                variant="secondary"
                onClick={() => {
                  setItems([...items, { label: '', type: 'EARNING', amount: 0, code: 'OTHER' }]);
                  setDirty(true);
                }}
              >
                + Add line
              </Button>
            )}
            <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500">Earnings</p>
                <p className="font-semibold text-emerald-700">{fmtMoney(earnings)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500">Deductions</p>
                <p className="font-semibold text-rose-600">{fmtMoney(deductions)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500">{earnings - deductions >= 0 ? 'Net payable' : 'Net recoverable'}</p>
                <p className="text-lg font-semibold text-indigo-700">{fmtMoney(Math.abs(earnings - deductions))}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {editable && (
                <Button onClick={() => void save()} disabled={busy || !dirty || items.some((i) => !i.label.trim())}>
                  Save changes
                </Button>
              )}
              {editable && isAdmin && (
                <Button onClick={() => void approve()} disabled={busy || dirty}>
                  Approve settlement
                </Button>
              )}
              {editable && !isAdmin && <span className="self-center text-xs text-slate-400">An ADMIN approves the settlement.</span>}
              {manage && s.status === 'APPROVED' && <Button onClick={() => setPayOpen(true)}>Record payment</Button>}
            </div>
          </div>
        )}
      </div>
      {payOpen && <PayModal data={data} onClose={() => setPayOpen(false)} onDone={onDone} />}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Letters & closure
// ---------------------------------------------------------------------------

function RehireModal({ data, mode, onClose, onDone }: { data: ExitDetail; mode: 'close' | 'rehire'; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    rehireEligible: data.employee.rehireEligible == null ? '' : data.employee.rehireEligible ? 'yes' : 'no',
    rehireNote: data.employee.rehireNote,
  });
  const { busy, error, run } = useAction(onDone);
  const submit = () =>
    run(
      () =>
        api(mode === 'close' ? `/exits/${data.id}/close` : `/exits/${data.id}/rehire`, {
          method: mode === 'close' ? 'POST' : 'PATCH',
          body: { rehireEligible: form.rehireEligible === 'yes', rehireNote: form.rehireNote },
        }),
      onClose
    );
  return (
    <Modal title={mode === 'close' ? 'Close exit case' : 'Rehire eligibility'} open onClose={onClose}>
      <div className="space-y-3">
        {mode === 'close' && (
          <p className="text-sm text-slate-500">
            Closing archives {data.employee.name}&apos;s profile. Their records stay available to HR as a former employee.
          </p>
        )}
        <ErrorNote error={error} />
        <Field label="Eligible for rehire?">
          <Select value={form.rehireEligible} onChange={(e) => setForm({ ...form, rehireEligible: e.target.value })}>
            <option value="">Select</option>
            <option value="yes">Yes — eligible for rehire</option>
            <option value="no">No — not eligible</option>
          </Select>
        </Field>
        <Field label="Note" hint={form.rehireEligible === 'no' ? 'Required when not eligible' : undefined}>
          <Textarea rows={3} value={form.rehireNote} onChange={(e) => setForm({ ...form, rehireNote: e.target.value })} />
        </Field>
        <Button
          className="w-full"
          onClick={() => void submit()}
          disabled={busy || !form.rehireEligible || (form.rehireEligible === 'no' && !form.rehireNote.trim())}
        >
          {mode === 'close' ? 'Close case & archive' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}

function LettersTab({ data, onDone }: { data: ExitDetail; onDone: () => void }) {
  const [modal, setModal] = useState<'close' | 'rehire' | null>(null);
  const { busy, error, run, setError } = useAction(onDone);
  const types = ['RESIGNATION_ACKNOWLEDGEMENT', 'RELIEVING', 'EXPERIENCE'].filter((t) => t !== 'RESIGNATION_ACKNOWLEDGEMENT' || data.exitType === 'RESIGNATION');
  const issued = (t: string) => data.letters.filter((l) => l.type === t);
  const issue = (type: string, reissue: boolean) => {
    if (reissue && !window.confirm('Issue a new copy of this letter?')) return;
    void run(() => api(`/exits/${data.id}/letters`, { method: 'POST', body: { type, reissue } }));
  };
  const download = async (id: string) => {
    try {
      const { url } = await api<{ url: string }>(`/letters/${id}/download?inline=true`);
      openUrl(url);
    } catch (err) {
      setError(errText(err));
    }
  };
  const canIssue = data.can.manage && ['APPROVED', 'COMPLETED'].includes(data.status);

  return (
    <div className="space-y-5">
      <Section title="Exit letters">
        <ErrorNote error={error} />
        <Table headers={['Letter', 'Issued', '']}>
          {types.map((t) => {
            const list = issued(t);
            const last = list[list.length - 1];
            return (
              <tr key={t}>
                <Td className="font-medium text-slate-900">{LETTER_LABELS[t]}</Td>
                <Td>
                  {last ? (
                    <>
                      {fmtDate(last.createdAt)}
                      {last.issuedByName && <span className="block text-xs text-slate-400">by {last.issuedByName}</span>}
                      {list.length > 1 && <span className="block text-xs text-slate-400">{list.length} copies</span>}
                    </>
                  ) : (
                    <span className="text-slate-400">Not issued</span>
                  )}
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    {last && (
                      <Button variant="ghost" onClick={() => void download(last.id)}>
                        View
                      </Button>
                    )}
                    {canIssue && (
                      <Button variant={last ? 'ghost' : 'secondary'} onClick={() => issue(t, !!last)} disabled={busy}>
                        {last ? 'Re-issue' : 'Generate'}
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
        </Table>
        <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-400">
          Letters and the paid F&F statement are filed in the employee&apos;s documents (“Employee Letters”) and stay downloadable by HR after access is revoked.
        </p>
      </Section>

      {data.can.manage && (
        <Section title="Close & archive">
          <div className="space-y-3 p-5 text-sm">
            {data.closedAt ? (
              <>
                <p className="text-slate-700">
                  Closed on <b>{fmtDate(data.closedAt)}</b>. Profile archived{data.employee.archivedAt ? ` on ${fmtDate(data.employee.archivedAt)}` : ''}.
                </p>
                <p className="text-slate-700">
                  Rehire:{' '}
                  {data.employee.rehireEligible == null ? (
                    <Badge>Not decided</Badge>
                  ) : data.employee.rehireEligible ? (
                    <Badge tone="green">Eligible</Badge>
                  ) : (
                    <Badge tone="red">Not eligible</Badge>
                  )}
                  {data.employee.rehireNote && <span className="ml-2 text-slate-500">{data.employee.rehireNote}</span>}
                </p>
                <Button variant="secondary" onClick={() => setModal('rehire')}>
                  Update rehire eligibility
                </Button>
              </>
            ) : (
              <>
                {data.closeBlockers.length > 0 ? (
                  <ul className="list-inside list-disc space-y-1 text-slate-600">
                    {data.closeBlockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-emerald-700">Clearances, F&F and letters are done — the case can be closed.</p>
                )}
                <div className="flex gap-2">
                  <Button onClick={() => setModal('close')} disabled={!data.can.close}>
                    Close case
                  </Button>
                  {data.status === 'COMPLETED' && (
                    <Button variant="secondary" onClick={() => setModal('rehire')}>
                      Set rehire eligibility
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </Section>
      )}
      {modal && <RehireModal data={data} mode={modal} onClose={() => setModal(null)} onDone={onDone} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ExitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { session, isCompanyAdmin } = useAuth();
  const { data, loading, error, reload } = useFetch<ExitDetail>(`/exits/${id}`);
  const [tab, setTab] = useState('Overview');
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <Card className="p-6 text-sm text-rose-600">{error ?? 'Not found'}</Card>;

  const isSelf = session?.employee?.id === data.employee.id;
  const isManager = !!session?.employee && data.employee.managerId === session.employee.id;
  const lastDay = data.approvedLastDay ?? data.requestedLastDay;
  const approved = ['APPROVED', 'COMPLETED'].includes(data.status);
  const stopped = data.status === 'REJECTED' ? 'Resignation rejected' : data.status === 'WITHDRAWN' ? 'Resignation withdrawn' : undefined;
  const showSettlement = isCompanyAdmin || (isSelf && !!data.settlement && data.settlement.status !== 'DRAFT');

  const tabs = [
    'Overview',
    ...(approved || data.handoverTasks.length || data.can.planHandover ? ['Handover'] : []),
    ...(approved ? ['Clearance'] : []),
    ...(approved && (isSelf || isCompanyAdmin) ? ['Exit interview'] : []),
    ...(approved && showSettlement ? ['F&F'] : []),
    ...(approved && (isCompanyAdmin || data.letters.length) ? ['Letters & closure'] : []),
  ];
  const active = tabs.includes(tab) ? tab : 'Overview';

  const withdraw = async () => {
    if (!window.confirm('Withdraw your resignation?')) return;
    setActionError(null);
    try {
      await api(`/exits/${data.id}/withdraw`, { method: 'POST' });
      reload();
    } catch (err) {
      setActionError(errText(err));
    }
  };

  return (
    <div>
      <Link href="/exits" className="mb-3 inline-block text-sm text-indigo-600 hover:underline">
        ← All exits
      </Link>
      <PageHeader
        title={`${data.employee.name}${data.code ? ` · ${data.code}` : ''}`}
        subtitle={`${data.employee.employeeCode} · ${data.employee.designation || '—'} · ${data.employee.department || '—'} · reports to ${data.employee.manager?.name ?? '—'}`}
        actions={
          <>
            <Badge tone={data.exitType === 'RESIGNATION' ? 'blue' : 'red'}>{humanize(data.exitType)}</Badge>
            <ExitStatusBadge r={data} />
            {isSelf && data.status === 'PENDING' && (
              <Button variant="secondary" onClick={() => void withdraw()}>
                Withdraw
              </Button>
            )}
          </>
        }
      />
      <ErrorNote error={actionError} />

      <StageStepper stage={data.stage} stopped={stopped} />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MiniStat label="Joined" value={fmtDate(data.employee.joiningDate)} sub={`Applied ${fmtDate(data.appliedOn)}`} />
        <MiniStat
          label={approved ? 'Last working day' : 'Requested last day'}
          value={fmtDate(lastDay)}
          sub={data.lastDayChangeStatus === 'PENDING' ? `Change to ${fmtDate(data.lastDayChangeTo)} pending` : undefined}
        />
        <MiniStat
          label="Notice"
          value={data.notice.serving ? `${data.notice.remainingDays} days left` : `${data.noticePeriodDays} days`}
          sub={`${data.notice.servedDays}/${data.notice.totalDays} served${data.shortfallDays ? ` · ${data.shortfallDays}d short` : ''}${data.noticeWaived ? ' · waived' : ''}`}
          accent={data.shortfallDays ? 'text-rose-600' : undefined}
        />
        <MiniStat
          label="Clearance"
          value={humanize(data.clearanceStatus)}
          sub={`${data.clearances.filter((c) => c.status === 'CLEARED').length}/${data.clearances.length || 5} departments`}
        />
      </div>

      {tabs.length > 1 && <Tabs tabs={tabs} active={active} onChange={setTab} />}

      {active === 'Overview' && (
        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            {data.can.decide && !isSelf && <DecideBox data={data} onDone={reload} />}
            <Section title="Separation request">
              <div className="grid gap-3 p-5 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs text-slate-500">Reason</p>
                  <p className="whitespace-pre-line text-slate-800">{data.reason}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Decision</p>
                  <p className="text-slate-800">
                    {data.approverName ? `${humanize(data.status)} by ${data.approverName}` : humanize(data.status)}
                    {data.remarks && <span className="block text-xs text-slate-500">{data.remarks}</span>}
                  </p>
                  {data.acknowledgedAt && <p className="mt-1 text-xs text-emerald-700">Acknowledged on {fmtDate(data.acknowledgedAt)}</p>}
                </div>
              </div>
            </Section>
            {approved && <NoticeCard key={`${data.lastDayChangeStatus}-${lastDay}`} data={data} onDone={reload} />}
            {approved && (isCompanyAdmin || isManager) && !isSelf && <NoticeAttendance id={data.id} />}
          </div>
          <div className="space-y-5">
            <Section title="Timeline">
              <Timeline data={data} />
            </Section>
            {data.assets.length > 0 && (
              <Section title="Assets with the employee">
                <ul className="divide-y divide-slate-100">
                  {data.assets.map((a) => (
                    <li key={a.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                      <span>
                        {a.name} <span className="text-xs text-slate-400">{a.tag}</span>
                      </span>
                      <span className="text-xs text-slate-500">
                        {a.department} · {fmtMoney(a.cost)}
                      </span>
                    </li>
                  ))}
                </ul>
                {isCompanyAdmin && (
                  <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-400">
                    Record returns under{' '}
                    <Link href="/assets" className="text-indigo-600 hover:underline">
                      Assets
                    </Link>
                    .
                  </p>
                )}
              </Section>
            )}
          </div>
        </div>
      )}
      {active === 'Handover' && <HandoverTab data={data} onDone={reload} />}
      {active === 'Clearance' && <ClearanceTab data={data} onDone={reload} />}
      {active === 'Exit interview' && <InterviewTab key={data.exitInterviewAt ?? 'none'} data={data} onDone={reload} />}
      {active === 'F&F' && <SettlementEditor key={data.settlement?.updatedAt ?? 'none'} data={data} manage={isCompanyAdmin && !isSelf} onDone={reload} />}
      {active === 'Letters & closure' && <LettersTab data={data} onDone={reload} />}
    </div>
  );
}
