'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate, fmtMoney } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, DatePicker, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Td,
  Textarea, statusTone,
} from '@/components/ui';

/* ---------------------------------- Types --------------------------------- */

const CALCS = ['FIXED', 'PERCENT_OF_BASIC', 'PERCENT_OF_CTC', 'BALANCE'] as const;
type Calc = (typeof CALCS)[number];
const CALC_LABEL: Record<Calc, string> = {
  FIXED: 'Fixed ₹ / month',
  PERCENT_OF_BASIC: '% of basic',
  PERCENT_OF_CTC: '% of gross',
  BALANCE: 'Balance (remaining)',
};

interface Component {
  id: string;
  code: string;
  name: string;
  type: 'EARNING' | 'DEDUCTION';
  calc: Calc;
  value: number;
  taxable: boolean;
  sortOrder: number;
  isActive: boolean;
}

interface TemplateComponent {
  code: string;
  calc: Calc;
  value: number;
}

interface Template {
  id: string;
  name: string;
  description: string;
  components: TemplateComponent[];
  isActive: boolean;
}

interface Monthly {
  basic: number;
  hra: number;
  conveyance: number;
  medical: number;
  allowance: number;
  pfEmployer: number;
  pfEmployee: number;
}

const MONTHLY_FIELDS: { key: keyof Monthly; label: string }[] = [
  { key: 'basic', label: 'Basic' },
  { key: 'hra', label: 'HRA' },
  { key: 'conveyance', label: 'Conveyance' },
  { key: 'medical', label: 'Medical' },
  { key: 'allowance', label: 'Special allowance' },
  { key: 'pfEmployer', label: 'PF (employer)' },
  { key: 'pfEmployee', label: 'PF (employee)' },
];

const grossOf = (m: Monthly) => m.basic + m.hra + m.conveyance + m.medical + m.allowance;

interface Preview {
  ctcAnnual: number;
  ctcMonthly: number;
  monthly: Monthly;
  lines: { code: string; name: string; amount: number }[];
  gross: number;
  gratuity: number;
  netMonthly: number;
  warnings: string[];
}

interface Arrear {
  id: string;
  label: string;
  amount: number;
  type: string;
  month: string;
  payslipId: string | null;
}

interface Revision {
  id: string;
  employeeId: string;
  employee: { id: string; name: string; employeeCode: string; department: string; designation: string };
  effectiveFrom: string;
  ctcAnnual: number;
  monthly: Monthly;
  previous: Monthly | null;
  grossMonthly: number;
  previousGrossMonthly: number | null;
  reason: string;
  status: string;
  createdByName: string | null;
  createdAt: string;
  arrears: Arrear[];
}

interface TrailStep {
  id: string;
  level: number;
  status: string;
  approverName: string | null;
  actedByName: string | null;
  remarks: string | null;
  actedAt: string | null;
}

interface Directory {
  items: { id: string; name: string; employeeCode: string }[];
}

const revisionTone = (s: string) => (s === 'APPLIED' ? 'green' : s === 'APPROVED' ? 'blue' : statusTone(s));
const errMsg = (err: unknown) => (err instanceof Error ? err.message : 'Failed');

/* ------------------------------- Revisions -------------------------------- */

function RevisionModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: directory } = useFetch<Directory>('/employees?pageSize=100');
  const { data: templates } = useFetch<Template[]>('/salary/templates');
  const [employeeId, setEmployeeId] = useState('');
  const current = useFetch<{ monthly: { subTotal: number; total: number }; annual: { total: number } }>(
    employeeId ? `/employees/${employeeId}/salary-structure` : null
  );
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [ctc, setCtc] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [monthly, setMonthly] = useState<Monthly | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Live preview: recompute shortly after the CTC / template stops changing.
  useEffect(() => {
    const amount = Number(ctc);
    if (!amount || amount <= 0) return;
    const t = setTimeout(() => {
      api<Preview>('/salary/preview', { method: 'POST', body: { ctcAnnual: amount, ...(templateId ? { templateId } : {}) } })
        .then((p) => {
          setPreview(p);
          setMonthly(p.monthly);
          setPreviewError(null);
        })
        .catch((err: unknown) => setPreviewError(errMsg(err)));
    }, 350);
    return () => clearTimeout(t);
  }, [ctc, templateId]);

  const currentAnnual = current.data?.annual.total ?? 0;
  const hike = currentAnnual > 0 && Number(ctc) > 0 ? ((Number(ctc) - currentAnnual) / currentAnnual) * 100 : null;
  const backDated = effectiveFrom && effectiveFrom < new Date().toISOString().slice(0, 10);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await api('/salary/revisions', {
        method: 'POST',
        body: {
          employeeId,
          effectiveFrom,
          ctcAnnual: Number(ctc),
          ...(templateId ? { templateId } : {}),
          ...(monthly ? { monthly } : {}),
          reason,
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
    <Modal title="Propose salary revision" open onClose={onClose} wide>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <div className="grid grid-cols-2 gap-3">
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
          <Field label="Effective from" hint={backDated ? 'Back-dated: arrears are added for published months' : undefined}>
            <DatePicker value={effectiveFrom} onChange={setEffectiveFrom} />
          </Field>
          <Field
            label="New annual CTC (₹)"
            hint={
              currentAnnual > 0
                ? `Current ${fmtMoney(currentAnnual)}${hike !== null ? ` · ${hike >= 0 ? '+' : ''}${hike.toFixed(1)}%` : ''}`
                : employeeId
                  ? 'No current structure'
                  : undefined
            }
          >
            <Input type="number" value={ctc} onChange={(e) => setCtc(e.target.value)} placeholder="e.g. 1200000" />
          </Field>
          <Field label="Template">
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Standard structure</option>
              {templates
                ?.filter((t) => t.isActive)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>

        <ErrorNote error={previewError} />
        {preview && monthly && (
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Monthly breakup (editable)</p>
              <span className="text-xs text-slate-500">CTC / month {fmtMoney(preview.ctcMonthly)}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              {MONTHLY_FIELDS.map((f) => (
                <Field key={f.key} label={f.label}>
                  <Input
                    type="number"
                    value={monthly[f.key]}
                    onChange={(e) => setMonthly({ ...monthly, [f.key]: Number(e.target.value) || 0 })}
                  />
                </Field>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>
                Gross <b>{fmtMoney(grossOf(monthly))}</b>
              </span>
              <span>
                Net (before tax) <b>{fmtMoney(grossOf(monthly) - monthly.pfEmployee)}</b>
              </span>
              {current.data && current.data.monthly.subTotal > 0 && (
                <span className="text-slate-500">Current gross {fmtMoney(current.data.monthly.subTotal)}</span>
              )}
            </div>
            {preview.warnings.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-amber-700">
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <Field label="Reason">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Annual increment, promotion, correction…" />
        </Field>
        <p className="text-xs text-slate-400">The revision goes through the salary-revision approval chain before it is applied.</p>
        <Button
          onClick={() => void submit()}
          disabled={busy || !employeeId || !effectiveFrom || !(Number(ctc) > 0) || !monthly || reason.length < 3}
          className="w-full"
        >
          Submit for approval
        </Button>
      </div>
    </Modal>
  );
}

function RevisionDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, loading, error, reload } = useFetch<Revision & { trail: TrailStep[] }>(`/salary/revisions/${id}`);
  const [remarks, setRemarks] = useState('');
  const [newDate, setNewDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const act = async (path: string, body: object) => {
    setBusy(true);
    setActionError(null);
    try {
      await api(`/salary/revisions/${id}/${path}`, { method: 'POST', body });
      reload();
      onChanged();
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Salary revision" open onClose={onClose} wide>
      {loading || !data ? (
        error ? <ErrorNote error={error} /> : <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-slate-900">{data.employee.name}</p>
              <p className="text-xs text-slate-500">
                {data.employee.employeeCode} · {data.employee.designation || '—'} · effective {fmtDate(data.effectiveFrom)}
              </p>
            </div>
            <Badge tone={revisionTone(data.status)}>{data.status}</Badge>
          </div>
          <Table headers={['Component', 'Previous', 'New']}>
            {MONTHLY_FIELDS.map((f) => (
              <tr key={f.key}>
                <Td>{f.label}</Td>
                <Td>{data.previous ? fmtMoney(data.previous[f.key]) : '—'}</Td>
                <Td className="font-medium">{fmtMoney(data.monthly[f.key])}</Td>
              </tr>
            ))}
            <tr>
              <Td className="font-semibold">Gross / month</Td>
              <Td className="font-semibold">{data.previousGrossMonthly !== null ? fmtMoney(data.previousGrossMonthly) : '—'}</Td>
              <Td className="font-semibold">{fmtMoney(data.grossMonthly)}</Td>
            </tr>
          </Table>
          <p className="text-sm text-slate-600">
            Annual CTC <b>{fmtMoney(data.ctcAnnual)}</b> · {data.reason}
          </p>
          {data.arrears.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Arrears raised</p>
              {data.arrears.map((a) => (
                <div key={a.id} className="flex justify-between border-b border-slate-100 py-1.5 text-sm">
                  <span>
                    {a.label} <span className="text-xs text-slate-400">→ payroll {new Date(a.month).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</span>
                  </span>
                  <span className={a.type === 'DEDUCTION' ? 'text-rose-600' : 'font-medium'}>
                    {a.type === 'DEDUCTION' ? '−' : ''}
                    {fmtMoney(a.amount)}
                  </span>
                </div>
              ))}
            </div>
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
          {(data.status === 'PENDING' || data.status === 'APPROVED') && (
            <div className="space-y-2">
              <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Remarks (optional)" />
              <div className="flex gap-2">
                {data.status === 'PENDING' && (
                  <>
                    <Button disabled={busy} onClick={() => void act('decide', { decision: 'APPROVED', remarks: remarks || undefined })}>
                      Approve
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => void act('decide', { decision: 'REJECTED', remarks: remarks || undefined })}
                    >
                      Reject
                    </Button>
                  </>
                )}
                <Button variant="secondary" disabled={busy} onClick={() => void act('cancel', { remarks: remarks || undefined })}>
                  Withdraw
                </Button>
              </div>
              <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                <Field label="Change effective date">
                  <DatePicker value={newDate} onChange={setNewDate} />
                </Field>
                <Button variant="secondary" disabled={busy || !newDate} onClick={() => void act('reschedule', { effectiveFrom: newDate })}>
                  Change date
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function RevisionsTab() {
  const { data: directory } = useFetch<Directory>('/employees?pageSize=100');
  const [employeeId, setEmployeeId] = useState('');
  const [status, setStatus] = useState('');
  const qs = new URLSearchParams({ ...(employeeId ? { employeeId } : {}), ...(status ? { status } : {}) }).toString();
  const { data, loading, error, reload } = useFetch<Revision[]>(`/salary/revisions${qs ? `?${qs}` : ''}`);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Field label="Employee">
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">All employees</option>
              {directory?.items.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-44">
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {['PENDING', 'APPROVED', 'APPLIED', 'REJECTED'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="ml-auto">
          <Button onClick={() => setCreating(true)}>+ New revision</Button>
        </div>
      </div>
      <ErrorNote error={error} />
      <Card>
        {loading ? (
          <Spinner />
        ) : !data || data.length === 0 ? (
          <Empty message="No salary revisions yet" />
        ) : (
          <Table headers={['Employee', 'Effective', 'Annual CTC', 'Gross / month', 'Arrears', 'Status', 'Raised by', '']}>
            {data.map((r) => (
              <tr key={r.id}>
                <Td>
                  <p className="font-medium text-slate-900">{r.employee.name}</p>
                  <p className="text-xs text-slate-400">{r.employee.employeeCode}</p>
                </Td>
                <Td>{fmtDate(r.effectiveFrom)}</Td>
                <Td className="font-medium">{fmtMoney(r.ctcAnnual)}</Td>
                <Td>
                  {r.previousGrossMonthly !== null && (
                    <span className="text-slate-400">{fmtMoney(r.previousGrossMonthly)} → </span>
                  )}
                  {fmtMoney(r.grossMonthly)}
                </Td>
                <Td>
                  {r.arrears.length > 0
                    ? fmtMoney(r.arrears.reduce((s, a) => s + (a.type === 'DEDUCTION' ? -a.amount : a.amount), 0))
                    : '—'}
                </Td>
                <Td>
                  <Badge tone={revisionTone(r.status)}>{r.status}</Badge>
                </Td>
                <Td className="text-slate-500">{r.createdByName ?? '—'}</Td>
                <Td>
                  <Button variant="ghost" onClick={() => setOpenId(r.id)}>
                    View
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {creating && <RevisionModal onClose={() => setCreating(false)} onDone={reload} />}
      {openId && <RevisionDetail id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}

/* ------------------------------ Restructure ------------------------------- */

interface Monthly {
  basic: number;
  hra: number;
  conveyance: number;
  medical: number;
  allowance: number;
  pfEmployer: number;
  pfEmployee: number;
}

interface RestructurePlan {
  rows: { employeeId: string; name: string; employeeCode: string; ctcAnnual: number; current: Monthly; next: Monthly; skip?: string }[];
  unchanged: number;
  scheduled: { count: number; dates: string[] };
}

const takeHome = (m: Monthly) => m.basic + m.hra + m.conveyance + m.medical + m.allowance - m.pfEmployee;

const firstOfNextMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1)).toISOString().slice(0, 10);
};

/**
 * After the structure changes: shows which employees' breakup would change
 * (their CTC stays the same) and applies it from a chosen date.
 */
function RestructurePanel({ templateId, version }: { templateId: string | null; version: number }) {
  const path = `/salary/restructure${templateId ? `?templateId=${templateId}` : ''}`;
  const { data, loading, error, reload } = useFetch<RestructurePlan>(`${path}${path.includes('?') ? '&' : '?'}v=${version}`);
  const [effectiveFrom, setEffectiveFrom] = useState(firstOfNextMonth());
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [newDate, setNewDate] = useState('');

  const ready = data?.rows.filter((r) => !r.skip) ?? [];

  const reschedule = async () => {
    if (!newDate) return;
    setBusy(true);
    setActionError(null);
    try {
      const r = await api<{ applied: number; scheduled: number; skipped: { name: string; reason: string }[] }>('/salary/restructure/reschedule', {
        method: 'POST',
        body: { templateId, effectiveFrom: newDate },
      });
      setResult(
        `Effective date changed to ${fmtDate(newDate)}: ${r.applied} updated now` +
          (r.scheduled ? `, ${r.scheduled} scheduled` : '') +
          (r.skipped.length ? `; skipped: ${r.skipped.map((x) => `${x.name} (${x.reason})`).join(', ')}` : '') +
          '.'
      );
      setNewDate('');
      reload();
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!confirm(`Re-split the salary of ${ready.length} employee(s) from ${fmtDate(effectiveFrom)}? Their CTC stays the same.`)) return;
    setBusy(true);
    setActionError(null);
    try {
      const r = await api<{ applied: number; scheduled: number; skipped: { name: string; reason: string }[] }>('/salary/restructure', {
        method: 'POST',
        body: { templateId, effectiveFrom },
      });
      setResult(
        `${r.applied} updated now${r.scheduled ? `, ${r.scheduled} scheduled for ${fmtDate(effectiveFrom)}` : ''}` +
          (r.skipped.length ? `; skipped: ${r.skipped.map((x) => `${x.name} (${x.reason})`).join(', ')}` : '') +
          '. See the Revisions tab.'
      );
      reload();
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Spinner />;
  return (
    <Card className="mt-5 p-5">
      <h3 className="text-sm font-semibold text-slate-900">Apply to existing employees</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        Changing the structure only affects new offers, joiners and revisions. To update current employees, apply it from a date —
        each employee keeps the same CTC; only the breakup changes.
      </p>
      <ErrorNote error={error ?? actionError} />
      {result && <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{result}</p>}
      {data && data.scheduled.count > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            <span className="font-semibold">{data.scheduled.count} employee(s)</span> already scheduled to switch on{' '}
            <span className="font-semibold">{data.scheduled.dates.map((d) => fmtDate(d)).join(', ')}</span>. Until then payroll uses
            their current structure.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Field label="Change effective date to">
              <DatePicker value={newDate} onChange={setNewDate} />
            </Field>
            <Button variant="secondary" onClick={() => void reschedule()} disabled={busy || !newDate}>
              Change date
            </Button>
          </div>
          <p className="mt-2 text-xs text-amber-800/80">
            Today or a past date applies it immediately (paid months get arrears in the next payroll). To undo it instead, withdraw the
            revisions on the Revisions tab.
          </p>
        </div>
      )}
      {data && data.rows.length === 0 && data.scheduled.count > 0 ? null : data && data.rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">
          All {data.unchanged} employee(s) on this structure already match it — nothing to update.
        </p>
      ) : data ? (
        <>
          <div className="mt-3 overflow-x-auto">
            <Table headers={['Employee', 'CTC / year', 'Basic / month', 'Take-home / month', '']}>
              {data.rows.map((r) => (
                <tr key={r.employeeId}>
                  <Td>
                    <p className="font-medium text-slate-900">{r.name}</p>
                    <p className="text-xs text-slate-400">{r.employeeCode}</p>
                  </Td>
                  <Td>{fmtMoney(r.ctcAnnual)}</Td>
                  <Td>
                    {fmtMoney(r.current.basic)} → <span className="font-semibold">{fmtMoney(r.next.basic)}</span>
                  </Td>
                  <Td>
                    {fmtMoney(takeHome(r.current))} → <span className="font-semibold">{fmtMoney(takeHome(r.next))}</span>
                  </Td>
                  <Td className="text-xs text-amber-700">{r.skip ?? ''}</Td>
                </tr>
              ))}
            </Table>
          </div>
          {data.unchanged > 0 && <p className="mt-2 text-xs text-slate-400">{data.unchanged} more employee(s) already match.</p>}
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Field label="Effective from">
              <DatePicker value={effectiveFrom} onChange={setEffectiveFrom} />
            </Field>
            <Button onClick={() => void apply()} disabled={busy || ready.length === 0 || !effectiveFrom}>
              Apply to {ready.length} employee{ready.length === 1 ? '' : 's'}
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            A past date pays the difference for already-paid months as arrears in the next payroll.
          </p>
        </>
      ) : null}
    </Card>
  );
}

/* ------------------------------- Components ------------------------------- */

const emptyComponent = { code: '', name: '', type: 'EARNING', calc: 'FIXED' as Calc, value: '0', taxable: true, sortOrder: '10' };

function ComponentModal({ initial, onClose, onDone }: { initial: Component | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState(
    initial
      ? { ...initial, value: String(initial.value), sortOrder: String(initial.sortOrder) }
      : emptyComponent
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: form.name,
        type: form.type,
        calc: form.calc,
        value: Number(form.value) || 0,
        taxable: form.taxable,
        sortOrder: Number(form.sortOrder) || 0,
      };
      if (initial) await api(`/salary/components/${initial.id}`, { method: 'PATCH', body });
      else await api('/salary/components', { method: 'POST', body: { ...body, code: form.code } });
      onDone();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? `Edit ${initial.code}` : 'New pay component'} open onClose={onClose}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code">
            <Input value={form.code} disabled={!!initial} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Component['type'] })}>
              <option value="EARNING">Earning</option>
              <option value="DEDUCTION">Deduction</option>
            </Select>
          </Field>
          <Field label="Calculation">
            <Select value={form.calc} onChange={(e) => setForm({ ...form, calc: e.target.value as Calc })}>
              {CALCS.map((c) => (
                <option key={c} value={c}>
                  {CALC_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={form.calc === 'FIXED' ? 'Amount (₹)' : 'Value (%)'}>
            <Input type="number" value={form.value} disabled={form.calc === 'BALANCE'} onChange={(e) => setForm({ ...form, value: e.target.value })} />
          </Field>
          <Field label="Order">
            <Input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.taxable} onChange={(e) => setForm({ ...form, taxable: e.target.checked })} />
          Taxable
        </label>
        <Button onClick={() => void submit()} disabled={busy || form.code.length < 2 || form.name.length < 2} className="w-full">
          Save
        </Button>
      </div>
    </Modal>
  );
}

function ComponentsTab() {
  const { data, loading, error, reload: reloadList } = useFetch<Component[]>('/salary/components');
  const [version, setVersion] = useState(0);
  const reload = () => {
    reloadList();
    setVersion((v) => v + 1);
  };
  const [editing, setEditing] = useState<Component | null | 'new'>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const remove = async (c: Component) => {
    if (!confirm(`Delete component ${c.code}?`)) return;
    setActionError(null);
    try {
      await api(`/salary/components/${c.id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      setActionError(errMsg(err));
    }
  };

  const toggle = async (c: Component) => {
    setActionError(null);
    try {
      await api(`/salary/components/${c.id}`, { method: 'PATCH', body: { isActive: !c.isActive } });
      reload();
    } catch (err) {
      setActionError(errMsg(err));
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-600">
          This is your <span className="font-semibold">standard salary structure</span>: offer letters, new joiners and revisions
          split the CTC using these earnings in order (Basic first, Balance last).
        </p>
        <Button onClick={() => setEditing('new')}>+ New component</Button>
      </div>
      <ErrorNote error={error ?? actionError} />
      <Card>
        {loading ? (
          <Spinner />
        ) : !data || data.length === 0 ? (
          <Empty message="No components" />
        ) : (
          <Table headers={['Code', 'Name', 'Type', 'Calculation', 'Taxable', 'Status', '']}>
            {data.map((c) => (
              <tr key={c.id}>
                <Td className="font-mono text-xs font-semibold text-slate-900">{c.code}</Td>
                <Td>{c.name}</Td>
                <Td>
                  <Badge tone={c.type === 'EARNING' ? 'green' : 'red'}>{c.type}</Badge>
                </Td>
                <Td>
                  {c.calc === 'FIXED' ? fmtMoney(c.value) : c.calc === 'BALANCE' ? 'Balance' : `${c.value}% `}
                  {c.calc === 'PERCENT_OF_BASIC' && 'of basic'}
                  {c.calc === 'PERCENT_OF_CTC' && 'of gross'}
                </Td>
                <Td>{c.taxable ? 'Yes' : 'No'}</Td>
                <Td>
                  <Badge tone={c.isActive ? 'green' : 'slate'}>{c.isActive ? 'Active' : 'Inactive'}</Badge>
                </Td>
                <Td>
                  <div className="flex gap-1">
                    <Button variant="ghost" onClick={() => setEditing(c)}>
                      Edit
                    </Button>
                    {c.code !== 'BASIC' && (
                      <>
                        <Button variant="ghost" onClick={() => void toggle(c)}>
                          {c.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button variant="ghost" onClick={() => void remove(c)}>
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {data && data.length > 0 && <RestructurePanel templateId={null} version={version} />}
      {editing && (
        <ComponentModal initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={reload} />
      )}
    </>
  );
}

/* -------------------------------- Templates ------------------------------- */

function TemplateModal({
  initial,
  components,
  onClose,
  onDone,
}: {
  initial: Template | null;
  components: Component[];
  onClose: () => void;
  onDone: () => void;
}) {
  const fromComponents = (): TemplateComponent[] =>
    components.filter((c) => c.isActive && c.type === 'EARNING').map((c) => ({ code: c.code, calc: c.calc, value: c.value }));
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [rows, setRows] = useState<TemplateComponent[]>(initial?.components ?? fromComponents());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sampleCtc, setSampleCtc] = useState('1200000');
  const [sample, setSample] = useState<Preview | null>(null);

  const update = (i: number, patch: Partial<TemplateComponent>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { name, description, components: rows };
      if (initial) await api(`/salary/templates/${initial.id}`, { method: 'PATCH', body });
      else await api('/salary/templates', { method: 'POST', body });
      onDone();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const tryIt = async () => {
    if (!initial) return;
    setError(null);
    try {
      setSample(await api<Preview>('/salary/preview', { method: 'POST', body: { ctcAnnual: Number(sampleCtc), templateId: initial.id } }));
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <Modal title={initial ? `Edit template — ${initial.name}` : 'New salary template'} open onClose={onClose} wide>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Components</p>
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <Select value={r.code} onChange={(e) => update(i, { code: e.target.value })}>
              <option value="">— component —</option>
              {components.map((c) => (
                <option key={c.id} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </Select>
            <Select value={r.calc} onChange={(e) => update(i, { calc: e.target.value as Calc })}>
              {CALCS.map((c) => (
                <option key={c} value={c}>
                  {CALC_LABEL[c]}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              className="w-28"
              value={r.value}
              disabled={r.calc === 'BALANCE'}
              onChange={(e) => update(i, { value: Number(e.target.value) || 0 })}
            />
            <button className="px-1 text-slate-400 hover:text-rose-600" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <Button variant="ghost" onClick={() => setRows([...rows, { code: '', calc: 'FIXED', value: 0 }])}>
          + component
        </Button>
        <p className="text-xs text-slate-400">
          Needs a BASIC component. “% of gross” is a share of the monthly gross (CTC less employer PF and gratuity); one
          “Balance” component absorbs the remainder.
        </p>
        {initial && (
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3">
            <div className="flex items-end gap-2">
              <Field label="Try with annual CTC (saved version)">
                <Input type="number" value={sampleCtc} onChange={(e) => setSampleCtc(e.target.value)} />
              </Field>
              <Button variant="secondary" onClick={() => void tryIt()}>
                Preview
              </Button>
            </div>
            {sample && (
              <div className="mt-2 text-sm">
                {sample.lines.map((l) => (
                  <div key={l.code} className="flex justify-between py-0.5">
                    <span className="text-slate-600">{l.name}</span>
                    <span>{fmtMoney(l.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold">
                  <span>Gross / month</span>
                  <span>{fmtMoney(sample.gross)}</span>
                </div>
                {sample.warnings.map((w) => (
                  <p key={w} className="text-xs text-amber-700">
                    {w}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
        <Button onClick={() => void submit()} disabled={busy || name.length < 2 || rows.some((r) => !r.code)} className="w-full">
          Save template
        </Button>
      </div>
    </Modal>
  );
}

function TemplatesTab() {
  const { data, loading, error, reload } = useFetch<Template[]>('/salary/templates');
  const { data: components } = useFetch<Component[]>('/salary/components');
  const [editing, setEditing] = useState<Template | null | 'new'>(null);
  const [applying, setApplying] = useState<Template | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const remove = async (t: Template) => {
    if (!confirm(`Delete template ${t.name}?`)) return;
    try {
      await api(`/salary/templates/${t.id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      setActionError(errMsg(err));
    }
  };

  const toggle = async (t: Template) => {
    try {
      await api(`/salary/templates/${t.id}`, { method: 'PATCH', body: { isActive: !t.isActive } });
      reload();
    } catch (err) {
      setActionError(errMsg(err));
    }
  };

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing('new')} disabled={!components}>
          + New template
        </Button>
      </div>
      <ErrorNote error={error ?? actionError} />
      <Card>
        {loading ? (
          <Spinner />
        ) : !data || data.length === 0 ? (
          <Empty message="No templates — everyone uses the standard structure (Components tab). Add a template only for a group that needs a different split, e.g. interns." />
        ) : (
          <Table headers={['Name', 'Components', 'Status', '']}>
            {data.map((t) => (
              <tr key={t.id}>
                <Td>
                  <p className="font-medium text-slate-900">{t.name}</p>
                  {t.description && <p className="text-xs text-slate-400">{t.description}</p>}
                </Td>
                <Td className="text-xs text-slate-600">
                  {t.components
                    .map((c) =>
                      c.calc === 'BALANCE'
                        ? `${c.code}: balance`
                        : c.calc === 'FIXED'
                          ? `${c.code}: ₹${c.value}`
                          : `${c.code}: ${c.value}% ${c.calc === 'PERCENT_OF_BASIC' ? 'basic' : 'gross'}`
                    )
                    .join(' · ')}
                </Td>
                <Td>
                  <Badge tone={t.isActive ? 'green' : 'slate'}>{t.isActive ? 'Active' : 'Inactive'}</Badge>
                </Td>
                <Td>
                  <div className="flex gap-1">
                    <Button variant="ghost" onClick={() => setEditing(t)}>
                      Edit
                    </Button>
                    {t.isActive && (
                      <Button variant="ghost" onClick={() => setApplying(t)}>
                        Apply to employees
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => void toggle(t)}>
                      {t.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button variant="ghost" onClick={() => void remove(t)}>
                      Delete
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {applying && (
        <Modal title={`Apply “${applying.name}” to its employees`} open onClose={() => setApplying(null)} wide>
          <p className="text-xs text-slate-500">Employees whose last salary revision used this template.</p>
          <RestructurePanel templateId={applying.id} version={0} />
        </Modal>
      )}
      {editing && components && (
        <TemplateModal
          initial={editing === 'new' ? null : editing}
          components={components}
          onClose={() => setEditing(null)}
          onDone={reload}
        />
      )}
    </>
  );
}

/* ---------------------------------- Page ---------------------------------- */

export default function SalaryPage() {
  const { isCompanyAdmin } = useAuth();
  const [tab, setTab] = useState('Revisions');

  if (!isCompanyAdmin) {
    return (
      <div>
        <PageHeader title="Salary" />
        <Card>
          <Empty message="Only ADMIN / HR can manage salary structures" />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Salary" subtitle="Pay components, CTC templates and salary revisions with approvals" />
      <Tabs tabs={['Revisions', 'Components', 'Templates']} active={tab} onChange={setTab} />
      {tab === 'Revisions' && <RevisionsTab />}
      {tab === 'Components' && <ComponentsTab />}
      {tab === 'Templates' && <TemplatesTab />}
    </div>
  );
}
