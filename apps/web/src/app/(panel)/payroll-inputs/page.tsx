'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { API_URL, api, fmtMoney, getActingCompanyId, getSession } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, MonthPicker, PageHeader, Select, Spinner, Stat, Table, Td,
} from '@/components/ui';

const MANUAL_TYPES = ['BONUS', 'INCENTIVE', 'REIMBURSEMENT', 'OTHER_EARNING', 'DEDUCTION'] as const;
const ALL_TYPES = [...MANUAL_TYPES, 'ARREAR', 'OVERTIME', 'LEAVE_ENCASHMENT', 'LOAN_EMI'];
const DEFAULT_TAXABLE: Record<string, boolean> = { BONUS: true, INCENTIVE: true, REIMBURSEMENT: false, OTHER_EARNING: true, DEDUCTION: false };
const typeLabel = (t: string) => t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, ' ');
const isDeduction = (t: string) => t === 'DEDUCTION' || t === 'LOAN_EMI';
const errMsg = (err: unknown) => (err instanceof Error ? err.message : 'Failed');

interface PayrollInput {
  id: string;
  employee: { id: string; name: string; employeeCode: string; department: string };
  type: string;
  label: string;
  amount: number;
  taxable: boolean;
  note: string;
  payslipId: string | null;
  system: boolean;
  editable: boolean;
}

interface ListResponse {
  runStatus: string | null;
  locked: boolean;
  totals: { earnings: number; deductions: number; count: number };
  items: PayrollInput[];
}

interface CsvResult {
  dryRun: boolean;
  total: number;
  valid: number;
  invalid: number;
  created: number;
  results: { row: number; employeeCode: string; type: string; amount: number | null; ok: boolean; error?: string }[];
}

