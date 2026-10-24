'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';
import { LeaveNav, fmtDays, type LeaveType } from '../leave-common';

type Form = Omit<LeaveType, 'id'>;

const EMPTY: Form = {
  code: '',
  name: '',
  totalPerYear: 12,
  color: '#7C3AED',
  isActive: true,
  accrualType: 'YEARLY',
  accrualRate: 0,
  carryForwardMax: 0,
  encashable: false,
  maxEncashDays: 0,
  maxConsecutive: 0,
  minNoticeDays: 0,
  allowNegative: false,
  maxNegative: 0,
  applicableAfterDays: 0,
  gender: '',
  sandwichRule: false,
  allowHalfDay: true,
  isCompOff: false,
  compOffExpiryDays: 0,
  isPaid: true,
};

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 p-3">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-slate-400">{hint}</span>
      </span>
    </label>
  );
}

function PolicyEditor({ initial, onClose, onDone }: { initial: LeaveType | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState<Form>(() => {
    if (!initial) return EMPTY;
    const { id: _id, ...rest } = initial;
    void _id;
    return rest;
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const num = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const body = {
        code: form.code, name: form.name, totalPerYear: form.totalPerYear, color: form.color,
        accrualType: form.accrualType, accrualRate: form.accrualRate, carryForwardMax: form.carryForwardMax,
        encashable: form.encashable, maxEncashDays: form.encashable ? form.maxEncashDays : 0,
        maxConsecutive: form.maxConsecutive, minNoticeDays: form.minNoticeDays,
        allowNegative: form.allowNegative, maxNegative: form.allowNegative ? form.maxNegative : 0,
        applicableAfterDays: form.applicableAfterDays, gender: form.gender, sandwichRule: form.sandwichRule,
        allowHalfDay: form.allowHalfDay, isCompOff: form.isCompOff, compOffExpiryDays: form.compOffExpiryDays, isPaid: form.isPaid,
        ...(initial ? { isActive: form.isActive } : {}),
      };
      if (initial) await api(`/leaves/types/${initial.id}`, { method: 'PATCH', body });
      else await api('/leaves/types', { method: 'POST', body });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? `Edit ${initial.name}` : 'New leave type'} open onClose={onClose} wide>
      <div className="space-y-5">
        <ErrorNote error={error} />
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Code">
            <Input value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} maxLength={10} />
          </Field>
          <div className="col-span-2">
            <Field label="Name">
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
          </div>
          <Field label="Colour">
            <Input type="color" value={form.color} onChange={(e) => set('color', e.target.value)} className="h-10.5 p-1" />
          </Field>
        </section>

        <section>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Entitlement</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Accrual" hint="Yearly: full quota on 1 Jan. Monthly: credited each month. None: credit-only (comp-off, unpaid).">
              <Select value={form.accrualType} onChange={(e) => set('accrualType', e.target.value as Form['accrualType'])} disabled={form.isCompOff}>
                <option value="YEARLY">Yearly</option>
                <option value="MONTHLY">Monthly</option>
                <option value="NONE">None</option>
              </Select>
            </Field>
            <Field label="Days per year" hint="Quota for a full year. Pro-rated by joining month in the joining year.">
              <Input type="number" min="0" step="0.5" value={form.totalPerYear} onChange={num('totalPerYear')} />
            </Field>
            {form.accrualType === 'MONTHLY' && (
              <Field label="Days per month" hint="Leave blank (0) to use days per year ÷ 12.">
                <Input type="number" min="0" step="0.25" value={form.accrualRate} onChange={num('accrualRate')} />
              </Field>
            )}
            <Field label="Carry forward max" hint="Unused days carried into next year; the rest lapses on 31 Dec. 0 = none.">
              <Input type="number" min="0" step="0.5" value={form.carryForwardMax} onChange={num('carryForwardMax')} />
            </Field>
          </div>
        </section>

        <section>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Eligibility & applying</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Available to" hint="Restrict e.g. maternity / paternity leave.">
              <Select value={form.gender} onChange={(e) => set('gender', e.target.value as Form['gender'])}>
                <option value="">Everyone</option>
                <option value="FEMALE">Female employees</option>
                <option value="MALE">Male employees</option>
              </Select>
            </Field>
            <Field label="Usable after (days)" hint="Probation: days after joining before it can be used.">
              <Input type="number" min="0" value={form.applicableAfterDays} onChange={num('applicableAfterDays')} />
            </Field>
            <Field label="Notice (days)" hint="Minimum days between applying and the leave start. 0 = back-dated allowed.">
              <Input type="number" min="0" value={form.minNoticeDays} onChange={num('minNoticeDays')} />
            </Field>
            <Field label="Max days per request" hint="0 = unlimited.">
              <Input type="number" min="0" step="0.5" value={form.maxConsecutive} onChange={num('maxConsecutive')} />
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Toggle label="Half days allowed" hint="Employees may take a single half day." checked={form.allowHalfDay} onChange={(v) => set('allowHalfDay', v)} />
            <Toggle
              label="Sandwich rule"
              hint="Weekends and holidays between two leave days are counted as leave."
              checked={form.sandwichRule}
              onChange={(v) => set('sandwichRule', v)}
            />
            <Toggle label="Paid leave" hint="Unpaid leave is deducted in payroll as loss of pay." checked={form.isPaid} onChange={(v) => set('isPaid', v)} />
            <Toggle
              label="Allow negative balance"
              hint="Let employees borrow against future accrual."
              checked={form.allowNegative}
              onChange={(v) => set('allowNegative', v)}
            />
          </div>
          {form.allowNegative && (
            <div className="mt-3 max-w-xs">
              <Field label="Max negative days" hint="How far below zero the balance may go.">
                <Input type="number" min="0" step="0.5" value={form.maxNegative} onChange={num('maxNegative')} />
              </Field>
            </div>
          )}
        </section>

        <section>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Encashment & comp-off</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Toggle
              label="Encashable"
              hint="Employees can convert balance to pay (basic ÷ 26 per day)."
              checked={form.encashable}
              onChange={(v) => set('encashable', v)}
            />
            <Toggle
              label="Comp-off type"
              hint="Approved comp-off requests are credited here. Only one per company."
              checked={form.isCompOff}
              onChange={(v) => setForm((f) => ({ ...f, isCompOff: v, accrualType: v ? 'NONE' : f.accrualType }))}
            />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {form.encashable && (
              <Field label="Max encash days / year" hint="0 = up to the full balance.">
                <Input type="number" min="0" step="0.5" value={form.maxEncashDays} onChange={num('maxEncashDays')} />
              </Field>
            )}
            {form.isCompOff && (
              <Field label="Comp-off expiry (days)" hint="Credits expire this many days after the day worked. 0 = never.">
                <Input type="number" min="0" value={form.compOffExpiryDays} onChange={num('compOffExpiryDays')} />
              </Field>
            )}
          </div>
        </section>

        {initial && (
          <Toggle
            label="Active"
            hint="Inactive types can't be applied for and are hidden from balances."
            checked={form.isActive}
            onChange={(v) => set('isActive', v)}
          />
        )}
        <p className="text-xs text-slate-400">Policy changes apply to future credits and applications; posted ledger entries are not rewritten.</p>
        <Button onClick={() => void save()} disabled={busy || !form.code || form.name.trim().length < 2} className="w-full">
          {initial ? 'Save policy' : 'Create leave type'}
        </Button>
      </div>
    </Modal>
  );
}

