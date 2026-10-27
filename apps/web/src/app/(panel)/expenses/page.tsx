'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate, fmtMoney } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, Empty, ErrorNote, Field, Input, LongText, Modal, PageHeader, Spinner, Table, Tabs, Td, Textarea, statusTone, DatePicker } from '@/components/ui';
import { ApprovalTrail, DecideModal } from '@/components/approvals';

interface Expense {
  id: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  status: string;
  hasReceipt: boolean;
  remarks: string | null;
  employee?: { id: string; name: string };
  approver?: { id: string; name: string } | null;
  /** Where a pending claim sits in its approval chain. */
  approval?: { level: number; totalLevels: number; waitingOn: string | null } | null;
  /** From the approvals inbox: whether the caller may decide the current level. */
  canAct?: boolean;
}

interface InboxItem {
  requestId: string;
  level: number;
  totalLevels: number;
  canAct: boolean;
  requester: { id: string; name: string } | null;
  summary: { title: string; description: string; amount: number | null; fromDate: string | null; hasAttachment?: boolean };
}

/** Inbox items reshaped as expense rows for the shared table. */
const fromInbox = (items: InboxItem[]): Expense[] =>
  items.map((i) => ({
    id: i.requestId,
    category: i.summary.title.split(' · ')[0] ?? '',
    description: i.summary.description,
    amount: i.summary.amount ?? 0,
    date: i.summary.fromDate ?? '',
    status: 'PENDING',
    hasReceipt: !!i.summary.hasAttachment,
    remarks: null,
    employee: i.requester ?? undefined,
    approval: { level: i.level, totalLevels: i.totalLevels, waitingOn: null },
    canAct: i.canAct,
  }));

function ClaimModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ category: 'Travel', description: '', amount: '', date: '' });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('category', form.category);
      fd.append('description', form.description);
      fd.append('amount', form.amount);
      fd.append('date', form.date);
      if (file) fd.append('receipt', file);
      await api('/expenses', { method: 'POST', form: fd });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New expense claim" open onClose={onClose}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </Field>
          <Field label="Amount (₹)">
            <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
        </div>
        <Field label="Date">
          <DatePicker value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
        </Field>
        <Field label="Description">
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Receipt (any file format)">
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-ink-600" />
        </Field>
        <Button
          onClick={() => void submit()}
          disabled={busy || !form.amount || !form.date || form.description.length < 2}
          className="w-full"
        >
          Submit claim
        </Button>
      </div>
    </Modal>
  );
}