function InputModal({
  month,
  initial,
  onClose,
  onDone,
}: {
  month: string;
  initial: PayrollInput | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: directory } = useFetch<{ items: { id: string; name: string; employeeCode: string }[] }>(
    initial ? null : '/employees?pageSize=100'
  );
  const [form, setForm] = useState({
    employeeId: initial?.employee.id ?? '',
    type: initial?.type ?? 'BONUS',
    label: initial?.label ?? '',
    amount: initial ? String(initial.amount) : '',
    taxable: initial?.taxable ?? true,
    note: initial?.note ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { type: form.type, label: form.label, amount: Number(form.amount), taxable: form.taxable, note: form.note };
      if (initial) await api(`/payroll-inputs/${initial.id}`, { method: 'PATCH', body });
      else await api('/payroll-inputs', { method: 'POST', body: { ...body, employeeId: form.employeeId, month } });
      onDone();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? 'Edit payroll input' : 'Add payroll input'} open onClose={onClose}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        {initial ? (
          <p className="text-sm text-ink-600">
            {initial.employee.name} ({initial.employee.employeeCode})
          </p>
        ) : (
          <Field label="Employee">
            <Select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
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
            <Select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value, taxable: DEFAULT_TAXABLE[e.target.value] ?? true })}
            >
              {MANUAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {typeLabel(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount (₹)">
            <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
        </div>
        <Field label="Label (shown on the payslip)">
          <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Diwali bonus" />
        </Field>
        <Field label="Note (internal)">
          <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
        {form.type !== 'DEDUCTION' && (
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={form.taxable} onChange={(e) => setForm({ ...form, taxable: e.target.checked })} />
            Taxable
          </label>
        )}
        <Button
          onClick={() => void submit()}
          disabled={busy || (!initial && !form.employeeId) || !(Number(form.amount) > 0) || form.label.length < 2}
          className="w-full"
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}

function CsvModal({ month, onClose, onDone }: { month: string; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<CsvResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('month', month);
      fd.append('dryRun', String(dryRun));
      const res = await api<CsvResult>('/payroll-inputs/upload', { method: 'POST', form: fd });
      setResult(res);
      if (!dryRun) onDone();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  /** Authenticated CSV download (the API needs the Bearer token). */
  const template = async () => {
    const s = getSession();
    const headers: Record<string, string> = { Authorization: `Bearer ${s?.accessToken}` };
    const acting = s?.role === 'SUPER_ADMIN' ? getActingCompanyId() : null;
    if (acting) headers['X-Company-Id'] = acting;
    const res = await fetch(`${API_URL}/payroll-inputs/template.csv`, { headers });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = 'payroll-inputs-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const failed = result?.results.filter((r) => !r.ok) ?? [];

  return (
    <Modal title={`Bulk upload — ${month}`} open onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-sm text-ink-600">
          Columns: <code className="text-xs">employeeCode, type, label, amount, taxable</code>. Types: {MANUAL_TYPES.join(', ')}.
          Validate first; valid rows are imported, invalid ones are skipped.
        </p>
        <Button variant="ghost" onClick={() => void template()}>
          Download template
        </Button>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
          }}
          className="block w-full text-sm text-ink-600"
        />
        <ErrorNote error={error} />
        {result && (
          <div className="rounded-xl border border-ink-200/80 p-3 text-sm">
            <p>
              {result.total} rows · <span className="text-emerald-700">{result.valid} valid</span> ·{' '}
              <span className="text-rose-700">{result.invalid} invalid</span>
              {!result.dryRun && <> · <b>{result.created} imported</b></>}
            </p>
            {failed.length > 0 && (
              <div className="mt-2 max-h-56 overflow-y-auto">
                <Table headers={['Row', 'Employee code', 'Type', 'Error']}>
                  {failed.map((r) => (
                    <tr key={r.row}>
                      <Td>{r.row}</Td>
                      <Td>{r.employeeCode || '—'}</Td>
                      <Td>{r.type || '—'}</Td>
                      <Td className="text-rose-700">{r.error}</Td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" disabled={busy || !file} onClick={() => void send(true)}>
            Validate
          </Button>
          <Button disabled={busy || !file || !result?.dryRun || result.valid === 0} onClick={() => void send(false)}>
            Import {result?.dryRun ? `${result.valid} row(s)` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function PayrollInputsPage() {
  const { canManagePayroll } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [type, setType] = useState('');
  const { data, loading, error, reload } = useFetch<ListResponse>(
    canManagePayroll && month ? `/payroll-inputs?month=${month}${type ? `&type=${type}` : ''}` : null
  );
  const [editing, setEditing] = useState<PayrollInput | null | 'new'>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!canManagePayroll) {
    return (
      <div>
        <PageHeader title="Payroll inputs" />
        <Card>
          <Empty message="Only ADMIN / HR can manage payroll inputs" />
        </Card>
      </div>
    );
  }

  const importExpenses = async () => {
    setActionError(null);
    setNotice(null);
    try {
      const r = await api<{ created: number; skipped: number; total: number }>('/payroll-inputs/import-expenses', {
        method: 'POST',
        body: { month },
      });
      setNotice(
        r.created > 0
          ? `Imported ${r.created} approved claim(s) worth ${fmtMoney(r.total)} as reimbursements.`
          : 'No new approved expense claims to import.'
      );
      reload();
    } catch (err) {
      setActionError(errMsg(err));
    }
  };

  const remove = async (i: PayrollInput) => {
    if (!confirm(`Delete ${i.label} for ${i.employee.name}?`)) return;
    setActionError(null);
    try {
      await api(`/payroll-inputs/${i.id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      setActionError(errMsg(err));
    }
  };

  const locked = !!data?.locked;

  return (
    <div>
      <PageHeader
        title="Payroll inputs"
        subtitle="One-off earnings and deductions picked up by the month's payroll run"
        actions={
          <>
            <Button variant="secondary" disabled={locked} onClick={() => void importExpenses()}>
              Import approved expenses
            </Button>
            <Button variant="secondary" disabled={locked} onClick={() => setCsvOpen(true)}>
              Upload CSV
            </Button>
            <Button disabled={locked} onClick={() => setEditing('new')}>
              + Add input
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Field label="Month">
            <MonthPicker value={month} onChange={setMonth} />
          </Field>
        </div>
        <div className="w-48">
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              {ALL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {typeLabel(t)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {data?.runStatus && (
          <Badge tone={locked ? 'red' : 'amber'}>
            Payroll run {data.runStatus}
            {locked ? ' — read-only' : ''}
          </Badge>
        )}
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Inputs" value={data?.totals.count ?? 0} icon="receipt" />
        <Stat label="Earnings" value={fmtMoney(data?.totals.earnings ?? 0)} accent="text-emerald-600" icon="banknote" />
        <Stat label="Deductions" value={fmtMoney(data?.totals.deductions ?? 0)} accent="text-rose-600" icon="wallet" />
      </div>
      {notice && <p className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">{notice}</p>}
      <ErrorNote error={error ?? actionError} />
      <Card>
        {loading ? (
          <Spinner />
        ) : !data || data.items.length === 0 ? (
          <Empty message="No inputs for this month" />
        ) : (
          <Table headers={['Employee', 'Type', 'Label', 'Amount', 'Taxable', 'Status', '']}>
            {data.items.map((i) => (
              <tr key={i.id}>
                <Td>
                  <p className="font-medium text-ink-900">{i.employee.name}</p>
                  <p className="text-xs text-ink-400">{i.employee.employeeCode}</p>
                </Td>
                <Td>
                  <Badge tone={isDeduction(i.type) ? 'red' : i.system ? 'violet' : 'green'}>{typeLabel(i.type)}</Badge>
                </Td>
                <Td>
                  <p>{i.label}</p>
                  {i.note && <p className="max-w-60 truncate text-xs text-ink-400">{i.note}</p>}
                </Td>
                <Td className={`font-medium ${isDeduction(i.type) ? 'text-rose-600' : ''}`}>
                  {isDeduction(i.type) ? '−' : ''}
                  {fmtMoney(i.amount)}
                </Td>
                <Td>{i.taxable ? 'Yes' : 'No'}</Td>
                <Td>
                  {i.payslipId ? <Badge tone="green">On payslip</Badge> : i.system ? <Badge tone="slate">System</Badge> : <Badge tone="amber">Open</Badge>}
                </Td>
                <Td>
                  {i.editable && !locked && (
                    <div className="flex gap-1">
                      <Button variant="ghost" onClick={() => setEditing(i)}>
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => void remove(i)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && (
        <InputModal month={month} initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={reload} />
      )}
      {csvOpen && <CsvModal month={month} onClose={() => setCsvOpen(false)} onDone={reload} />}
    </div>
  );
}
