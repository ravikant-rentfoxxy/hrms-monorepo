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

/** One timesheet line: a date, a project, what was done and the hours. */
interface EntryRow {
  key: string;
  date: string; // YYYY-MM-DD
  projectId: string;
  description: string;
  hours: string;
  billable: boolean;
}

let rowSeq = 0;
const newKey = () => `row-${++rowSeq}`;

function rowsFromWeek(week: Week): EntryRow[] {
  return [...week.entries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ key: e.id, date: dayOf(e.date), projectId: e.projectId, description: e.description, hours: String(e.hours), billable: e.billable }));
}

const num = (s: string | undefined) => {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function Trail({ steps }: { steps: TrailStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="space-y-1.5 text-xs text-ink-500">
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
  const [rows, setRows] = useState<EntryRow[]>([]);
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
  const dayTotal = (d: string) => rows.reduce((s, r) => s + (r.date === d ? num(r.hours) : 0), 0);
  const grand = rows.reduce((s, r) => s + num(r.hours), 0);
  const project = (id: string) => projects.find((p) => p.id === id) ?? week.data?.entries.find((e) => e.projectId === id)?.project;
  // Lines missing a project or hours are not saved; flag them instead of dropping them silently.
  const incomplete = rows.filter((r) => !r.projectId || num(r.hours) <= 0).length;

  const update = (key: string, patch: Partial<EntryRow>) => {
    setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const addRow = () => {
    const today = isoDay(new Date());
    const last = rows[rows.length - 1];
    const firstDay = isoDay(days[0] ?? weekStart);
    const date = last?.date ?? (days.some((d) => isoDay(d) === today) ? today : firstDay);
    const p = last ? project(last.projectId) : projects.length === 1 ? projects[0] : undefined;
    setRows([...rows, { key: newKey(), date, projectId: p?.id ?? '', description: '', hours: '', billable: p?.isBillable ?? true }]);
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
    entries: rows
      .filter((r) => r.projectId && num(r.hours) > 0)
      .map((r) => ({ projectId: r.projectId, date: r.date, hours: num(r.hours), billable: r.billable, description: r.description.trim() })),
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
            <p className="text-sm font-semibold text-ink-900">
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
              <Button disabled={busy || grand <= 0 || incomplete > 0} onClick={() => void submit()}>
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
                <tr className="border-b border-ink-200/80 bg-ink-50/60 text-[11px] uppercase tracking-wider text-ink-500">
                  <th className="w-40 px-4 py-3 font-semibold">
                    Date{editable && <span className="ml-0.5 text-rose-500">*</span>}
                  </th>
                  <th className="w-56 px-2 py-3 font-semibold">
                    Project{editable && <span className="ml-0.5 text-rose-500">*</span>}
                  </th>
                  <th className="px-2 py-3 font-semibold">Description</th>
                  <th className="w-24 px-2 py-3 text-right font-semibold">
                    Hours{editable && <span className="ml-0.5 text-rose-500">*</span>}
                  </th>
                  <th className="w-20 px-2 py-3 text-center font-semibold">Billable</th>
                  {editable && <th className="w-12" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <Empty message={editable ? 'No entries yet — click “+ Add entry” to log your work' : 'No hours logged this week'} />
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const p = project(r.projectId);
                  const bad = editable && (!r.projectId || num(r.hours) <= 0);
                  return (
                    <tr key={r.key} className={bad ? 'bg-amber-50/40' : ''}>
                      <td className="px-4 py-2 align-top">
                        {editable ? (
                          <Select value={r.date} onChange={(e) => update(r.key, { date: e.target.value })}>
                            {days.map((d) => (
                              <option key={isoDay(d)} value={isoDay(d)}>
                                {dayLabel(d)} {d.toLocaleDateString('en-IN', { month: 'short' })}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <span className="text-ink-700">{fmtDate(r.date)}</span>
                        )}
                      </td>
                      <td className="px-2 py-2 align-top">
                        {editable ? (
                          <Select
                            value={r.projectId}
                            onChange={(e) => {
                              const np = projects.find((x) => x.id === e.target.value);
                              update(r.key, { projectId: e.target.value, billable: np?.isBillable ?? r.billable });
                            }}
                          >
                            <option value="">Select a project…</option>
                            {projects.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.code} — {x.name}
                              </option>
                            ))}
                            {p && !projects.some((x) => x.id === p.id) && <option value={p.id}>{p.code} — {p.name} (inactive)</option>}
                          </Select>
                        ) : (
                          <p className="font-medium text-ink-900">
                            <Badge tone="violet">{p?.code ?? '?'}</Badge> {p?.name}
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-2 align-top">
                        {editable ? (
                          <Textarea
                            rows={1}
                            maxLength={500}
                            value={r.description}
                            placeholder="What did you work on?"
                            onChange={(e) => update(r.key, { description: e.target.value })}
                            className="min-h-[42px]"
                          />
                        ) : (
                          <p className="whitespace-pre-line text-ink-600">{r.description || '—'}</p>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right align-top">
                        {editable ? (
                          <input
                            type="number"
                            min={0}
                            max={24}
                            step={0.25}
                            value={r.hours}
                            placeholder="0"
                            onChange={(e) => update(r.key, { hours: e.target.value })}
                            className="w-20 rounded-xl border border-ink-200 px-2.5 py-2.5 text-right text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-500/10"
                          />
                        ) : (
                          <span className="font-semibold text-ink-900">{num(r.hours)}</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center align-top">
                        <input
                          type="checkbox"
                          checked={r.billable}
                          disabled={!editable}
                          onChange={(e) => update(r.key, { billable: e.target.checked })}
                          className="mt-3 h-4 w-4 accent-brand-600"
                        />
                      </td>
                      {editable && (
                        <td className="px-2 py-2 align-top">
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setRows(rows.filter((x) => x.key !== r.key));
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
            </table>
          </div>
        )}
        {(rows.length > 0 || editable) && (
          <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 p-4">
            {editable && (
              <Button variant="secondary" onClick={addRow} disabled={projects.length === 0}>
                + Add entry
              </Button>
            )}
            {projects.length === 0 && editable && <p className="text-xs text-ink-400">No projects available to you yet — ask HR or your manager to add you to a project.</p>}
            <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs">
              {days.map((d) => {
                const t = dayTotal(isoDay(d));
                return t > 0 ? (
                  <span key={isoDay(d)} className={`rounded-full px-2.5 py-1 font-medium ${t > 24 ? 'bg-rose-50 text-rose-700' : 'bg-ink-100 text-ink-600'}`}>
                    {dayLabel(d)}: {t}h
                  </span>
                ) : null;
              })}
              <span className="rounded-full bg-brand-600 px-3 py-1 font-semibold text-white">Week total: {grand}h</span>
            </div>
          </div>
        )}
        {editable && incomplete > 0 && (
          <p className="px-4 pb-4 text-xs text-amber-700">
            {incomplete} entr{incomplete === 1 ? 'y needs' : 'ies need'} a project and hours before you can submit.
          </p>
        )}
      </Card>

      {week.data && week.data.trail.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Approval trail</p>
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

  return (
    <Modal title={data ? `${data.employee.name} — week of ${fmtDate(data.weekStart)}` : 'Timesheet'} open onClose={onClose} wide>
      {loading || !data ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <ErrorNote error={error} />
          <Table headers={['Date', 'Project', 'Description', 'Hours']}>
            {[...data.entries]
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap">{fmtDate(e.date)}</Td>
                  <Td>
                    <Badge tone="violet">{e.project.code}</Badge> <span className="text-ink-700">{e.project.name}</span>
                    {!e.billable && <span className="ml-1 text-xs text-ink-400">(non-billable)</span>}
                  </Td>
                  <Td className="max-w-sm whitespace-pre-line text-ink-600">{e.description || '—'}</Td>
                  <Td className="text-right font-semibold">{e.hours}</Td>
                </tr>
              ))}
          </Table>
          <p className="text-sm text-ink-600">
            Total <span className="font-semibold text-ink-900">{data.totalHours}h</span> ·{' '}
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
              <Td className="font-medium text-ink-900">
                {w.employee.name}
                <span className="block text-xs font-normal text-ink-400">{w.employee.department || w.employee.employeeCode}</span>
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
        <label className="flex items-center gap-2 pb-2.5 text-sm text-ink-600">
          <input type="checkbox" checked={approvedOnly} onChange={(e) => setApprovedOnly(e.target.checked)} className="accent-brand-600" />
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
              <p className="px-4 pt-4 text-sm font-semibold text-ink-900">By project</p>
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
              <p className="px-4 pt-4 text-sm font-semibold text-ink-900">By employee</p>
              {data.byEmployee.length === 0 ? (
                <Empty message="No hours in this range" />
              ) : (
                <Table headers={['Employee', 'Billable', 'Non-bill.', 'Total', 'Billable %']}>
                  {data.byEmployee.map((e) => (
                    <tr key={e.employee.id}>
                      <Td className="font-medium text-ink-900">{e.employee.name}</Td>
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
  const projects = useFetch<Project[]>('/projects?mine=true');

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
