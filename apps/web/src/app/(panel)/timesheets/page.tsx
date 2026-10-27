'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate, fmtTime } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { openSecureFile } from '@/lib/secure-file';
import {
  Badge, Button, Card, DatePicker, Empty, ErrorNote, Field, Icon, Modal, PageHeader, Select, Spinner, Stat, Table, Tabs, Td, Textarea,
} from '@/components/ui';
import { addDays, dayOf, downloadFile, errMsg, isoDay } from '@/components/engage';

interface Project {
  id: string;
  name: string;
  code: string;
  client: string;
  isBillable: boolean;
  isActive: boolean;
}

interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedOn: string;
}

interface Entry {
  id: string;
  projectId: string;
  hours: number;
  billable: boolean;
  description: string;
  project: Project;
  attachments: Attachment[];
}

/** One employee's timesheet for one date. DRAFT → SUBMITTED (final). */
interface Day {
  id: string | null;
  date: string;
  status: 'DRAFT' | 'SUBMITTED';
  submittedAt: string | null;
  totalHours: number;
  editable: boolean;
  entries: Entry[];
  employee: { id: string; name: string; employeeCode: string; department: string };
}

interface DayList {
  from: string;
  to: string;
  days: (Day & { id: string })[];
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

/** One timesheet line. `key` is the entry id (uuid, also for unsaved lines). */
interface EntryRow {
  key: string;
  projectId: string;
  description: string;
  hours: string;
  billable: boolean;
  attachments: Attachment[];
}

/** Unsaved lines get their entry id up front so files can be attached right after the first save. */
const newKey = (): string => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const rowsFromDay = (day: Day): EntryRow[] =>
  day.entries.map((e) => ({ key: e.id, projectId: e.projectId, description: e.description, hours: String(e.hours), billable: e.billable, attachments: e.attachments }));

const num = (s: string | undefined) => {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** YYYY-MM-DD for today (local calendar). Future days can't be filled. */
const todayStr = () => isoDay(new Date());
const parseDay = (s: string) => new Date(`${s}T00:00:00`);
const shiftDay = (s: string, n: number) => isoDay(addDays(parseDay(s), n));
const longDate = (s: string) => parseDay(s).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
const shortDate = (s: string) => parseDay(s).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

const statusTone = (s: string) => (s === 'SUBMITTED' ? 'green' : 'slate');
const statusLabel = (s: string) => (s === 'SUBMITTED' ? 'Submitted' : 'Draft');

/** Documents, images and PDFs (the API enforces the same list). */
const ATTACH_ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.heif,.bmp,.svg,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.txt,.csv';

const fmtSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const fileIcon = (a: Attachment) =>
  a.mimeType.startsWith('image/') ? '🖼️' : a.mimeType === 'application/pdf' || a.name.toLowerCase().endsWith('.pdf') ? '📕' : '📄';

/** Shared size for the grid's inputs so every control in a row lines up. */
const CONTROL = 'h-10 py-0!';
/** Required field still empty. */
const MISSING = 'border-amber-300! bg-amber-50/50!';

/** An entry's files as chips; click opens the file in the secure viewer. */
function EntryFiles({ dayId, items, onRemove, onError }: { dayId: string | null; items: Attachment[]; onRemove?: (a: Attachment) => void; onError: (msg: string) => void }) {
  if (!dayId || items.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {items.map((a) => (
        <li key={a.id} className="flex max-w-full items-center gap-1.5 rounded-full border border-ink-200 bg-white py-1 pl-2.5 pr-1.5 text-xs shadow-[0_1px_2px_rgb(11_26_54/0.04)]">
          <span aria-hidden className="text-[13px] leading-none">{fileIcon(a)}</span>
          <button
            type="button"
            className="max-w-48 truncate font-medium text-ink-700 hover:text-brand-700 hover:underline"
            title={`Open ${a.name}`}
            onClick={() => openSecureFile(`/timesheets/${dayId}/attachments/${a.id}/download?inline=true`).catch((e: unknown) => onError(errMsg(e)))}
          >
            {a.name}
          </button>
          <span className="whitespace-nowrap text-ink-400">{fmtSize(a.size)}</span>
          {onRemove && (
            <button
              type="button"
              className="flex h-4 w-4 items-center justify-center rounded-full text-ink-400 hover:bg-rose-50 hover:text-rose-600"
              title={`Remove ${a.name}`}
              onClick={() => onRemove(a)}
            >
              <Icon name="x" className="h-3 w-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Confirmation popup for deleting one entry line (and its files). */
function DeleteEntryModal({ row, project, saved, busy, error, onCancel, onConfirm }: {
  row: EntryRow | null;
  project?: Project;
  saved: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const files = row?.attachments.length ?? 0;
  return (
    <Modal title="Delete entry?" open={!!row} onClose={() => !busy && onCancel()}>
      {row && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600">
              <Icon name="trash" className="h-5 w-5" />
            </span>
            <p className="pt-2 text-sm text-ink-600">
              {saved ? 'This entry will be removed from your timesheet right away.' : 'This line hasn’t been saved yet and will be discarded.'}
              {files > 0 && ` Its ${files} attached file${files === 1 ? '' : 's'} will be deleted too.`} This can’t be undone.
            </p>
          </div>
          <div className="rounded-xl border border-ink-200 bg-ink-50/60 p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium text-ink-900">
                {project ? (
                  <>
                    <Badge tone="violet">{project.code}</Badge> {project.name}
                  </>
                ) : (
                  <span className="text-ink-400">No project selected</span>
                )}
              </p>
              <span className="whitespace-nowrap font-semibold tabular-nums text-ink-900">{num(row.hours)}h</span>
            </div>
            {row.description.trim() && <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-ink-600">{row.description}</p>}
            {files > 0 && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-ink-500">
                <Icon name="paperclip" className="h-3.5 w-3.5" /> {files} file{files === 1 ? '' : 's'}
              </p>
            )}
          </div>
          <ErrorNote error={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="danger" disabled={busy} onClick={onConfirm}>
              {busy ? 'Deleting…' : 'Delete entry'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Day editor (date picker + entry lines) with the user's submitted days listed below. */
function MyTimesheet({ projects }: { projects: Project[] }) {
  const [date, setDate] = useState(todayStr);
  const day = useFetch<Day>(`/timesheets/day?date=${date}`);
  const [rows, setRows] = useState<EntryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [listVersion, setListVersion] = useState(0);
  const [toDelete, setToDelete] = useState<EntryRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    // Reset the lines whenever a (new) day is loaded from the server.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (day.data) setRows(rowsFromDay(day.data));
    setDirty(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [day.data]);

  const today = todayStr();
  const editable = day.data?.editable ?? false;
  const total = rows.reduce((s, r) => s + num(r.hours), 0);
  const project = (id: string) => projects.find((p) => p.id === id) ?? day.data?.entries.find((e) => e.projectId === id)?.project;
  // Lines missing a project or hours are not saved; flag them instead of dropping them silently.
  const incomplete = rows.filter((r) => !r.projectId || num(r.hours) <= 0).length;

  const update = (key: string, patch: Partial<EntryRow>) => {
    setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const addRow = () => {
    const last = rows[rows.length - 1];
    const p = last ? project(last.projectId) : projects.length === 1 ? projects[0] : undefined;
    setRows([...rows, { key: newKey(), projectId: p?.id ?? '', description: '', hours: '', billable: p?.isBillable ?? true, attachments: [] }]);
    setDirty(true);
  };

  const run = async (fn: () => Promise<unknown>, ok: string, refreshList = false) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
      setNotice(ok);
      day.reload();
      if (refreshList) setListVersion((v) => v + 1);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const payload = () => ({
    date,
    entries: rows
      .filter((r) => r.projectId && num(r.hours) > 0)
      .map((r) => ({ id: r.key, projectId: r.projectId, hours: num(r.hours), billable: r.billable, description: r.description.trim() })),
  });

  const save = () => run(() => api('/timesheets/day', { method: 'PUT', body: payload() }), 'Draft saved');
  const submit = () => {
    if (!window.confirm(`Submit ${total}h for ${longDate(date)}? Submitted timesheets can't be edited.`)) return;
    void run(
      async () => {
        const saved = await api<Day>('/timesheets/day', { method: 'PUT', body: payload() });
        if (!saved.id) throw new Error('Nothing to submit');
        await api(`/timesheets/${saved.id}/submit`, { method: 'POST' });
      },
      `Timesheet for ${longDate(date)} submitted`,
      true
    );
  };
  // Saves the lines first so the day exists (and unsaved edits survive the reload that follows).
  const savedDayId = async () => {
    if (day.data?.id && !dirty) return day.data.id;
    const saved = await api<Day>('/timesheets/day', { method: 'PUT', body: payload() });
    if (!saved.id) throw new Error('Could not create the timesheet');
    return saved.id;
  };
  const attach = (entryId: string, files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    void run(async () => {
      const id = await savedDayId();
      for (const f of list) {
        const form = new FormData();
        form.append('file', f);
        await api(`/timesheets/${id}/entries/${entryId}/attachments`, { method: 'POST', form });
      }
    }, list.length === 1 ? `Attached ${list[0]?.name}` : `Attached ${list.length} files`);
  };
  const detach = (a: Attachment) => {
    if (!window.confirm(`Remove ${a.name}?`)) return;
    void run(async () => {
      const id = await savedDayId();
      await api(`/timesheets/${id}/attachments/${a.id}`, { method: 'DELETE' });
    }, 'Attachment removed');
  };
  const isSaved = (r: EntryRow) => !!day.data?.id && day.data.entries.some((e) => e.id === r.key);
  // Saved entries are deleted on the server right away; unsaved lines just leave the screen.
  // No reload, so unsaved edits on the other lines stay as they are.
  const confirmDelete = async () => {
    const r = toDelete;
    if (!r) return;
    if (!isSaved(r)) {
      setRows((prev) => prev.filter((x) => x.key !== r.key));
      setDirty(true);
      setToDelete(null);
      return;
    }
    setDeleteError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api(`/timesheets/${day.data?.id}/entries/${r.key}`, { method: 'DELETE' });
      setRows((prev) => prev.filter((x) => x.key !== r.key));
      setNotice('Entry deleted');
      setToDelete(null);
    } catch (err) {
      setDeleteError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  const copyPrevious = () => run(() => api('/timesheets/day/copy-previous', { method: 'POST', body: { date } }), 'Copied your previous day — review and save');

  const goTo = (next: string) => {
    if (!next || next === date || next > today) return;
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setDate(next);
    setNotice(null);
    setError(null);
  };

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            title="Previous day"
            onClick={() => goTo(shiftDay(date, -1))}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-ink-200 bg-white text-ink-600 shadow-[0_1px_2px_rgb(11_26_54/0.04)] hover:bg-ink-50"
          >
            ‹
          </button>
          <div className="w-44">
            <DatePicker value={date} onChange={goTo} max={today} />
          </div>
          <button
            type="button"
            title="Next day"
            disabled={date >= today}
            onClick={() => goTo(shiftDay(date, 1))}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-ink-200 bg-white text-ink-600 shadow-[0_1px_2px_rgb(11_26_54/0.04)] hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-300 disabled:hover:bg-white"
          >
            ›
          </button>
          {date !== today && (
            <Button variant="ghost" onClick={() => goTo(today)}>
              Today
            </Button>
          )}
          <div className="ml-1 flex items-center gap-2">
            <p className="text-sm font-semibold text-ink-900">{longDate(date)}</p>
            {day.data && <Badge tone={statusTone(day.data.status)}>{statusLabel(day.data.status)}</Badge>}
          </div>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            {rows.length === 0 && (
              <Button variant="secondary" disabled={busy} onClick={() => void copyPrevious()}>
                Copy previous day
              </Button>
            )}
            <Button variant="secondary" disabled={busy || !dirty} onClick={() => void save()}>
              Save draft
            </Button>
            <Button disabled={busy || total <= 0 || incomplete > 0} onClick={submit}>
              Submit timesheet
            </Button>
          </div>
        )}
      </Card>

      <ErrorNote error={error ?? day.error} />
      {notice && <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">{notice}</p>}
      {day.data?.status === 'SUBMITTED' && (
        <p className="rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm text-ink-600">
          Submitted{day.data.submittedAt ? ` on ${fmtDate(day.data.submittedAt)} at ${fmtTime(day.data.submittedAt)}` : ''} — this timesheet is locked.
        </p>
      )}

      <Card>
        {day.loading && !day.data ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-200/80 bg-ink-50/60 text-[11px] uppercase tracking-wider text-ink-500">
                  <th className="w-64 py-3 pl-4 pr-2 font-semibold">
                    Project{editable && <span className="ml-0.5 text-rose-500">*</span>}
                  </th>
                  <th className="min-w-64 px-2 py-3 font-semibold">Description</th>
                  <th className="w-28 px-2 py-3 text-right font-semibold">
                    Hours{editable && <span className="ml-0.5 text-rose-500">*</span>}
                  </th>
                  <th className="w-20 px-2 py-3 text-center font-semibold">Billable</th>
                  {editable && (
                    <th className="w-28 py-3 pl-2 pr-4 text-right font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <Empty message={editable ? 'No entries yet — click “+ Add entry” to log your work for this day' : 'No hours logged on this day'} />
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const p = project(r.projectId);
                  const noProject = editable && !r.projectId;
                  const noHours = editable && num(r.hours) <= 0;
                  const bad = noProject || noHours;
                  const files = r.attachments.length;
                  return (
                    <tr key={r.key} className="transition-colors hover:bg-ink-50/40">
                      <td className="py-3 pl-4 pr-2 align-top">
                        {editable ? (
                          <Select
                            value={r.projectId}
                            onChange={(e) => {
                              const np = projects.find((x) => x.id === e.target.value);
                              update(r.key, { projectId: e.target.value, billable: np?.isBillable ?? r.billable });
                            }}
                            className={`${CONTROL} ${noProject ? MISSING : ''}`}
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
                          <p className="flex h-10 items-center gap-1.5 font-medium text-ink-900">
                            <Badge tone="violet">{p?.code ?? '?'}</Badge> <span className="truncate">{p?.name}</span>
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-3 align-top">
                        {editable ? (
                          <Textarea
                            rows={1}
                            maxLength={500}
                            value={r.description}
                            placeholder="What did you work on?"
                            onChange={(e) => update(r.key, { description: e.target.value })}
                            className="field-sizing-content max-h-40 min-h-10 resize-none py-2!"
                          />
                        ) : (
                          <p className="whitespace-pre-line py-2.5 text-ink-600">{r.description || '—'}</p>
                        )}
                        <EntryFiles dayId={day.data?.id ?? null} items={r.attachments} onRemove={editable ? detach : undefined} onError={setError} />
                      </td>
                      <td className="px-2 py-3 align-top">
                        {editable ? (
                          <div className="relative">
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              max={24}
                              step={0.25}
                              value={r.hours}
                              placeholder="0"
                              aria-label="Hours"
                              onChange={(e) => update(r.key, { hours: e.target.value })}
                              className={`h-10 w-full rounded-xl border border-ink-200 bg-white pl-3 pr-7 text-right text-sm font-medium tabular-nums text-ink-900 shadow-[0_1px_2px_rgb(11_26_54/0.04)] [appearance:textfield] placeholder:font-normal placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${noHours ? MISSING : ''}`}
                            />
                            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-ink-400">h</span>
                          </div>
                        ) : (
                          <span className="flex h-10 items-center justify-end font-semibold tabular-nums text-ink-900">{num(r.hours)}h</span>
                        )}
                      </td>
                      <td className="px-2 py-3 align-top">
                        <label className={`flex h-10 items-center justify-center ${editable ? 'cursor-pointer' : ''}`}>
                          <input
                            type="checkbox"
                            checked={r.billable}
                            disabled={!editable}
                            aria-label="Billable"
                            onChange={(e) => update(r.key, { billable: e.target.checked })}
                            className="h-[18px] w-[18px] cursor-pointer rounded accent-brand-600 disabled:cursor-default"
                          />
                        </label>
                      </td>
                      {editable && (
                        <td className="py-3 pl-2 pr-4 align-top">
                          <div className="flex h-10 items-center justify-end gap-1.5">
                            <label
                              title={bad ? 'Pick a project and enter hours to attach files' : 'Attach documents, images or PDFs'}
                              aria-disabled={busy || bad}
                              className={`relative flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
                                busy || bad
                                  ? 'cursor-not-allowed border-ink-100 text-ink-300'
                                  : files > 0
                                    ? 'cursor-pointer border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100'
                                    : 'cursor-pointer border-ink-200 bg-white text-ink-500 hover:border-ink-300 hover:bg-ink-50 hover:text-ink-800'
                              }`}
                            >
                              <Icon name="paperclip" className="h-4 w-4" />
                              {files > 0 && (
                                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold leading-none text-white">
                                  {files}
                                </span>
                              )}
                              <span className="sr-only">Attach files</span>
                              <input
                                type="file"
                                multiple
                                accept={ATTACH_ACCEPT}
                                className="hidden"
                                disabled={busy || bad}
                                onChange={(e) => {
                                  attach(r.key, e.target.files);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              title="Delete entry"
                              disabled={busy}
                              onClick={() => {
                                setDeleteError(null);
                                setToDelete(r);
                              }}
                              className="flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-ink-400 transition-colors hover:border-rose-100 hover:bg-rose-50 hover:text-rose-600"
                            >
                              <Icon name="trash" className="h-4 w-4" />
                              <span className="sr-only">Delete entry</span>
                            </button>
                          </div>
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
            <span className={`ml-auto rounded-full px-3 py-1 text-xs font-semibold ${total > 24 ? 'bg-rose-600 text-white' : 'bg-brand-600 text-white'}`}>
              Day total: {total}h{total > 24 ? ' — max 24h' : ''}
            </span>
          </div>
        )}
        {editable && incomplete > 0 && (
          <p className="px-4 pb-4 text-xs text-amber-700">
            {incomplete} entr{incomplete === 1 ? 'y needs' : 'ies need'} a project and hours before you can submit.
          </p>
        )}
      </Card>

      <DeleteEntryModal
        row={toDelete}
        project={toDelete ? project(toDelete.projectId) : undefined}
        saved={toDelete ? isSaved(toDelete) : false}
        busy={busy}
        error={deleteError}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void confirmDelete()}
      />

      <SubmittedDays scope="me" version={listVersion} onOpen={goTo} />
    </div>
  );
}

/**
 * Submitted days as a table — one block per day with its entries.
 * scope=me under the editor; team / company for managers and HR.
 */
function SubmittedDays({ scope, version = 0, onOpen }: { scope: 'me' | 'team' | 'company'; version?: number; onOpen?: (date: string) => void }) {
  const today = todayStr();
  const [from, setFrom] = useState(() => shiftDay(today, -29));
  const [to, setTo] = useState(today);
  const { data, loading, error, reload } = useFetch<DayList>(from && to ? `/timesheets?scope=${scope}&status=SUBMITTED&from=${from}&to=${to}` : null);
  const [fileError, setFileError] = useState<string | null>(null);
  const showEmployee = scope !== 'me';

  // Refresh after the editor submits a day (skip the first render — useFetch already loads).
  const firstVersion = useRef(version);
  useEffect(() => {
    if (version !== firstVersion.current) reload();
  }, [version, reload]);

  const days = data?.days ?? [];
  const hours = days.reduce((s, d) => s + d.totalHours, 0);
  const cols = showEmployee ? 6 : 5;

  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink-100 p-4">
        <div>
          <p className="text-sm font-semibold text-ink-900">{scope === 'me' ? 'Submitted timesheets' : scope === 'team' ? 'Team timesheets' : 'All timesheets'}</p>
          <p className="text-xs text-ink-500">
            {days.length} day{days.length === 1 ? '' : 's'} · {Math.round(hours * 100) / 100}h
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="From">
            <DatePicker value={from} onChange={setFrom} max={to} />
          </Field>
          <Field label="To">
            <DatePicker value={to} onChange={setTo} max={today} />
          </Field>
        </div>
      </div>
      <ErrorNote error={error ?? fileError} />
      {loading && !data ? (
        <Spinner />
      ) : days.length === 0 ? (
        <Empty message="No submitted timesheets in this range" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-200/80 bg-ink-50/60 text-[11px] uppercase tracking-wider text-ink-500">
                <th className="w-44 py-3 pl-4 pr-2 font-semibold">Date</th>
                {showEmployee && <th className="w-48 px-2 py-3 font-semibold">Employee</th>}
                <th className="w-56 px-2 py-3 font-semibold">Project</th>
                <th className="px-2 py-3 font-semibold">Description</th>
                <th className="w-20 px-2 py-3 text-right font-semibold">Hours</th>
                <th className="w-24 py-3 pl-2 pr-4 text-center font-semibold">Billable</th>
              </tr>
            </thead>
            {days.map((d) => (
              <tbody key={d.id} className="border-b border-ink-200/80 last:border-b-0">
                {d.entries.map((e, i) => (
                  <tr key={e.id} className={i > 0 ? 'border-t border-ink-100' : ''}>
                    {i === 0 && (
                      <td rowSpan={d.entries.length + 1} className="border-r border-ink-100 bg-ink-50/30 py-3 pl-4 pr-2 align-top">
                        {onOpen ? (
                          <button type="button" onClick={() => onOpen(dayOf(d.date))} className="font-semibold text-ink-900 hover:text-brand-700 hover:underline" title="Open this day">
                            {shortDate(dayOf(d.date))}
                          </button>
                        ) : (
                          <p className="font-semibold text-ink-900">{shortDate(dayOf(d.date))}</p>
                        )}
                        {d.submittedAt && <p className="mt-0.5 text-xs text-ink-400">Submitted {fmtDate(d.submittedAt)}, {fmtTime(d.submittedAt)}</p>}
                      </td>
                    )}
                    {showEmployee && i === 0 && (
                      <td rowSpan={d.entries.length + 1} className="border-r border-ink-100 px-2 py-3 align-top">
                        <p className="font-medium text-ink-900">{d.employee.name}</p>
                        <p className="text-xs text-ink-400">{d.employee.department || d.employee.employeeCode}</p>
                      </td>
                    )}
                    <td className="px-2 py-3 align-top">
                      <Badge tone="violet">{e.project.code}</Badge> <span className="text-ink-700">{e.project.name}</span>
                    </td>
                    <td className="px-2 py-3 align-top text-ink-600">
                      <p className="whitespace-pre-line">{e.description || '—'}</p>
                      <EntryFiles dayId={d.id} items={e.attachments} onError={setFileError} />
                    </td>
                    <td className="px-2 py-3 text-right align-top font-semibold tabular-nums text-ink-900">{e.hours}h</td>
                    <td className="py-3 pl-2 pr-4 text-center align-top">{e.billable ? <Badge tone="green">Yes</Badge> : <span className="text-xs text-ink-400">No</span>}</td>
                  </tr>
                ))}
                <tr className="border-t border-ink-100 bg-ink-50/40 text-xs">
                  <td colSpan={cols - (showEmployee ? 2 : 1) - 2} className="px-2 py-2 text-right font-semibold uppercase tracking-wider text-ink-500">
                    Day total
                  </td>
                  <td className="px-2 py-2 text-right text-sm font-bold tabular-nums text-ink-900">{d.totalHours}h</td>
                  <td className="py-2 pl-2 pr-4" />
                </tr>
              </tbody>
            ))}
          </table>
        </div>
      )}
    </Card>
  );
}

function UtilisationReport({ projects }: { projects: Project[] }) {
  const today = new Date();
  const [from, setFrom] = useState(isoDay(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(isoDay(today));
  const [projectId, setProjectId] = useState('');
  const qs = `from=${from}&to=${to}${projectId ? `&projectId=${projectId}` : ''}`;
  const { data, loading, error } = useFetch<Utilisation>(from && to ? `/timesheets/utilisation?${qs}` : null);
  const [dlError, setDlError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <Field label="From">
          <DatePicker value={from} onChange={setFrom} max={to} />
        </Field>
        <Field label="To">
          <DatePicker value={to} onChange={setTo} max={todayStr()} />
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
    ...(session?.employee ? ['My timesheet'] : []),
    ...(isManagerial ? ['Team'] : []),
    ...(isCompanyAdmin ? ['All', 'Utilisation'] : []),
  ];
  const [tab, setTab] = useState(tabs[0] ?? 'Team');
  const projects = useFetch<Project[]>('/projects?mine=true');

  return (
    <div>
      <PageHeader title="Timesheets" subtitle="Log your hours day by day — today or any past day" />
      {tabs.length > 1 && <Tabs tabs={tabs} active={tab} onChange={setTab} />}
      {tab === 'My timesheet' && <MyTimesheet projects={projects.data ?? []} />}
      {tab === 'Team' && <SubmittedDays scope="team" />}
      {tab === 'All' && <SubmittedDays scope="company" />}
      {tab === 'Utilisation' && <UtilisationReport projects={projects.data ?? []} />}
      {!session?.employee && tabs.length === 0 && (
        <Card>
          <Empty message="Timesheets need an employee profile" />
        </Card>
      )}
    </div>
  );
}
