'use client';

import { useState, type ReactNode } from 'react';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, DatePicker, ErrorNote, Field, Input, Modal, Select, Spinner, Textarea } from './ui';
import { api } from '@/lib/api';

export const ASSET_CATEGORIES = ['Laptop', 'Desktop', 'Monitor', 'Mobile', 'Tablet', 'Accessory', 'ID Card', 'Access Card', 'Vehicle', 'Furniture', 'Other'];

/** Quick-add rows for the usual joiner kit. */
const ASSET_PRESETS: { name: string; category: string }[] = [
  { name: 'Laptop', category: 'Laptop' },
  { name: 'Charger', category: 'Accessory' },
  { name: 'Mouse', category: 'Accessory' },
  { name: 'Headphones', category: 'Accessory' },
  { name: 'Monitor', category: 'Monitor' },
  { name: 'ID card', category: 'ID Card' },
  { name: 'Access card', category: 'Access Card' },
];

export interface NewAssetItem {
  name: string;
  category: string;
  count: number;
  /** Multi-line; saved on each unit created from the row. */
  description?: string;
  /** YYYY-MM-DD; null = today, which keeps the exact time of issue. */
  issuedOn?: string | null;
}

interface Row {
  name: string;
  category: string;
  count: string;
  description: string;
  issuedOn: string;
}

/** Today as the local calendar day the date pickers use. */
const today = () => localDay(new Date().toISOString());

interface HeldAsset {
  id: string;
  asset: { tag: string; name: string };
}

const errText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');

/**
 * Rows of asset name + type + count + issue date + description. Submitting
 * creates every unit under Assets (own AST-… tag) and issues it to this
 * employee only. `submit` posts the rows (onboarding task or employee profile).
 */
