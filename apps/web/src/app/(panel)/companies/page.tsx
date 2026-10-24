'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td,
} from '@/components/ui';

interface Company {
  id: string;
  name: string;
  code: string;
  email: string | null;
  isActive: boolean;
  createdAt: string;
  _count: { employees: number; memberships: number };
}

interface Member {
  id: string;
  role: string;
  isActive: boolean;
  user: { id: string; email: string; lastLoginAt: string | null };
}

function MembersModal({ company, onClose }: { company: Company; onClose: () => void }) {
  const { data: members, loading, reload } = useFetch<Member[]>(`/superadmin/companies/${company.id}/members`);
  const [form, setForm] = useState({ email: '', role: 'ADMIN', password: '', name: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const grant = async () => {
    setError(null);
    setBusy(true);
    try {
      await api(`/superadmin/companies/${company.id}/members`, {
        method: 'POST',
        body: {
          email: form.email,
          role: form.role,
          ...(form.password ? { password: form.password } : {}),
          ...(form.name ? { name: form.name } : {}),
        },
      });
      setForm({ email: '', role: 'ADMIN', password: '', name: '' });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (userId: string) => {
    await api(`/superadmin/companies/${company.id}/members/${userId}`, { method: 'DELETE' });
    reload();
  };

  return (
    <Modal title={`Members — ${company.name}`} open onClose={onClose} wide>
      <div className="mb-4 rounded-lg bg-slate-50 p-3">
        <p className="mb-2 text-xs font-medium text-slate-500">
          Grant access — existing users just need an email; new users need a name and password too.
        </p>
        <ErrorNote error={error} />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Input placeholder="email@company.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
          <Input placeholder="Name (new users)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input
            placeholder="Password (new users)"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>
        <Button onClick={() => void grant()} disabled={busy || !form.email} className="mt-2">
          Grant access
        </Button>
      </div>
      {loading ? (
        <Spinner />
      ) : !members || members.length === 0 ? (
        <Empty message="No members yet" />
      ) : (
        <Table headers={['Email', 'Role', 'Status', 'Last login', '']}>
          {members.map((m) => (
            <tr key={m.id}>
              <Td>{m.user.email}</Td>
              <Td>
                <Badge tone="blue">{m.role}</Badge>
              </Td>
              <Td>{m.isActive ? <Badge tone="green">active</Badge> : <Badge tone="red">revoked</Badge>}</Td>
              <Td>{m.user.lastLoginAt ? fmtDate(m.user.lastLoginAt) : '—'}</Td>
              <Td>
                {m.isActive && (
                  <Button variant="danger" onClick={() => void revoke(m.user.id)}>
                    Revoke
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Modal>
  );
}

export default function CompaniesPage() {
  const { hasRole } = useAuth();
  const { data: companies, loading, reload } = useFetch<Company[]>('/superadmin/companies');
  const [showCreate, setShowCreate] = useState(false);
  const [membersFor, setMembersFor] = useState<Company | null>(null);
  const [form, setForm] = useState({ name: '', email: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!hasRole('SUPER_ADMIN')) return <Empty message="Only the super admin can manage companies." />;

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      await api('/superadmin/companies', {
        method: 'POST',
        body: { name: form.name, ...(form.email ? { email: form.email } : {}) },
      });
      setShowCreate(false);
      setForm({ name: '', email: '' });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (c: Company) => {
    await api(`/superadmin/companies/${c.id}`, { method: 'PATCH', body: { isActive: !c.isActive } });
    reload();
  };

  return (
    <div>
      <PageHeader
        title="Companies"
        subtitle="Tenants on this platform — each gets default leave types on creation"
        actions={
          <>
            <Button onClick={() => setShowCreate(true)}>+ New company</Button>
          </>
        }
      />
      <Card>
        {loading ? (
          <Spinner />
        ) : !companies || companies.length === 0 ? (
          <Empty message="No companies yet — create the first tenant." />
        ) : (
          <Table headers={['Company', 'Code', 'Employees', 'Members', 'Status', 'Created', '']}>
            {companies.map((c) => (
              <tr key={c.id}>
                <Td className="font-medium text-slate-900">{c.name}</Td>
                <Td>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{c.code}</code>
                </Td>
                <Td>{c._count.employees}</Td>
                <Td>{c._count.memberships}</Td>
                <Td>{c.isActive ? <Badge tone="green">active</Badge> : <Badge tone="red">disabled</Badge>}</Td>
                <Td>{fmtDate(c.createdAt)}</Td>
                <Td>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setMembersFor(c)}>
                      Members
                    </Button>
                    <Button variant={c.isActive ? 'danger' : 'primary'} onClick={() => void toggleActive(c)}>
                      {c.isActive ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal title="New company" open={showCreate} onClose={() => setShowCreate(false)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme Corp" />
          </Field>
          <Field label="Email (optional)">
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="hq@acme.com" />
          </Field>
          <p className="text-xs text-slate-400">
            The company code is generated automatically (Code-01, Code-02, …).
          </p>
          <Button onClick={() => void create()} disabled={busy || !form.name} className="w-full">
            Create company
          </Button>
        </div>
      </Modal>

      {membersFor && <MembersModal company={membersFor} onClose={() => setMembersFor(null)} />}
    </div>
  );
}
