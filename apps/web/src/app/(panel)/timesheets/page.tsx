'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, DatePicker, Empty, ErrorNote, Field, Modal, PageHeader, Select, Spinner, Stat, Table, Tabs, Td, Textarea,
} from '@/components/ui';
import { addDays, dayLabel, dayOf, downloadFile, errMsg, extraTone, isoDay, mondayOf } from '@/components/engage';

interface Project {
  id: string;
  name: string;
  code: string;
  client: string;
  isBillable: boolean;
  isActive: boolean;
}

interface Entry {
  id: string;
  projectId: string;
  date: string;
  hours: number;
  billable: boolean;
  description: string;
  project: Project;
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

interface Week {
  id: string | null;
  weekStart: string;
  status: string;
  remarks: string | null;
  submittedAt: string | null;
  totalHours: number;
  editable: boolean;
  entries: Entry[];
  trail: TrailStep[];
  employee: { id: string; name: string };
}

interface WeekRow {
  id: string;
  weekStart: string;
  status: string;
  totalHours: number;
  billableHours: number;
  nonBillableHours: number;
  submittedAt: string | null;
  remarks: string | null;
  employee: { id: string; name: string; employeeCode: string; department: string };
}

interface Bucket {
  billable: number;
  nonBillable: number;
  total: number;
  billablePct: number;
}

interface Utilisation {
  totals: Bucket;
  byProject: (Bucket & { project: Project; employees: number })[];
  byEmployee: (Bucket & { employee: { id: string; name: string; department: string } })[];
}

/** One grid line: a project with hours per day (keyed by YYYY-MM-DD). */
interface GridRow {
  projectId: string;
  billable: boolean;
  description: string;
  hours: Record<string, string>;
}

const parseDay = (s: string) => {
  const [y, m, d] = dayOf(s).split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};

function rowsFromWeek(week: Week): GridRow[] {
  const rows = new Map<string, GridRow>();
  for (const e of week.entries) {
    const row = rows.get(e.projectId) ?? { projectId: e.projectId, billable: e.billable, description: '', hours: {} };
    row.hours[dayOf(e.date)] = String(e.hours);
    if (!row.description && e.description) row.description = e.description;
    rows.set(e.projectId, row);
  }
  return [...rows.values()];
}

const num = (s: string | undefined) => {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function Trail({ steps }: { steps: TrailStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="space-y-1.5 text-xs text-slate-500">
      {steps.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center gap-2">
          <Badge tone={extraTone(s.status)}>L{s.level} {s.status}</Badge>
          <span>{s.actedByName ?? s.approverName ?? '—'}</span>
          {s.actedAt && <span>· {fmtDate(s.actedAt)}</span>}
          {s.remarks && <span className="italic">“{s.remarks}”</span>}
        </li>
      ))}
    </ol>
  );
}

