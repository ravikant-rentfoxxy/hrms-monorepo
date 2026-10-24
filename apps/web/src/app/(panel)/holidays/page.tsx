'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, DatePicker, Empty, ErrorNote, Field, Input, Modal, PageHeader, Spinner, Table, Td, Textarea,
} from '@/components/ui';

interface Holiday {
  id: string;
  name: string;
  date: string;
  optional: boolean;
}

/** Parses "YYYY-MM-DD, Name[, optional]" lines; returns items and per-line errors. */
function parseBulk(text: string) {
  const items: { date: string; name: string; optional: boolean }[] = [];
  const errors: string[] = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const [date, ...rest] = line.split(',').map((s) => s.trim());
    let optional = false;
    if (rest.length > 1 && /^optional$/i.test(rest[rest.length - 1] ?? '')) {
      optional = true;
      rest.pop();
    }
    const name = rest.join(', ');
    const valid = !!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T00:00:00Z`).getTime());
    if (!valid) errors.push(`Line ${i + 1}: date must be YYYY-MM-DD`);
    else if (name.length < 2) errors.push(`Line ${i + 1}: holiday name is missing`);
    else items.push({ date, name, optional });
  });
  return { items, errors };
}

function BulkModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { items, errors } = parseBulk(text);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ created: number; skipped: number }>('/holidays', { method: 'POST', body: items });
      setResult(`Added ${res.created} holiday(s)${res.skipped ? `, skipped ${res.skipped} already present` : ''}.`);
      setText('');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Bulk add holidays" open onClose={onClose} wide>
      <div className="space-y-3">
        <ErrorNote error={error ?? (errors.length ? errors.slice(0, 5).join(' · ') : null)} />
        {result && <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">{result}</p>}
        <Field label="One holiday per line" hint='Format: "YYYY-MM-DD, Name". Add ", optional" at the end for an optional holiday. Up to 100 lines.'>
          <Textarea
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'2026-01-26, Republic Day\n2026-03-04, Holi\n2026-08-15, Independence Day\n2026-11-09, Govardhan Puja, optional'}
            className="font-mono text-xs"
          />
        </Field>
        <Button onClick={() => void submit()} disabled={busy || items.length === 0 || errors.length > 0 || items.length > 100} className="w-full">
          Add {items.length || ''} holiday{items.length === 1 ? '' : 's'}
        </Button>
      </div>
    </Modal>
  );
}

function EditModal({ holiday, onClose, onDone }: { holiday: Holiday; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: holiday.name, date: holiday.date.slice(0, 10), optional: holiday.optional });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await api(`/holidays/${holiday.id}`, { method: 'PATCH', body: form });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Edit holiday" open onClose={onClose}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <Field label="Holiday name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Date">
          <DatePicker value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.optional} onChange={(e) => setForm({ ...form, optional: e.target.checked })} />
          Optional holiday
        </label>
        <Button onClick={() => void save()} disabled={busy || form.name.trim().length < 2 || !form.date} className="w-full">
          Save
        </Button>
      </div>
    </Modal>
  );
}

export default function HolidaysPage() {
  const { isCompanyAdmin } = useAuth();
  const year = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(String(year));
  const { data, loading, reload } = useFetch<Holiday[]>(`/holidays?year=${selectedYear}`);
  const [form, setForm] = useState({ name: '', date: '', optional: false });
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const add = async () => {
    setError(null);
    try {
      await api('/holidays', { method: 'POST', body: form });
      setForm({ name: '', date: '', optional: false });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const remove = async (h: Holiday) => {
    if (!window.confirm(`Remove ${h.name}?`)) return;
    setError(null);
    try {
      await api(`/holidays/${h.id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div>
      <PageHeader
        title="Holidays"
        actions={
          <>
            {isCompanyAdmin && (
              <Button variant="secondary" onClick={() => setBulkOpen(true)}>
                Bulk add
              </Button>
            )}
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              {[year - 1, year, year + 1].map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </>
        }
      />

      {isCompanyAdmin && (
        <Card className="mb-4 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Holiday name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Diwali" />
            </Field>
            <Field label="Date">
              <DatePicker value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
            </Field>
            <label className="mb-2 flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={form.optional} onChange={(e) => setForm({ ...form, optional: e.target.checked })} />
              Optional
            </label>
            <Button onClick={() => void add()} disabled={!form.name || !form.date}>
              Add holiday
            </Button>
          </div>
          <p className="mt-3 text-xs text-slate-400">Public holidays are excluded from leave day counts and can be claimed as comp-off when worked.</p>
        </Card>
      )}
      <div className="mb-3">
        <ErrorNote error={error} />
      </div>

      <Card>
        {loading ? (
          <Spinner />
        ) : !data || data.length === 0 ? (
          <Empty message={`No holidays configured for ${selectedYear}`} />
        ) : (
          <Table headers={['Holiday', 'Date', 'Day', 'Type', ...(isCompanyAdmin ? [''] : [])]}>
            {data.map((h) => (
              <tr key={h.id}>
                <Td className="font-medium text-slate-900">{h.name}</Td>
                <Td>{fmtDate(h.date)}</Td>
                <Td>{new Date(h.date).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })}</Td>
                <Td>{h.optional ? <Badge tone="slate">optional</Badge> : <Badge tone="blue">public</Badge>}</Td>
                {isCompanyAdmin && (
                  <Td>
                    <div className="flex gap-1">
                      <Button variant="ghost" onClick={() => setEditing(h)}>
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => void remove(h)}>
                        Remove
                      </Button>
                    </div>
                  </Td>
                )}
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {editing && <EditModal holiday={editing} onClose={() => setEditing(null)} onDone={reload} />}
      {bulkOpen && <BulkModal onClose={() => setBulkOpen(false)} onDone={reload} />}
    </div>
  );
}
