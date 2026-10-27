'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtMoney } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Td,
} from '@/components/ui';

interface Department {
  id: string;
  name: string;
  code: string;
  headId: string | null;
  parentId: string | null;
  isActive: boolean;
  head: { id: string; name: string; designation: string } | null;
  parent: { id: string; name: string } | null;
  employeeCount: number;
}

interface Designation {
  id: string;
  name: string;
  level: number;
  isActive: boolean;
  employeeCount: number;
}

interface Grade {
  id: string;
  code: string;
  name: string;
  minCtc: number;
  maxCtc: number;
  isActive: boolean;
  employeeCount: number;
}

type Kind = 'departments' | 'designations' | 'grades';
type Editing = { kind: Kind; id: string | null; form: Record<string, string>; isActive: boolean };

const TABS: Record<string, Kind> = { Departments: 'departments', Designations: 'designations', Grades: 'grades' };

export default function MastersPage() {
  const { isCompanyAdmin, hasRole } = useAuth();
  const [tab, setTab] = useState('Departments');
  const kind = TABS[tab] ?? 'departments';
  const departments = useFetch<Department[]>('/masters/departments?includeInactive=true');
  const designations = useFetch<Designation[]>(kind === 'designations' ? '/masters/designations?includeInactive=true' : null);
  const grades = useFetch<Grade[]>(kind === 'grades' ? '/masters/grades?includeInactive=true' : null);
  const { data: people } = useFetch<{ items: { id: string; name: string }[] }>(isCompanyAdmin ? '/employees?pageSize=100' : null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadKind = (k: Kind) => (k === 'departments' ? departments.reload() : k === 'designations' ? designations.reload() : grades.reload());

  const open = (k: Kind, row?: Department | Designation | Grade) => {
    setError(null);
    if (k === 'departments') {
      const d = row as Department | undefined;
      setEditing({ kind: k, id: d?.id ?? null, isActive: d?.isActive ?? true, form: { name: d?.name ?? '', code: d?.code ?? '', headId: d?.headId ?? '', parentId: d?.parentId ?? '' } });
    } else if (k === 'designations') {
      const d = row as Designation | undefined;
      setEditing({ kind: k, id: d?.id ?? null, isActive: d?.isActive ?? true, form: { name: d?.name ?? '', level: String(d?.level ?? 0) } });
    } else {
      const g = row as Grade | undefined;
      setEditing({
        kind: k, id: g?.id ?? null, isActive: g?.isActive ?? true,
        form: { code: g?.code ?? '', name: g?.name ?? '', minCtc: g ? String(g.minCtc) : '', maxCtc: g ? String(g.maxCtc) : '' },
      });
    }
  };

  const save = async () => {
    if (!editing) return;
    setError(null);
    setBusy(true);
    const f = editing.form;
    const body =
      editing.kind === 'departments'
        ? { name: f.name, code: f.code, headId: f.headId || null, parentId: f.parentId || null, isActive: editing.isActive }
        : editing.kind === 'designations'
          ? { name: f.name, level: Number(f.level || 0), isActive: editing.isActive }
          : { code: f.code, name: f.name, minCtc: Number(f.minCtc || 0), maxCtc: Number(f.maxCtc || 0), isActive: editing.isActive };
    try {
      await api(`/masters/${editing.kind}${editing.id ? `/${editing.id}` : ''}`, { method: editing.id ? 'PATCH' : 'POST', body });
      reloadKind(editing.kind);
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (k: Kind, id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setPageError(null);
    try {
      await api(`/masters/${k}/${id}`, { method: 'DELETE' });
      reloadKind(k);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const sync = async () => {
    if (!confirm('Create department and designation masters from the text on every employee profile and link them?')) return;
    setPageError(null);
    setSyncMsg(null);
    try {
      const r = await api<{ departmentsCreated: number; designationsCreated: number; employeesLinked: number }>(
        '/masters/sync-from-employees',
        { method: 'POST' }
      );
      setSyncMsg(`Created ${r.departmentsCreated} department(s) and ${r.designationsCreated} designation(s); linked ${r.employeesLinked} employee(s).`);
      departments.reload();
      designations.reload();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const actions = (k: Kind, row: { id: string; name: string }) =>
    isCompanyAdmin && (
      <div className="flex justify-end gap-1">
        <Button variant="ghost" onClick={() => open(k, row as Department)}>
          Edit
        </Button>
        <Button variant="ghost" onClick={() => void remove(k, row.id, row.name)}>
          Delete
        </Button>
      </div>
    );

  const status = (active: boolean) => (active ? <Badge tone="green">active</Badge> : <Badge tone="slate">inactive</Badge>);
  const current = kind === 'departments' ? departments : kind === 'designations' ? designations : grades;

  return (
    <div>
      <PageHeader
        title="Organisation masters"
        subtitle="Departments, designations and grades used across profiles, approvals and reports"
        actions={
          isCompanyAdmin ? (
            <>
              {hasRole('ADMIN', 'SUPER_ADMIN') && (
                <Button variant="secondary" onClick={() => void sync()}>
                  Import from employee profiles
                </Button>
              )}
              <Button onClick={() => open(kind)}>+ Add {tab.slice(0, -1).toLowerCase()}</Button>
            </>
          ) : undefined
        }
      />
      <Tabs tabs={Object.keys(TABS)} active={tab} onChange={setTab} />
      <div className="mb-3 space-y-2">
        <ErrorNote error={pageError ?? current.error} />
        {syncMsg && <p className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">{syncMsg}</p>}
      </div>

      <Card>
        {current.loading ? (
          <Spinner />
        ) : kind === 'departments' ? (
          !departments.data?.length ? (
            <Empty message="No departments yet" />
          ) : (
            <Table headers={['Department', 'Code', 'Head', 'Parent', 'Employees', 'Status', '']}>
              {departments.data.map((d) => (
                <tr key={d.id}>
                  <Td className="font-medium text-ink-900">{d.name}</Td>
                  <Td>{d.code || '—'}</Td>
                  <Td>{d.head?.name ?? '—'}</Td>
                  <Td>{d.parent?.name ?? '—'}</Td>
                  <Td>{d.employeeCount}</Td>
                  <Td>{status(d.isActive)}</Td>
                  <Td>{actions('departments', d)}</Td>
                </tr>
              ))}
            </Table>
          )
        ) : kind === 'designations' ? (
          !designations.data?.length ? (
            <Empty message="No designations yet" />
          ) : (
            <Table headers={['Designation', 'Level', 'Employees', 'Status', '']}>
              {designations.data.map((d) => (
                <tr key={d.id}>
                  <Td className="font-medium text-ink-900">{d.name}</Td>
                  <Td>{d.level}</Td>
                  <Td>{d.employeeCount}</Td>
                  <Td>{status(d.isActive)}</Td>
                  <Td>{actions('designations', d)}</Td>
                </tr>
              ))}
            </Table>
          )
        ) : !grades.data?.length ? (
          <Empty message="No grades yet" />
        ) : (
          <Table headers={['Grade', 'Name', 'Annual CTC band', 'Employees', 'Status', '']}>
            {grades.data.map((g) => (
              <tr key={g.id}>
                <Td className="font-mono font-medium text-ink-900">{g.code}</Td>
                <Td>{g.name}</Td>
                <Td>{g.minCtc || g.maxCtc ? `${fmtMoney(g.minCtc)} – ${g.maxCtc ? fmtMoney(g.maxCtc) : 'no cap'}` : '—'}</Td>
                <Td>{g.employeeCount}</Td>
                <Td>{status(g.isActive)}</Td>
                <Td>{actions('grades', g)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal
        title={editing ? `${editing.id ? 'Edit' : 'New'} ${editing.kind.slice(0, -1)}` : ''}
        open={!!editing}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <div className="space-y-3">
            <ErrorNote error={error} />
            {editing.kind === 'grades' && (
              <Field label="Code">
                <Input value={editing.form.code} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, code: e.target.value } })} placeholder="L3" />
              </Field>
            )}
            <Field label="Name">
              <Input value={editing.form.name} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })} />
            </Field>
            {editing.kind === 'departments' && (
              <>
                <Field label="Code">
                  <Input value={editing.form.code} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, code: e.target.value } })} placeholder="ENG" />
                </Field>
                <Field label="Department head" hint="can approve requests via the DEPARTMENT_HEAD approval step">
                  <Select value={editing.form.headId} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, headId: e.target.value } })}>
                    <option value="">— none —</option>
                    {people?.items.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Parent department">
                  <Select value={editing.form.parentId} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, parentId: e.target.value } })}>
                    <option value="">— none —</option>
                    {departments.data
                      ?.filter((d) => d.id !== editing.id)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </Select>
                </Field>
              </>
            )}
            {editing.kind === 'designations' && (
              <Field label="Seniority level" hint="higher = more senior; orders the org chart">
                <Input type="number" min={0} max={100} value={editing.form.level} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, level: e.target.value } })} />
              </Field>
            )}
            {editing.kind === 'grades' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Min annual CTC (₹)">
                  <Input type="number" min={0} value={editing.form.minCtc} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, minCtc: e.target.value } })} />
                </Field>
                <Field label="Max annual CTC (₹)" hint="0 = no cap">
                  <Input type="number" min={0} value={editing.form.maxCtc} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, maxCtc: e.target.value } })} />
                </Field>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-ink-600">
              <input type="checkbox" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />
              Active (inactive masters are hidden from pickers)
            </label>
            <Button
              onClick={() => void save()}
              disabled={busy || editing.form.name.trim().length < (editing.kind === 'grades' ? 1 : 2) || (editing.kind === 'grades' && !editing.form.code.trim())}
              className="w-full"
            >
              Save
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
