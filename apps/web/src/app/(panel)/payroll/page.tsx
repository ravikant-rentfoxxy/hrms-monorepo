'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { api, fmtDate, fmtMoney } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Td, DatePicker,
  MonthPicker,
} from '@/components/ui';
import { PayslipModal, RunBadge, TaxCard, days, monthName, type PayItem, type PayrollRun, type Payslip } from './payroll-common';

function GenerateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: directory } = useFetch<{ items: { id: string; name: string }[] }>('/employees?pageSize=100');
  const [employeeId, setEmployeeId] = useState('');
  const [month, setMonth] = useState('');
  const [workingDays, setWorkingDays] = useState('22');
  const [paidDays, setPaidDays] = useState('22');
  const [paidOn, setPaidOn] = useState('');
  const [earnings, setEarnings] = useState<PayItem[]>([{ label: 'Basic', amount: 0 }, { label: 'HRA', amount: 0 }]);
  const [deductions, setDeductions] = useState<PayItem[]>([{ label: 'PF', amount: 0 }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = (items: PayItem[], set: (v: PayItem[]) => void) => (
    <>
      {items.map((item, i) => (
        <div key={i} className="mb-2 flex gap-2">
          <Input value={item.label} onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <Input
            type="number"
            value={item.amount || ''}
            onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))}
            className="w-32"
          />
          <button className="text-slate-400 hover:text-rose-600" onClick={() => set(items.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <Button variant="ghost" onClick={() => set([...items, { label: '', amount: 0 }])}>
        + row
      </Button>
    </>
  );

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await api('/payroll/payslips', {
        method: 'POST',
        body: {
          employeeId,
          month: `${month}-01`,
          earnings: earnings.filter((e) => e.label),
          deductions: deductions.filter((d) => d.label),
          workingDays: Number(workingDays),
          paidDays: Number(paidDays),
          paidOn,
        },
      });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Manual payslip" open onClose={onClose} wide>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <p className="text-sm text-slate-500">
          For a month without a payroll run only (e.g. historical payslips). It is published immediately and cannot be
          edited afterwards.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Employee">
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">— select —</option>
              {directory?.items.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Month">
            <MonthPicker value={month} onChange={setMonth} />
          </Field>
          <Field label="Working days">
            <Input type="number" value={workingDays} onChange={(e) => setWorkingDays(e.target.value)} />
          </Field>
          <Field label="Paid days">
            <Input type="number" value={paidDays} onChange={(e) => setPaidDays(e.target.value)} />
          </Field>
          <Field label="Paid on">
            <DatePicker value={paidOn} onChange={setPaidOn} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-emerald-600">Earnings</p>
            {rows(earnings, setEarnings)}
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-rose-600">Deductions</p>
            {rows(deductions, setDeductions)}
          </div>
        </div>
        <Button onClick={() => void submit()} disabled={busy || !employeeId || !month || !paidOn} className="w-full">
          Create payslip
        </Button>
      </div>
    </Modal>
  );
}

function NewRunModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [workingDays, setWorkingDays] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await api<{ run: { id: string } }>('/payroll/runs', {
        method: 'POST',
        body: { month: `${month}-01`, ...(workingDays ? { workingDays: Number(workingDays) } : {}) },
      });
      router.push(`/payroll/runs/${result.run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
    }
  };

  return (
    <Modal title="New payroll run" open onClose={onClose}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <p className="text-sm text-slate-500">
          Creates <span className="font-semibold text-slate-700">draft payslips</span> for every eligible employee:
          salary pro-rated by payable days (attendance + approved leave), the month&apos;s payroll inputs and loan EMIs,
          and PF, ESI, professional tax, LWF and TDS. Review, lock and publish it from the run page — employees only see
          payslips once the run is published. Re-running a draft month refreshes it.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Month">
            <MonthPicker value={month} onChange={setMonth} />
          </Field>
          <Field label="Working days" hint="empty = auto: days in month − weekends − holidays (or the office's fixed norm)">
            <Input
              type="number"
              min={1}
              max={31}
              placeholder="auto"
              value={workingDays}
              onChange={(e) => setWorkingDays(e.target.value)}
            />
          </Field>
        </div>
        <Button onClick={() => void run()} disabled={busy || !month} className="w-full">
          {busy ? 'Calculating…' : 'Create draft run'}
        </Button>
      </div>
    </Modal>
  );
}

function RunsTab() {
  const { data: runs, loading, error } = useFetch<PayrollRun[]>('/payroll/runs');
  if (loading) return <Card><Spinner /></Card>;
  return (
    <Card>
      <ErrorNote error={error} />
      {!runs || runs.length === 0 ? (
        <Empty message="No payroll runs yet — start one with “New run”" />
      ) : (
        <Table headers={['Month', 'Status', 'Employees', 'Gross', 'Deductions', 'Net pay', 'Employer cost', '']}>
          {runs.map((r) => (
            <tr key={r.id}>
              <Td className="font-medium text-slate-900">{monthName(r.month)}</Td>
              <Td><RunBadge status={r.status} paid={!!r.paidAt} /></Td>
              <Td>{r.totals?.employees ?? '—'}</Td>
              <Td>{r.totals ? fmtMoney(r.totals.gross) : '—'}</Td>
              <Td className="text-rose-600">{r.totals ? `−${fmtMoney(r.totals.deductions)}` : '—'}</Td>
              <Td className="font-semibold text-indigo-700">{r.totals ? fmtMoney(r.totals.net) : '—'}</Td>
              <Td>{r.totals ? fmtMoney(r.totals.employerCost) : '—'}</Td>
              <Td>
                <Link href={`/payroll/runs/${r.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
                  Open
                </Link>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function PayslipsTab({ employeeId, admin }: { employeeId: string | null; admin: boolean }) {
  const target = admin && employeeId ? `?employeeId=${employeeId}` : '';
  const { data: slips, loading, reload } = useFetch<Payslip[]>(employeeId ? `/payroll/payslips${target}` : null);
  const [selected, setSelected] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);

  const downloadPdf = async (id: string) => {
    const { url } = await api<{ url: string }>(`/payroll/payslips/${id}/pdf`);
    window.open(url, '_blank');
  };

  return (
    <>
      {admin && (
        <div className="mb-3 flex justify-end">
          <Button variant="secondary" onClick={() => setGenOpen(true)}>+ Manual payslip</Button>
        </div>
      )}
      <Card>
        {loading ? (
          <Spinner />
        ) : !slips || slips.length === 0 ? (
          <Empty message="No payslips yet" />
        ) : (
          <Table headers={['Month', 'Gross', 'Deductions', 'Net', 'Paid days', 'LOP', 'Paid on', '']}>
            {slips.map((slip) => (
              <tr key={slip.id}>
                <Td className="font-medium text-slate-900">
                  {monthName(slip.month)} {slip.status === 'DRAFT' && <Badge tone="amber">DRAFT</Badge>}
                </Td>
                <Td>{fmtMoney(slip.gross)}</Td>
                <Td className="text-rose-600">−{fmtMoney(slip.totalDeductions)}</Td>
                <Td className="font-semibold text-indigo-700">{fmtMoney(slip.net)}</Td>
                <Td>{days(slip.paidDays)}/{slip.workingDays}</Td>
                <Td>{days(slip.lopDays ?? Math.max(0, slip.workingDays - slip.paidDays))}</Td>
                <Td>{fmtDate(slip.paidOn)}</Td>
                <Td>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => setSelected(slip.id)}>View</Button>
                    <Button variant="ghost" onClick={() => void downloadPdf(slip.id)}>PDF</Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {employeeId && (
        <Card className="mt-4">
          <TaxCard key={employeeId} employeeId={employeeId} self={!admin} />
        </Card>
      )}
      {selected && <PayslipModal id={selected} onClose={() => setSelected(null)} />}
      {genOpen && <GenerateModal onClose={() => setGenOpen(false)} onDone={reload} />}
    </>
  );
}

export default function PayrollPage() {
  const { session, isCompanyAdmin } = useAuth();
  const [tab, setTab] = useState('Payroll runs');
  const [viewFor, setViewFor] = useState('');
  const [runOpen, setRunOpen] = useState(false);
  const { data: directory } = useFetch<{ items: { id: string; name: string }[] }>(
    isCompanyAdmin && tab === 'Payslips' ? '/employees?pageSize=100' : null
  );
  const ownId = session?.employee?.id ?? null;

  if (!isCompanyAdmin) {
    return (
      <div>
        <PageHeader title="Payroll" subtitle="Your payslips and income tax" />
        <PayslipsTab employeeId={ownId} admin={false} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Payroll"
        subtitle="Monthly runs, payslips and statutory outputs"
        actions={
          <>
            <Link href="/payroll/statutory">
              <Button variant="secondary">Statutory settings</Button>
            </Link>
            <Button onClick={() => setRunOpen(true)}>New run</Button>
          </>
        }
      />
      <Tabs tabs={['Payroll runs', 'Payslips']} active={tab} onChange={setTab} />
      {tab === 'Payroll runs' ? (
        <RunsTab />
      ) : (
        <>
          <div className="mb-4 max-w-xs">
            <Select value={viewFor} onChange={(e) => setViewFor(e.target.value)}>
              <option value="">My payslips</option>
              {directory?.items.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </Select>
          </div>
          <PayslipsTab key={viewFor || 'me'} employeeId={viewFor || ownId} admin />
        </>
      )}
      {runOpen && <NewRunModal onClose={() => setRunOpen(false)} />}
    </div>
  );
}
