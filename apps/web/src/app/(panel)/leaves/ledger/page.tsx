'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, DatePicker, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td,
} from '@/components/ui';
import { BalanceCards, LeaveNav, fmtDays, type Balance, type EmployeeRef, type LeaveType } from '../leave-common';

interface LedgerEntry {
  id: string;
  date: string;
  change: number;
  kind: string;
  reason: string;
  refId: string | null;
  expiresOn: string | null;
  createdAt: string;
  runningBalance: number;
  createdByName: string | null;
  leaveType: Pick<LeaveType, 'id' | 'code' | 'name' | 'color' | 'isCompOff'>;
}

interface LedgerResponse {
  employee: { id: string; name: string; employeeCode: string };
  year: number;
  entries: LedgerEntry[];
}

const KIND_TONE: Record<string, 'green' | 'red' | 'blue' | 'amber' | 'violet' | 'slate'> = {
  OPENING: 'blue',
  ACCRUAL: 'green',
  CARRY_FORWARD: 'blue',
  LAPSE: 'slate',
  ADJUSTMENT: 'amber',
  AVAILED: 'violet',
  REVERSAL: 'green',
  ENCASHED: 'amber',
  COMP_OFF: 'green',
  EXPIRED: 'slate',
};

function AdjustModal({
  mode,
  employee,
  types,
  year,
  onClose,
  onDone,
}: {
  mode: 'adjust' | 'opening';
  employee: EmployeeRef;
  types: LeaveType[];
  year: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({ leaveTypeId: types[0]?.id ?? '', direction: 'credit', days: '1', reason: '', date: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'adjust') {
        await api('/leaves/ledger/adjust', {
          method: 'POST',
          body: {
            employeeId: employee.id,
            leaveTypeId: form.leaveTypeId,
            days: (form.direction === 'debit' ? -1 : 1) * Number(form.days),
            reason: form.reason,
            ...(form.date ? { date: form.date } : {}),
          },
        });
      } else {
        await api('/leaves/ledger/opening', {
          method: 'POST',
          body: { employeeId: employee.id, leaveTypeId: form.leaveTypeId, year, days: Number(form.days) },
        });
      }
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const valid = Number(form.days) > 0 || (mode === 'opening' && Number(form.days) === 0);

  return (
    <Modal title={mode === 'adjust' ? `Adjust balance · ${employee.name}` : `Opening balance ${year} · ${employee.name}`} open onClose={onClose}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <Field label="Leave type">
          <Select value={form.leaveTypeId} onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.code})
              </option>
            ))}
          </Select>
        </Field>
        {mode === 'adjust' ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <Select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
                  <option value="credit">Credit (+)</option>
                  <option value="debit">Debit (−)</option>
                </Select>
              </Field>
              <Field label="Days">
                <Input type="number" min="0.5" step="0.5" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
              </Field>
            </div>
            <Field label="Effective date" hint="Defaults to today. The date decides which year's balance changes.">
              <DatePicker value={form.date} onChange={(v) => setForm({ ...form, date: v })} clearable />
            </Field>
            <Field label="Reason" hint="Required — recorded in the ledger and the audit log.">
              <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </Field>
          </>
        ) : (
          <Field
            label="Opening days"
            hint="Replaces any earlier opening balance for the year. For yearly types it also replaces the automatic yearly credit; monthly accruals continue on top."
          >
            <Input type="number" min="0" step="0.5" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
          </Field>
        )}
        <Button
          onClick={() => void submit()}
          disabled={busy || !form.leaveTypeId || !valid || (mode === 'adjust' && form.reason.trim().length < 3)}
          className="w-full"
        >
          {mode === 'adjust' ? 'Post adjustment' : 'Set opening balance'}
        </Button>
      </div>
    </Modal>
  );
}

export default function LeaveLedgerPage() {
  const { session, isManagerial, isCompanyAdmin } = useAuth();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [employeeId, setEmployeeId] = useState(session?.employee?.id ?? '');
  const [typeFilter, setTypeFilter] = useState('');
  const [modal, setModal] = useState<'adjust' | 'opening' | null>(null);

  const employees = useFetch<EmployeeRef[]>(isManagerial ? '/leaves/employees' : null);
  const types = useFetch<LeaveType[]>('/leaves/types');
  const selected = employeeId || employees.data?.[0]?.id || '';
  const q = `employeeId=${selected}&year=${year}`;
  const balances = useFetch<Balance[]>(selected ? `/leaves/balance?${q}` : null);
  const ledger = useFetch<LedgerResponse>(selected ? `/leaves/ledger?${q}${typeFilter ? `&leaveTypeId=${typeFilter}` : ''}` : null);
  const employee = employees.data?.find((e) => e.id === selected) ?? (ledger.data ? ledger.data.employee : null);

  const reload = () => {
    balances.reload();
    ledger.reload();
  };

  return (
    <div>
      <PageHeader
        title="Leave ledger"
        subtitle="Every credit and debit behind a balance"
        actions={
          <>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              {[thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
            {isCompanyAdmin && employee && (
              <>
                <Button variant="secondary" onClick={() => setModal('opening')}>
                  Opening balance
                </Button>
                <Button onClick={() => setModal('adjust')}>Adjust balance</Button>
              </>
            )}
          </>
        }
      />
      <LeaveNav />

      <div className="mb-5 flex flex-wrap items-end gap-3">
        {isManagerial && (
          <div className="w-72">
            <Field label="Employee">
              <Select value={selected} onChange={(e) => setEmployeeId(e.target.value)}>
                {(employees.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} {e.employeeCode ? `(${e.employeeCode})` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        <div className="w-56">
          <Field label="Leave type">
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              {(types.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      <ErrorNote error={balances.error ?? ledger.error} />
      {!selected && !employees.loading && (
        <Card>
          <Empty message="No employee profile to show" />
        </Card>
      )}

      {balances.data && <BalanceCards balances={balances.data} />}

      {selected && (
        <Card>
          {ledger.loading ? (
            <Spinner />
          ) : !ledger.data || ledger.data.entries.length === 0 ? (
            <Empty message={`No ledger entries in ${year}`} />
          ) : (
            <Table headers={['Date', 'Type', 'Entry', 'Change', 'Balance', 'Details', 'By']}>
              {ledger.data.entries.map((e) => (
                <tr key={e.id}>
                  <Td>{fmtDate(e.date)}</Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.leaveType.color }} />
                      {e.leaveType.code}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={KIND_TONE[e.kind] ?? 'slate'}>{e.kind.replace('_', ' ')}</Badge>
                  </Td>
                  <Td className={`font-semibold ${e.change >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {e.change > 0 ? '+' : ''}
                    {fmtDays(e.change)}
                  </Td>
                  <Td>{fmtDays(e.runningBalance)}</Td>
                  <Td className="max-w-72 text-xs text-slate-500">
                    {e.reason}
                    {e.expiresOn && <span className="block">expires {fmtDate(e.expiresOn)}</span>}
                  </Td>
                  <Td className="text-xs text-slate-500">{e.createdByName ?? 'System'}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {modal && employee && types.data && (
        <AdjustModal
          mode={modal}
          employee={employee}
          types={types.data}
          year={year}
          onClose={() => setModal(null)}
          onDone={reload}
        />
      )}
    </div>
  );
}
