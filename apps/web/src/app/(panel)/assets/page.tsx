'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { API_URL, api, fmtDate, fmtMoney, getActingCompanyId, getSession } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, DatePicker, Empty, ErrorNote, Field, Input, LongText, Modal, PageHeader, Select, Spinner, Stat, Table, Td, Textarea,
} from '@/components/ui';
import { EmployeeSelect, errText, humanize, useEmployees } from '@/components/lifecycle';
import { DeleteAssetDialog, EditAssignmentDatesDialog, localDay, type DatedAssignment } from '@/components/assets';

interface Asset {
  id: string;
  tag: string;
  name: string;
  category: string;
  serialNumber: string;
  brand: string;
  model: string;
  purchaseDate: string | null;
  cost: number;
  status: string;
  notes: string;
  holder: { id: string; name: string; employeeCode: string; issuedOn: string } | null;
}

interface Assignment {
  id: string;
  issuedOn: string;
  expectedReturn: string | null;
  returnedOn: string | null;
  conditionOut: string;
  conditionIn: string;
  notes: string;
  asset: { id: string; tag: string; name: string; category: string; serialNumber: string; cost: number; status: string };
  employee: { id: string; name: string; employeeCode: string };
}

interface Meta {
  categories: string[];
  statuses: string[];
  summary: { total: number; value: number; byStatus: Record<string, number> };
}

const assetTone = (s: string) =>
  (({ AVAILABLE: 'green', ASSIGNED: 'blue', IN_REPAIR: 'amber', RETIRED: 'slate', LOST: 'red' }) as const)[
    s as 'AVAILABLE'
  ] ?? 'slate';

const emptyForm = {
  tag: '', name: '', category: 'Laptop', serialNumber: '', brand: '', model: '', purchaseDate: '', cost: '', status: 'AVAILABLE', notes: '',
};