export default function ExpensesPage() {
  const { session, isCompanyAdmin } = useAuth();
  const [tab, setTab] = useState('My claims');
  // "Approvals" = claims waiting on me (any role can be a named approver);
  // "All pending" = every pending claim in the company (ADMIN / HR override).
  const tabs = ['My claims', 'Approvals', ...(isCompanyAdmin ? ['All pending'] : [])];
  const mine = useFetch<Expense[]>(tab === 'My claims' ? '/expenses?scope=me' : null);
  const inbox = useFetch<InboxItem[]>(tab === 'Approvals' ? '/approvals/inbox?module=EXPENSE' : null);
  const allPending = useFetch<Expense[]>(tab === 'All pending' ? '/expenses?scope=company&status=PENDING' : null);
  const approvals = tab === 'Approvals'
    ? { ...inbox, data: inbox.data ? fromInbox(inbox.data) : null }
    : allPending;
  const reloadApprovals = () => (tab === 'Approvals' ? inbox.reload() : allPending.reload());
  const [claimOpen, setClaimOpen] = useState(false);
  const [deciding, setDeciding] = useState<{ expense: Expense; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const [trailFor, setTrailFor] = useState<Expense | null>(null);
  const [error, setError] = useState<string | null>(null);

  const receipt = async (id: string) => {
    setError(null);
    try {
      const { url } = await api<{ url: string }>(`/expenses/${id}/receipt`);
      window.open(url, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const cancel = async (id: string) => {
    await api(`/expenses/${id}/cancel`, { method: 'POST' });
    mine.reload();
  };

  const renderTable = (items: Expense[], isApprovals: boolean) => (
    <Table headers={[...(isApprovals ? ['Employee'] : []), 'Category', 'Description', 'Amount', 'Date', 'Status', 'Receipt', '']}>
      {items.map((e) => (
        <tr key={e.id}>
          {isApprovals && <Td className="font-medium text-ink-900">{e.employee?.name}</Td>}
          <Td>{e.category}</Td>
          <Td>
            <LongText text={e.description} />
          </Td>
          <Td className="font-medium">{fmtMoney(e.amount)}</Td>
          <Td>{fmtDate(e.date)}</Td>
          <Td>
            <Badge tone={statusTone(e.status)}>{e.status}</Badge>
            {e.approval && e.approval.totalLevels > 1 && (
              <span className="mt-0.5 block text-[11px] text-ink-400">
                level {e.approval.level}/{e.approval.totalLevels}
                {e.approval.waitingOn ? ` · ${e.approval.waitingOn}` : ''}
              </span>
            )}
            {e.approval && e.approval.totalLevels === 1 && e.approval.waitingOn && (
              <span className="mt-0.5 block text-[11px] text-ink-400">with {e.approval.waitingOn}</span>
            )}
          </Td>
          <Td>
            {e.hasReceipt ? (
              <Button variant="ghost" onClick={() => void receipt(e.id)}>
                View
              </Button>
            ) : (
              '—'
            )}
          </Td>
          <Td>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setTrailFor(e)}>
                Timeline
              </Button>
              {isApprovals ? (
                <>
                  <Button disabled={e.canAct === false} onClick={() => setDeciding({ expense: e, decision: 'APPROVED' })}>
                    Approve
                  </Button>
                  <Button variant="danger" disabled={e.canAct === false} onClick={() => setDeciding({ expense: e, decision: 'REJECTED' })}>
                    Reject
                  </Button>
                </>
              ) : (
                e.status === 'PENDING' && (
                  <Button variant="ghost" onClick={() => void cancel(e.id)}>
                    Cancel
                  </Button>
                )
              )}
            </div>
          </Td>
        </tr>
      ))}
    </Table>
  );

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Claims with receipts stored in the file bucket"
        actions={session?.employee ? <Button onClick={() => setClaimOpen(true)}>+ New claim</Button> : undefined}
      />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="mb-3">
        <ErrorNote error={error ?? (tab === 'My claims' ? mine.error : approvals.error)} />
      </div>

      <Card>
        {tab === 'My claims' ? (
          mine.loading ? (
            <Spinner />
          ) : !mine.data || mine.data.length === 0 ? (
            <Empty message="No expense claims yet" />
          ) : (
            renderTable(mine.data, false)
          )
        ) : approvals.loading ? (
          <Spinner />
        ) : !approvals.data || approvals.data.length === 0 ? (
          <Empty message="Nothing waiting for approval 🎉" />
        ) : (
          renderTable(approvals.data, true)
        )}
      </Card>

      {claimOpen && <ClaimModal onClose={() => setClaimOpen(false)} onDone={() => mine.reload()} />}

      {deciding && (
        <DecideModal
          title={`${deciding.decision === 'APPROVED' ? 'Approve' : 'Reject'} — ${deciding.expense.employee?.name ?? ''} · ${fmtMoney(deciding.expense.amount)}`}
          path={`/expenses/${deciding.expense.id}/decide`}
          decision={deciding.decision}
          onClose={() => setDeciding(null)}
          onDone={reloadApprovals}
        />
      )}

      <Modal title="Approval timeline" open={!!trailFor} onClose={() => setTrailFor(null)}>
        {trailFor && <ApprovalTrail module="EXPENSE" requestId={trailFor.id} />}
      </Modal>
    </div>
  );
}