export default function LeavePoliciesPage() {
  const { isCompanyAdmin } = useAuth();
  const types = useFetch<LeaveType[]>(isCompanyAdmin ? '/leaves/types?all=true' : null);
  const [editing, setEditing] = useState<LeaveType | 'new' | null>(null);

  if (!isCompanyAdmin) {
    return (
      <div>
        <PageHeader title="Leave policies" />
        <LeaveNav />
        <Card>
          <Empty message="Only HR and admins can manage leave policies" />
        </Card>
      </div>
    );
  }

  const describe = (t: LeaveType) =>
    [
      t.accrualType === 'MONTHLY' ? `${fmtDays(t.accrualRate || t.totalPerYear / 12)}/month` : t.accrualType === 'YEARLY' ? `${fmtDays(t.totalPerYear)}/year` : 'credit only',
      t.carryForwardMax > 0 && `carry ${fmtDays(t.carryForwardMax)}`,
      t.minNoticeDays > 0 && `${t.minNoticeDays}d notice`,
      t.maxConsecutive > 0 && `max ${fmtDays(t.maxConsecutive)}/req`,
      t.applicableAfterDays > 0 && `after ${t.applicableAfterDays}d`,
      t.sandwichRule && 'sandwich',
      !t.allowHalfDay && 'no half day',
      t.allowNegative && `−${fmtDays(t.maxNegative)} allowed`,
      t.gender && t.gender.toLowerCase(),
      t.encashable && `encash${t.maxEncashDays ? ` ≤${fmtDays(t.maxEncashDays)}` : ''}`,
      t.isCompOff && `comp-off${t.compOffExpiryDays ? `, expires ${t.compOffExpiryDays}d` : ''}`,
      !t.isPaid && 'unpaid',
    ].filter(Boolean) as string[];

  return (
    <div>
      <PageHeader title="Leave policies" subtitle="Leave types and the rules the engine enforces" actions={<Button onClick={() => setEditing('new')}>+ New type</Button>} />
      <LeaveNav />
      <Card>
        {types.loading ? (
          <Spinner />
        ) : !types.data || types.data.length === 0 ? (
          <Empty message="No leave types yet" />
        ) : (
          <Table headers={['Code', 'Name', 'Policy', 'Status', '']}>
            {types.data.map((t) => (
              <tr key={t.id}>
                <Td>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                    <Badge tone="violet">{t.code}</Badge>
                  </span>
                </Td>
                <Td className="font-medium text-slate-900">{t.name}</Td>
                <Td>
                  <div className="flex max-w-xl flex-wrap gap-1">
                    {describe(t).map((d) => (
                      <Badge key={d}>{d}</Badge>
                    ))}
                  </div>
                </Td>
                <Td>{t.isActive ? <Badge tone="green">active</Badge> : <Badge>inactive</Badge>}</Td>
                <Td>
                  <Button variant="ghost" onClick={() => setEditing(t)}>
                    Edit
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && <PolicyEditor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={types.reload} />}
    </div>
  );
}
