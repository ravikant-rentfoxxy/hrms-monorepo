'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, Card, Empty, ErrorNote, Modal, PageHeader, Spinner, Table, Tabs, Td, statusTone } from '@/components/ui';
import { ApprovalTrail, DecideModal } from '@/components/approvals';
import { errText } from '@/components/lifecycle';
import { RaiseTransferModal, TRANSFER_TYPE_LABEL } from '@/components/career';

interface Placement {
  department: string;
  designation: string;
  manager: string;
  office: string;
  grade: string;
}

interface Transfer {
  id: string;
  employeeId: string;
  type: string;
  effectiveDate: string;
  reason: string;
  status: string;
  remarks: string | null;
  incrementPercent: number;
  appliedAt: string | null;
  createdAt: string;
  before: Placement | null;
  to: { department: string | null; designation: string | null; manager: string | null; office: string | null; grade: string | null };
  requestedByName: string | null;
  canDecide: boolean;
  canCancel: boolean;
  employee: { id: string; name: string; employeeCode: string; designation: string; department: string; managerId: string | null };
}

interface DirectoryRow {
  id: string;
  name: string;
  employeeCode: string;
  manager: { id: string } | null;
}

const STATUS_TABS = ['Pending', 'Approved', 'Applied', 'All'];
const TAB_STATUS: Record<string, string> = { Pending: 'PENDING', Approved: 'APPROVED', Applied: 'APPLIED' };

/** "Sales → Marketing; Engineer → Senior Engineer" from the snapshot + targets. */
function changeSummary(t: Transfer): string {
  const b = t.before;
  const parts: string[] = [];
  const add = (label: string, from: string | undefined, to: string | null) => {
    if (to) parts.push(`${label}: ${from || '—'} → ${to}`);
  };
  add('Dept', b?.department, t.to.department);
  add('Designation', b?.designation, t.to.designation);
  add('Grade', b?.grade, t.to.grade);
  add('Manager', b?.manager, t.to.manager);
  add('Location', b?.office, t.to.office);
  return parts.join(' · ');
}

export default function TransfersPage() {
  const { session, isCompanyAdmin, isManagerial } = useAuth();
  const [tab, setTab] = useState(isManagerial ? 'Pending' : 'All');
  const status = TAB_STATUS[tab];
  // Plain employees only see their own history.
  const { data, loading, error, reload } = useFetch<Transfer[]>(
    isManagerial ? `/transfers${status ? `?status=${status}` : ''}` : '/transfers/me'
  );
  const { data: directory } = useFetch<{ items: DirectoryRow[] }>(isManagerial ? '/employees?pageSize=100' : null);
  const raisable = (directory?.items ?? []).filter(
    (e) => e.id !== session?.employee?.id && (isCompanyAdmin || e.manager?.id === session?.employee?.id)
  );
  const [raise, setRaise] = useState(false);
  const [deciding, setDeciding] = useState<{ item: Transfer; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const [detail, setDetail] = useState<Transfer | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const post = async (path: string, body: unknown = {}) => {
    setActionError(null);
    try {
      await api(path, { method: 'POST', body });
      reload();
    } catch (err) {
      setActionError(errText(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Transfers & promotions"
        subtitle={
          isManagerial
            ? 'Department transfers, promotions, designation, manager and location changes — approved through the Transfer chain'
            : 'Your transfer and promotion history'
        }
        actions={isManagerial && raisable.length > 0 ? <Button onClick={() => setRaise(true)}>+ Raise request</Button> : undefined}
      />
      {isManagerial && <Tabs tabs={STATUS_TABS} active={tab} onChange={setTab} />}
      <ErrorNote error={error ?? actionError} />
      <Card>
        {loading ? (
          <Spinner />
        ) : !data || data.length === 0 ? (
          <Empty message="No transfer or promotion requests" />
        ) : (
          <Table headers={['Employee', 'Type', 'Change', 'Effective', 'Status', '']}>
            {data.map((t) => (
              <tr key={t.id} className="hover:bg-ink-50">
                <Td>
                  <Link href={`/employees/${t.employee.id}`} className="font-medium text-brand-700 hover:underline">
                    {t.employee.name}
                  </Link>
                  <span className="block text-xs text-ink-400">
                    {t.employee.employeeCode}
                    {t.requestedByName ? ` · raised by ${t.requestedByName}` : ''}
                  </span>
                </Td>
                <Td>
                  {TRANSFER_TYPE_LABEL[t.type] ?? t.type}
                  {t.incrementPercent > 0 && <span className="block text-xs text-violet-600">+{t.incrementPercent}% increment</span>}
                </Td>
                <Td className="max-w-md text-xs text-ink-600">{changeSummary(t) || '—'}</Td>
                <Td>{fmtDate(t.effectiveDate)}</Td>
                <Td>
                  <Badge tone={t.status === 'APPLIED' ? 'green' : t.status === 'APPROVED' ? 'blue' : statusTone(t.status)}>{t.status}</Badge>
                </Td>
                <Td className="whitespace-nowrap text-right">
                  <Button variant="ghost" onClick={() => setDetail(t)}>
                    Details
                  </Button>
                  {t.canDecide && (
                    <>
                      <Button variant="ghost" onClick={() => setDeciding({ item: t, decision: 'APPROVED' })}>
                        Approve
                      </Button>
                      <Button variant="ghost" onClick={() => setDeciding({ item: t, decision: 'REJECTED' })}>
                        Reject
                      </Button>
                    </>
                  )}
                  {isCompanyAdmin && t.status === 'APPROVED' && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (confirm(`Apply this change to ${t.employee.name} now (before ${fmtDate(t.effectiveDate)})?`)) void post(`/transfers/${t.id}/apply`);
                      }}
                    >
                      Apply now
                    </Button>
                  )}
                  {t.canCancel && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (confirm('Cancel this request?')) void post(`/transfers/${t.id}/cancel`);
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {raise && (
        <RaiseTransferModal
          employees={raisable}
          onClose={() => setRaise(false)}
          onDone={() => {
            setRaise(false);
            reload();
          }}
        />
      )}
      {deciding && (
        <DecideModal
          title={`${deciding.decision === 'APPROVED' ? 'Approve' : 'Reject'} — ${deciding.item.employee.name}`}
          path={`/transfers/${deciding.item.id}/decide`}
          decision={deciding.decision}
          onClose={() => setDeciding(null)}
          onDone={reload}
        />
      )}
      {detail && (
        <Modal title={`${TRANSFER_TYPE_LABEL[detail.type] ?? detail.type} — ${detail.employee.name}`} open onClose={() => setDetail(null)} wide>
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <p>
                <span className="block text-xs uppercase text-ink-400">Effective</span>
                {fmtDate(detail.effectiveDate)}
              </p>
              <p>
                <span className="block text-xs uppercase text-ink-400">Status</span>
                {detail.status}
                {detail.appliedAt ? ` on ${fmtDate(detail.appliedAt)}` : ''}
              </p>
            </div>
            <p className="text-ink-700">{changeSummary(detail)}</p>
            <p className="rounded-lg bg-ink-50 px-3 py-2 text-ink-600">“{detail.reason}”</p>
            {detail.remarks && <p className="text-xs text-amber-700">{detail.remarks}</p>}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">Approval trail</p>
              <ApprovalTrail module="TRANSFER" requestId={detail.id} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
