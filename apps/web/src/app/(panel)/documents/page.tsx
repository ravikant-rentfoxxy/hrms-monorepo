'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Td } from '@/components/ui';
import { openSecureFile } from '@/lib/secure-file';

interface Doc {
  id: string;
  name: string;
  category: string;
  mimeType: string;
  size: number;
  uploadedOn: string;
  employee: { id: string; name: string } | null;
  uploadedBy: { id: string; name: string } | null;
}

/** Tab → list scope: personal documents of the user, company-wide ones, or (HR/Admin) other employees' personal documents. */
const SCOPES = { 'For me': 'me', Company: 'company', Employees: 'employees' } as const;
type ScopeTab = keyof typeof SCOPES;

const EMPTY: Record<ScopeTab, string> = {
  'For me': 'No personal documents yet — HR adds things like your offer letter, ID proofs and certificates here',
  Company: 'No company documents yet — policies, handbooks and holiday lists shared with everyone appear here',
  Employees: 'No employee documents yet',
};

const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function DocumentsPage() {
  const { session, isCompanyAdmin } = useAuth();
  const hasProfile = !!session?.employee;
  const tabs: ScopeTab[] = [...(hasProfile ? (['For me'] as const) : []), 'Company', ...(isCompanyAdmin ? (['Employees'] as const) : [])];
  const [tab, setTab] = useState<ScopeTab>(tabs[0] ?? 'Company');
  // Employees tab: optional filter to one person (options = everyone who has personal documents).
  const [ownerFilter, setOwnerFilter] = useState('');
  const owners = useFetch<{ id: string; name: string; employeeCode: string; isActive: boolean; documents: number }[]>(
    isCompanyAdmin && tab === 'Employees' ? '/documents/owners' : null
  );
  const byOwner = tab === 'Employees' && ownerFilter ? `&employeeId=${ownerFilter}` : '';
  const { data, loading, reload: reloadDocs } = useFetch<Doc[]>(`/documents?scope=${SCOPES[tab]}${byOwner}`);
  const reload = () => {
    reloadDocs();
    owners.reload();
  };
  const { data: directory } = useFetch<{ items: { id: string; name: string }[] }>(isCompanyAdmin ? '/employees?pageSize=100' : null);
  const { data: folderInfo } = useFetch<{ folders: { name: string }[] }>('/documents/folders');
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('General');
  const [target, setTarget] = useState('mine'); // mine | company | <employeeId>
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Edit-details modal
  const [editing, setEditing] = useState<Doc | null>(null);
  const [editForm, setEditForm] = useState({ name: '', category: 'General', target: 'company' });
  const [editError, setEditError] = useState<string | null>(null);

  const openUpload = () => {
    setError(null);
    setTarget(tab === 'Company' ? 'company' : tab === 'For me' ? 'mine' : ownerFilter || (directory?.items[0]?.id ?? 'company'));
    setOpen(true);
  };

  const upload = async () => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (name) fd.append('name', name);
      fd.append('category', category);
      if (target === 'company') fd.append('companyWide', 'true');
      else if (target !== 'mine') fd.append('employeeId', target);
      await api('/documents', { method: 'POST', form: fd });
      setOpen(false);
      setFile(null);
      setName('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  // inline=true renders the file in the browser tab; otherwise it downloads.
  const open_ = (id: string, inline: boolean) =>
    openSecureFile(`/documents/${id}/download${inline ? '?inline=true' : ''}`).catch((err: unknown) =>
      window.alert(err instanceof Error ? err.message : 'Could not open the document')
    );

  const remove = async (id: string) => {
    await api(`/documents/${id}`, { method: 'DELETE' });
    reload();
  };

  const openEdit = (d: Doc) => {
    setEditError(null);
    setEditForm({ name: d.name, category: d.category ?? 'General', target: d.employee?.id ?? 'company' });
    setEditing(d);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setEditError(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: editForm.name, category: editForm.category };
      if (isCompanyAdmin) {
        if (editForm.target === 'company') body.companyWide = true;
        else body.employeeId = editForm.target;
      }
      await api(`/documents/${editing.id}`, { method: 'PATCH', body });
      setEditing(null);
      reload();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle={isCompanyAdmin ? 'Manage employee and company documents' : 'Documents shared with you by HR'}
        actions={isCompanyAdmin ? <Button onClick={openUpload}>+ Upload</Button> : undefined}
      />
      {tabs.length > 1 && <Tabs tabs={tabs} active={tab} onChange={(t) => setTab(t as ScopeTab)} />}
      {tab === 'Employees' && (
        <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
          <div className="w-full max-w-sm">
            <Field label="Employee">
              <Select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
                <option value="">All employees ({owners.data?.reduce((s, o) => s + o.documents, 0) ?? 0} documents)</option>
                {owners.data?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.employeeCode}){o.isActive ? '' : ' — inactive'} · {o.documents}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {ownerFilter && (
            <Button variant="ghost" onClick={() => setOwnerFilter('')}>
              Clear filter
            </Button>
          )}
        </Card>
      )}
      <Card>
        {loading ? (
          <Spinner />
        ) : !data || data.length === 0 ? (
          <Empty message={tab === 'Employees' && ownerFilter ? 'This employee has no personal documents' : EMPTY[tab]} />
        ) : (
          <Table headers={['Name', 'Folder', ...(tab === 'Employees' ? ['Belongs to'] : []), 'Type', 'Size', 'Uploaded', '']}>
            {data.map((d) => (
              <tr key={d.id}>
                <Td className="font-medium text-ink-900">{d.name}</Td>
                <Td>
                  <Badge tone="slate">{d.category ?? 'General'}</Badge>
                </Td>
                {tab === 'Employees' && <Td>{d.employee?.name ?? '—'}</Td>}
                <Td className="text-xs text-ink-400">{d.mimeType}</Td>
                <Td>{fmtSize(d.size)}</Td>
                <Td>
                  {fmtDate(d.uploadedOn)}
                  {d.uploadedBy && <span className="block text-xs text-ink-400">by {d.uploadedBy.name}</span>}
                </Td>
                <Td>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => void open_(d.id, true)}>
                      View
                    </Button>
                    <Button variant="ghost" onClick={() => void open_(d.id, false)}>
                      Download
                    </Button>
                    {isCompanyAdmin && (
                      <>
                        <Button variant="ghost" onClick={() => openEdit(d)}>
                          Edit
                        </Button>
                        <Button variant="ghost" onClick={() => void remove(d.id)}>
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal title="Upload a document" open={open} onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <p className="text-sm text-ink-500">
            Keep HR files in one safe place — offer letters, ID proofs, certificates, payslips or company policies.
            Whoever the document belongs to can open and download it anytime, from the web portal or the mobile app.
          </p>
          <ErrorNote error={error} />
          <Field label="Step 1 — Choose the file" hint="Any format works (PDF, image, Word, Excel…), up to 15 MB">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-ink-200 px-4 py-6 text-center transition hover:border-brand-300 hover:bg-brand-50/40">
              <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              {file ? (
                <>
                  <span className="text-sm font-semibold text-ink-800">{file.name}</span>
                  <span className="mt-0.5 text-xs text-ink-400">{fmtSize(file.size)} · click to choose a different file</span>
                </>
              ) : (
                <>
                  <span className="text-sm font-medium text-brand-600">Click to browse your computer</span>
                  <span className="mt-0.5 text-xs text-ink-400">e.g. Aadhaar.pdf, Offer-letter.docx, Policy.xlsx</span>
                </>
              )}
            </label>
          </Field>
          <Field label="Step 2 — Give it a clear name (optional)" hint="Shown in the document list; the file name is used if left blank">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={file?.name ?? 'e.g. PAN card — Sneha'} />
          </Field>
          <Field label="Step 3 — Pick a folder" hint="Folders organise the employee's documents in the app (Identity, Offer Letter, …)">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {(folderInfo?.folders ?? [{ name: 'General' }]).map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
          {isCompanyAdmin && (
            <Field label="Step 4 — Who is this document for?" hint="A personal document is visible only to that person and HR/Admin">
              <Select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="mine">Me (my personal document)</option>
                <option value="company">Entire company — everyone can see it (e.g. policy, holiday list)</option>
                {directory?.items.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} — personal document
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Button onClick={() => void upload()} disabled={busy || !file} className="w-full">
            {busy ? 'Uploading…' : file ? `Upload “${name || file.name}”` : 'Choose a file first'}
          </Button>
        </div>
      </Modal>

      <Modal title="Edit document details" open={editing !== null} onClose={() => setEditing(null)}>
        <div className="space-y-3">
          <p className="text-sm text-ink-500">
            Change how this document is listed. The file itself stays as uploaded — to replace it, delete this
            entry and upload the new version.
          </p>
          <ErrorNote error={editError} />
          <Field label="Display name">
            <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          </Field>
          <Field label="Folder" hint="where it appears in the employee's documents">
            <Select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
              {(folderInfo?.folders ?? [{ name: editForm.category }]).map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
          {isCompanyAdmin && (
            <Field label="Belongs to" hint="a personal document is visible only to that person and HR/Admin">
              <Select value={editForm.target} onChange={(e) => setEditForm({ ...editForm, target: e.target.value })}>
                <option value="company">Entire company — everyone can see it</option>
                {directory?.items.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} — personal document
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Button onClick={() => void saveEdit()} disabled={busy || !editForm.name.trim()} className="w-full">
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
