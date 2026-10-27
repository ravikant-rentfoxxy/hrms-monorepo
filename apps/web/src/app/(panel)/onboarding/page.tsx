'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Stat, Table, Tabs, Td, Textarea,
} from '@/components/ui';
import { EmployeeSelect, ProgressBar, errText, humanize, useEmployees } from '@/components/lifecycle';
import { openSecureFile } from '@/lib/secure-file';
import { IssueAssetsDialog } from '@/components/assets';

type AssigneeRole = 'EMPLOYEE' | 'HR' | 'MANAGER' | 'IT' | 'ADMIN';
const ROLES: AssigneeRole[] = ['EMPLOYEE', 'MANAGER', 'HR', 'IT', 'ADMIN'];
const roleTone = (r: string) =>
  (({ EMPLOYEE: 'violet', MANAGER: 'blue', HR: 'green', IT: 'amber', ADMIN: 'slate' }) as const)[r as AssigneeRole] ?? 'slate';

interface TemplateTask {
  title: string;
  description: string;
  assigneeRole: AssigneeRole;
  dueOffsetDays: number;
  requiresDocument: boolean;
  documentCategory: string;
}

interface Template {
  id: string;
  name: string;
  tasks: TemplateTask[];
  isDefault: boolean;
  isActive: boolean;
}

interface Task {
  id: string;
  caseId: string;
  title: string;
  description: string;
  assigneeRole: AssigneeRole;
  assigneeId: string | null;
  dueDate: string | null;
  done: boolean;
  doneAt: string | null;
  requiresDocument: boolean;
  documentCategory: string;
  documentId: string | null;
  case?: { id: string; status: string; employee: { id: string; name: string; employeeCode: string } };
}

interface Case {
  id: string;
  status: string;
  startedOn: string;
  completedOn: string | null;
  progress: number;
  doneTasks: number;
  totalTasks: number;
  employee: { id: string; name: string; employeeCode: string; designation: string; department: string; joiningDate: string };
  tasks: Task[];
}

const caseTone = (s: string) => (s === 'COMPLETED' ? 'green' : s === 'CANCELLED' ? 'slate' : 'blue');
const overdue = (t: Task) => !t.done && !!t.dueDate && new Date(t.dueDate) < new Date(new Date().toDateString());

/** IT / Admin kit tasks (laptop, ID card …) get the "Issue assets" dialog. */
const issuesAssets = (t: Task) =>
  !t.requiresDocument && (t.assigneeRole === 'IT' || t.assigneeRole === 'ADMIN' || /laptop|asset|id card|access card/i.test(t.title));

/** The shared dialog, posting to the task so it can also complete it. */
function TaskAssetsDialog({ task, employeeId, employeeName, onClose, onDone }: {
  task: Task;
  employeeId: string;
  employeeName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [complete, setComplete] = useState(!task.done);
  return (
    <IssueAssetsDialog
      employeeId={employeeId}
      employeeName={employeeName}
      submit={(items) => api(`/onboarding/tasks/${task.id}/assets`, { method: 'POST', body: { items, complete } })}
      onClose={onClose}
      onDone={onDone}
    >
      {!task.done && (
        <label className="flex items-center gap-2 text-sm text-ink-600">
          <input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} />
          Also mark “{task.title}” as done
        </label>
      )}
    </IssueAssetsDialog>
  );
}

