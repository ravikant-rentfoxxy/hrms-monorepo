'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { api, fmtDate, fmtMoney } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Stat, Table, Td } from '@/components/ui';
import { PayslipModal, RunBadge, days, downloadFile, monthName, type PayrollRun } from '../../payroll-common';

interface RunLine {
  id: string;
  status: string;
  employee: { id: string; name: string; employeeCode: string; department: string; designation: string; hasBank: boolean };
  workingDays: number;
  paidDays: number;
  lopDays: number;
  gross: number;
  totalDeductions: number;
  netPay: number;
  employerContributions: number;
  tds: number;
  pf: number;
  previousNet: number | null;
  variance: number | null;
}

interface RunDetail extends PayrollRun {
  lines: RunLine[];
  byDepartment: { department: string; employees: number; gross: number; net: number; employerCost: number }[];
  previous: { employees: number; gross: number; net: number } | null;
  missingBank: number;
}

const STEPS = ['DRAFT', 'LOCKED', 'APPROVED', 'PUBLISHED', 'PAID'] as const;
const STEP_LABELS: Record<(typeof STEPS)[number], string> = {
  DRAFT: 'Draft',
  LOCKED: 'Under review',
  APPROVED: 'Approved',
  PUBLISHED: 'Published',
  PAID: 'Salary paid',
};

function Stepper({ status, paid }: { status: string; paid: boolean }) {
  const at = paid ? STEPS.length - 1 : STEPS.indexOf(status as (typeof STEPS)[number]);
  return (
    <div className="mb-5 flex items-center gap-2">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
              i <= at ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'
            }`}
          >
            {i < at ? '✓' : i + 1}
          </span>
          <span className={`text-sm font-medium ${i <= at ? 'text-slate-900' : 'text-slate-400'}`}>
            {STEP_LABELS[s]}
          </span>
          {i < STEPS.length - 1 && <span className={`h-px w-10 ${i < at ? 'bg-indigo-400' : 'bg-slate-200'}`} />}
        </div>
      ))}
    </div>
  );
}

function RecalcModal({ run, onClose, onDone }: { run: RunDetail; onClose: () => void; onDone: () => void }) {
  const [workingDays, setWorkingDays] = useState(String(run.workingDays));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/payroll/runs/${run.id}/recalculate`, {
        method: 'POST',
        body: workingDays ? { workingDays: Number(workingDays) } : {},
      });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
    }
  };
  return (
    <Modal title="Recalculate run" open onClose={onClose}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <p className="text-sm text-slate-500">
          Recomputes every draft payslip from current salaries, attendance, payroll inputs, loans, declarations and
          statutory settings. Manual edits to draft payslips are replaced.
        </p>
        <Field label="Working days">
          <Input type="number" min={1} max={31} value={workingDays} onChange={(e) => setWorkingDays(e.target.value)} />
        </Field>
        <Button className="w-full" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Recalculating…' : 'Recalculate'}
        </Button>
      </div>
    </Modal>
  );
}

const PAYMENT_MODES = ['NEFT', 'RTGS', 'IMPS', 'CHEQUE', 'CASH', 'OTHER'] as const;

