'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Spinner, Table, Td } from '@/components/ui';
import { errMsg } from '@/components/engage';

interface Project {
  id: string;
  name: string;
  code: string;
  client: string;
  isBillable: boolean;
  isActive: boolean;
  createdAt: string;
  entryCount: number;
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
          <Table headers={['Code', 'Name', 'Client', 'Billing', 'Entries', 'Status', 'Created', '']}>
            {data.map((p) => (
              <tr key={p.id} className={p.isActive ? '' : 'opacity-60'}>
                <Td>
                  <Badge tone="violet">{p.code}</Badge>
                </Td>
                <Td className="font-medium text-slate-900">{p.name}</Td>
                <Td>{p.client || '—'}</Td>
                <Td>
                  <Badge tone={p.isBillable ? 'green' : 'slate'}>{p.isBillable ? 'Billable' : 'Non-billable'}</Badge>
                </Td>
                <Td>{p.entryCount}</Td>
                <Td>
                  <Badge tone={p.isActive ? 'green' : 'slate'}>{p.isActive ? 'Active' : 'Inactive'}</Badge>
                </Td>
                <Td>{fmtDate(p.createdAt)}</Td>
                <Td>
                  {isManagerial && (
                    <div className="flex gap-1">
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
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={form.isBillable}
              onChange={(e) => setForm({ ...form, isBillable: e.target.checked })}
              className="accent-indigo-600"
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
