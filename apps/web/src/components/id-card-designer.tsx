'use client';

import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFetch } from '@/lib/useFetch';
import { errMsg } from './engage';
import { Button, Card, ErrorNote, Input, Spinner, Textarea } from './ui';
import {
  CARD_FIELD_LABELS, IdCard, MAX_CARD_FIELDS, blendsIn, contrast,
  type CardDesign, type CardFieldKey, type CardLayout, type CardStyle, type IdCardData, type PhotoShape,
} from './id-card';

const HEX = /^#[0-9a-fA-F]{6}$/;

/** One-click starting points; every colour stays editable afterwards. */
const THEMES: { name: string; style: Pick<CardStyle, 'headerColor' | 'headerColor2' | 'bodyColor' | 'accentColor' | 'footerColor'> }[] = [
  { name: 'Emerald', style: { headerColor: '#059571', headerColor2: '', bodyColor: '#FFFFFF', accentColor: '#059571', footerColor: '#059571' } },
  { name: 'Corporate', style: { headerColor: '#1E3A8A', headerColor2: '#2563EB', bodyColor: '#FFFFFF', accentColor: '#2563EB', footerColor: '#1E3A8A' } },
  { name: 'Midnight', style: { headerColor: '#0F172A', headerColor2: '#334155', bodyColor: '#111827', accentColor: '#38BDF8', footerColor: '#38BDF8' } },
  { name: 'Sunset', style: { headerColor: '#F97316', headerColor2: '#DB2777', bodyColor: '#FFFFFF', accentColor: '#DB2777', footerColor: '#F97316' } },
  { name: 'Minimal', style: { headerColor: '#F1F5F9', headerColor2: '', bodyColor: '#FFFFFF', accentColor: '#0F172A', footerColor: '#0F172A' } },
];

/** Shown first and tagged in the picker — what most ID cards carry. */
const RECOMMENDED: CardFieldKey[] = ['department', 'bloodGroup', 'emergencyContact', 'validTill'];
const ALL_FIELDS = Object.keys(CARD_FIELD_LABELS) as CardFieldKey[];
const FIELD_NAMES: Partial<Record<CardFieldKey, string>> = {
  emergencyContact: 'Emergency contact',
  joiningDate: 'Joining date',
  employmentType: 'Employment type',
  manager: 'Reporting manager',
};
const fieldName = (k: CardFieldKey) => FIELD_NAMES[k] ?? CARD_FIELD_LABELS[k];

const VALIDITY = [
  { months: 0, label: 'No expiry' },
  { months: 12, label: '1 year' },
  { months: 24, label: '2 years' },
  { months: 36, label: '3 years' },
  { months: 60, label: '5 years' },
];

/** Sample details for the preview — the real card fills in each employee's own. */
const SAMPLE: Record<CardFieldKey, string> = {
  department: 'Engineering',
  bloodGroup: 'B+',
  emergencyContact: '+91 91234 56780',
  validTill: '',
  joiningDate: '2024-04-01',
  phone: '+91 98765 43210',
  email: 'priya.nair@company.com',
  office: 'Head office',
  workMode: 'Office',
  employmentType: 'Full-time',
  grade: 'L4',
  manager: 'Rahul Verma',
  dateOfBirth: '1995-08-14',
};

/** Company-wide ID card design. The logo comes from the letterhead section below. */
export function IdCardDesigner() {
  const { data, loading, error, setData } = useFetch<CardDesign>('/id-cards/settings');
  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorNote error={error ?? 'Not found'} />;
  return <DesignerForm initial={data} onSaved={setData} />;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-t border-ink-100 pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-[13px] font-semibold text-ink-900">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ColorField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="color"
        value={HEX.test(value) ? value : '#000000'}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-ink-200 bg-white p-1"
        aria-label={label}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-ink-700">{label}</span>
        <input
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.trim())}
          className={`w-full bg-transparent font-mono text-xs outline-none ${HEX.test(value) ? 'text-ink-500' : 'text-rose-600'}`}
          aria-label={`${label} hex`}
        />
      </span>
    </label>
  );
}