function MyWeek({ projects }: { projects: Project[] }) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const ws = isoDay(weekStart);
  const week = useFetch<Week>(`/timesheets/week?weekStart=${ws}`);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [addProject, setAddProject] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    // Reset the grid whenever a (new) week is loaded from the server.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (week.data) setRows(rowsFromWeek(week.data));
    setDirty(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [week.data]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const editable = week.data?.editable ?? false;
  const dayTotal = (d: string) => rows.reduce((s, r) => s + num(r.hours[d]), 0);
  const rowTotal = (r: GridRow) => days.reduce((s, d) => s + num(r.hours[isoDay(d)]), 0);
  const grand = rows.reduce((s, r) => s + rowTotal(r), 0);
  const project = (id: string) => projects.find((p) => p.id === id) ?? week.data?.entries.find((e) => e.projectId === id)?.project;
  const available = projects.filter((p) => !rows.some((r) => r.projectId === p.id));

  const update = (i: number, patch: Partial<GridRow>) => {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
      setNotice(ok);
      week.reload();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const payload = () => ({
    weekStart: ws,
    entries: rows.flatMap((r) =>
      days
        .map((d) => isoDay(d))
        .filter((d) => num(r.hours[d]) > 0)
        .map((d) => ({ projectId: r.projectId, date: d, hours: num(r.hours[d]), billable: r.billable, description: r.description }))
    ),
  });

  const save = () => run(() => api('/timesheets/week', { method: 'PUT', body: payload() }), 'Timesheet saved');
  const submit = () =>
    run(async () => {
      const saved = await api<Week>('/timesheets/week', { method: 'PUT', body: payload() });
      if (!saved.id) throw new Error('Nothing to submit');
      await api(`/timesheets/${saved.id}/submit`, { method: 'POST' });
    }, 'Submitted for approval');
  const recall = () => run(() => api(`/timesheets/${week.data?.id}/recall`, { method: 'POST' }), 'Recalled — you can edit again');
  const copyLast = () => run(() => api('/timesheets/week/copy-last', { method: 'POST', body: { weekStart: ws } }), 'Copied last week');

  const go = (deltaWeeks: number) => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setWeekStart(addDays(weekStart, deltaWeeks * 7));
    setNotice(null);
    setError(null);
  };

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => go(-1)}>
            ←
          </Button>
          <div className="min-w-48 text-center">
            <p className="text-sm font-semibold text-slate-900">
              {fmtDate(weekStart)} – {fmtDate(addDays(weekStart, 6))}
            </p>
            {week.data && <Badge tone={extraTone(week.data.status)}>{week.data.status}</Badge>}
          </div>
          <Button variant="secondary" onClick={() => go(1)}>
            →
          </Button>
          <Button variant="ghost" onClick={() => go(Math.round((mondayOf(new Date()).getTime() - weekStart.getTime()) / (7 * 86400000)))}>
            This week
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && rows.length === 0 && (
            <Button variant="secondary" disabled={busy} onClick={() => void copyLast()}>
              Copy last week
            </Button>
          )}
          {editable && (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => void save()}>
                Save draft
              </Button>
              <Button disabled={busy || grand <= 0} onClick={() => void submit()}>
                Submit week
              </Button>
            </>
          )}
          {week.data?.status === 'SUBMITTED' && (
            <Button variant="secondary" disabled={busy} onClick={() => void recall()}>
              Recall
            </Button>
          )}
        </div>
      </Card>

      <ErrorNote error={error ?? week.error} />
      {notice && <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">{notice}</p>}
      {week.data?.status === 'REJECTED' && week.data.remarks && (
        <p className="rounded-xl border border-rose-100 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
          Rejected: {week.data.remarks} — correct the hours and submit again.
        </p>
      )}

      <Card>
        {week.loading && !week.data ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200/80 bg-slate-50/60 text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3 font-semibold">Project</th>
                  {days.map((d) => (
                    <th key={d.toISOString()} className={`px-2 py-3 text-center font-semibold ${d.getDay() % 6 === 0 ? 'text-slate-400' : ''}`}>
                      {dayLabel(d)}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-right font-semibold">Total</th>
                  <th className="px-3 py-3 font-semibold">Billable</th>
                  {editable && <th />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={11}>
                      <Empty message={editable ? 'Add a project row to start logging hours' : 'No hours logged this week'} />
                    </td>
                  </tr>
                )}
                {rows.map((r, i) => {
                  const p = project(r.projectId);
                  return (
                    <tr key={r.projectId}>
                      <td className="px-4 py-2 align-top">
                        <p className="font-medium text-slate-900">
                          <Badge tone="violet">{p?.code ?? '?'}</Badge> {p?.name}
                        </p>
                        <input
                          value={r.description}
                          disabled={!editable}
                          placeholder="What did you work on?"
                          onChange={(e) => update(i, { description: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-xs text-slate-500 hover:border-slate-200 focus:border-indigo-300 focus:outline-none disabled:hover:border-transparent"
                        />
                      </td>
                      {days.map((d) => {
                        const key = isoDay(d);
                        return (
                          <td key={key} className="px-1 py-2 text-center">
                            <input
                              type="number"
                              min={0}
                              max={24}
                              step={0.25}
                              value={r.hours[key] ?? ''}
                              disabled={!editable}
                              onChange={(e) => update(i, { hours: { ...r.hours, [key]: e.target.value } })}
                              className="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-center text-sm focus:border-indigo-400 focus:outline-none disabled:border-transparent disabled:bg-transparent"
                            />
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">{rowTotal(r)}</td>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={r.billable}
                          disabled={!editable}
                          onChange={(e) => update(i, { billable: e.target.checked })}
                          className="h-4 w-4 accent-indigo-600"
                        />
                      </td>
                      {editable && (
                        <td className="px-2">
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setRows(rows.filter((_, idx) => idx !== i));
                              setDirty(true);
                            }}
                          >
                            ✕
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50/60 text-sm font-semibold">
                    <td className="px-4 py-2.5 text-slate-500">Day total</td>
                    {days.map((d) => {
                      const t = dayTotal(isoDay(d));
                      return (
                        <td key={d.toISOString()} className={`px-1 py-2.5 text-center ${t > 24 ? 'text-rose-600' : 'text-slate-700'}`}>
                          {t || '—'}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-right text-indigo-700">{grand}</td>
                    <td colSpan={editable ? 2 : 1} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        {editable && (
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 p-4">
            <Field label="Add project">
              <Select value={addProject} onChange={(e) => setAddProject(e.target.value)} className="min-w-64">
                <option value="">Select a project…</option>
                {available.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                    {p.client ? ` (${p.client})` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              variant="secondary"
              disabled={!addProject}
              onClick={() => {
                const p = projects.find((x) => x.id === addProject);
                if (!p) return;
                setRows([...rows, { projectId: p.id, billable: p.isBillable, description: '', hours: {} }]);
                setAddProject('');
                setDirty(true);
              }}
            >
              + Add row
            </Button>
            {projects.length === 0 && <p className="text-xs text-slate-400">No active projects yet — ask HR or your manager to create one.</p>}
          </div>
        )}
      </Card>

      {week.data && week.data.trail.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Approval trail</p>
          <Trail steps={week.data.trail} />
        </Card>
      )}
    </div>
  );
}

function WeekDetail({ id, onClose, onDecided }: { id: string; onClose: () => void; onDecided?: () => void }) {
  const { data, loading } = useFetch<Week>(`/timesheets/${id}`);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const decide = async (decision: 'APPROVED' | 'REJECTED') => {
    setError(null);
    setBusy(true);
    try {
      await api(`/timesheets/${id}/decide`, { method: 'POST', body: { decision, ...(remarks ? { remarks } : {}) } });
      onDecided?.();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const days = data ? Array.from({ length: 7 }, (_, i) => addDays(parseDay(data.weekStart), i)) : [];
  const projects = data ? [...new Map(data.entries.map((e) => [e.projectId, e.project])).values()] : [];

  return (
    <Modal title={data ? `${data.employee.name} — week of ${fmtDate(data.weekStart)}` : 'Timesheet'} open onClose={onClose} wide>
      {loading || !data ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <ErrorNote error={error} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2 text-left">Project</th>
                  {days.map((d) => (
                    <th key={d.toISOString()} className="px-1 py-2 text-center">
                      {dayLabel(d)}
                    </th>
                  ))}
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {projects.map((p) => {
                  const lines = data.entries.filter((e) => e.projectId === p.id);
                  return (
                    <tr key={p.id}>
                      <td className="py-2">
                        <Badge tone="violet">{p.code}</Badge> <span className="text-slate-700">{p.name}</span>
                        {lines.some((l) => !l.billable) && <span className="ml-1 text-xs text-slate-400">(non-billable)</span>}
                      </td>
                      {days.map((d) => (
                        <td key={d.toISOString()} className="px-1 py-2 text-center text-slate-700">
                          {lines.find((l) => dayOf(l.date) === isoDay(d))?.hours ?? '—'}
                        </td>
                      ))}
                      <td className="py-2 text-right font-semibold">{lines.reduce((s, l) => s + l.hours, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-slate-600">
            Total <span className="font-semibold text-slate-900">{data.totalHours}h</span> ·{' '}
            <Badge tone={extraTone(data.status)}>{data.status}</Badge>
          </p>
          <Trail steps={data.trail} />
          {data.status === 'SUBMITTED' && onDecided && (
            <>
              <Field label="Remarks (required to reject)">
                <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </Field>
              <div className="flex gap-2">
                <Button disabled={busy} onClick={() => void decide('APPROVED')}>
                  Approve
                </Button>
                <Button variant="danger" disabled={busy || remarks.trim().length === 0} onClick={() => void decide('REJECTED')}>
                  Reject
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function WeekList({ path, empty, canDecide }: { path: string; empty: string; canDecide?: boolean }) {
  const { data, loading, error, reload } = useFetch<WeekRow[]>(path);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card>
      <ErrorNote error={error} />
      {loading ? (
        <Spinner />
      ) : !data || data.length === 0 ? (
        <Empty message={empty} />
      ) : (
        <Table headers={['Employee', 'Week', 'Billable', 'Non-billable', 'Total', 'Status', '']}>
          {data.map((w) => (
            <tr key={w.id}>
              <Td className="font-medium text-slate-900">
                {w.employee.name}
                <span className="block text-xs font-normal text-slate-400">{w.employee.department || w.employee.employeeCode}</span>
              </Td>
              <Td>{fmtDate(w.weekStart)}</Td>
              <Td>{w.billableHours}h</Td>
              <Td>{w.nonBillableHours}h</Td>
              <Td className="font-semibold">{w.totalHours}h</Td>
              <Td>
                <Badge tone={extraTone(w.status)}>{w.status}</Badge>
              </Td>
              <Td>
                <Button variant="ghost" onClick={() => setOpen(w.id)}>
                  {canDecide && w.status === 'SUBMITTED' ? 'Review' : 'View'}
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {open && <WeekDetail id={open} onClose={() => setOpen(null)} onDecided={canDecide ? reload : undefined} />}
    </Card>
  );
}

function UtilisationReport({ projects }: { projects: Project[] }) {
  const today = new Date();
  const [from, setFrom] = useState(isoDay(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(isoDay(today));
  const [projectId, setProjectId] = useState('');
  const [approvedOnly, setApprovedOnly] = useState(false);
  const qs = `from=${from}&to=${to}${projectId ? `&projectId=${projectId}` : ''}&approvedOnly=${approvedOnly}`;
  const { data, loading, error } = useFetch<Utilisation>(from && to ? `/timesheets/utilisation?${qs}` : null);
  const [dlError, setDlError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <Field label="From">
          <DatePicker value={from} onChange={setFrom} />
        </Field>
        <Field label="To">
          <DatePicker value={to} onChange={setTo} />
        </Field>
        <Field label="Project">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 pb-2.5 text-sm text-slate-600">
          <input type="checkbox" checked={approvedOnly} onChange={(e) => setApprovedOnly(e.target.checked)} className="accent-indigo-600" />
          Approved weeks only
        </label>
        <Button
          variant="secondary"
          onClick={() => {
            setDlError(null);
            downloadFile(`/timesheets/utilisation.csv?${qs}`, `utilisation-${from}-to-${to}.csv`).catch((e: unknown) => setDlError(errMsg(e)));
          }}
        >
          Export CSV
        </Button>
      </Card>
      <ErrorNote error={error ?? dlError} />
      {loading || !data ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Total hours" value={data.totals.total} icon="clock" />
            <Stat label="Billable" value={data.totals.billable} accent="text-emerald-600" />
            <Stat label="Non-billable" value={data.totals.nonBillable} accent="text-amber-600" />
            <Stat label="Billable %" value={`${data.totals.billablePct}%`} icon="chart" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <p className="px-4 pt-4 text-sm font-semibold text-slate-900">By project</p>
              {data.byProject.length === 0 ? (
                <Empty message="No hours in this range" />
              ) : (
                <Table headers={['Project', 'People', 'Billable', 'Non-bill.', 'Total']}>
                  {data.byProject.map((p) => (
                    <tr key={p.project.id}>
                      <Td>
                        <Badge tone="violet">{p.project.code}</Badge> {p.project.name}
                      </Td>
                      <Td>{p.employees}</Td>
                      <Td>{p.billable}</Td>
                      <Td>{p.nonBillable}</Td>
                      <Td className="font-semibold">{p.total}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            <Card>
              <p className="px-4 pt-4 text-sm font-semibold text-slate-900">By employee</p>
              {data.byEmployee.length === 0 ? (
                <Empty message="No hours in this range" />
              ) : (
                <Table headers={['Employee', 'Billable', 'Non-bill.', 'Total', 'Billable %']}>
                  {data.byEmployee.map((e) => (
                    <tr key={e.employee.id}>
                      <Td className="font-medium text-slate-900">{e.employee.name}</Td>
                      <Td>{e.billable}</Td>
                      <Td>{e.nonBillable}</Td>
                      <Td className="font-semibold">{e.total}</Td>
                      <Td>{e.billablePct}%</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

export default function TimesheetsPage() {
  const { session, isManagerial, isCompanyAdmin } = useAuth();
  const tabs = [
    ...(session?.employee ? ['My week', 'History'] : []),
    ...(isManagerial ? ['Approvals', 'Team'] : []),
    ...(isCompanyAdmin ? ['All', 'Utilisation'] : []),
  ];
  const [tab, setTab] = useState(tabs[0] ?? 'Approvals');
  const projects = useFetch<Project[]>('/projects');

  return (
    <div>
      <PageHeader title="Timesheets" subtitle="Weekly hours by project, submitted for approval" />
      {tabs.length > 1 && <Tabs tabs={tabs} active={tab} onChange={setTab} />}
      {tab === 'My week' && <MyWeek projects={projects.data ?? []} />}
      {tab === 'History' && <WeekList path="/timesheets?scope=me" empty="No timesheets yet" />}
      {tab === 'Approvals' && <WeekList path="/timesheets?scope=approvals" empty="Nothing waiting for approval 🎉" canDecide />}
      {tab === 'Team' && <WeekList path="/timesheets?scope=team" empty="Your team has no timesheets yet" canDecide />}
      {tab === 'All' && <WeekList path="/timesheets?scope=company&status=SUBMITTED" empty="No submitted timesheets" canDecide />}
      {tab === 'Utilisation' && <UtilisationReport projects={projects.data ?? []} />}
      {!session?.employee && tabs.length === 0 && (
        <Card>
          <Empty message="Timesheets need an employee profile" />
        </Card>
      )}
    </div>
  );
}
