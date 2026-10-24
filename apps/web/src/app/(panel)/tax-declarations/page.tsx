'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate, fmtMoney } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Stat, Table, Tabs, Td } from '@/components/ui';

interface Item {
  section: string;
  label: string;
  declared: number;
  approved?: number | null;
  rentPerMonth?: number;
  months?: number;
  landlordName?: string;
  landlordPan?: string;
  metro?: boolean;
  forParents?: boolean;
  seniorCitizen?: boolean;
}

interface Proof {
  id: string;
  section: string;
  name: string;
  mimeType: string;
  size: number;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  uploadedOn: string;
}

interface SectionSummary {
  section: string;
  title: string;
  declared: number;
  cap: number | null;
  eligible: number;
}

interface Declaration {
  id: string;
  fy: string;
  regime: string;
  status: string;
  items: Item[];
  previousEmployerIncome: number;
  previousEmployerTds: number;
  submittedAt: string | null;
  verifiedAt: string | null;
  remarks: string | null;
  proofs: Proof[];
  summary: { sections: SectionSummary[]; totalDeclared: number; totalEligible: number; warnings: string[] };
  employee: { id: string; name: string; employeeCode: string; department: string; pan: string };
}

interface ListRow {
  id: string;
  regime: string;
  status: string;
  submittedAt: string | null;
  verifiedAt: string | null;
  employee: { id: string; name: string; employeeCode: string; department: string };
  totalDeclared: number;
  totalEligible: number;
  totalApproved: number;
  proofs: number;
  proofsPending: number;
}

interface ListResponse {
  fy: string;
  counts: Record<string, number>;
  notStarted: number;
  items: ListRow[];
}

const tone = (s: string) =>
  (({ DRAFT: 'slate', SUBMITTED: 'amber', VERIFIED: 'green', REJECTED: 'red', PENDING: 'amber', ACCEPTED: 'green' }) as const)[
    s as 'DRAFT'
  ] ?? 'slate';

/** "2026-27" for the FY containing `d` (April–March). */
const fyOf = (d: Date) => {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};

const itemDetail = (i: Item) => {
  if (i.section === 'HRA') {
    return `₹${i.rentPerMonth ?? 0}/month × ${i.months ?? 12} · ${i.landlordName || 'landlord ?'}${i.landlordPan ? ` (PAN ${i.landlordPan})` : ''}${i.metro ? ' · metro' : ''}`;
  }
  if (i.section === '80D') return `${i.forParents ? 'Parents' : 'Self / family'}${i.seniorCitizen ? ' · senior citizen' : ''}`;
  return '';
};

function VerifyModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const { data, loading, error } = useFetch<Declaration>(`/tax-declarations/${id}`);
  const [approved, setApproved] = useState<Record<number, string>>({});
  const [proofStatus, setProofStatus] = useState<Record<string, Proof['status']>>({});
  const [remarks, setRemarks] = useState('');
  const [viewer, setViewer] = useState<{ url: string; name: string; mimeType: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const view = async (p: Proof) => {
    try {
      const { url } = await api<{ url: string }>(`/tax-declarations/${id}/proofs/${p.id}/download?inline=1`);
      setViewer({ url, name: p.name, mimeType: p.mimeType });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to open proof');
    }
  };

  // Default approved amount: what HR already approved, else the declared amount.
  const approvedFor = (i: number, item: Item) => approved[i] ?? String(item.approved ?? item.declared);

  const verify = async () => {
    if (!data) return;
    setBusy(true);
    setActionError(null);
    try {
      await api(`/tax-declarations/${id}/verify`, {
        method: 'POST',
        body: {
          items: data.items.map((item, index) => ({ index, approved: Number(approvedFor(index, item)) || 0 })),
          proofs: data.proofs.map((p) => ({ id: p.id, status: proofStatus[p.id] ?? (p.status === 'PENDING' ? 'ACCEPTED' : p.status) })),
          ...(remarks ? { remarks } : {}),
        },
      });
      onDone();
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const sendBack = async () => {
    if (remarks.trim().length < 3) {
      setActionError('Add remarks explaining what needs to change');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await api(`/tax-declarations/${id}/reject`, { method: 'POST', body: { remarks } });
      onDone();
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Verify tax declaration" open onClose={onClose} wide>
      {loading || !data ? (
        error ? <ErrorNote error={error} /> : <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-slate-900">{data.employee.name}</p>
              <p className="text-xs text-slate-500">
                {data.employee.employeeCode} · PAN {data.employee.pan || '—'} · FY {data.fy} · submitted {fmtDate(data.submittedAt)}
              </p>
            </div>
            <div className="flex gap-2">
              <Badge tone={data.regime === 'OLD' ? 'violet' : 'blue'}>{data.regime} regime</Badge>
              <Badge tone={tone(data.status)}>{data.status}</Badge>
            </div>
          </div>

          {data.items.length === 0 ? (
            <Empty message="No investments declared (regime choice only)" />
          ) : (
            <Table headers={['Section', 'Item', 'Declared', 'Approved']}>
              {data.items.map((item, i) => (
                <tr key={i}>
                  <Td className="font-mono text-xs font-semibold">{item.section}</Td>
                  <Td>
                    <p>{item.label}</p>
                    {itemDetail(item) && <p className="text-xs text-slate-400">{itemDetail(item)}</p>}
                  </Td>
                  <Td>{fmtMoney(item.declared)}</Td>
                  <Td>
                    <Input
                      type="number"
                      className="w-32"
                      value={approvedFor(i, item)}
                      onChange={(e) => setApproved({ ...approved, [i]: e.target.value })}
                    />
                  </Td>
                </tr>
              ))}
            </Table>
          )}

          {data.summary.sections.length > 0 && (
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              {data.summary.sections.map((s) => (
                <div key={s.section} className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="font-semibold text-slate-700">{s.section}</p>
                  <p className="text-slate-500">
                    {fmtMoney(s.declared)} declared{s.cap !== null ? ` · cap ${fmtMoney(s.cap)}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
          {data.summary.warnings.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-amber-700">
              {data.summary.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {(data.previousEmployerIncome > 0 || data.previousEmployerTds > 0) && (
            <p className="text-sm text-slate-600">
              Previous employer: income {fmtMoney(data.previousEmployerIncome)} · TDS {fmtMoney(data.previousEmployerTds)}
            </p>
          )}

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Proofs</p>
            {data.proofs.length === 0 ? (
              <p className="text-sm text-slate-400">No proofs uploaded</p>
            ) : (
              data.proofs.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 border-b border-slate-100 py-1.5 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-xs text-slate-500">{p.section}</span> · {p.name}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="ghost" onClick={() => void view(p)}>
                      View
                    </Button>
                    <Select
                      className="w-32"
                      value={proofStatus[p.id] ?? (p.status === 'PENDING' ? 'ACCEPTED' : p.status)}
                      onChange={(e) => setProofStatus({ ...proofStatus, [p.id]: e.target.value as Proof['status'] })}
                    >
                      <option value="ACCEPTED">Accept</option>
                      <option value="REJECTED">Reject</option>
                      <option value="PENDING">Pending</option>
                    </Select>
                  </div>
                </div>
              ))
            )}
          </div>

          {viewer && (
            <div className="rounded-xl border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-sm">
                <span className="truncate font-medium">{viewer.name}</span>
                <div className="flex gap-1">
                  <Button variant="ghost" onClick={() => window.open(viewer.url, '_blank')}>
                    Open
                  </Button>
                  <Button variant="ghost" onClick={() => setViewer(null)}>
                    Close
                  </Button>
                </div>
              </div>
              {viewer.mimeType.startsWith('image/') ? (
                // eslint-disable-next-line @next/next/no-img-element -- presigned bucket URL, not an optimisable asset
                <img src={viewer.url} alt={viewer.name} className="max-h-[420px] w-full object-contain" />
              ) : (
                <iframe src={viewer.url} title={viewer.name} className="h-[420px] w-full rounded-b-xl" />
              )}
            </div>
          )}

          <Field label="Remarks">
            <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Required when sending back" />
          </Field>
          <ErrorNote error={actionError} />
          {(data.status === 'SUBMITTED' || data.status === 'VERIFIED') && (
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => void verify()}>
                {data.status === 'VERIFIED' ? 'Update verification' : 'Verify'}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void sendBack()}>
                Send back
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

const STATUS_TABS: Record<string, string> = { 'To verify': 'SUBMITTED', Verified: 'VERIFIED', 'Sent back': 'REJECTED', Drafts: 'DRAFT', All: '' };

export default function TaxDeclarationsPage() {
  const { isCompanyAdmin } = useAuth();
  const current = fyOf(new Date());
  const prevYear = Number(current.slice(0, 4)) - 1;
  const fys = [current, `${prevYear}-${String((prevYear + 1) % 100).padStart(2, '0')}`];
  const [fy, setFy] = useState(current);
  const [tab, setTab] = useState('To verify');
  const status = STATUS_TABS[tab] ?? '';
  const { data, loading, error, reload } = useFetch<ListResponse>(
    isCompanyAdmin ? `/tax-declarations?fy=${fy}${status ? `&status=${status}` : ''}` : null
  );
  const [openId, setOpenId] = useState<string | null>(null);

  if (!isCompanyAdmin) {
    return (
      <div>
        <PageHeader title="Tax declarations" />
        <Card>
          <Empty message="Employees declare investments from the mobile app" />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Tax declarations"
        subtitle="Investment declarations and proofs — verified amounts feed TDS in payroll"
        actions={
          <Select value={fy} onChange={(e) => setFy(e.target.value)} className="w-36">
            {fys.map((f) => (
              <option key={f} value={f}>
                FY {f}
              </option>
            ))}
          </Select>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="To verify" value={data?.counts.SUBMITTED ?? 0} accent="text-amber-600" icon="receipt" />
        <Stat label="Verified" value={data?.counts.VERIFIED ?? 0} accent="text-emerald-600" icon="check" />
        <Stat label="Drafts / sent back" value={(data?.counts.DRAFT ?? 0) + (data?.counts.REJECTED ?? 0)} icon="history" />
        <Stat label="Not started" value={data?.notStarted ?? 0} icon="users" />
      </div>
      <Tabs tabs={Object.keys(STATUS_TABS)} active={tab} onChange={setTab} />
      <ErrorNote error={error} />
      <Card>
        {loading ? (
          <Spinner />
        ) : !data || data.items.length === 0 ? (
          <Empty message="No declarations here" />
        ) : (
          <Table headers={['Employee', 'Regime', 'Declared', 'Eligible', 'Approved', 'Proofs', 'Submitted', 'Status', '']}>
            {data.items.map((d) => (
              <tr key={d.id}>
                <Td>
                  <p className="font-medium text-slate-900">{d.employee.name}</p>
                  <p className="text-xs text-slate-400">
                    {d.employee.employeeCode} · {d.employee.department || '—'}
                  </p>
                </Td>
                <Td>{d.regime}</Td>
                <Td>{fmtMoney(d.totalDeclared)}</Td>
                <Td>{fmtMoney(d.totalEligible)}</Td>
                <Td>{d.status === 'VERIFIED' ? fmtMoney(d.totalApproved) : '—'}</Td>
                <Td>
                  {d.proofs}
                  {d.proofsPending > 0 && <span className="text-xs text-amber-600"> ({d.proofsPending} new)</span>}
                </Td>
                <Td>{fmtDate(d.submittedAt)}</Td>
                <Td>
                  <Badge tone={tone(d.status)}>{d.status}</Badge>
                </Td>
                <Td>
                  <Button variant="ghost" onClick={() => setOpenId(d.id)}>
                    {d.status === 'SUBMITTED' ? 'Review' : 'View'}
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {openId && <VerifyModal id={openId} onClose={() => setOpenId(null)} onDone={reload} />}
    </div>
  );
}
