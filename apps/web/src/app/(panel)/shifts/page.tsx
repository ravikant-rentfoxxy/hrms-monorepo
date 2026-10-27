'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, DatePicker, Empty, ErrorNote, Field, Icon, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Td,
} from '@/components/ui';

interface Shift {
  id: string;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  breakMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  overtimeAfterMinutes: number;
  isNight: boolean;
  weeklyOffs: string;
  altSaturdaysOff: string;
  color: string;
  isDefault: boolean;
  isActive: boolean;
  assignedNow?: number;
}

interface Assignment {
  id: string;
  fromDate: string;
  toDate: string | null;
  shift: { id: string; name: string; code: string; color: string; startTime: string; endTime: string };
  employee: { id: string; name: string; employeeCode: string; department: string };
}

interface EmployeeLite {
  id: string;
  name: string;
  employeeCode: string;
  department: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const COLORS = ['#4F46E5', '#0EA5E9', '#16A34A', '#F59E0B', '#DC2626', '#7C3AED', '#0D9488', '#DB2777', '#64748B'];

const emptyForm = {
  name: '',
  code: '',
  startTime: '09:30',
  endTime: '18:30',
  graceMinutes: '10',
  breakMinutes: '60',
  fullDayMinutes: '480',
  halfDayMinutes: '240',
  overtimeAfterMinutes: '0',
  isNight: false,
  weeklyOffs: [0, 6] as number[],
  altSaturdaysOff: '',
  color: '#4F46E5',
  isDefault: false,
};

const hm = (minutes: number) => `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;

function weeklyOffLabel(s: Pick<Shift, 'weeklyOffs' | 'altSaturdaysOff'>): string {
  const days = s.weeklyOffs.split(',').filter(Boolean).map(Number);
  const alt = s.altSaturdaysOff.split(',').filter(Boolean);
  const parts = days.filter((d) => !(d === 6 && alt.length)).map((d) => WEEKDAYS[d]);
  if (alt.length) parts.push(`Sat (${alt.map((w) => `${w}${['st', 'nd', 'rd', 'th', 'th'][Number(w) - 1]}`).join(', ')})`);
  return parts.length ? parts.join(', ') : 'None';
}

/** All active employees (the list API pages at 100). */
async function loadAllEmployees(): Promise<EmployeeLite[]> {
  const all: EmployeeLite[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await api<{ items: EmployeeLite[]; total: number }>(`/employees?pageSize=100&page=${page}`);
    all.push(...res.items);
    if (all.length >= res.total || res.items.length === 0) break;
  }
  return all;
}

export default function ShiftsPage() {
  const { isCompanyAdmin } = useAuth();
  const [tab, setTab] = useState('Shifts');
  const shifts = useFetch<Shift[]>('/shifts?includeInactive=true');
  const assignments = useFetch<Assignment[]>(tab === 'Assignments' ? '/shifts/assignments' : null);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assignFor, setAssignFor] = useState<Shift | null>(null);

  if (!isCompanyAdmin) return <Empty message="Only ADMIN / HR can manage shifts." />;

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setFormOpen(true);
  };

  const openEdit = (s: Shift) => {
    setEditing(s);
    setForm({
      name: s.name,
      code: s.code,
      startTime: s.startTime,
      endTime: s.endTime,
      graceMinutes: String(s.graceMinutes),
      breakMinutes: String(s.breakMinutes),
      fullDayMinutes: String(s.fullDayMinutes),
      halfDayMinutes: String(s.halfDayMinutes),
      overtimeAfterMinutes: String(s.overtimeAfterMinutes),
      isNight: s.isNight,
      weeklyOffs: s.weeklyOffs.split(',').filter(Boolean).map(Number),
      altSaturdaysOff: s.altSaturdaysOff,
      color: s.color,
      isDefault: s.isDefault,
    });
    setError(null);
    setFormOpen(true);
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        startTime: form.startTime,
        endTime: form.endTime,
        graceMinutes: Number(form.graceMinutes) || 0,
        breakMinutes: Number(form.breakMinutes) || 0,
        fullDayMinutes: Number(form.fullDayMinutes) || 480,
        halfDayMinutes: Number(form.halfDayMinutes) || 240,
        overtimeAfterMinutes: Number(form.overtimeAfterMinutes) || 0,
        isNight: form.isNight,
        weeklyOffs: [...form.weeklyOffs].sort().join(','),
        altSaturdaysOff: form.altSaturdaysOff.replace(/\s/g, ''),
        color: form.color,
        isDefault: form.isDefault,
      };
      if (editing) await api(`/shifts/${editing.id}`, { method: 'PATCH', body });
      else await api('/shifts', { method: 'POST', body });
      setFormOpen(false);
      shifts.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: Shift) => {
    if (!confirm(`Delete shift ${s.name}? Shifts with history are deactivated instead.`)) return;
    try {
      const res = await api<{ deleted: boolean; deactivated: boolean }>(`/shifts/${s.id}`, { method: 'DELETE' });
      if (res.deactivated) alert(`${s.name} has history, so it was deactivated instead of deleted.`);
      shifts.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  };

  const toggleActive = async (s: Shift) => {
    try {
      await api(`/shifts/${s.id}`, { method: 'PATCH', body: { isActive: !s.isActive } });
      shifts.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  };

  const makeDefault = async (s: Shift) => {
    try {
      await api(`/shifts/${s.id}`, { method: 'PATCH', body: { isDefault: true } });
      shifts.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  };

  const removeAssignment = async (a: Assignment) => {
    if (!confirm(`Remove ${a.employee.name}'s ${a.shift.code} assignment? They fall back to the default shift.`)) return;
    await api(`/shifts/assignments/${a.id}`, { method: 'DELETE' });
    assignments.reload();
  };

  const toggleWeekday = (d: number) =>
    setForm((f) => ({ ...f, weeklyOffs: f.weeklyOffs.includes(d) ? f.weeklyOffs.filter((x) => x !== d) : [...f.weeklyOffs, d] }));

  return (
    <div>
      <PageHeader
        title="Shifts"
        subtitle="Timings, grace, weekly offs and who works which shift"
        actions={
          <>
            <Button variant="secondary" onClick={() => setAssignFor(shifts.data?.find((s) => s.isActive) ?? null)}>
              <Icon name="users" className="h-4 w-4" /> Assign shift
            </Button>
            <Button onClick={openNew}>
              <Icon name="plus" className="h-4 w-4" /> New shift
            </Button>
          </>
        }
      />
      <Tabs tabs={['Shifts', 'Assignments']} active={tab} onChange={setTab} />

      {tab === 'Shifts' ? (
        <Card>
          {shifts.loading ? (
            <Spinner />
          ) : shifts.error ? (
            <div className="p-4"><ErrorNote error={shifts.error} /></div>
          ) : !shifts.data || shifts.data.length === 0 ? (
            <Empty message="No shifts yet" />
          ) : (
            <Table headers={['Shift', 'Timing', 'Grace / break', 'Full / half day', 'OT after', 'Weekly off', 'Assigned', '']}>
              {shifts.data.map((s) => (
                <tr key={s.id} className={s.isActive ? '' : 'opacity-50'}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
                      <div>
                        <p className="font-medium text-ink-900">
                          {s.name} <span className="text-xs text-ink-400">{s.code}</span>
                        </p>
                        <div className="mt-0.5 flex gap-1">
                          {s.isDefault && <Badge tone="blue">default</Badge>}
                          {s.isNight && <Badge tone="violet">night</Badge>}
                          {!s.isActive && <Badge>inactive</Badge>}
                        </div>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    {s.startTime} – {s.endTime}
                    {s.isNight && <span className="text-xs text-ink-400"> (+1)</span>}
                  </Td>
                  <Td>
                    {s.graceMinutes}m / {s.breakMinutes}m
                  </Td>
                  <Td>
                    {hm(s.fullDayMinutes)} / {hm(s.halfDayMinutes)}
                  </Td>
                  <Td>{s.overtimeAfterMinutes ? hm(s.overtimeAfterMinutes) : 'Full day'}</Td>
                  <Td>{weeklyOffLabel(s)}</Td>
                  <Td>{s.assignedNow ?? 0}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      {s.isActive && (
                        <Button variant="ghost" onClick={() => setAssignFor(s)}>
                          Assign
                        </Button>
                      )}
                      <Button variant="ghost" onClick={() => openEdit(s)}>
                        Edit
                      </Button>
                      {!s.isDefault && s.isActive && (
                        <Button variant="ghost" onClick={() => void makeDefault(s)}>
                          Make default
                        </Button>
                      )}
                      {!s.isDefault && (
                        <Button variant="ghost" onClick={() => void toggleActive(s)}>
                          {s.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                      )}
                      {!s.isDefault && (
                        <Button variant="ghost" onClick={() => void remove(s)}>
                          <Icon name="x" className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      ) : (
        <Card>
          {assignments.loading ? (
            <Spinner />
          ) : !assignments.data || assignments.data.length === 0 ? (
            <Empty message="No shift assignments — everyone works the default shift" />
          ) : (
            <Table headers={['Employee', 'Department', 'Shift', 'From', 'To', '']}>
              {assignments.data.map((a) => (
                <tr key={a.id}>
                  <Td className="font-medium text-ink-900">
                    {a.employee.name} <span className="text-xs text-ink-400">{a.employee.employeeCode}</span>
                  </Td>
                  <Td>{a.employee.department || '—'}</Td>
                  <Td>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.shift.color }} />
                      {a.shift.name} ({a.shift.startTime}–{a.shift.endTime})
                    </span>
                  </Td>
                  <Td>{fmtDate(a.fromDate)}</Td>
                  <Td>{a.toDate ? fmtDate(a.toDate) : 'Open-ended'}</Td>
                  <Td>
                    <Button variant="ghost" onClick={() => void removeAssignment(a)}>
                      Remove
                    </Button>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      <Modal title={editing ? `Edit ${editing.name}` : 'New shift'} open={formOpen} onClose={() => setFormOpen(false)} wide>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="Name">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Morning" />
              </Field>
            </div>
            <Field label="Code">
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="MOR" maxLength={10} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Start">
              <Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
            </Field>
            <Field label="End">
              <Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
            </Field>
            <Field label="Night shift" hint="ends the next day">
              <label className="flex h-[42px] items-center gap-2 text-sm text-ink-700">
                <input type="checkbox" checked={form.isNight} onChange={(e) => setForm({ ...form, isNight: e.target.checked })} />
                Ends next morning
              </label>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Grace (min)" hint="late after start + grace">
              <Input type="number" min={0} value={form.graceMinutes} onChange={(e) => setForm({ ...form, graceMinutes: e.target.value })} />
            </Field>
            <Field label="Break (min)">
              <Input type="number" min={0} value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: e.target.value })} />
            </Field>
            <Field label="OT after (min)" hint="0 = beyond a full day">
              <Input
                type="number"
                min={0}
                value={form.overtimeAfterMinutes}
                onChange={(e) => setForm({ ...form, overtimeAfterMinutes: e.target.value })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full day (worked min)">
              <Input type="number" min={60} value={form.fullDayMinutes} onChange={(e) => setForm({ ...form, fullDayMinutes: e.target.value })} />
            </Field>
            <Field label="Half day (worked min)">
              <Input type="number" min={30} value={form.halfDayMinutes} onChange={(e) => setForm({ ...form, halfDayMinutes: e.target.value })} />
            </Field>
          </div>
          <Field label="Weekly offs">
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleWeekday(i)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${
                    form.weeklyOffs.includes(i) ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-ink-600 ring-ink-200'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Alternate Saturdays off" hint='e.g. "2,4" = only the 2nd & 4th Saturdays off, other Saturdays working. Empty = per weekly offs'>
            <Input value={form.altSaturdaysOff} onChange={(e) => setForm({ ...form, altSaturdaysOff: e.target.value })} placeholder="2,4" />
          </Field>
          <Field label="Colour">
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => setForm({ ...form, color: c })}
                  className={`h-7 w-7 rounded-full ring-offset-2 ${form.color === c ? 'ring-2 ring-ink-900' : ''}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </Field>
          {!editing?.isDefault && (
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
              Company default (applies to everyone without an assignment)
            </label>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={busy || !form.name || !form.code}>
              {editing ? 'Save changes' : 'Create shift'}
            </Button>
          </div>
        </div>
      </Modal>

      {assignFor !== null && shifts.data && (
        <AssignModal
          shifts={shifts.data.filter((s) => s.isActive)}
          initialShiftId={assignFor.id}
          onClose={() => setAssignFor(null)}
          onDone={() => {
            setAssignFor(null);
            shifts.reload();
            assignments.reload();
          }}
        />
      )}
    </div>
  );
}

function AssignModal({
  shifts,
  initialShiftId,
  onClose,
  onDone,
}: {
  shifts: Shift[];
  initialShiftId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [employees, setEmployees] = useState<EmployeeLite[] | null>(null);
  const [shiftId, setShiftId] = useState(initialShiftId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState(new Date().toISOString().slice(0, 10));
  const [toDate, setToDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadAllEmployees()
      .then(setEmployees)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load employees'));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (employees ?? []).filter(
      (e) => !q || e.name.toLowerCase().includes(q) || e.employeeCode.toLowerCase().includes(q) || e.department.toLowerCase().includes(q)
    );
  }, [employees, query]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.id));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const e of filtered) {
        if (allVisibleSelected) next.delete(e.id);
        else next.add(e.id);
      }
      return next;
    });
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await api('/shifts/assignments', {
        method: 'POST',
        body: { shiftId, employeeIds: [...selected], fromDate, toDate: toDate || null },
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Assign shift" open onClose={onClose} wide>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <Field label="Shift">
          <Select value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
            {shifts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code}) · {s.startTime}–{s.endTime}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <DatePicker value={fromDate} onChange={setFromDate} />
          </Field>
          <Field label="To" hint="leave empty for open-ended">
            <DatePicker value={toDate} onChange={setToDate} clearable placeholder="Open-ended" />
          </Field>
        </div>
        <Field label={`Employees (${selected.size} selected)`}>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, code or department" />
        </Field>
        <div className="max-h-72 overflow-y-auto rounded-xl border border-ink-200">
          {!employees ? (
            <Spinner />
          ) : filtered.length === 0 ? (
            <Empty message="No employees match" />
          ) : (
            <>
              <label className="flex items-center gap-2 border-b border-ink-100 bg-ink-50/60 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-ink-500">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} />
                Select all shown ({filtered.length})
              </label>
              {filtered.map((e) => (
                <label key={e.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-ink-50">
                  <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                  <span className="font-medium text-ink-800">{e.name}</span>
                  <span className="text-xs text-ink-400">{e.employeeCode}</span>
                  <span className="ml-auto text-xs text-ink-400">{e.department}</span>
                </label>
              ))}
            </>
          )}
        </div>
        <p className="text-xs text-ink-400">Overlapping assignments of the selected employees are trimmed to this range.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || selected.size === 0 || !fromDate}>
            Assign to {selected.size} employee{selected.size === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
