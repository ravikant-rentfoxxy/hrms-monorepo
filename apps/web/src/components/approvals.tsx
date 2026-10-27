'use client';

import { useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, ErrorNote, Field, Modal, Spinner, Textarea, statusTone } from './ui';

/** Approval-engine modules, in the order the settings page lists them. */
export const APPROVAL_MODULES = [
  'LEAVE', 'EXPENSE', 'REGULARIZATION', 'OVERTIME', 'COMP_OFF', 'ENCASHMENT', 'LOAN',
  'RESIGNATION', 'TRAVEL', 'TIMESHEET', 'CONFIRMATION', 'SALARY_REVISION',
  'REQUISITION', 'OFFER', 'TRANSFER',
] as const;
export type ApprovalModule = (typeof APPROVAL_MODULES)[number];

export const MODULE_LABELS: Record<ApprovalModule, string> = {
  LEAVE: 'Leave',
  EXPENSE: 'Expense',
  REGULARIZATION: 'Regularization',
  OVERTIME: 'Overtime',
  COMP_OFF: 'Comp-off',
  ENCASHMENT: 'Leave encashment',
  LOAN: 'Loan / advance',
  RESIGNATION: 'Resignation',
  TRAVEL: 'Travel',
  TIMESHEET: 'Timesheet',
  CONFIRMATION: 'Confirmation',
  SALARY_REVISION: 'Salary revision',
  REQUISITION: 'Hiring requisition',
  OFFER: 'Offer approval',
  TRANSFER: 'Transfer / promotion',
};

/** Module decide endpoints (body `{ decision, remarks? }`) — fallback when an item has no `decidePath`. */
export const DECIDE_PATHS: Record<ApprovalModule, (id: string) => string> = {
  LEAVE: (id) => `/leaves/${id}/decide`,
  EXPENSE: (id) => `/expenses/${id}/decide`,
  REGULARIZATION: (id) => `/attendance/regularizations/${id}/decide`,
  OVERTIME: (id) => `/overtime/${id}/decide`,
  COMP_OFF: (id) => `/leaves/comp-off/${id}/decide`,
  ENCASHMENT: (id) => `/leaves/encashments/${id}/decide`,
  LOAN: (id) => `/loans/${id}/decide`,
  RESIGNATION: (id) => `/exits/${id}/decide`,
  TRAVEL: (id) => `/travel/${id}/decide`,
  TIMESHEET: (id) => `/timesheets/${id}/decide`,
  CONFIRMATION: (id) => `/confirmations/${id}/decide`,
  SALARY_REVISION: (id) => `/salary/revisions/${id}/decide`,
  REQUISITION: (id) => `/recruitment/requisitions/${id}/decide`,
  OFFER: (id) => `/recruitment/offers/${id}/decide`,
  TRANSFER: (id) => `/transfers/${id}/decide`,
};

export interface TrailStep {
  id: string;
  level: number;
  approverType: string;
  approverRole: string | null;
  approverName: string | null;
  status: string;
  actedByName: string | null;
  remarks: string | null;
  actedAt: string | null;
  createdAt: string;
}

const typeLabel: Record<string, string> = {
  MANAGER: 'Reporting manager',
  MANAGERS_MANAGER: "Manager's manager",
  DEPARTMENT_HEAD: 'Department head',
  ROLE: 'Role',
  EMPLOYEE: 'Named approver',
};

/** Vertical timeline of a request's approval chain. */
export function ApprovalTrail({ module, requestId }: { module: ApprovalModule; requestId: string }) {
  const { data, loading, error } = useFetch<TrailStep[]>(`/approvals/trail/${module}/${requestId}`);
  if (loading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  if (!data || data.length === 0) {
    return <p className="text-sm text-ink-400">No approval chain yet — it is created on the first decision.</p>;
  }
  return (
    <ol className="relative space-y-4 border-l border-ink-200 pl-5">
      {data.map((s) => (
        <li key={s.id} className="relative">
          <span
            className={`absolute -left-[26px] top-1 h-3 w-3 rounded-full ring-4 ring-white ${
              s.status === 'APPROVED' ? 'bg-emerald-500' : s.status === 'REJECTED' ? 'bg-rose-500' : s.status === 'PENDING' ? 'bg-amber-400' : 'bg-ink-300'
            }`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink-800">
              Level {s.level} · {s.approverName ?? '—'}
            </span>
            <Badge tone={statusTone(s.status)}>{s.status}</Badge>
          </div>
          <p className="text-xs text-ink-400">
            {typeLabel[s.approverType] ?? s.approverType}
            {s.actedAt && ` · ${s.actedByName ?? 'someone'} on ${fmtDate(s.actedAt)}`}
          </p>
          {s.remarks && <p className="mt-1 rounded-lg bg-ink-50 px-2.5 py-1.5 text-sm text-ink-600">“{s.remarks}”</p>}
        </li>
      ))}
    </ol>
  );
}

/** Approve / reject dialog with remarks; posts to the module's decide endpoint. */
export function DecideModal({
  title,
  path,
  decision,
  onClose,
  onDone,
}: {
  title: string;
  path: string;
  decision: 'APPROVED' | 'REJECTED';
  onClose: () => void;
  onDone: () => void;
}) {
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await api(path, { method: 'POST', body: { decision, ...(remarks.trim() ? { remarks: remarks.trim() } : {}) } });
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
      <div className="space-y-3">
        <ErrorNote error={error} />
        <Field label={decision === 'REJECTED' ? 'Reason (shared with the employee)' : 'Remarks (optional)'}>
          <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} />
        </Field>
        <Button
          variant={decision === 'APPROVED' ? 'primary' : 'danger'}
          onClick={() => void submit()}
          disabled={busy || (decision === 'REJECTED' && remarks.trim().length < 2)}
          className="w-full"
        >
          {decision === 'APPROVED' ? 'Approve' : 'Reject'}
        </Button>
      </div>
    </Modal>
  );
}
