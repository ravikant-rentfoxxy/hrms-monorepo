'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Td,
} from '@/components/ui';
import { EmployeeSelect, errText, humanize, openUrl, useEmployees } from '@/components/lifecycle';

interface Template {
  id: string;
  type: string;
  name: string;
  subject: string;
  body: string;
  isActive: boolean;
  updatedAt: string;
}

interface Letter {
  id: string;
  type: string;
  title: string;
  createdAt: string;
  employee: { id: string; name: string; employeeCode: string } | null;
}

interface Meta {
  placeholders: { key: string; description: string }[];
  types: string[];
}

interface Preview {
  subject: string;
  body: string;
  missing: string[];
  sample: boolean;
}

/** Rendered letter as it will read on paper. */
function PreviewPane({ preview, loading }: { preview: Preview | null; loading?: boolean }) {
  return (
    <div className="h-full min-h-72 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      {loading && !preview ? (
        <Spinner />
      ) : !preview ? (
        <p className="text-sm text-slate-400">Preview appears here</p>
      ) : (
        <div className="space-y-3 text-[13px] leading-relaxed text-slate-700">
          {preview.sample && <Badge tone="amber">sample data</Badge>}
          {preview.subject && <p className="font-semibold text-slate-900">Subject: {preview.subject}</p>}
          {preview.body.split(/\n\s*\n/).map((p, i) => (
            <p key={i} className="whitespace-pre-line">
              {p}
            </p>
          ))}
          {preview.missing.length > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              No value for: {preview.missing.map((m) => `{{${m}}}`).join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TemplateEditor({
  template,
  meta,
  onClose,
  onDone,
}: {
  template: Template | null;
  meta: Meta;
  onClose: () => void;
  onDone: () => void;
}) {
  const employees = useEmployees();
  const [form, setForm] = useState({
    type: template?.type ?? 'CUSTOM',
    name: template?.name ?? '',
    subject: template?.subject ?? '',
    body: template?.body ?? '',
    isActive: template?.isActive ?? true,
  });
  const [employeeId, setEmployeeId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Live preview, debounced while typing.
  useEffect(() => {
    const t = setTimeout(() => {
      api<Preview>('/letters/preview', {
        method: 'POST',
        body: { subject: form.subject, body: form.body, ...(employeeId ? { employeeId } : {}) },
      })
        .then(setPreview)
        .catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [form.subject, form.body, employeeId]);

  const insert = (key: string) => {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) return setForm({ ...form, body: form.body + token });
    const start = el.selectionStart ?? form.body.length;
    const end = el.selectionEnd ?? start;
    const body = form.body.slice(0, start) + token + form.body.slice(end);
    setForm({ ...form, body });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      if (template) await api(`/letters/templates/${template.id}`, { method: 'PATCH', body: form });
      else await api('/letters/templates', { method: 'POST', body: form });
      onDone();
      onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={template ? `Edit “${template.name}”` : 'New letter template'} open onClose={onClose} wide>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Letter type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {meta.types.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Template name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
        </div>
        <Field label="Subject">
          <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        </Field>
        <Field label="Insert a placeholder" hint="Click to insert at the cursor. Leave a blank line between paragraphs.">
          <div className="flex flex-wrap gap-1.5">
            {meta.placeholders.map((p) => (
              <button
                key={p.key}
                type="button"
                title={p.description}
                onClick={() => insert(p.key)}
                className="rounded-md bg-indigo-50 px-2 py-0.5 font-mono text-[11px] text-indigo-700 hover:bg-indigo-100"
              >
                {`{{${p.key}}}`}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid gap-3 lg:grid-cols-2">
          <Field label="Body">
            {/* Plain textarea (the shared one does not forward refs) — needed to insert at the cursor. */}
            <textarea
              ref={bodyRef}
              rows={16}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 font-mono text-[12px] text-slate-900 shadow-sm transition-colors focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-500/10"
            />
          </Field>
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Live preview</span>
              <div className="w-48">
                <EmployeeSelect employees={employees} value={employeeId} onChange={setEmployeeId} placeholder="Sample employee" />
              </div>
            </div>
            <PreviewPane preview={preview} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active
        </label>
        <Button onClick={() => void save()} disabled={busy || form.name.trim().length < 2 || form.body.trim().length < 10} className="w-full">
          {busy ? 'Saving…' : 'Save template'}
        </Button>
      </div>
    </Modal>
  );
}

function GeneratePanel({ templates, onGenerated }: { templates: Template[]; onGenerated: () => void }) {
  const employees = useEmployees();
  const active = templates.filter((t) => t.isActive);
  const [templateId, setTemplateId] = useState(active[0]?.id ?? '');
  const [employeeId, setEmployeeId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Letter | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!templateId || !employeeId) return;
    let live = true;
    api<Preview>('/letters/preview', { method: 'POST', body: { templateId, employeeId } })
      .then((p) => live && setPreview(p))
      .catch((err: unknown) => live && setError(errText(err)));
    return () => {
      live = false;
    };
  }, [templateId, employeeId]);

  const generate = async () => {
    setError(null);
    setBusy(true);
    try {
      const letter = await api<Letter>('/letters/generate', { method: 'POST', body: { templateId, employeeId } });
      setDone(letter);
      onGenerated();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const download = async (id: string) => {
    const { url } = await api<{ url: string }>(`/letters/${id}/download?inline=true`);
    openUrl(url);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
      <Card className="h-fit space-y-3 p-5">
        <ErrorNote error={error} />
        <Field label="Template">
          <Select
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setDone(null);
            }}
          >
            {active.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({humanize(t.type)})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Employee">
          <EmployeeSelect
            employees={employees}
            value={employeeId}
            onChange={(id) => {
              setEmployeeId(id);
              setDone(null);
              if (!id) setPreview(null);
            }}
          />
        </Field>
        <Button onClick={() => void generate()} disabled={busy || !templateId || !employeeId} className="w-full">
          {busy ? 'Generating PDF…' : 'Generate letter'}
        </Button>
        {done && (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">
            Issued and filed in the employee&apos;s documents.{' '}
            <button className="font-semibold underline" onClick={() => void download(done.id)}>
              Open PDF
            </button>
          </div>
        )}
      </Card>
      <PreviewPane preview={employeeId ? preview : null} />
    </div>
  );
}

export default function LettersPage() {
  const { session, isCompanyAdmin } = useAuth();
  const tabs = isCompanyAdmin ? ['Issued letters', 'Generate', 'Templates'] : ['My letters'];
  const [tab, setTab] = useState(tabs[0] ?? 'My letters');
  const [filterEmployee, setFilterEmployee] = useState('');
  const employees = useEmployees(isCompanyAdmin);

  const meta = useFetch<Meta>(isCompanyAdmin ? '/letters/placeholders' : null);
  const templates = useFetch<Template[]>(isCompanyAdmin ? '/letters/templates' : null);
  const letters = useFetch<Letter[]>(
    tab === 'Issued letters' || tab === 'My letters' ? `/letters${filterEmployee ? `?employeeId=${filterEmployee}` : ''}` : null
  );
  const [editing, setEditing] = useState<Template | null | 'new'>(null);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);

  const open = async (id: string, inline: boolean) => {
    try {
      const { url } = await api<{ url: string }>(`/letters/${id}/download${inline ? '?inline=true' : ''}`);
      openUrl(url);
    } catch (err) {
      setError(errText(err));
    }
  };

  const remove = async (l: Letter) => {
    if (!window.confirm(`Delete “${l.title}”? The PDF is also removed from the employee's documents.`)) return;
    await api(`/letters/${l.id}`, { method: 'DELETE' });
    letters.reload();
  };

  const removeTemplate = async (t: Template) => {
    if (!window.confirm(`Delete template “${t.name}”?`)) return;
    await api(`/letters/templates/${t.id}`, { method: 'DELETE' });
    templates.reload();
  };

  const requestOwn = async (type: string) => {
    setError(null);
    setRequesting(type);
    try {
      const letter = await api<Letter>('/letters/request', { method: 'POST', body: { type } });
      letters.reload();
      await open(letter.id, true);
    } catch (err) {
      setError(errText(err));
    } finally {
      setRequesting(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Letters"
        subtitle={isCompanyAdmin ? 'Templates with placeholders, generated as PDF into employee documents' : 'Your HR letters and certificates'}
        actions={
          session?.employee ? (
            <>
              <Button variant="secondary" disabled={!!requesting} onClick={() => void requestOwn('SALARY_CERTIFICATE')}>
                {requesting === 'SALARY_CERTIFICATE' ? 'Generating…' : 'Salary certificate'}
              </Button>
              <Button variant="secondary" disabled={!!requesting} onClick={() => void requestOwn('EXPERIENCE')}>
                {requesting === 'EXPERIENCE' ? 'Generating…' : 'Experience letter'}
              </Button>
            </>
          ) : undefined
        }
      />
      {tabs.length > 1 && <Tabs tabs={tabs} active={tab} onChange={setTab} />}
      <ErrorNote error={error} />

      {(tab === 'Issued letters' || tab === 'My letters') && (
        <Card className={error ? 'mt-3' : ''}>
          {isCompanyAdmin && (
            <div className="flex items-center justify-end border-b border-slate-100 px-5 py-3">
              <div className="w-64">
                <EmployeeSelect employees={employees} value={filterEmployee} onChange={setFilterEmployee} placeholder="All employees" />
              </div>
            </div>
          )}
          {letters.loading ? (
            <Spinner />
          ) : !letters.data || letters.data.length === 0 ? (
            <Empty message="No letters issued yet" />
          ) : (
            <Table headers={['Letter', 'Type', ...(isCompanyAdmin ? ['Employee'] : []), 'Issued', '']}>
              {letters.data.map((l) => (
                <tr key={l.id}>
                  <Td className="font-medium text-slate-900">{l.title}</Td>
                  <Td>
                    <Badge tone="violet">{humanize(l.type)}</Badge>
                  </Td>
                  {isCompanyAdmin && <Td>{l.employee ? `${l.employee.name} (${l.employee.employeeCode})` : 'Candidate'}</Td>}
                  <Td>{fmtDate(l.createdAt)}</Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={() => void open(l.id, true)}>
                        View
                      </Button>
                      <Button variant="ghost" onClick={() => void open(l.id, false)}>
                        Download
                      </Button>
                      {isCompanyAdmin && (
                        <Button variant="ghost" onClick={() => void remove(l)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'Generate' &&
        (templates.data ? (
          <GeneratePanel templates={templates.data} onGenerated={letters.reload} />
        ) : (
          <Spinner />
        ))}

      {tab === 'Templates' && (
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Letter templates</h2>
            <Button variant="secondary" onClick={() => setEditing('new')} disabled={!meta.data}>
              + New template
            </Button>
          </div>
          {templates.loading ? (
            <Spinner />
          ) : !templates.data || templates.data.length === 0 ? (
            <Empty message="No templates" />
          ) : (
            <Table headers={['Template', 'Type', 'Subject', 'Status', 'Updated', '']}>
              {templates.data.map((t) => (
                <tr key={t.id}>
                  <Td className="font-medium text-slate-900">{t.name}</Td>
                  <Td>
                    <Badge tone="violet">{humanize(t.type)}</Badge>
                  </Td>
                  <Td className="max-w-64 truncate">{t.subject || '—'}</Td>
                  <Td>
                    <Badge tone={t.isActive ? 'green' : 'slate'}>{t.isActive ? 'Active' : 'Inactive'}</Badge>
                  </Td>
                  <Td>{fmtDate(t.updatedAt)}</Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={() => setEditing(t)} disabled={!meta.data}>
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

      {editing && meta.data && (
        <TemplateEditor
          template={editing === 'new' ? null : editing}
          meta={meta.data}
          onClose={() => setEditing(null)}
          onDone={templates.reload}
        />
      )}
    </div>
  );
}
