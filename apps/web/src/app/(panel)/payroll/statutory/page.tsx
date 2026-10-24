'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { api, fmtMoney } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Button, Card, Empty, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, Tabs, Td } from '@/components/ui';
import { fyOptions } from '../payroll-common';

interface Config {
  pfEnabled: boolean;
  pfEmployeeRate: number;
  pfEmployerRate: number;
  pfWageCeiling: number;
  pfRestrictToCeiling: boolean;
  esiEnabled: boolean;
  esiWageLimit: number;
  esiEmployeeRate: number;
  esiEmployerRate: number;
  ptEnabled: boolean;
  lwfEnabled: boolean;
  tdsEnabled: boolean;
  gratuityEnabled: boolean;
  defaultState: string;
  pfEstablishmentCode: string;
  esiEmployerCode: string;
  tan: string;
  companyPan: string;
}

interface PtSlab {
  id?: string;
  state?: string;
  minSalary: number;
  maxSalary: number;
  amount: number;
  gender: string;
  month: number;
}

interface LwfRule {
  id: string;
  state: string;
  employeeAmount: number;
  employerAmount: number;
  months: string;
}

interface TaxRule {
  id: string;
  fy: string;
  regime: 'NEW' | 'OLD';
  standardDeduction: number;
  rebateIncomeLimit: number;
  rebateMax: number;
  cessRate: number;
  slabs: { upTo: number | null; rate: number }[];
}

interface States {
  all: string[];
  withPt: string[];
  withLwf: string[];
}

