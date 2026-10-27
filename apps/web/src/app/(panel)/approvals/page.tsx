'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtMoney } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Avatar, Badge, Button, Card, Empty, ErrorNote, Modal, PageHeader, Select, Spinner } from '@/components/ui';
import {
  APPROVAL_MODULES, ApprovalTrail, DECIDE_PATHS, DecideModal, MODULE_LABELS, type ApprovalModule,
} from '@/components/approvals';

interface InboxItem {
  stepId: string;
  module: ApprovalModule;
  moduleLabel: string;
  requestId: string;
  level: number;
  totalLevels: number;
  approverType: string;
  approverRole: string | null;
  canAct: boolean;
  waitingSince: string;
  requester: { id: string; name: string; employeeCode: string; designation: string; department: string; avatarColor: string } | null;
  summary: {
    title: string;
    description: string;
    amount: number | null;
    fromDate: string | null;
    toDate: string | null;
    submittedAt: string | null;
  };
  decidePath: string;
}

const dateRange = (from: string | null, to: string | null) =>
  !from ? null : to && to.slice(0, 10) !== from.slice(0, 10) ? `${fmtDate(from)} → ${fmtDate(to)}` : fmtDate(from);

export default function ApprovalsPage() {
  const { isCompanyAdmin } = useAuth();
  const [module, setModule] = useState<'' | ApprovalModule>('');
  const [all, setAll] = useState(false);
  const { data, loading, error, reload } = useFetch<InboxItem[]>(
    `/approvals/inbox?${new URLSearchParams({ ...(module ? { module } : {}), ...(all ? { all: 'true' } : {}) }).toString()}`
  );
  const [deciding, setDeciding] = useState<{ item: InboxItem; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const [trailFor, setTrailFor] = useState<InboxItem | null>(null);

  const counts = new Map<string, number>();
  for (const i of data ?? []) counts.set(i.module, (counts.get(i.module) ?? 0) + 1);

  return (
    <div>
      <PageHeader
        title="Approvals"
        subtitle="Every request waiting on your decision — leave, expenses, attendance, loans and more"
        actions={
          <div className="flex items-center gap-2">
            {isCompanyAdmin && (
              <label className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2 text-xs font-medium text-ink-600 shadow-sm">
                <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
                All pending in company
              </label>
            )}
            <div className="w-52">
              <Select value={module} onChange={(e) => setModule(e.target.value as '' | ApprovalModule)}>
                <option value="">All modules</option>
                {APPROVAL_MODULES.map((m) => (
                  <option key={m} value={m}>
                    {MODULE_LABELS[m]}
                    {!module && counts.get(m) ? ` (${counts.get(m)})` : ''}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        }
      />

      <ErrorNote error={error} />

      {loading ? (
        <Spinner />
      ) : !data || data.length === 0 ? (
        <Card>
          <Empty message="Nothing waiting for you — all caught up" />
        </Card>
      ) : (
        <div className="space-y-3">
          {data.map((item) => {
            const range = dateRange(item.summary.fromDate, item.summary.toDate);
            return (
              <Card key={item.stepId} className="p-4">
                <div className="flex flex-wrap items-start gap-4">
                  {item.requester && <Avatar name={item.requester.name} color={item.requester.avatarColor} />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink-900">{item.requester?.name ?? 'Unknown employee'}</span>
                      <span className="text-xs text-ink-400">
                        {item.requester?.employeeCode}
                        {item.requester?.department ? ` · ${item.requester.department}` : ''}
                      </span>
                      <Badge tone="violet">{item.moduleLabel}</Badge>
                      {item.totalLevels > 1 && (
                        <Badge tone="blue">
                          Level {item.level} of {item.totalLevels}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-medium text-ink-800">{item.summary.title}</p>
                    {item.summary.description && (
                      <p className="mt-0.5 line-clamp-2 text-sm text-ink-500">{item.summary.description}</p>
                    )}
                    <p className="mt-1 text-xs text-ink-400">
                      {range && <>{range} · </>}
                      {item.summary.amount !== null && item.module !== 'SALARY_REVISION' && <>{fmtMoney(item.summary.amount)} · </>}
                      waiting since {fmtDate(item.waitingSince)}
                      {item.approverRole && ` · ${item.approverRole} step`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="ghost" onClick={() => setTrailFor(item)}>
                      Timeline
                    </Button>
                    <Button variant="danger" disabled={!item.canAct} onClick={() => setDeciding({ item, decision: 'REJECTED' })}>
                      Reject
                    </Button>
                    <Button disabled={!item.canAct} onClick={() => setDeciding({ item, decision: 'APPROVED' })}>
                      Approve
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {deciding && (
        <DecideModal
          title={`${deciding.decision === 'APPROVED' ? 'Approve' : 'Reject'} — ${deciding.item.requester?.name ?? ''} · ${deciding.item.moduleLabel}`}
          path={deciding.item.decidePath || DECIDE_PATHS[deciding.item.module](deciding.item.requestId)}
          decision={deciding.decision}
          onClose={() => setDeciding(null)}
          onDone={reload}
        />
      )}

      <Modal
        title={trailFor ? `Approval timeline — ${trailFor.moduleLabel}` : ''}
        open={!!trailFor}
        onClose={() => setTrailFor(null)}
      >
        {trailFor && <ApprovalTrail module={trailFor.module} requestId={trailFor.requestId} />}
      </Modal>
    </div>
  );
}
