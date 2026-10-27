'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Spinner, Table, Td } from '@/components/ui';
import { errMsg } from '@/components/engage';
import { useEmployees } from '@/components/lifecycle';

interface Project {
  id: string;
  name: string;
  code: string;
  client: string;
  isBillable: boolean;
  isActive: boolean;
  createdAt: string;
  entryCount: number;
  /** Employees with access; empty = open to everyone. */
  members: { id: string; name: string; employeeCode: string }[];
}

/** Pick the employees who may log hours on a project; none selected = open to everyone. */
function MembersModal({ project, onClose, onSaved }: { project: Project; onClose: () => void; onSaved: () => void }) {
  const employees = useEmployees();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(project.members.map((m) => m.id)));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needle = q.trim().toLowerCase();
  const shown = employees.filter((e) => !needle || `${e.name} ${e.employeeCode ?? ''} ${e.designation ?? ''}`.toLowerCase().includes(needle));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name ?? project.members.find((m) => m.id === id)?.name ?? '…';

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/projects/${project.id}/members`, { method: 'PUT', body: { employeeIds: [...selected] } });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Members — ${project.code} · ${project.name}`} open onClose={onClose} wide>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <p className={`rounded-xl px-3 py-2.5 text-sm ${selected.size ? 'bg-brand-50 text-brand-800' : 'bg-ink-100 text-ink-600'}`}>
          {selected.size
            ? `Only these ${selected.size} employee${selected.size === 1 ? '' : 's'} can log timesheet hours on ${project.code}.`
            : `No members — ${project.code} is open to everyone. Add employees to limit access to them only.`}
        </p>
        {selected.size > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {[...selected].map((id) => (
              <button
                key={id}
                onClick={() => toggle(id)}
                className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-500"
                title="Remove"
              >
                {nameOf(id)} ✕
              </button>
            ))}
          </div>
        )}
        <Input placeholder="Search employees by name, ID or designation…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-72 divide-y divide-ink-100 overflow-y-auto rounded-xl border border-ink-200">
          {shown.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-400">No employees found</p>
          ) : (
            shown.map((e) => (
              <label key={e.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-ink-50">
                <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} className="h-4 w-4 accent-brand-600" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-900">{e.name}</span>
                  <span className="block truncate text-xs text-ink-400">{[e.employeeCode, e.designation].filter(Boolean).join(' · ')}</span>
                </span>
              </label>
            ))
          )}
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <Button variant="secondary" onClick={() => setSelected(new Set())}>
              Clear all
            </Button>
          )}
          <Button onClick={() => void save()} disabled={busy} className="flex-1">
            {busy ? 'Saving…' : 'Save members'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const blank = { name: '', code: '', client: '', isBillable: true };

export default function ProjectsPage() {
  const { isManagerial } = useAuth();
  const { data, loading, error, reload } = useFetch<Project[]>('/projects?includeInactive=true');
  const [editing, setEditing] = useState<Project | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [membersFor, setMembersFor] = useState<Project | null>(null);

  const openNew = () => {
    setEditing(null);
    setForm(blank);
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (p: Project) => {
    setEditing(p);
    setForm({ name: p.name, code: p.code, client: p.client, isBillable: p.isBillable });
    setFormError(null);
    setOpen(true);
  };

  const save = async () => {
    setFormError(null);
    try {
      if (editing) await api(`/projects/${editing.id}`, { method: 'PATCH', body: form });
      else await api('/projects', { method: 'POST', body: form });
      setOpen(false);
      reload();
    } catch (err) {
      setFormError(errMsg(err));
    }
  };

  const toggleActive = async (p: Project) => {
    setActionError(null);
    try {
      await api(`/projects/${p.id}`, { method: 'PATCH', body: { isActive: !p.isActive } });
      reload();
    } catch (err) {
      setActionError(errMsg(err));
    }
  };

  const remove = async (p: Project) => {
    if (!window.confirm(`Delete ${p.code}?`)) return;
    setActionError(null);
    try {
      await api(`/projects/${p.id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      setActionError(errMsg(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle="Projects and clients that timesheet hours are booked against"
        actions={isManagerial ? <Button onClick={openNew}>+ New project</Button> : undefined}
      />
      <div className="mb-4">
        <ErrorNote error={error ?? actionError} />
      </div>
      <Card>
        {loading ? (
          <Spinner />
        ) : !data || data.length === 0 ? (
          <Empty message="No projects yet" />
        ) : (
          <Table headers={['Code', 'Name', 'Client', 'Access', 'Billing', 'Entries', 'Status', '']}>
            {data.map((p) => (
              <tr key={p.id} className={p.isActive ? '' : 'opacity-60'}>
                <Td>
                  <Badge tone="violet">{p.code}</Badge>
                </Td>
                <Td className="font-medium text-ink-900">{p.name}</Td>
                <Td>{p.client || '—'}</Td>
                <Td>
                  {p.members.length === 0 ? (
                    <span className="text-xs text-ink-500">Everyone</span>
                  ) : (
                    <span className="text-xs text-ink-700" title={p.members.map((m) => m.name).join(', ')}>
                      {p.members
                        .slice(0, 2)
                        .map((m) => m.name)
                        .join(', ')}
                      {p.members.length > 2 && <span className="text-ink-400"> +{p.members.length - 2} more</span>}
                    </span>
                  )}
                </Td>
                <Td>
                  <Badge tone={p.isBillable ? 'green' : 'slate'}>{p.isBillable ? 'Billable' : 'Non-billable'}</Badge>
                </Td>
                <Td>{p.entryCount}</Td>
                <Td>
                  <Badge tone={p.isActive ? 'green' : 'slate'}>{p.isActive ? 'Active' : 'Inactive'}</Badge>
                </Td>
                <Td>
                  {isManagerial && (
                    <div className="flex gap-1">
                      <Button variant="ghost" onClick={() => setMembersFor(p)}>
                        Members{p.members.length > 0 ? ` (${p.members.length})` : ''}
                      </Button>
                      <Button variant="ghost" onClick={() => openEdit(p)}>
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => void toggleActive(p)}>
                        {p.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                      {p.entryCount === 0 && (
                        <Button variant="ghost" onClick={() => void remove(p)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {membersFor && <MembersModal project={membersFor} onClose={() => setMembersFor(null)} onSaved={reload} />}

      <Modal title={editing ? `Edit ${editing.code}` : 'New project'} open={open} onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <ErrorNote error={formError} />
          <div className="grid grid-cols-3 gap-3">
            <Field label="Code">
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="ACME-WEB" />
            </Field>
            <div className="col-span-2">
              <Field label="Name">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
            </div>
          </div>
          <Field label="Client">
            <Input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} placeholder="Internal" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-ink-600">
            <input
              type="checkbox"
              checked={form.isBillable}
              onChange={(e) => setForm({ ...form, isBillable: e.target.checked })}
              className="accent-brand-600"
            />
            Billable by default
          </label>
          <Button onClick={() => void save()} disabled={!form.code || form.name.length < 2} className="w-full">
            {editing ? 'Save changes' : 'Create project'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