const MONTHS = ['Every month', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
      <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Notice({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">{text}</p>;
}

/* --------------------------------- General -------------------------------- */

function GeneralTab({ canEdit, states }: { canEdit: boolean; states: string[] }) {
  const { data, error } = useFetch<Config>('/statutory/config');
  if (!data) return <Card>{error ? <ErrorNote error={error} /> : <Spinner />}</Card>;
  return <GeneralForm initial={data} canEdit={canEdit} states={states} />;
}

function GeneralForm({ initial, canEdit, states }: { initial: Config; canEdit: boolean; states: string[] }) {
  const [form, setForm] = useState<Config>(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Config>(key: K, value: Config[K]) => setForm({ ...form, [key]: value });
  const num = (key: keyof Config) => (
    <Input type="number" step="0.01" min={0} disabled={!canEdit} value={String(form[key])} onChange={(e) => set(key, Number(e.target.value) as never)} />
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { pfEnabled, pfEmployeeRate, pfEmployerRate, pfWageCeiling, pfRestrictToCeiling, esiEnabled, esiWageLimit,
        esiEmployeeRate, esiEmployerRate, ptEnabled, lwfEnabled, tdsEnabled, gratuityEnabled, defaultState,
        pfEstablishmentCode, esiEmployerCode, tan, companyPan } = form;
      const saved = await api<Config>('/statutory/config', {
        method: 'PATCH',
        body: {
          pfEnabled, pfEmployeeRate, pfEmployerRate, pfWageCeiling, pfRestrictToCeiling, esiEnabled, esiWageLimit,
          esiEmployeeRate, esiEmployerRate, ptEnabled, lwfEnabled, tdsEnabled, gratuityEnabled, defaultState,
          pfEstablishmentCode, esiEmployerCode, tan, companyPan,
        },
      });
      setForm(saved);
      setNotice('Statutory settings saved. They apply to the next payroll calculation.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <ErrorNote error={error} />
      <Notice text={notice} />
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Provident fund</h2>
        <div className="mb-3 flex flex-wrap gap-6">
          <Toggle label="PF enabled" checked={form.pfEnabled} disabled={!canEdit} onChange={(v) => set('pfEnabled', v)} />
          <Toggle label="Restrict PF wages to the ceiling" checked={form.pfRestrictToCeiling} disabled={!canEdit} onChange={(v) => set('pfRestrictToCeiling', v)} />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Employee rate (%)">{num('pfEmployeeRate')}</Field>
          <Field label="Employer rate (%)" hint="EPS 8.33% on wages up to the PF wage ceiling, rest to EPF">{num('pfEmployerRate')}</Field>
          <Field label="Wage ceiling (₹)">{num('pfWageCeiling')}</Field>
          <Field label="Establishment code">
            <Input disabled={!canEdit} value={form.pfEstablishmentCode} onChange={(e) => set('pfEstablishmentCode', e.target.value)} />
          </Field>
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">ESI</h2>
        <div className="mb-3"><Toggle label="ESI enabled" checked={form.esiEnabled} disabled={!canEdit} onChange={(v) => set('esiEnabled', v)} /></div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Wage limit (₹/month)">{num('esiWageLimit')}</Field>
          <Field label="Employee rate (%)">{num('esiEmployeeRate')}</Field>
          <Field label="Employer rate (%)">{num('esiEmployerRate')}</Field>
          <Field label="Employer code">
            <Input disabled={!canEdit} value={form.esiEmployerCode} onChange={(e) => set('esiEmployerCode', e.target.value)} />
          </Field>
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Professional tax, LWF, TDS & gratuity</h2>
        <div className="mb-3 flex flex-wrap gap-6">
          <Toggle label="Professional tax" checked={form.ptEnabled} disabled={!canEdit} onChange={(v) => set('ptEnabled', v)} />
          <Toggle label="Labour welfare fund" checked={form.lwfEnabled} disabled={!canEdit} onChange={(v) => set('lwfEnabled', v)} />
          <Toggle label="TDS on salary" checked={form.tdsEnabled} disabled={!canEdit} onChange={(v) => set('tdsEnabled', v)} />
          <Toggle label="Gratuity provision in CTC" checked={form.gratuityEnabled} disabled={!canEdit} onChange={(v) => set('gratuityEnabled', v)} />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Default state" hint="Used when an employee's office has no state">
            <Select disabled={!canEdit} value={form.defaultState} onChange={(e) => set('defaultState', e.target.value)}>
              {[...new Set([form.defaultState, ...states])].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="TAN">
            <Input disabled={!canEdit} value={form.tan} onChange={(e) => set('tan', e.target.value.toUpperCase())} />
          </Field>
          <Field label="Company PAN">
            <Input disabled={!canEdit} value={form.companyPan} onChange={(e) => set('companyPan', e.target.value.toUpperCase())} />
          </Field>
        </div>
      </Card>
      {canEdit && <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</Button>}
    </div>
  );
}

/* ---------------------------- Professional tax ----------------------------- */

function PtTab({ canEdit, states }: { canEdit: boolean; states: States }) {
  const [state, setState] = useState(states.withPt[0] ?? 'Maharashtra');
  const { data, loading, reload } = useFetch<PtSlab[]>(`/statutory/pt-slabs?state=${encodeURIComponent(state)}`);
  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-60">
          <Field label="State">
            <Select value={state} onChange={(e) => setState(e.target.value)}>
              {[...new Set([...states.withPt, ...states.all])].map((s) => (
                <option key={s} value={s}>{s}{states.withPt.includes(s) ? ' ✓' : ''}</option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="flex-1 text-xs text-slate-400">
          Monthly gross between min and max (inclusive, max 0 = no limit) → PT. Gender- and month-specific slabs override
          the general ones (e.g. Maharashtra February ₹300). Seeded figures are the 2026 state rules — verify and edit.
        </p>
      </div>
      {loading || !data ? <Spinner /> : <PtEditor key={state} state={state} initial={data} canEdit={canEdit} onSaved={reload} />}
    </Card>
  );
}

function PtEditor({ state, initial, canEdit, onSaved }: { state: string; initial: PtSlab[]; canEdit: boolean; onSaved: () => void }) {
  const [rows, setRows] = useState<PtSlab[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (i: number, patch: Partial<PtSlab>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api('/statutory/pt-slabs/state', {
        method: 'PUT',
        body: {
          state,
          slabs: rows.map((r) => ({ minSalary: Number(r.minSalary), maxSalary: Number(r.maxSalary), amount: Number(r.amount), gender: r.gender, month: Number(r.month) })),
        },
      });
      setNotice(`${state} slabs saved.`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ErrorNote error={error} />
      <Notice text={notice} />
      {rows.length === 0 && <Empty message={`No professional tax slabs for ${state} — PT is not deducted there`} />}
      {rows.length > 0 && (
        <Table headers={['Min ₹', 'Max ₹ (0 = no limit)', 'PT ₹', 'Gender', 'Month', '']}>
          {rows.map((r, i) => (
            <tr key={i}>
              <Td><Input type="number" disabled={!canEdit} value={r.minSalary} onChange={(e) => update(i, { minSalary: Number(e.target.value) })} /></Td>
              <Td><Input type="number" disabled={!canEdit} value={r.maxSalary} onChange={(e) => update(i, { maxSalary: Number(e.target.value) })} /></Td>
              <Td><Input type="number" disabled={!canEdit} value={r.amount} onChange={(e) => update(i, { amount: Number(e.target.value) })} /></Td>
              <Td>
                <Select disabled={!canEdit} value={r.gender} onChange={(e) => update(i, { gender: e.target.value })}>
                  <option value="">All</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                </Select>
              </Td>
              <Td>
                <Select disabled={!canEdit} value={r.month} onChange={(e) => update(i, { month: Number(e.target.value) })}>
                  {MONTHS.map((m, k) => <option key={m} value={k}>{m}</option>)}
                </Select>
              </Td>
              <Td>
                {canEdit && (
                  <button className="text-slate-400 hover:text-rose-600" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {canEdit && (
        <div className="mt-3 flex gap-2">
          <Button variant="ghost" onClick={() => setRows([...rows, { minSalary: 0, maxSalary: 0, amount: 0, gender: '', month: 0 }])}>+ slab</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : `Save ${state}`}</Button>
        </div>
      )}
    </>
  );
}

/* ----------------------------------- LWF ----------------------------------- */

function LwfTab({ canEdit, states }: { canEdit: boolean; states: string[] }) {
  const { data: rules, loading, reload } = useFetch<LwfRule[]>('/statutory/lwf-rules');
  const [form, setForm] = useState({ state: '', employeeAmount: '', employerAmount: '', months: '6,12' });
  const [error, setError] = useState<string | null>(null);

  const save = async (body: { state: string; employeeAmount: number; employerAmount: number; months: string }) => {
    setError(null);
    try {
      await api('/statutory/lwf-rules', { method: 'PUT', body });
      setForm({ state: '', employeeAmount: '', employerAmount: '', months: '6,12' });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm('Delete this LWF rule?')) return;
    try {
      await api(`/statutory/lwf-rules/${id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <Card className="p-5">
      <p className="mb-3 text-xs text-slate-400">
        Labour Welfare Fund is deducted in the listed months only, by the employee&apos;s work state. It is applied only
        when LWF is enabled in General settings.
      </p>
      <ErrorNote error={error} />
      {loading ? (
        <Spinner />
      ) : !rules || rules.length === 0 ? (
        <Empty message="No LWF rules" />
      ) : (
        <Table headers={['State', 'Employee ₹', 'Employer ₹', 'Months', '']}>
          {rules.map((r) => (
            <tr key={r.id}>
              <Td className="font-medium text-slate-900">{r.state}</Td>
              <Td>{fmtMoney(r.employeeAmount)}</Td>
              <Td>{fmtMoney(r.employerAmount)}</Td>
              <Td>{r.months.split(',').map((m) => MONTHS[Number(m)] ?? m).join(', ')}</Td>
              <Td>
                {canEdit && (
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => setForm({ state: r.state, employeeAmount: String(r.employeeAmount), employerAmount: String(r.employerAmount), months: r.months })}>Edit</Button>
                    <Button variant="ghost" onClick={() => void remove(r.id)}>Delete</Button>
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {canEdit && (
        <div className="mt-4 grid grid-cols-2 items-end gap-3 md:grid-cols-5">
          <Field label="State">
            <Select value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}>
              <option value="">— select —</option>
              {states.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Employee ₹"><Input type="number" value={form.employeeAmount} onChange={(e) => setForm({ ...form, employeeAmount: e.target.value })} /></Field>
          <Field label="Employer ₹"><Input type="number" value={form.employerAmount} onChange={(e) => setForm({ ...form, employerAmount: e.target.value })} /></Field>
          <Field label="Months (1–12)"><Input value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value })} /></Field>
          <Button
            disabled={!form.state || form.employeeAmount === '' || form.employerAmount === ''}
            onClick={() => void save({ state: form.state, employeeAmount: Number(form.employeeAmount), employerAmount: Number(form.employerAmount), months: form.months.replace(/\s/g, '') })}
          >
            Save rule
          </Button>
        </div>
      )}
    </Card>
  );
}

/* -------------------------------- Income tax ------------------------------- */

function TaxRuleCard({ rule, canEdit, onSaved }: { rule: TaxRule; canEdit: boolean; onSaved: () => void }) {
  const [form, setForm] = useState(rule);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setSlab = (i: number, patch: Partial<TaxRule['slabs'][number]>) =>
    setForm({ ...form, slabs: form.slabs.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api('/statutory/tax-rules', {
        method: 'PUT',
        body: {
          fy: form.fy,
          regime: form.regime,
          standardDeduction: Number(form.standardDeduction),
          rebateIncomeLimit: Number(form.rebateIncomeLimit),
          rebateMax: Number(form.rebateMax),
          cessRate: Number(form.cessRate),
          slabs: form.slabs.map((s, i) => ({ upTo: i === form.slabs.length - 1 ? null : Number(s.upTo), rate: Number(s.rate) })),
        },
      });
      setNotice('Saved');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{form.regime === 'NEW' ? 'New regime (115BAC)' : 'Old regime'} · FY {form.fy}</h2>
      <ErrorNote error={error} />
      <Notice text={notice} />
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Field label="Standard deduction ₹"><Input type="number" disabled={!canEdit} value={form.standardDeduction} onChange={(e) => setForm({ ...form, standardDeduction: Number(e.target.value) })} /></Field>
        <Field label="Cess %"><Input type="number" disabled={!canEdit} value={form.cessRate} onChange={(e) => setForm({ ...form, cessRate: Number(e.target.value) })} /></Field>
        <Field label="87A income limit ₹"><Input type="number" disabled={!canEdit} value={form.rebateIncomeLimit} onChange={(e) => setForm({ ...form, rebateIncomeLimit: Number(e.target.value) })} /></Field>
        <Field label="87A max rebate ₹"><Input type="number" disabled={!canEdit} value={form.rebateMax} onChange={(e) => setForm({ ...form, rebateMax: Number(e.target.value) })} /></Field>
      </div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Slabs (annual taxable income)</p>
      {form.slabs.map((s, i) => {
        const last = i === form.slabs.length - 1;
        const from = i === 0 ? 0 : (form.slabs[i - 1]?.upTo ?? 0);
        return (
          <div key={i} className="mb-2 flex items-center gap-2 text-sm">
            <span className="w-28 text-right tabular-nums text-slate-500">{fmtMoney(from)} –</span>
            {last ? (
              <span className="w-36 text-slate-500">and above</span>
            ) : (
              <Input type="number" className="!w-36" disabled={!canEdit} value={s.upTo ?? ''} onChange={(e) => setSlab(i, { upTo: Number(e.target.value) })} />
            )}
            <Input type="number" className="!w-20" disabled={!canEdit} value={s.rate} onChange={(e) => setSlab(i, { rate: Number(e.target.value) })} />
            <span className="text-slate-500">%</span>
            {canEdit && form.slabs.length > 1 && (
              <button className="text-slate-400 hover:text-rose-600" onClick={() => setForm({ ...form, slabs: form.slabs.filter((_, j) => j !== i) })}>✕</button>
            )}
          </div>
        );
      })}
      {canEdit && (
        <div className="mt-3 flex gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              const slabs = [...form.slabs];
              const prevTop = slabs.length > 1 ? (slabs[slabs.length - 2]?.upTo ?? 0) : 0;
              slabs.splice(slabs.length - 1, 0, { upTo: prevTop + 100000, rate: 0 });
              setForm({ ...form, slabs });
            }}
          >
            + slab
          </Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      )}
    </Card>
  );
}

function TaxTab({ canEdit }: { canEdit: boolean }) {
  const fys = fyOptions(3);
  const [fy, setFy] = useState(fys[0] ?? '');
  const { data: rules, loading, reload } = useFetch<TaxRule[]>(`/statutory/tax-rules?fy=${fy}`);
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <div className="w-36">
          <Select value={fy} onChange={(e) => setFy(e.target.value)}>
            {fys.map((f) => <option key={f} value={f}>FY {f}</option>)}
          </Select>
        </div>
        <p className="text-xs text-slate-400">
          Surcharge (10% / 15% / 25% above ₹50L / 1Cr / 2Cr, 37% above ₹5Cr in the old regime) and marginal relief are
          applied automatically. Employees choose their regime in their tax declaration.
        </p>
      </div>
      {loading || !rules ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {['NEW', 'OLD'].map((regime) => {
            const rule = rules.find((r) => r.regime === regime);
            return rule ? <TaxRuleCard key={`${rule.id}-${fy}`} rule={rule} canEdit={canEdit} onSaved={reload} /> : null;
          })}
        </div>
      )}
    </div>
  );
}

export default function StatutorySettingsPage() {
  const { session } = useAuth();
  const canEdit = session?.role === 'ADMIN' || session?.role === 'SUPER_ADMIN';
  const [tab, setTab] = useState('General');
  const { data: states, error } = useFetch<States>('/statutory/states');

  return (
    <div>
      <PageHeader
        title="Statutory settings"
        subtitle="PF, ESI, professional tax, labour welfare fund and income tax rules"
        actions={<Link href="/payroll" className="text-sm font-medium text-slate-500 hover:text-slate-800">← Payroll</Link>}
      />
      {!canEdit && <p className="mb-4 text-sm text-slate-500">Read-only: only company admins can change statutory settings.</p>}
      <ErrorNote error={error} />
      <Tabs tabs={['General', 'Professional tax', 'Labour welfare fund', 'Income tax']} active={tab} onChange={setTab} />
      {!states ? (
        <Spinner />
      ) : tab === 'General' ? (
        <GeneralTab canEdit={canEdit} states={states.all} />
      ) : tab === 'Professional tax' ? (
        <PtTab canEdit={canEdit} states={states} />
      ) : tab === 'Labour welfare fund' ? (
        <LwfTab canEdit={canEdit} states={states.all} />
      ) : (
        <TaxTab canEdit={canEdit} />
      )}
    </div>
  );
}
