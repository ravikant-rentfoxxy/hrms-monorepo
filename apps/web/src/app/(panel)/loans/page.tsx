'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate, fmtMoney } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, MonthPicker, PageHeader, Select, Spinner, Table, Tabs, Td,
  Textarea, statusTone,
} from '@/components/ui';

interface Loan {
  id: string;
  type: 'LOAN' | 'SALARY_ADVANCE';
  principal: number;
  interestRate: number;
  tenureMonths: number;
  emi: number;
  startMonth: string | null;
  balance: number;
  status: string;
  reason: string;
  remarks: string | null;
  appliedOn: string;
  employee: { id: string; name: string; employeeCode: string; department: string };
  currentStep: { level: number; approverRole: string | null } | null;
}

interface ScheduleRow {
  installment: number;
  month: string;
  emi: number;
  interest: number;
  principal: number;
  closingBalance: number;
  paid?: number | null;
}

interface LoanDetail extends Loan {
  totalRepayable: number;
  totalInterest: number;
  paid: number;
  schedule: ScheduleRow[];
  extraRepayments: { id: string; month: string; amount: number }[];
  trail: { id: string; level: number; status: string; approverName: string | null; actedByName: string | null; remarks: string | null }[];
}

interface EmiPreview {
  emi: number;
  totalRepayable: number;
  totalInterest: number;
}

const loanTone = (s: string) => (s === 'ACTIVE' ? 'blue' : statusTone(s));
const typeLabel = (t: string) => (t === 'SALARY_ADVANCE' ? 'Salary advance' : 'Loan');
const monthName = (d: string) => new Date(d).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
const errMsg = (err: unknown) => (err instanceof Error ? err.message : 'Failed');

function ApplyModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { session, isCompanyAdmin } = useAuth();
  const { data: directory } = useFetch<{ items: { id: string; name: string; employeeCode: string }[] }>(
    isCompanyAdmin ? '/employees?pageSize=100' : null
  );
  const [employeeId, setEmployeeId] = useState(session?.employee?.id ?? '');
  const [type, setType] = useState<'LOAN' | 'SALARY_ADVANCE'>('LOAN');
  const [principal, setPrincipal] = useState('');
  const [tenure, setTenure] = useState('12');
  const [rate, setRate] = useState('0');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<EmiPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const p = Number(principal);
    const n = Number(tenure);
    if (!(p > 0) || !(n >= 1)) return;
    const t = setTimeout(() => {
      api<EmiPreview>(`/loans/emi-preview?principal=${p}&tenureMonths=${n}&interestRate=${Number(rate) || 0}`)
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 300);
    return () => clearTimeout(t);
  }, [principal, tenure, rate]);

  const changeType = (t: 'LOAN' | 'SALARY_ADVANCE') => {
    setType(t);
    if (t === 'SALARY_ADVANCE') {
      setTenure('1');
      setRate('0');
    } else setTenure('12');
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/loans', {
        method: 'POST',
        body: {
          type,
          principal: Number(principal),
          tenureMonths: Number(tenure),
          reason,
          ...(isCompanyAdmin && employeeId && employeeId !== session?.employee?.id ? { employeeId } : {}),
          ...(isCompanyAdmin && Number(rate) > 0 ? { interestRate: Number(rate) } : {}),
        },
      });
      onDone();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Loan / salary advance request" open onClose={onClose}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        {isCompanyAdmin && (
          <Field label="Employee">
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">— select —</option>
              {directory?.items.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.employeeCode})
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={type} onChange={(e) => changeType(e.target.value as 'LOAN' | 'SALARY_ADVANCE')}>
              <option value="LOAN">Loan</option>
              <option value="SALARY_ADVANCE">Salary advance</option>
            </Select>
          </Field>
          <Field label="Amount (₹)">
            <Input type="number" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
          </Field>
          <Field label="Tenure (months)" hint={type === 'SALARY_ADVANCE' ? '1–3 months' : 'Up to 60 months'}>
            <Input type="number" min={1} max={type === 'SALARY_ADVANCE' ? 3 : 60} value={tenure} onChange={(e) => setTenure(e.target.value)} />
          </Field>
          {isCompanyAdmin && type === 'LOAN' && (
            <Field label="Interest (% p.a.)">
              <Input type="number" value={rate} onChange={(e) => setRate(e.target.value)} />
            </Field>
          )}
        </div>
        {preview && Number(principal) > 0 && (
          <div className="rounded-xl bg-indigo-50 px-4 py-3 text-sm">
            EMI <b>{fmtMoney(preview.emi)}</b> × {tenure} months
            {preview.totalInterest > 0 && <> · interest {fmtMoney(preview.totalInterest)}</>} · total {fmtMoney(preview.totalRepayable)}
          </div>
        )}
        <Field label="Reason">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Button onClick={() => void submit()} disabled={busy || !employeeId || !(Number(principal) > 0) || reason.length < 3} className="w-full">
          Submit request
        </Button>
      </div>
    </Modal>
  );
}

function LoanModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { session, isCompanyAdmin, isManagerial } = useAuth();
  const { data, loading, error, reload } = useFetch<LoanDetail>(`/loans/${id}`);
  const [remarks, setRemarks] = useState('');
  const [rate, setRate] = useState<string | null>(null);
  const [startMonth, setStartMonth] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const post = async (path: string, body: object) => {
    setBusy(true);
    setActionError(null);
    try {
      await api(`/loans/${id}/${path}`, { method: 'POST', body });
      reload();
      onChanged();
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const decide = (decision: 'APPROVED' | 'REJECTED') =>
    post('decide', {
      decision,
      ...(remarks ? { remarks } : {}),
      ...(isCompanyAdmin && rate !== null && rate !== '' ? { interestRate: Number(rate) } : {}),
      ...(isCompanyAdmin && startMonth ? { startMonth } : {}),
    });

  const own = data?.employee.id === session?.employee?.id;

  return (
    <Modal title={data ? `${typeLabel(data.type)} — ${data.employee.name}` : 'Loan'} open onClose={onClose} wide>
      {loading || !data ? (
        error ? <ErrorNote error={error} /> : <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">Principal</p>
              <p className="font-semibold">{fmtMoney(data.principal)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">EMI</p>
              <p className="font-semibold">
                {fmtMoney(data.emi)} × {data.tenureMonths}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Interest</p>
              <p className="font-semibold">
                {data.interestRate}% · {fmtMoney(data.totalInterest)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Outstanding</p>
              <p className="font-semibold">{fmtMoney(data.balance)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Badge tone={loanTone(data.status)}>{data.status}</Badge>
            <span>
              Applied {fmtDate(data.appliedOn)}
              {data.startMonth ? ` · EMIs from ${monthName(data.startMonth)}` : ''} · recovered {fmtMoney(data.paid)}
            </span>
          </div>
          <p className="text-sm text-slate-600">{data.reason}</p>
          {data.remarks && <p className="text-sm text-slate-500">Remarks: {data.remarks}</p>}

          <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-100">
            <Table headers={['#', 'Month', 'EMI', 'Interest', 'Principal', 'Balance', 'Recovered']}>
              {data.schedule.map((r) => (
                <tr key={r.installment}>
                  <Td>{r.installment}</Td>
                  <Td>{monthName(r.month)}</Td>
                  <Td>{fmtMoney(r.emi)}</Td>
                  <Td>{fmtMoney(r.interest)}</Td>
                  <Td>{fmtMoney(r.principal)}</Td>
                  <Td>{fmtMoney(r.closingBalance)}</Td>
                  <Td>{r.paid != null ? <span className="text-emerald-700">{fmtMoney(r.paid)}</span> : '—'}</Td>
                </tr>
              ))}
            </Table>
          </div>
          {data.extraRepayments.length > 0 && (
            <p className="text-xs text-slate-500">
              Other recoveries: {data.extraRepayments.map((r) => `${monthName(r.month)} ${fmtMoney(r.amount)}`).join(', ')}
            </p>
          )}
          {data.trail.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Approval trail</p>
              {data.trail.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-1 text-sm">
                  <span>
                    L{s.level} · {s.approverName ?? '—'}
                    {s.actedByName ? ` (by ${s.actedByName})` : ''}
                    {s.remarks ? ` — ${s.remarks}` : ''}
                  </span>
                  <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                </div>
              ))}
            </div>
          )}

          <ErrorNote error={actionError} />
          {data.status === 'PENDING' && !own && isManagerial && (
            <div className="space-y-2 rounded-xl bg-slate-50 p-3">
              {isCompanyAdmin && (
                <div className="grid grid-cols-2 gap-3">
                  {data.type === 'LOAN' && (
                    <Field label="Interest (% p.a.)">
                      <Input type="number" value={rate ?? String(data.interestRate)} onChange={(e) => setRate(e.target.value)} />
                    </Field>
                  )}
                  <Field label="First EMI month" hint="Default: next month">
                    <MonthPicker value={startMonth} onChange={setStartMonth} />
                  </Field>
                </div>
              )}
              <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Remarks (optional)" />
              <div className="flex gap-2">
                <Button disabled={busy} onClick={() => void decide('APPROVED')}>
                  Approve
                </Button>
                <Button variant="danger" disabled={busy} onClick={() => void decide('REJECTED')}>
                  Reject
                </Button>
              </div>
            </div>
          )}
          {data.status === 'PENDING' && (own || isCompanyAdmin) && (
            <Button variant="secondary" disabled={busy} onClick={() => void post('cancel', {})}>
              Cancel request
            </Button>
          )}
          {data.status === 'ACTIVE' && isCompanyAdmin && (
            <div className="space-y-2 rounded-xl bg-slate-50 p-3">
              <p className="text-xs text-slate-500">
                Close early when the outstanding {fmtMoney(data.balance)} is settled outside payroll — EMIs stop.
              </p>
              <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Foreclosure remarks (required)" />
              <Button
                variant="danger"
                disabled={busy || remarks.trim().length < 3}
                onClick={() => confirm('Close this loan now?') && void post('close', { remarks })}
              >
                Foreclose
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function LoansPage() {
  const { session, isManagerial, isCompanyAdmin } = useAuth();
  const tabs = [
    ...(isManagerial ? ['Approvals', isCompanyAdmin ? 'All loans' : 'Team loans'] : []),
    ...(session?.employee ? ['My loans'] : []),
  ];
  const [tab, setTab] = useState(tabs[0] ?? 'My loans');
  const scope = isCompanyAdmin ? 'company' : 'team';
  const [status, setStatus] = useState('');
  const path =
    tab === 'Approvals'
      ? `/loans?scope=${scope}&status=PENDING`
      : tab === 'My loans'
        ? '/loans?scope=me'
        : `/loans?scope=${scope}${status ? `&status=${status}` : ''}`;
  const { data, loading, error, reload } = useFetch<Loan[]>(path);
  const [applying, setApplying] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const showEmployee = tab !== 'My loans';

  return (
    <div>
      <PageHeader
        title="Loans & advances"
        subtitle="Employee loans and salary advances, recovered as EMIs through payroll"
        actions={session?.employee || isCompanyAdmin ? <Button onClick={() => setApplying(true)}>+ New request</Button> : undefined}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        {tabs.length > 1 && <Tabs tabs={tabs} active={tab} onChange={setTab} />}
        {(tab === 'All loans' || tab === 'Team loans') && (
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="">All statuses</option>
            {['PENDING', 'ACTIVE', 'CLOSED', 'REJECTED', 'CANCELLED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        )}
      </div>
      <ErrorNote error={error} />
      <Card>
        {loading ? (
          <Spinner />
        ) : !data || data.length === 0 ? (
          <Empty message={tab === 'Approvals' ? 'Nothing waiting for approval' : 'No loans or advances'} />
        ) : (
          <Table headers={[...(showEmployee ? ['Employee'] : []), 'Type', 'Amount', 'EMI', 'Outstanding', 'Applied', 'Status', '']}>
            {data.map((l) => (
              <tr key={l.id}>
                {showEmployee && (
                  <Td>
                    <p className="font-medium text-slate-900">{l.employee.name}</p>
                    <p className="text-xs text-slate-400">{l.employee.employeeCode}</p>
                  </Td>
                )}
                <Td>{typeLabel(l.type)}</Td>
                <Td className="font-medium">{fmtMoney(l.principal)}</Td>
                <Td>
                  {fmtMoney(l.emi)} × {l.tenureMonths}
                  {l.interestRate > 0 && <span className="text-xs text-slate-400"> @ {l.interestRate}%</span>}
                </Td>
                <Td>{l.status === 'ACTIVE' ? fmtMoney(l.balance) : '—'}</Td>
                <Td>{fmtDate(l.appliedOn)}</Td>
                <Td>
                  <Badge tone={loanTone(l.status)}>{l.status}</Badge>
                  {l.currentStep && <p className="mt-0.5 text-[11px] text-slate-400">Level {l.currentStep.level}</p>}
                </Td>
                <Td>
                  <Button variant="ghost" onClick={() => setOpenId(l.id)}>
                    {tab === 'Approvals' ? 'Review' : 'Schedule'}
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {applying && <ApplyModal onClose={() => setApplying(false)} onDone={reload} />}
      {openId && <LoanModal id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}
