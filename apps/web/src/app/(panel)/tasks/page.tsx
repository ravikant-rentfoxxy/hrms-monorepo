'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, DatePicker } from '@/components/ui';

interface Task {
  id: string;
  title: string;
  project: string;
  due: string;
  priority: 'Low' | 'Medium' | 'High';
  done: boolean;
}

const priorityTone = { Low: 'slate', Medium: 'blue', High: 'red' } as const;

export default function TasksPage() {
  const { session, isManagerial } = useAuth();
  const { data, loading, reload } = useFetch<Task[]>(session?.employee ? '/tasks' : null);
  const { data: directory } = useFetch<{ items: { id: string; name: string }[] }>(isManagerial ? '/employees?pageSize=100' : null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', project: '', due: '', priority: 'Medium', employeeId: '' });
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    try {
      await api('/tasks', {
        method: 'POST',
        body: {
          title: form.title,
          project: form.project,
          due: form.due,
          priority: form.priority,
          ...(form.employeeId ? { employeeId: form.employeeId } : {}),
        },
      });
    } catch (err) {
      // e.g. a manager assigning to someone outside their team
      setError(err instanceof Error ? err.message : 'Failed');
      return;
    }
    setOpen(false);
    setForm({ title: '', project: '', due: '', priority: 'Medium', employeeId: '' });
    reload();
  };

  const toggle = async (t: Task) => {
    await api(`/tasks/${t.id}`, { method: 'PATCH', body: { done: !t.done } });
    reload();
  };

  const remove = async (id: string) => {
    await api(`/tasks/${id}`, { method: 'DELETE' });
    reload();
  };

  return (
    <div>
      <PageHeader title="Tasks" actions={<Button onClick={() => setOpen(true)}>+ New task</Button>} />
      <Card>
        {loading ? (
          <Spinner />
        ) : !data || data.length === 0 ? (
          <Empty message="No tasks — enjoy the quiet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                <input type="checkbox" checked={t.done} onChange={() => void toggle(t)} className="h-4 w-4 accent-indigo-600" />
                <div className="flex-1">
                  <p className={`text-sm ${t.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{t.title}</p>
                  <p className="text-xs text-slate-400">
                    {t.project || 'No project'} · due {fmtDate(t.due)}
                  </p>
                </div>
                <Badge tone={priorityTone[t.priority] ?? 'slate'}>{t.priority}</Badge>
                <Button variant="ghost" onClick={() => void remove(t.id)}>
                  ✕
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal title="New task" open={open} onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Title">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Project">
              <Input value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} />
            </Field>
            <Field label="Due">
              <DatePicker value={form.due} onChange={(v) => setForm({ ...form, due: v })} />
            </Field>
          </div>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {['Low', 'Medium', 'High'].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          </Field>
          {isManagerial && (
            <Field label="Assign to (optional)">
              <Select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                <option value="">Myself</option>
                {directory?.items.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Button onClick={() => void create()} disabled={!form.title || !form.due} className="w-full">
            Create task
          </Button>
        </div>
      </Modal>
    </div>
  );
}