function Choice<T extends string>({ options, value, onChange, disabled }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; disabled: boolean }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`flex items-center justify-center gap-2 rounded-xl border px-2 py-2 text-xs font-medium ${
            value === o.value ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-ink-200 text-ink-600 hover:bg-ink-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function DesignerForm({ initial, onSaved }: { initial: CardDesign; onSaved: (d: CardDesign) => void }) {
  const { isCompanyAdmin: canEdit } = useAuth();
  const locked = !canEdit;
  const [layout, setLayout] = useState<CardLayout>(initial.layout);
  const [fields, setFields] = useState<CardFieldKey[]>(initial.fields);
  const [backNote, setBackNote] = useState(initial.backNote);
  const [style, setStyle] = useState<CardStyle>(initial.style);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const touch = () => setSaved(false);
  const patch = (p: Partial<CardStyle>) => {
    touch();
    setStyle((s) => ({ ...s, ...p }));
  };
  const colors = [style.headerColor, style.bodyColor, style.accentColor, style.footerColor, ...(style.headerColor2 ? [style.headerColor2] : [])];
  const valid = colors.every((c) => HEX.test(c));
  // Clashes the card works around (grey labels, a hairline instead of a band) — say so, so it isn't a surprise.
  const clashes = !valid
    ? []
    : [
        contrast(style.accentColor, style.bodyColor) < 3 && 'The accent is too faint on the card body — labels and the employee code print in grey instead.',
        !style.headerColor2 && blendsIn(style.headerColor, style.bodyColor) && 'The top band is the same colour as the card body, so it only shows as a thin line.',
        blendsIn(style.footerColor, style.bodyColor) && 'The bottom stripe is the same colour as the card body, so it only shows as a thin line.',
      ].filter((m): m is string => !!m);

  const add = (k: CardFieldKey) => {
    touch();
    setFields((f) => (f.length < MAX_CARD_FIELDS && !f.includes(k) ? [...f, k] : f));
  };
  const remove = (k: CardFieldKey) => {
    touch();
    setFields((f) => f.filter((x) => x !== k));
  };
  const move = (i: number, dir: -1 | 1) => {
    touch();
    setFields((f) => {
      const next = [...f];
      [next[i], next[i + dir]] = [next[i + dir], next[i]];
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api<CardDesign>('/id-cards/settings', {
        method: 'PUT',
        // brandColor follows the top band so older screens using it stay in step.
        body: { brandColor: style.headerColor, idCardLayout: layout, idCardFields: fields, idCardBackNote: backNote, idCardStyle: style },
      });
      onSaved(d);
      setSaved(true);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const validTill = (() => {
    if (!style.validityMonths) return '';
    const d = new Date();
    d.setMonth(d.getMonth() + style.validityMonths);
    return d.toISOString().slice(0, 10);
  })();
  const sample = { ...SAMPLE, validTill };
  const preview: IdCardData = {
    ...initial,
    layout,
    fields,
    backNote,
    style: valid ? style : initial.style,
    employee: {
      id: 'preview',
      name: 'Priya Nair',
      employeeCode: 'EMP-0042',
      designation: 'Senior Software Engineer',
      avatarColor: '#64748B',
      isActive: true,
      photoUrl: null,
      issuedOn: new Date().toISOString().slice(0, 10),
      expiresOn: validTill || null,
      fields: fields.filter((k) => sample[k]).map((key) => ({ key, value: sample[key] })),
    },
    verifyUrl: '',
    qr: null,
  };
  const available = [...RECOMMENDED, ...ALL_FIELDS.filter((k) => !RECOMMENDED.includes(k))].filter((k) => !fields.includes(k));

  return (
    <Card className="p-5">
      <ErrorNote error={error} />
      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Section title="Theme" hint="Start from a theme, then fine-tune any colour below">
            <div className="flex flex-wrap gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  disabled={locked}
                  onClick={() => patch(t.style)}
                  className="group flex items-center gap-2 rounded-full border border-ink-200 py-1 pl-1 pr-3 text-xs font-medium text-ink-700 hover:border-ink-300 hover:bg-ink-50"
                >
                  <span className="flex h-6 w-6 overflow-hidden rounded-full ring-1 ring-ink-200">
                    <span className="h-full w-1/2" style={{ background: t.style.headerColor2 ? `linear-gradient(${t.style.headerColor}, ${t.style.headerColor2})` : t.style.headerColor }} />
                    <span className="h-full w-1/2" style={{ background: t.style.accentColor }} />
                  </span>
                  {t.name}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Colours">
            <div className="grid grid-cols-2 gap-3">
              <ColorField label="Top band" value={style.headerColor} onChange={(v) => patch({ headerColor: v })} disabled={locked} />
              {style.headerColor2 ? (
                <ColorField label="Top band — gradient to" value={style.headerColor2} onChange={(v) => patch({ headerColor2: v })} disabled={locked} />
              ) : (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => patch({ headerColor2: style.accentColor === style.headerColor ? '#0F172A' : style.accentColor })}
                  className="rounded-lg border border-dashed border-ink-300 text-xs font-medium text-ink-500 hover:bg-ink-50"
                >
                  + Gradient
                </button>
              )}
              <ColorField label="Card body" value={style.bodyColor} onChange={(v) => patch({ bodyColor: v })} disabled={locked} />
              <ColorField label="Accent (labels, ID)" value={style.accentColor} onChange={(v) => patch({ accentColor: v })} disabled={locked} />
              <ColorField label="Bottom stripe" value={style.footerColor} onChange={(v) => patch({ footerColor: v })} disabled={locked} />
              {style.headerColor2 && (
                <button type="button" disabled={locked} onClick={() => patch({ headerColor2: '' })} className="text-left text-xs font-medium text-ink-500 hover:text-ink-800">
                  Remove gradient
                </button>
              )}
            </div>
            {!valid && <p className="mt-2 text-xs text-rose-600">Use 6-digit hex colours, like #059571.</p>}
            {clashes.map((m) => (
              <p key={m} className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {m}
              </p>
            ))}
          </Section>

          <Section title="Layout & photo">
            <div className="space-y-3">
              <Choice<CardLayout>
                disabled={locked}
                value={layout}
                onChange={(v) => {
                  touch();
                  setLayout(v);
                }}
                options={[
                  { value: 'VERTICAL', label: <><span className="inline-block h-4 w-3 rounded-sm border-2 border-current" /> Portrait</> },
                  { value: 'HORIZONTAL', label: <><span className="inline-block h-3 w-4 rounded-sm border-2 border-current" /> Landscape</> },
                ]}
              />
              <Choice<PhotoShape>
                disabled={locked}
                value={style.photoShape}
                onChange={(v) => patch({ photoShape: v })}
                options={[
                  { value: 'ROUNDED', label: <><span className="inline-block h-3.5 w-3.5 rounded-[4px] border-2 border-current" /> Rounded</> },
                  { value: 'CIRCLE', label: <><span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current" /> Circle</> },
                  { value: 'SQUARE', label: <><span className="inline-block h-3.5 w-3.5 border-2 border-current" /> Square</> },
                ]}
              />
              <div>
                <span className="mb-1 block text-xs font-medium text-ink-700">Title under the logo</span>
                <Input value={style.title} maxLength={30} disabled={locked} onChange={(e) => patch({ title: e.target.value })} placeholder="e.g. EMPLOYEE ID CARD (optional)" />
              </div>
            </div>
          </Section>

          <Section title={`Details on the front (${fields.length}/${MAX_CARD_FIELDS})`} hint="Photo, name, designation and employee code always print. Use the arrows to set the order.">
            {fields.length > 0 && (
              <ol className="mb-3 divide-y divide-ink-100 rounded-xl border border-ink-200">
                {fields.map((k, i) => (
                  <li key={k} className="flex items-center gap-2 px-3 py-1.5 text-sm text-ink-800">
                    <span className="w-4 text-xs text-ink-400">{i + 1}</span>
                    <span className="flex-1">{fieldName(k)}</span>
                    {!locked && (
                      <>
                        <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="px-1 text-ink-400 hover:text-ink-800 disabled:opacity-30" aria-label={`Move ${fieldName(k)} up`}>↑</button>
                        <button type="button" disabled={i === fields.length - 1} onClick={() => move(i, 1)} className="px-1 text-ink-400 hover:text-ink-800 disabled:opacity-30" aria-label={`Move ${fieldName(k)} down`}>↓</button>
                        <button type="button" onClick={() => remove(k)} className="px-1 text-ink-400 hover:text-rose-600" aria-label={`Remove ${fieldName(k)}`}>✕</button>
                      </>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {!locked && (
              <div className="flex flex-wrap gap-1.5">
                {available.map((k) => (
                  <button
                    key={k}
                    type="button"
                    disabled={fields.length >= MAX_CARD_FIELDS}
                    onClick={() => add(k)}
                    className="rounded-full border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-40"
                  >
                    + {fieldName(k)}
                    {RECOMMENDED.includes(k) && <span className="ml-1 text-[10px] font-semibold text-brand-600">recommended</span>}
                  </button>
                ))}
              </div>
            )}
            {fields.includes('validTill') && !style.validityMonths && (
              <p className="mt-2 text-xs text-amber-700">“Valid till” only prints once you choose a validity below.</p>
            )}
            {fields.includes('dateOfBirth') && (
              <p className="mt-2 text-xs text-amber-700">Date of birth is personal data — anyone who finds the card can read it.</p>
            )}
          </Section>

          <Section title="Back of the card" hint="The verification QR code always prints">
            <div className="space-y-2">
              {(
                [
                  ['showAddress', 'Company address'],
                  ['showContact', 'Company phone & email'],
                  ['showSignatory', `Authorised signatory${initial.company.signatoryName ? ` (${initial.company.signatoryName})` : ' — set it in the letterhead below'}`],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm text-ink-700">
                  <input type="checkbox" disabled={locked} checked={style[key]} onChange={(e) => patch({ [key]: e.target.checked })} />
                  {label}
                </label>
              ))}
              <Textarea
                rows={2}
                maxLength={200}
                disabled={locked}
                value={backNote}
                onChange={(e) => {
                  touch();
                  setBackNote(e.target.value);
                }}
                placeholder="Note — e.g. If found, please return to HR, 4th floor, Tower B. (empty = standard note)"
              />
            </div>
          </Section>

          <Section title="Validity" hint="Counted from the day each card is issued. An expired card's QR shows “Expired”; Reissue renews it.">
            <Choice<string>
              disabled={locked}
              value={String(style.validityMonths)}
              onChange={(v) => patch({ validityMonths: Number(v) })}
              options={VALIDITY.map((v) => ({ value: String(v.months), label: v.label }))}
            />
          </Section>

          {canEdit ? (
            <div className="flex items-center gap-3 border-t border-ink-100 pt-4">
              <Button disabled={busy || !valid} onClick={() => void save()}>
                Save design
              </Button>
              {saved && <span className="text-sm text-emerald-600">Saved — every card uses it now.</span>}
            </div>
          ) : (
            <p className="text-xs text-ink-500">Only Admin or HR can change the card design.</p>
          )}
        </div>

        <div className="min-w-0">
          <div className="xl:sticky xl:top-24">
            <p className="mb-3 text-xs font-medium text-ink-500">
              Preview with sample details{initial.company.logoUrl ? '' : ' — upload a logo below to replace the company name'}
            </p>
            <div className="overflow-x-auto rounded-2xl bg-ink-50 p-5">
              <IdCard data={preview} />
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