function AssetForm({ asset, meta, onClose, onDone }: { asset: Asset | null; meta: Meta; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState(
    asset
      ? {
          tag: asset.tag, name: asset.name, category: asset.category, serialNumber: asset.serialNumber, brand: asset.brand,
          model: asset.model, purchaseDate: asset.purchaseDate?.slice(0, 10) ?? '', cost: String(asset.cost), status: asset.status,
          notes: asset.notes,
        }
      : emptyForm
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof emptyForm, v: string) => setForm({ ...form, [k]: v });

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const body = { ...form, cost: Number(form.cost) || 0, purchaseDate: form.purchaseDate || null };
      if (asset) await api(`/assets/${asset.id}`, { method: 'PATCH', body });
      else await api('/assets', { method: 'POST', body });
      onDone();
      onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={asset ? `Edit ${asset.tag}` : 'Add asset'} open onClose={onClose} wide>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Asset tag" hint="Unique, e.g. LAP-0042">
            <Input value={form.tag} onChange={(e) => set('tag', e.target.value)} />
          </Field>
          <Field label="Name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. MacBook Pro 14" />
          </Field>
          <Field label="Category">
            <Select value={form.category} onChange={(e) => set('category', e.target.value)}>
              {meta.categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => set('status', e.target.value)} disabled={form.status === 'ASSIGNED'}>
              {meta.statuses
                .filter((s) => s !== 'ASSIGNED' || form.status === 'ASSIGNED')
                .map((s) => (
                  <option key={s} value={s}>
                    {humanize(s)}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Brand">
            <Input value={form.brand} onChange={(e) => set('brand', e.target.value)} />
          </Field>
          <Field label="Model">
            <Input value={form.model} onChange={(e) => set('model', e.target.value)} />
          </Field>
          <Field label="Serial number">
            <Input value={form.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} />
          </Field>
          <Field label="Cost (₹)" hint="Recovered in F&F if not returned at exit">
            <Input type="number" min={0} value={form.cost} onChange={(e) => set('cost', e.target.value)} />
          </Field>
          <Field label="Purchase date">
            <DatePicker value={form.purchaseDate} onChange={(v) => set('purchaseDate', v)} clearable />
          </Field>
        </div>
        <Field label="Description">
          <Textarea rows={3} maxLength={1000} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Configuration, accessories, condition…" />
        </Field>
        <Button onClick={() => void save()} disabled={busy || !form.tag.trim() || form.name.trim().length < 2} className="w-full">
          {busy ? 'Saving…' : 'Save asset'}
        </Button>
      </div>
    </Modal>
  );
}

function AssignModal({ asset, onClose, onDone }: { asset: Asset; onClose: () => void; onDone: () => void }) {
  const employees = useEmployees();
  const [form, setForm] = useState({ employeeId: '', issuedOn: localDay(new Date().toISOString()), expectedReturn: '', conditionOut: 'Good', notes: '' });
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await api(`/assets/${asset.id}/assign`, {
        method: 'POST',
        // Today keeps the exact time of issue; an earlier day back-dates it.
        body: { ...form, issuedOn: form.issuedOn === localDay(new Date().toISOString()) ? null : form.issuedOn, expectedReturn: form.expectedReturn || null },
      });
      onDone();
      onClose();
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <Modal title={`Assign ${asset.name} (${asset.tag})`} open onClose={onClose}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <Field label="Employee">
          <EmployeeSelect employees={employees} value={form.employeeId} onChange={(id) => setForm({ ...form, employeeId: id })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Issued on" hint="change it to record an earlier hand-over">
            <DatePicker value={form.issuedOn} onChange={(v) => setForm({ ...form, issuedOn: v })} />
          </Field>
          <Field label="Condition">
            <Input value={form.conditionOut} onChange={(e) => setForm({ ...form, conditionOut: e.target.value })} />
          </Field>
          <Field label="Expected return">
            <DatePicker value={form.expectedReturn} onChange={(v) => setForm({ ...form, expectedReturn: v })} clearable />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Accessories issued, charger, bag…" />
        </Field>
        <Button onClick={() => void submit()} disabled={!form.employeeId || !form.issuedOn} className="w-full">
          Assign
        </Button>
      </div>
    </Modal>
  );
}

function ReturnModal({ asset, onClose, onDone }: { asset: Asset; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ returnedOn: localDay(new Date().toISOString()), conditionIn: 'Good', status: 'AVAILABLE', notes: '' });
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await api(`/assets/${asset.id}/return`, {
        method: 'POST',
        body: { ...form, returnedOn: form.returnedOn === localDay(new Date().toISOString()) ? null : form.returnedOn },
      });
      onDone();
      onClose();
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <Modal title={`Return ${asset.name} (${asset.tag})`} open onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-ink-500">
          From {asset.holder?.name}, issued {fmtDate(asset.holder?.issuedOn)}.
        </p>
        <ErrorNote error={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Returned on">
            <DatePicker value={form.returnedOn} onChange={(v) => setForm({ ...form, returnedOn: v })} />
          </Field>
          <Field label="Condition on return">
            <Input value={form.conditionIn} onChange={(e) => setForm({ ...form, conditionIn: e.target.value })} />
          </Field>
        </div>
        <Field label="Move to">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="AVAILABLE">Available — ready to issue</option>
            <option value="IN_REPAIR">In repair</option>
          </Select>
        </Field>
        <Field label="Notes">
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        <Button onClick={() => void submit()} disabled={form.conditionIn.trim().length < 2 || !form.returnedOn} className="w-full">
          Record return
        </Button>
      </div>
    </Modal>
  );
}

function HistoryModal({ asset, onClose, onChanged }: { asset: Asset; onClose: () => void; onChanged: () => void }) {
  const { data, loading, reload } = useFetch<Assignment[]>(`/assets/${asset.id}/history`);
  const [editing, setEditing] = useState<DatedAssignment | null>(null);
  if (editing) {
    return (
      <EditAssignmentDatesDialog
        assignment={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          reload();
          onChanged();
        }}
      />
    );
  }
  return (
    <Modal title={`History — ${asset.name} (${asset.tag})`} open onClose={onClose} wide>
      {loading ? (
        <Spinner />
      ) : !data || data.length === 0 ? (
        <Empty message="Never issued" />
      ) : (
        <div className="-mx-6">
          <Table headers={['Employee', 'Issued', 'Returned', 'Condition', 'Notes', '']}>
            {data.map((a) => (
              <tr key={a.id}>
                <Td className="font-medium text-ink-900">
                  {a.employee.name} <span className="text-xs text-ink-400">{a.employee.employeeCode}</span>
                </Td>
                <Td>{fmtDate(a.issuedOn)}</Td>
                <Td>{a.returnedOn ? fmtDate(a.returnedOn) : <Badge tone="blue">With employee</Badge>}</Td>
                <Td>
                  {a.conditionOut}
                  {a.conditionIn && ` → ${a.conditionIn}`}
                </Td>
                <Td>
                  <LongText text={a.notes} />
                </Td>
                <Td>
                  <Button variant="ghost" onClick={() => setEditing(a)}>
                    Edit dates
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </Modal>
  );
}

/** Employees (and managers) see the assets issued to them. */
function MyAssets() {
  const { data, loading } = useFetch<Assignment[]>('/assets/mine?includeReturned=true');
  return (
    <Card>
      {loading ? (
        <Spinner />
      ) : !data || data.length === 0 ? (
        <Empty message="No company assets issued to you" />
      ) : (
        <Table headers={['Asset', 'Category', 'Serial', 'Issued', 'Status']}>
          {data.map((a) => (
            <tr key={a.id}>
              <Td className="font-medium text-ink-900">
                {a.asset.name} <span className="text-xs text-ink-400">{a.asset.tag}</span>
              </Td>
              <Td>{a.asset.category}</Td>
              <Td>{a.asset.serialNumber || '—'}</Td>
              <Td>{fmtDate(a.issuedOn)}</Td>
              <Td>{a.returnedOn ? <Badge tone="slate">Returned {fmtDate(a.returnedOn)}</Badge> : <Badge tone="blue">With you</Badge>}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

export default function AssetsPage() {
  const { isCompanyAdmin } = useAuth();
  const [filters, setFilters] = useState({ status: '', category: '', q: '' });
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const meta = useFetch<Meta>(isCompanyAdmin ? '/assets/meta' : null);
  const assets = useFetch<Asset[]>(isCompanyAdmin ? `/assets${qs ? `?${qs}` : ''}` : null);
  const [modal, setModal] = useState<{ kind: 'form' | 'assign' | 'return' | 'history' | 'delete'; asset: Asset | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isCompanyAdmin) {
    return (
      <div>
        <PageHeader title="My assets" subtitle="Company equipment issued to you" />
        <MyAssets />
      </div>
    );
  }

  const reload = () => {
    assets.reload();
    meta.reload();
  };

  /** Authenticated CSV download (the API needs the Bearer token). */
  const exportCsv = async () => {
    const sessionData = getSession();
    const headers: Record<string, string> = { Authorization: `Bearer ${sessionData?.accessToken}` };
    const acting = sessionData?.role === 'SUPER_ADMIN' ? getActingCompanyId() : null;
    if (acting) headers['X-Company-Id'] = acting;
    const res = await fetch(`${API_URL}/assets/export`, { headers });
    if (!res.ok) return setError('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `assets-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const s = meta.data?.summary;
  return (
    <div>
      <PageHeader
        title="Assets"
        subtitle="Inventory, issue and return of company equipment"
        actions={
          <>
            <Button variant="secondary" onClick={() => void exportCsv()}>
              Export CSV
            </Button>
            <Button onClick={() => setModal({ kind: 'form', asset: null })} disabled={!meta.data}>
              + Add asset
            </Button>
          </>
        }
      />

      {s && (
        <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Total assets" value={s.total} icon="box" />
          <Stat label="Assigned" value={s.byStatus.ASSIGNED ?? 0} accent="text-sky-600" icon="users" />
          <Stat label="Available" value={s.byStatus.AVAILABLE ?? 0} accent="text-emerald-600" icon="check" />
          <Stat label="Inventory value" value={fmtMoney(s.value)} icon="wallet" />
        </div>
      )}

      <ErrorNote error={error} />
      <Card className={error ? 'mt-3' : ''}>
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-5 py-3">
          <Input
            placeholder="Search tag, name, serial or employee…"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            className="w-64!"
          />
          <Select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} className="w-44!">
            <option value="">All categories</option>
            {meta.data?.categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="w-44!">
            <option value="">All statuses</option>
            {meta.data?.statuses.map((st) => (
              <option key={st} value={st}>
                {humanize(st)}
              </option>
            ))}
          </Select>
        </div>
        {assets.loading && !assets.data ? (
          <Spinner />
        ) : !assets.data || assets.data.length === 0 ? (
          <Empty message="No assets found" />
        ) : (
          <Table headers={['Asset', 'Category', 'Serial / model', 'Cost', 'Status', 'With', '']}>
            {assets.data.map((a) => (
              <tr key={a.id}>
                <Td>
                  <p className="font-medium text-ink-900">{a.name}</p>
                  <p className="font-mono text-xs text-ink-400">{a.tag}</p>
                </Td>
                <Td>{a.category}</Td>
                <Td>
                  <p>{a.serialNumber || '—'}</p>
                  <p className="text-xs text-ink-400">{[a.brand, a.model].filter(Boolean).join(' ')}</p>
                </Td>
                <Td>{fmtMoney(a.cost)}</Td>
                <Td>
                  <Badge tone={assetTone(a.status)}>{humanize(a.status)}</Badge>
                </Td>
                <Td>
                  {a.holder ? (
                    <>
                      <p>{a.holder.name}</p>
                      <p className="text-xs text-ink-400">since {fmtDate(a.holder.issuedOn)}</p>
                    </>
                  ) : (
                    '—'
                  )}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {a.status === 'AVAILABLE' && <Button onClick={() => setModal({ kind: 'assign', asset: a })}>Assign</Button>}
                    {a.status === 'ASSIGNED' && (
                      <Button variant="secondary" onClick={() => setModal({ kind: 'return', asset: a })}>
                        Return
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => setModal({ kind: 'history', asset: a })}>
                      History
                    </Button>
                    <Button variant="ghost" onClick={() => setModal({ kind: 'form', asset: a })}>
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => setModal({ kind: 'delete', asset: a })}>
                      Delete
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {modal?.kind === 'form' && meta.data && (
        <AssetForm asset={modal.asset} meta={meta.data} onClose={() => setModal(null)} onDone={reload} />
      )}
      {modal?.kind === 'assign' && modal.asset && <AssignModal asset={modal.asset} onClose={() => setModal(null)} onDone={reload} />}
      {modal?.kind === 'return' && modal.asset && <ReturnModal asset={modal.asset} onClose={() => setModal(null)} onDone={reload} />}
      {modal?.kind === 'delete' && modal.asset && <DeleteAssetDialog asset={modal.asset} onClose={() => setModal(null)} onDone={reload} />}
      {modal?.kind === 'history' && modal.asset && <HistoryModal asset={modal.asset} onClose={() => setModal(null)} onChanged={reload} />}
    </div>
  );
}