/** One checklist row with complete (+ upload) / reopen. */
/** `readOnly` for a cancelled onboarding — the API refuses changes to its tasks. */
function TaskRow({ task, showEmployee, readOnly, employee, onChanged }: {
  task: Task;
  showEmployee?: boolean;
  readOnly?: boolean;
  /** The joiner, for issuing assets (falls back to the task's case). */
  employee?: { id: string; name: string };
  onChanged: () => void;
}) {
  const { isCompanyAdmin } = useAuth();
  const joiner = employee ?? task.case?.employee;
  const canIssue = isCompanyAdmin && !!joiner && issuesAssets(task);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = async () => {
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      if (file) fd.append('file', file);
      await api(`/onboarding/tasks/${task.id}/complete`, { method: 'POST', form: fd });
      setFile(null);
      onChanged();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  // Short-lived signed link (5 min) in a new tab; the shell shows the expiry notice.
  const viewDocument = async () => {
    if (!task.documentId) return;
    setError(null);
    try {
      await openSecureFile(`/documents/${task.documentId}/download?inline=true`);
    } catch (err) {
      setError(errText(err));
    }
  };

  const reopen = async () => {
    setError(null);
    try {
      await api(`/onboarding/tasks/${task.id}/reopen`, { method: 'POST' });
      onChanged();
    } catch (err) {
      setError(errText(err));
    }
  };

  const needsFile = task.requiresDocument && !task.documentId;
  return (
    <tr>
      <Td>
        <div className="flex items-start gap-2.5">
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
              task.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-ink-300 text-transparent'
            }`}
          >
            ✓
          </span>
          <div>
            <p className={`font-medium ${task.done ? 'text-ink-400 line-through' : 'text-ink-900'}`}>{task.title}</p>
            {task.description && <p className="mt-0.5 max-w-md text-xs text-ink-400">{task.description}</p>}
            {task.requiresDocument && (
              <div className="mt-1 flex items-center gap-2 text-xs">
                <span className={task.documentId ? 'text-ink-500' : 'text-brand-600'}>
                  📎 {task.documentCategory || 'Onboarding'} document{task.documentId ? ' uploaded' : ' required'}
                </span>
                {task.documentId && (
                  <button
                    className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-0.5 font-semibold text-brand-700 hover:bg-brand-100"
                    title="Open in a new tab"
                    onClick={() => void viewDocument()}
                  >
                    View ↗
                  </button>
                )}
              </div>
            )}
            <ErrorNote error={error} />
          </div>
        </div>
      </Td>
      {showEmployee && <Td>{task.case?.employee.name ?? '—'}</Td>}
      <Td>
        <Badge tone={roleTone(task.assigneeRole)}>{task.assigneeRole}</Badge>
      </Td>
      <Td className={overdue(task) ? 'font-medium text-rose-600' : ''}>{fmtDate(task.dueDate)}</Td>
      <Td>
        {readOnly ? (
          <span className="text-xs text-ink-400">{task.done ? `Done ${fmtDate(task.doneAt)}` : 'Not done'}</span>
        ) : task.done ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-400">Done {fmtDate(task.doneAt)}</span>
            {canIssue && (
              <Button variant="ghost" onClick={() => setAssetsOpen(true)}>
                + Assets
              </Button>
            )}
            <Button variant="ghost" onClick={() => void reopen()}>
              Reopen
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {task.requiresDocument && (
              <label className="cursor-pointer rounded-lg border border-dashed border-ink-300 px-2.5 py-1.5 text-xs text-ink-500 hover:border-brand-300">
                <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                {file ? file.name.slice(0, 22) : task.documentId ? 'Replace file' : 'Choose file'}
              </label>
            )}
            {canIssue && <Button onClick={() => setAssetsOpen(true)}>Issue assets</Button>}
            <Button variant={canIssue ? 'secondary' : 'primary'} onClick={() => void complete()} disabled={busy || (needsFile && !file)}>
              {busy ? 'Saving…' : 'Complete'}
            </Button>
          </div>
        )}
        {assetsOpen && joiner && (
          <TaskAssetsDialog
            task={task}
            employeeId={joiner.id}
            employeeName={joiner.name}
            onClose={() => setAssetsOpen(false)}
            onDone={onChanged}
          />
        )}
      </Td>
    </tr>
  );
}

function CaseModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { isCompanyAdmin } = useAuth();
  const { data, loading, error: loadError, reload } = useFetch<Case>(`/onboarding/cases/${id}`);
  const [error, setError] = useState<string | null>(null);

  const changed = () => {
    reload();
    onChanged();
  };
  const cancel = async () => {
    if (!window.confirm('Cancel this onboarding? Open tasks will no longer be tracked.')) return;
    try {
      await api(`/onboarding/cases/${id}/cancel`, { method: 'POST' });
      changed();
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <Modal title={data ? `Onboarding — ${data.employee.name}` : 'Onboarding'} open onClose={onClose} wide>
      {/* Spinner only on first load; refreshes after an action keep the list (and its scroll) in place. */}
      {!data ? (
        loading ? <Spinner /> : <ErrorNote error={loadError ?? 'Could not load this case'} />
      ) : (
        <div className="space-y-4">
          <ErrorNote error={error} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-ink-500">
              {data.employee.designation || '—'} · joined {fmtDate(data.employee.joiningDate)}
              <div className="mt-1.5">
                <ProgressBar value={data.progress} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={caseTone(data.status)}>{humanize(data.status)}</Badge>
              {isCompanyAdmin && data.status === 'IN_PROGRESS' && (
                <Button variant="ghost" onClick={() => void cancel()}>
                  Cancel onboarding
                </Button>
              )}
            </div>
          </div>
          {data.status === 'CANCELLED' && (
            <p className="rounded-xl bg-ink-100 px-3 py-2.5 text-sm text-ink-600">
              This onboarding was cancelled, so its tasks can no longer be completed. Start a new onboarding for this employee if needed.
            </p>
          )}
          <div className="-mx-6 max-h-[60vh] overflow-y-auto border-t border-ink-100">
            <Table headers={['Task', 'Owner', 'Due', '']}>
              {data.tasks.map((t) => (
                <TaskRow key={t.id} task={t} readOnly={data.status === 'CANCELLED'} employee={data.employee} onChanged={changed} />
              ))}
            </Table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function StartModal({ templates, onClose, onDone }: { templates: Template[]; onClose: () => void; onDone: () => void }) {
  const employees = useEmployees();
  const [employeeId, setEmployeeId] = useState('');
  const [templateId, setTemplateId] = useState(templates.find((t) => t.isDefault)?.id ?? templates[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await api('/onboarding/cases', { method: 'POST', body: { employeeId, ...(templateId ? { templateId } : {}) } });
      onDone();
      onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Start onboarding" open onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-ink-500">
          Creates the joiner&apos;s checklist with due dates counted from their joining date. If a case is already in
          progress for the employee, it is reused.
        </p>
        <ErrorNote error={error} />
        <Field label="Employee">
          <EmployeeSelect employees={employees} value={employeeId} onChange={setEmployeeId} />
        </Field>
        <Field label="Checklist template">
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {templates.filter((t) => t.isActive).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.tasks.length} tasks){t.isDefault ? ' — default' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Button onClick={() => void submit()} disabled={busy || !employeeId} className="w-full">
          {busy ? 'Starting…' : 'Start onboarding'}
        </Button>
      </div>
    </Modal>
  );
}

const emptyTask = (): TemplateTask => ({
  title: '',
  description: '',
  assigneeRole: 'EMPLOYEE',
  dueOffsetDays: 0,
  requiresDocument: false,
  documentCategory: '',
});

function TemplateEditor({ template, onClose, onDone }: { template: Template | null; onClose: () => void; onDone: () => void }) {
  const { data: folderInfo } = useFetch<{ folders: { name: string }[] }>('/documents/folders');
  const [name, setName] = useState(template?.name ?? '');
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false);
  const [isActive, setIsActive] = useState(template?.isActive ?? true);
  const [tasks, setTasks] = useState<TemplateTask[]>(template?.tasks.map((t) => ({ ...emptyTask(), ...t })) ?? [emptyTask()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (i: number, p: Partial<TemplateTask>) => setTasks(tasks.map((t, j) => (j === i ? { ...t, ...p } : t)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...tasks];
    const [item] = next.splice(i, 1);
    if (!item) return;
    next.splice(i + d, 0, item);
    setTasks(next);
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const body = {
        name,
        isDefault,
        isActive,
        tasks: tasks.map((t) => ({ ...t, dueOffsetDays: Number(t.dueOffsetDays) || 0, documentCategory: t.requiresDocument ? t.documentCategory : '' })),
      };
      if (template) await api(`/onboarding/templates/${template.id}`, { method: 'PATCH', body });
      else await api('/onboarding/templates', { method: 'POST', body });
      onDone();
      onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={template ? `Edit “${template.name}”` : 'New onboarding template'} open onClose={onClose} wide>
      <div className="space-y-4">
        <ErrorNote error={error} />
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <Field label="Template name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Engineering onboarding" />
          </Field>
          <label className="flex items-center gap-2 pb-2.5 text-sm text-ink-600">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> Default
          </label>
          <label className="flex items-center gap-2 pb-2.5 text-sm text-ink-600">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active
          </label>
        </div>
        <p className="text-xs text-ink-400">
          Due offset is counted in days from the joining date (negative = before joining). Employee tasks go to the
          joiner, Manager tasks to their reporting manager; HR, IT and Admin tasks are handled by HR/Admin users.
        </p>
        <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
          {tasks.map((t, i) => (
            <div key={i} className="rounded-xl border border-ink-200 p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_130px_90px]">
                <Input value={t.title} onChange={(e) => patch(i, { title: e.target.value })} placeholder={`Task ${i + 1} title`} />
                <Select value={t.assigneeRole} onChange={(e) => patch(i, { assigneeRole: e.target.value as AssigneeRole })}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {humanize(r)}
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  value={t.dueOffsetDays}
                  onChange={(e) => patch(i, { dueOffsetDays: Number(e.target.value) })}
                  title="Due (days from joining)"
                />
              </div>
              <Textarea
                rows={1}
                className="mt-2"
                value={t.description}
                onChange={(e) => patch(i, { description: e.target.value })}
                placeholder="Instructions (optional)"
              />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-ink-600">
                  <input
                    type="checkbox"
                    checked={t.requiresDocument}
                    onChange={(e) => patch(i, { requiresDocument: e.target.checked, documentCategory: t.documentCategory || 'Onboarding' })}
                  />
                  Requires a document
                </label>
                {t.requiresDocument && (
                  <Select value={t.documentCategory} onChange={(e) => patch(i, { documentCategory: e.target.value })} className="w-56!">
                    {(folderInfo?.folders ?? [{ name: 'Onboarding' }]).map((f) => (
                      <option key={f.name} value={f.name}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                )}
                <div className="ml-auto flex gap-1">
                  <Button variant="ghost" onClick={() => move(i, -1)} disabled={i === 0}>
                    ↑
                  </Button>
                  <Button variant="ghost" onClick={() => move(i, 1)} disabled={i === tasks.length - 1}>
                    ↓
                  </Button>
                  <Button variant="ghost" onClick={() => setTasks(tasks.filter((_, j) => j !== i))} disabled={tasks.length === 1}>
                    Remove
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setTasks([...tasks, emptyTask()])}>
            + Add task
          </Button>
          <Button
            onClick={() => void save()}
            disabled={busy || name.trim().length < 2 || tasks.some((t) => t.title.trim().length < 2)}
            className="flex-1"
          >
            {busy ? 'Saving…' : 'Save template'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function OnboardingPage() {
  const { session, isManagerial, isCompanyAdmin } = useAuth();
  const myCase = useFetch<Case | null>(session?.employee ? '/onboarding/cases/me' : null);
  // HR / Admin work every joiner's checklist from "New onboarding", so "My tasks" (the same tasks as one
  // list) is only for employees and managers — or for HR / Admin while their own onboarding is running.
  const showMyTasks = !isCompanyAdmin || myCase.data?.status === 'IN_PROGRESS';
  const tabs = [...(showMyTasks ? ['My tasks'] : []), ...(isManagerial ? ['New onboarding'] : []), ...(isCompanyAdmin ? ['Templates'] : [])];
  const [picked, setTab] = useState<string | null>(null);
  const tab = picked && tabs.includes(picked) ? picked : (tabs[0] as string);
  const [status, setStatus] = useState('');

  const tasks = useFetch<Task[]>(tab === 'My tasks' ? '/onboarding/tasks' : null);
  const cases = useFetch<Case[]>(tab === 'New onboarding' && isManagerial ? `/onboarding/cases${status ? `?status=${status}` : ''}` : null);
  const templates = useFetch<Template[]>(isCompanyAdmin ? '/onboarding/templates' : null);

  const [openCase, setOpenCase] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null | 'new'>(null);

  const refreshAll = () => {
    tasks.reload();
    cases.reload();
    myCase.reload();
  };

  const removeTemplate = async (t: Template) => {
    if (!window.confirm(`Delete template “${t.name}”? Onboardings already started keep their tasks.`)) return;
    await api(`/onboarding/templates/${t.id}`, { method: 'DELETE' });
    templates.reload();
  };

  const ownTasks = myCase.data?.tasks.filter((t) => t.assigneeId === session?.employee?.id) ?? [];
  const otherTasks = (tasks.data ?? []).filter((t) => t.case?.employee.id !== session?.employee?.id);

  return (
    <div>
      <PageHeader
        title="Onboarding"
        subtitle="Joining checklists for new employees, their managers, HR, IT and Admin"
        actions={isCompanyAdmin && templates.data ? <Button onClick={() => setStartOpen(true)}>+ Start onboarding</Button> : undefined}
      />

      {tabs.length > 1 && <Tabs tabs={tabs} active={tab} onChange={setTab} />}

      {tab === 'My tasks' && (
        <div className="space-y-6">
          {/* The viewer's own joining checklist, only while it is still running. */}
          {myCase.data?.status === 'IN_PROGRESS' && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-ink-900">My onboarding</h2>
                  <p className="text-xs text-ink-400">
                    {myCase.data.doneTasks} of {myCase.data.totalTasks} tasks done across everyone involved
                  </p>
                </div>
                <ProgressBar value={myCase.data.progress} />
              </div>
              {ownTasks.length === 0 ? (
                <Empty message="Nothing for you to do — HR is on it" />
              ) : (
                <Table headers={['Task', 'Owner', 'Due', '']}>
                  {ownTasks.map((t) => (
                    <TaskRow key={t.id} task={t} onChanged={refreshAll} />
                  ))}
                </Table>
              )}
            </Card>
          )}

          <Card>
            <div className="border-b border-ink-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-ink-900">Tasks assigned to me</h2>
              <p className="text-xs text-ink-400">Open checklist items for new joiners that you or your department own</p>
            </div>
            {tasks.loading ? (
              <Spinner />
            ) : otherTasks.length === 0 ? (
              <Empty message="No open onboarding tasks" />
            ) : (
              <Table headers={['Task', 'Joiner', 'Owner', 'Due', '']}>
                {otherTasks.map((t) => (
                  <TaskRow key={t.id} task={t} showEmployee onChanged={refreshAll} />
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}

      {tab === 'New onboarding' && (
        <>
          {cases.data && (
            <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="Joiners shown" value={cases.data.length} icon="users" />
              <Stat
                label="Avg. progress"
                value={`${cases.data.length ? Math.round(cases.data.reduce((s, c) => s + c.progress, 0) / cases.data.length) : 0}%`}
                icon="chart"
              />
              <Stat
                label="Overdue tasks"
                value={cases.data.reduce((s, c) => s + c.tasks.filter(overdue).length, 0)}
                accent="text-rose-600"
                icon="clock"
              />
              <Stat label="Tasks open" value={cases.data.reduce((s, c) => s + (c.totalTasks - c.doneTasks), 0)} icon="tasks" />
            </div>
          )}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold text-ink-900">New onboarding</h2>
                <p className="text-xs text-ink-400">Every new joiner&apos;s checklist. Open one to upload documents and tick off tasks.</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  ['', 'All'],
                  ['IN_PROGRESS', 'In progress'],
                  ['COMPLETED', 'Completed'],
                  ['CANCELLED', 'Cancelled'],
                ].map(([value, text]) => (
                  <button
                    key={value}
                    onClick={() => setStatus(value)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      status === value ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                    }`}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
            {cases.loading ? (
              <Spinner />
            ) : !cases.data || cases.data.length === 0 ? (
              <Empty message="No new joiners here" />
            ) : (
              <Table headers={['Employee', 'Joining', 'Started', 'Progress', 'Overdue', 'Status', '']}>
                {/* Cancelled onboardings go last and are dimmed so they are not mistaken for the live one. */}
                {[...cases.data].sort((a, b) => Number(a.status === 'CANCELLED') - Number(b.status === 'CANCELLED')).map((c) => (
                  <tr key={c.id} className={c.status === 'CANCELLED' ? 'opacity-60' : ''}>
                    <Td>
                      <p className="font-medium text-ink-900">{c.employee.name}</p>
                      <p className="text-xs text-ink-400">
                        {c.employee.employeeCode} · {c.employee.designation || '—'}
                      </p>
                    </Td>
                    <Td>{fmtDate(c.employee.joiningDate)}</Td>
                    <Td>{fmtDate(c.startedOn)}</Td>
                    <Td>
                      <ProgressBar value={c.progress} />
                      <span className="text-xs text-ink-400">
                        {c.doneTasks}/{c.totalTasks} tasks
                      </span>
                    </Td>
                    <Td>{c.tasks.filter(overdue).length || '—'}</Td>
                    <Td>
                      <Badge tone={caseTone(c.status)}>{humanize(c.status)}</Badge>
                    </Td>
                    <Td>
                      <Button variant="ghost" onClick={() => setOpenCase(c.id)}>
                        {c.status === 'CANCELLED' ? 'View' : 'Checklist'}
                      </Button>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}

      {tab === 'Templates' && (
        <Card>
          <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-ink-900">Checklist templates</h2>
            <Button variant="secondary" onClick={() => setEditing('new')}>
              + New template
            </Button>
          </div>
          {templates.loading ? (
            <Spinner />
          ) : !templates.data || templates.data.length === 0 ? (
            <Empty message="No templates" />
          ) : (
            <Table headers={['Template', 'Tasks', 'Owners', 'Status', '']}>
              {templates.data.map((t) => (
                <tr key={t.id}>
                  <Td className="font-medium text-ink-900">
                    {t.name} {t.isDefault && <Badge tone="violet">default</Badge>}
                  </Td>
                  <Td>
                    {t.tasks.length} ({t.tasks.filter((x) => x.requiresDocument).length} documents)
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {ROLES.filter((r) => t.tasks.some((x) => x.assigneeRole === r)).map((r) => (
                        <Badge key={r} tone={roleTone(r)}>
                          {r}
                        </Badge>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={t.isActive ? 'green' : 'slate'}>{t.isActive ? 'Active' : 'Inactive'}</Badge>
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={() => setEditing(t)}>
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => void removeTemplate(t)}>
                        Delete
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {openCase && <CaseModal id={openCase} onClose={() => setOpenCase(null)} onChanged={refreshAll} />}
      {startOpen && templates.data && (
        <StartModal templates={templates.data} onClose={() => setStartOpen(false)} onDone={refreshAll} />
      )}
      {editing && (
        <TemplateEditor
          template={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => templates.reload()}
        />
      )}
    </div>
  );
}