function PaidModal({ run, onClose, onDone }: { run: RunDetail; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ paymentReference: '', paymentMode: 'NEFT', paidAt: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/payroll/runs/${run.id}/mark-paid`, { method: 'POST', body: form });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
    }
  };
  return (
    <Modal title="Record salary payment" open onClose={onClose}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <p className="text-sm text-slate-500">
          Record the bank transfer for {fmtMoney(run.totals?.net ?? 0)} net pay. Employees are told their salary has been credited.
        </p>
        <Field label="Payment / UTR reference">
          <Input value={form.paymentReference} onChange={(e) => setForm({ ...form, paymentReference: e.target.value })} placeholder="UTR or batch reference" />
        </Field>
        <Field label="Mode">
          <Select value={form.paymentMode} onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}>
            {PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Paid on">
          <Input type="date" value={form.paidAt} onChange={(e) => setForm({ ...form, paidAt: e.target.value })} />
        </Field>
        <Button className="w-full" onClick={() => void submit()} disabled={busy || form.paymentReference.trim().length < 2}>
          {busy ? 'Saving…' : 'Record payment'}
        </Button>
      </div>
    </Modal>
  );
}

export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  const { data: run, loading, error, reload } = useFetch<RunDetail>(`/payroll/runs/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [recalcOpen, setRecalcOpen] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const lines = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!run) return [];
    return q
      ? run.lines.filter((l) => `${l.employee.name} ${l.employee.employeeCode} ${l.employee.department}`.toLowerCase().includes(q))
      : run.lines;
  }, [run, query]);

  const act = async (action: 'lock' | 'unlock' | 'approve' | 'publish') => {
    if (action === 'publish' && !window.confirm('Publish this payroll? Employees will see their payslips, loan EMIs are posted and the run can no longer change.')) return;
    setBusy(action);
    setActionError(null);
    try {
      await api(`/payroll/runs/${id}/${action}`, { method: 'POST' });
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const download = async (path: string, name: string) => {
    setActionError(null);
    try {
      await downloadFile(`/payroll/runs/${id}/${path}`, name);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Download failed');
    }
  };

  if (loading && !run) return <Spinner />;
  if (!run) return <ErrorNote error={error ?? 'Run not found'} />;
  const t = run.totals;
  const ym = run.month.slice(0, 7);
  const isAdmin = session?.role === 'ADMIN' || session?.role === 'SUPER_ADMIN';

  return (
    <div>
      <PageHeader
        title={`Payroll · ${monthName(run.month)}`}
        subtitle={`${run.workingDays} working days · created ${fmtDate(run.createdAt)}${run.publishedAt ? ` · published ${fmtDate(run.publishedAt)}` : ''}`}
        actions={
          <>
            <Link href="/payroll" className="text-sm font-medium text-slate-500 hover:text-slate-800">← All runs</Link>
            {run.status === 'DRAFT' && (
              <>
                <Button variant="secondary" onClick={() => setRecalcOpen(true)}>Recalculate</Button>
                <Button onClick={() => void act('lock')} disabled={!!busy || run.lines.length === 0}>
                  {busy === 'lock' ? 'Locking…' : 'Lock for review'}
                </Button>
              </>
            )}
            {(run.status === 'LOCKED' || run.status === 'APPROVED') && isAdmin && (
              <Button variant="secondary" onClick={() => void act('unlock')} disabled={!!busy}>
                {busy === 'unlock' ? 'Unlocking…' : 'Send back to draft'}
              </Button>
            )}
            {run.status === 'LOCKED' && (
              isAdmin ? (
                <Button onClick={() => void act('approve')} disabled={!!busy}>
                  {busy === 'approve' ? 'Approving…' : 'Approve payroll'}
                </Button>
              ) : (
                <span className="text-sm text-slate-500">Waiting for management approval</span>
              )
            )}
            {run.status === 'APPROVED' && (
              <Button onClick={() => void act('publish')} disabled={!!busy}>
                {busy === 'publish' ? 'Publishing…' : 'Publish payslips'}
              </Button>
            )}
            {run.status === 'PUBLISHED' && !run.paidAt && (
              <Button onClick={() => setPaidOpen(true)}>Record salary payment</Button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Stepper status={run.status} paid={!!run.paidAt} />
        <RunBadge status={run.status} paid={!!run.paidAt} />
      </div>
      <ErrorNote error={actionError} />

      <div className="mb-4 mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Employees" value={t?.employees ?? 0} icon="users" />
        <Stat label="Gross" value={fmtMoney(t?.gross ?? 0)} icon="banknote" />
        <Stat label="Deductions" value={fmtMoney(t?.deductions ?? 0)} accent="text-rose-600" />
        <Stat label="Net pay" value={fmtMoney(t?.net ?? 0)} accent="text-indigo-700" icon="wallet" />
        <Stat label="Employer cost" value={fmtMoney(t?.employerCost ?? 0)} icon="building" />
      </div>
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-500">
        <span>TDS {fmtMoney(t?.tds ?? 0)}</span>
        <span>Employer contributions {fmtMoney(t?.employerContributions ?? 0)}</span>
        <span>LOP days {days(t?.lopDays ?? 0)}</span>
        {(t?.zeroDays ?? 0) > 0 && <span className="text-amber-600">{t?.zeroDays} with zero payable days (no payslip)</span>}
        {(t?.skipped ?? 0) > 0 && <span>{t?.skipped} already paid (manual payslip / F&F)</span>}
        {run.missingBank > 0 && <span className="text-amber-600">{run.missingBank} without bank details</span>}
        {run.previous && (
          <span>
            vs last month: net {run.previous.net ? `${(((t?.net ?? 0) - run.previous.net) / run.previous.net * 100).toFixed(1)}%` : '—'}
            {' '}({run.previous.employees} employees)
          </span>
        )}
      </div>

      <Card className="mb-4 p-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Downloads</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={run.status === 'DRAFT'} onClick={() => void download('bank-file.csv', `bank-transfer-${ym}.csv`)}>
            Bank transfer file
          </Button>
          <Button variant="secondary" onClick={() => void download('ecr.txt', `ECR-${ym}.txt`)}>PF ECR</Button>
          <Button variant="secondary" onClick={() => void download('esi.csv', `ESI-${ym}.csv`)}>ESI return</Button>
          <Button variant="secondary" onClick={() => void download('pt.csv', `PT-${ym}.csv`)}>PT summary</Button>
          <Button variant="secondary" onClick={() => void download('register.csv', `payroll-register-${ym}.csv`)}>Payroll register</Button>
        </div>
        {run.status === 'DRAFT' && <p className="mt-2 text-xs text-slate-400">Lock the run to generate the bank transfer file.</p>}
      </Card>

      {run.byDepartment.length > 1 && (
        <Card className="mb-4">
          <Table headers={['Department', 'Employees', 'Gross', 'Net', 'Employer cost']}>
            {run.byDepartment.map((d) => (
              <tr key={d.department}>
                <Td className="font-medium text-slate-900">{d.department}</Td>
                <Td>{d.employees}</Td>
                <Td>{fmtMoney(d.gross)}</Td>
                <Td>{fmtMoney(d.net)}</Td>
                <Td>{fmtMoney(d.employerCost)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between gap-3 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Employees</h2>
          <div className="w-64">
            <Input placeholder="Search name, code, department" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        {lines.length === 0 ? (
          <Empty message="No payslips in this run" />
        ) : (
          <Table headers={['Employee', 'Paid / LOP', 'Gross', 'Deductions', 'TDS', 'Net pay', 'vs last month', '']}>
            {lines.map((l) => (
              <tr key={l.id}>
                <Td>
                  <p className="font-medium text-slate-900">{l.employee.name}</p>
                  <p className="text-xs text-slate-400">
                    {l.employee.employeeCode} · {l.employee.department || '—'}
                    {!l.employee.hasBank && <span className="ml-1 text-amber-600">· no bank</span>}
                  </p>
                </Td>
                <Td>
                  {days(l.paidDays)}/{l.workingDays}
                  {l.lopDays > 0 && <span className="ml-1 text-xs text-rose-500">LOP {days(l.lopDays)}</span>}
                </Td>
                <Td>{fmtMoney(l.gross)}</Td>
                <Td className="text-rose-600">−{fmtMoney(l.totalDeductions)}</Td>
                <Td>{fmtMoney(l.tds)}</Td>
                <Td className="font-semibold text-indigo-700">{fmtMoney(l.netPay)}</Td>
                <Td>
                  {l.variance === null ? (
                    <span className="text-xs text-slate-400">new</span>
                  ) : (
                    <span className={l.variance > 0 ? 'text-emerald-600' : l.variance < 0 ? 'text-rose-600' : 'text-slate-400'}>
                      {l.variance > 0 ? '+' : ''}{fmtMoney(l.variance)}
                    </span>
                  )}
                </Td>
                <Td>
                  <Button variant="ghost" onClick={() => setSelected(l.id)}>View</Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {selected && <PayslipModal id={selected} onClose={() => setSelected(null)} />}
      {recalcOpen && <RecalcModal run={run} onClose={() => setRecalcOpen(false)} onDone={reload} />}
      {paidOpen && <PaidModal run={run} onClose={() => setPaidOpen(false)} onDone={reload} />}
    </div>
  );
}