export function IssueAssetsDialog({
  employeeId,
  employeeName,
  submit,
  onClose,
  onDone,
  children,
}: {
  employeeId: string;
  employeeName: string;
  submit: (items: NewAssetItem[]) => Promise<unknown>;
  onClose: () => void;
  onDone: () => void;
  /** Extra controls above the submit button (e.g. "also complete the task"). */
  children?: ReactNode;
}) {
  const held = useFetch<HeldAsset[]>(`/assets/employee/${employeeId}`);
  const [rows, setRows] = useState<Row[]>(() => [{ name: 'Laptop', category: 'Laptop', count: '1', description: '', issuedOn: today() }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = (r: Partial<Row> = {}) => setRows([...rows, { name: '', category: 'Other', count: '1', description: '', issuedOn: rows[rows.length - 1]?.issuedOn || today(), ...r }]);
  const valid = rows.length > 0 && rows.every((r) => !!r.issuedOn) && rows.every((r) => r.name.trim().length >= 2 && Number(r.count) >= 1 && Number(r.count) <= 20);
  const total = rows.reduce((n, r) => n + (Number(r.count) || 0), 0);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await submit(
        rows.map((r) => ({
          name: r.name.trim(),
          category: r.category,
          count: Number(r.count),
          ...(r.description.trim() ? { description: r.description.trim() } : {}),
          issuedOn: r.issuedOn === today() ? null : r.issuedOn,
        }))
      );
      onDone();
      onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Issue assets — ${employeeName}`} open onClose={onClose} wide>
      <div className="space-y-4">
        <ErrorNote error={error} />
        <p className="text-sm text-ink-500">
          Add each item and how many. Every unit is created under Assets with its own tag (AST-…) and issued to {employeeName} only.
        </p>

        <div className="flex flex-wrap gap-1.5">
          <span className="self-center text-xs text-ink-400">Quick add:</span>
          {ASSET_PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => add(p)}
              className="rounded-full bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-600 hover:bg-brand-50 hover:text-brand-700"
            >
              + {p.name}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="rounded-2xl border border-ink-200/80 bg-white">
              {/* No overflow clipping on the card — the date picker's calendar opens over it. */}
              <div className="flex items-center justify-between gap-3 rounded-t-2xl border-b border-ink-100 bg-ink-50/60 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                    {i + 1}
                  </span>
                  <span className={`truncate text-sm font-semibold ${r.name.trim() ? 'text-ink-900' : 'text-ink-400'}`}>
                    {r.name.trim() || 'New item'}
                  </span>
                  {Number(r.count) > 1 && <Badge tone="blue">× {r.count}</Badge>}
                </div>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-ink-500 hover:bg-rose-50 hover:text-rose-600"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid gap-3 p-4 sm:grid-cols-6">
                <div className="sm:col-span-3">
                  <Field label="Asset name" required>
                    <Input value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="e.g. MacBook Air M3" />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Type">
                    <Select value={r.category} onChange={(e) => set(i, { category: e.target.value })}>
                      {ASSET_CATEGORIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="sm:col-span-1">
                  <Field label="Qty">
                    <Input type="number" min={1} max={20} value={r.count} onChange={(e) => set(i, { count: e.target.value })} />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Issued on" required>
                    <DatePicker value={r.issuedOn} onChange={(v) => set(i, { issuedOn: v })} />
                  </Field>
                </div>
                <div className="sm:col-span-4">
                  <Field label="Description">
                    {/* One line to start; grows with what is typed. */}
                    <Textarea
                      rows={1}
                      maxLength={1000}
                      value={r.description}
                      onChange={(e) => set(i, { description: e.target.value })}
                      placeholder="Serial no., configuration, accessories…"
                      className="max-h-40 min-h-[42px] resize-none [field-sizing:content]"
                    />
                  </Field>
                </div>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => add()}
            className="w-full rounded-2xl border border-dashed border-ink-300 py-3 text-sm font-semibold text-brand-700 transition-colors hover:border-brand-400 hover:bg-brand-50/50"
          >
            + Add another item
          </button>
        </div>

        {(held.data?.length ?? 0) > 0 && (
          <div className="rounded-xl bg-ink-50 p-3">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Already with {employeeName}</p>
            <div className="flex flex-wrap gap-1.5">
              {held.data?.map((h) => (
                <Badge key={h.id} tone="slate">
                  {h.asset.name} · {h.asset.tag}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {children}
        <Button onClick={() => void save()} disabled={busy || !valid} className="w-full">
          {busy ? 'Issuing…' : `Issue ${total} asset${total === 1 ? '' : 's'} to ${employeeName}`}
        </Button>
      </div>
    </Modal>
  );
}

export interface EditableAsset {
  id: string;
  tag: string;
  name: string;
  category: string;
  serialNumber: string;
  brand?: string;
  model?: string;
  purchaseDate?: string | null;
  cost: number;
  notes?: string;
}

/**
 * Edit one asset's details (name, type, serial, brand / model, purchase date,
 * cost, description). Opened on an issue (`assignment`), it also edits the
 * issue date.
 */
export function EditAssetDialog({
  asset,
  assignment,
  onClose,
  onSaved,
}: {
  asset: EditableAsset;
  assignment?: { id: string; issuedOn: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const initialIssued = localDay(assignment?.issuedOn);
  const [issuedOn, setIssuedOn] = useState(initialIssued);
  const [form, setForm] = useState({
    name: asset.name,
    category: asset.category,
    serialNumber: asset.serialNumber ?? '',
    brand: asset.brand ?? '',
    model: asset.model ?? '',
    purchaseDate: localDay(asset.purchaseDate),
    cost: asset.cost ? String(asset.cost) : '',
    notes: asset.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/assets/${asset.id}`, { method: 'PATCH', body: { ...form, cost: Number(form.cost) || 0, purchaseDate: form.purchaseDate || null } });
      if (assignment && issuedOn !== initialIssued) {
        await api(`/assets/assignments/${assignment.id}/dates`, { method: 'PATCH', body: { issuedOn } });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Edit asset — ${asset.tag}`} open onClose={onClose}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <Field label="Asset name" required>
          <Input value={form.name} onChange={set('name')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={form.category} onChange={set('category')}>
              {ASSET_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Serial no.">
            <Input value={form.serialNumber} onChange={set('serialNumber')} />
          </Field>
          <Field label="Brand">
            <Input value={form.brand} onChange={set('brand')} placeholder="e.g. Apple" />
          </Field>
          <Field label="Model">
            <Input value={form.model} onChange={set('model')} placeholder="e.g. MacBook Air M3" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {assignment && (
            <Field label="Issued on" required>
              <DatePicker value={issuedOn} onChange={setIssuedOn} />
            </Field>
          )}
          <Field label="Purchase date">
            <DatePicker value={form.purchaseDate} onChange={(v) => setForm({ ...form, purchaseDate: v })} clearable />
          </Field>
          <Field label="Cost (₹)">
            <Input type="number" min={0} value={form.cost} onChange={set('cost')} />
          </Field>
        </div>
        <Field label="Description">
          <Textarea rows={3} maxLength={1000} value={form.notes} onChange={set('notes')} placeholder="Configuration, accessories, condition…" />
        </Field>
        <Button onClick={() => void save()} disabled={busy || form.name.trim().length < 2 || (!!assignment && !issuedOn)} className="w-full">
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </Modal>
  );
}

/** A stored date / timestamp as the local calendar day (YYYY-MM-DD) the date pickers use. */
export function localDay(d: string | null | undefined): string {
  if (!d) return '';
  const t = new Date(d);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

export interface DatedAssignment {
  id: string;
  issuedOn: string;
  expectedReturn: string | null;
  returnedOn: string | null;
  asset: { name: string; tag: string };
  employee?: { name: string };
}

/**
 * Correct when an asset was issued, when it should come back and (once
 * returned) when it came back. The API rejects future dates, a return before
 * the issue and overlaps with the asset's other issues.
 */
export function EditAssignmentDatesDialog({ assignment, onClose, onSaved }: { assignment: DatedAssignment; onClose: () => void; onSaved: () => void }) {
  const initial = {
    issuedOn: localDay(assignment.issuedOn),
    expectedReturn: localDay(assignment.expectedReturn),
    returnedOn: localDay(assignment.returnedOn),
  };
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const returned = !!assignment.returnedOn;
  // Only what changed is sent, so an untouched timestamp keeps its time of day.
  const changes = {
    ...(form.issuedOn !== initial.issuedOn ? { issuedOn: form.issuedOn } : {}),
    ...(form.expectedReturn !== initial.expectedReturn ? { expectedReturn: form.expectedReturn || null } : {}),
    ...(returned && form.returnedOn !== initial.returnedOn ? { returnedOn: form.returnedOn } : {}),
  };
  const localError =
    !form.issuedOn || (returned && !form.returnedOn)
      ? null
      : returned && form.returnedOn < form.issuedOn
        ? 'The return date cannot be before the issue date.'
        : form.expectedReturn && form.expectedReturn < form.issuedOn
          ? 'The return-by date cannot be before the issue date.'
          : null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/assets/assignments/${assignment.id}/dates`, { method: 'PATCH', body: changes });
      onSaved();
      onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Edit dates — ${assignment.asset.name} (${assignment.asset.tag})`} open onClose={onClose}>
      <div className="space-y-3">
        {assignment.employee && <p className="text-sm text-ink-500">Issued to {assignment.employee.name}.</p>}
        <ErrorNote error={error ?? localError} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Issued on" required>
            <DatePicker value={form.issuedOn} onChange={(v) => setForm({ ...form, issuedOn: v })} />
          </Field>
          <Field label="Return by">
            <DatePicker value={form.expectedReturn} onChange={(v) => setForm({ ...form, expectedReturn: v })} clearable />
          </Field>
          {returned && (
            <Field label="Returned on" required>
              <DatePicker value={form.returnedOn} onChange={(v) => setForm({ ...form, returnedOn: v })} />
            </Field>
          )}
        </div>
        {!returned && <p className="text-xs text-ink-500">Still with the employee — record the return from Assets to set a return date.</p>}
        <Button onClick={() => void save()} disabled={busy || !!localError || Object.keys(changes).length === 0} className="w-full">
          {busy ? 'Saving…' : 'Save dates'}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Delete with eyes open: shows how often the asset was issued and who has it
 * now. An issued asset goes together with its history (kept in the audit log);
 * an asset that is only out of use can be retired instead.
 */
export function DeleteAssetDialog({
  asset,
  onClose,
  onDone,
}: {
  asset: { id: string; tag: string; name: string; status: string; holder: { name: string } | null };
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: history, loading } = useFetch<unknown[]>(`/assets/${asset.id}/history`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issued = history?.length ?? 0;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
      onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Delete ${asset.name} (${asset.tag})?`} open onClose={() => !busy && onClose()}>
      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <ErrorNote error={error} />
          {issued === 0 ? (
            <p className="text-sm text-ink-600">This asset was never issued. It will be removed from the inventory permanently.</p>
          ) : (
            <>
              <p className="text-sm text-ink-600">
                It was issued {issued === 1 ? 'once' : `${issued} times`}
                {asset.holder ? (
                  <>
                    {' '}
                    and is <span className="font-semibold text-ink-900">with {asset.holder.name} now</span> — it will no longer
                    count against their exit clearance
                  </>
                ) : null}
                . Deleting removes the asset <span className="font-semibold text-ink-900">and its whole issue history</span> from
                Assets and the employee&apos;s Assets tab. A copy of the history is kept in the audit log.
              </p>
              {!asset.holder && asset.status !== 'RETIRED' && (
                <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
                  Just out of use? <span className="font-semibold">Retire</span> it instead — it stays in the history but can&apos;t be issued.
                </p>
              )}
            </>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            {issued > 0 && !asset.holder && asset.status !== 'RETIRED' && (
              <Button variant="secondary" disabled={busy} onClick={() => void run(() => api(`/assets/${asset.id}`, { method: 'PATCH', body: { status: 'RETIRED' } }))}>
                Retire instead
              </Button>
            )}
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void run(() => api(`/assets/${asset.id}${issued > 0 ? '?withHistory=true' : ''}`, { method: 'DELETE' }))}
            >
              {busy ? 'Deleting…' : issued > 0 ? 'Delete with history' : 'Delete'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
