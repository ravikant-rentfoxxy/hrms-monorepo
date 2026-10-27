'use client';

import { useRef, useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { errMsg } from './engage';
import { Button, Card, ErrorNote, Modal, Spinner } from './ui';

export type CardLayout = 'VERTICAL' | 'HORIZONTAL';
export type PhotoShape = 'ROUNDED' | 'CIRCLE' | 'SQUARE';
export type CardFieldKey =
  | 'department' | 'bloodGroup' | 'emergencyContact' | 'validTill' | 'joiningDate' | 'phone' | 'email'
  | 'office' | 'workMode' | 'employmentType' | 'grade' | 'manager' | 'dateOfBirth';

/** Optional front rows (matches CARD_FIELDS on the API); the company picks up to MAX_CARD_FIELDS and their order. */
export const CARD_FIELD_LABELS: Record<CardFieldKey, string> = {
  department: 'Department',
  bloodGroup: 'Blood group',
  emergencyContact: 'Emergency',
  validTill: 'Valid till',
  joiningDate: 'Joined',
  phone: 'Phone',
  email: 'Email',
  office: 'Office',
  workMode: 'Work mode',
  employmentType: 'Type',
  grade: 'Grade',
  manager: 'Reports to',
  dateOfBirth: 'Date of birth',
};
export const MAX_CARD_FIELDS = 6;
const DATE_FIELDS: CardFieldKey[] = ['joiningDate', 'validTill', 'dateOfBirth'];

export interface CardStyle {
  headerColor: string;
  /** Second colour of a gradient top band; empty = solid. */
  headerColor2: string;
  bodyColor: string;
  accentColor: string;
  footerColor: string;
  photoShape: PhotoShape;
  title: string;
  showAddress: boolean;
  showContact: boolean;
  showSignatory: boolean;
  /** 0 = cards don't expire. */
  validityMonths: number;
}

export interface CardDesign {
  brandColor: string;
  layout: CardLayout;
  fields: CardFieldKey[];
  backNote: string;
  style: CardStyle;
  company: {
    name: string;
    address: string;
    phone: string;
    email: string;
    signatoryName: string;
    signatoryTitle: string;
    logoUrl: string | null;
  };
}

export interface IdCardData extends CardDesign {
  employee: {
    id: string;
    name: string;
    employeeCode: string;
    designation: string;
    avatarColor: string;
    isActive: boolean;
    photoUrl: string | null;
    issuedOn: string;
    expiresOn: string | null;
    fields: { key: CardFieldKey; value: string }[];
  };
  verifyUrl: string;
  /** QR code as a PNG data URL; null in the designer preview. */
  qr: string | null;
}

/** WCAG relative luminance of a #RRGGBB colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** True when dark text reads better than white on this colour. */
const isLight = (hex: string) => luminance(hex) > 0.4;
const onColor = (hex: string) => (isLight(hex) ? '#0b1530' : '#ffffff');

/** Text colours for the card body, so a dark body stays readable. */
function bodyTones(body: string) {
  return isLight(body)
    ? { text: '#0b1530', muted: '#5b6478', faint: '#8a93a6', line: '#e2e6ec' }
    : { text: '#ffffff', muted: 'rgba(255,255,255,.75)', faint: 'rgba(255,255,255,.55)', line: 'rgba(255,255,255,.18)' };
}

/** Accent as text on the body; a colour too faint to read (e.g. white on white) falls back to the body's muted tone. */
export const readableAccent = (s: CardStyle) => (contrast(s.accentColor, s.bodyColor) >= 3 ? s.accentColor : bodyTones(s.bodyColor).muted);
/** Band or stripe the same colour as the body would vanish — those get a hairline edge instead. */
export const blendsIn = (color: string, body: string) => contrast(color, body) < 1.15;

function Stripe({ s, className, vertical }: { s: CardStyle; className: string; vertical: boolean }) {
  const hidden = blendsIn(s.footerColor, s.bodyColor);
  const line = bodyTones(s.bodyColor).line;
  return (
    <div
      className={className}
      style={hidden ? { background: s.bodyColor, boxShadow: `inset ${vertical ? `0 1px` : `1px 0`} 0 ${line}` } : { background: s.footerColor }}
    />
  );
}

const headerBg = (s: CardStyle) =>
  s.headerColor2 ? `linear-gradient(135deg, ${s.headerColor}, ${s.headerColor2})` : s.headerColor;

const PHOTO_RADIUS: Record<PhotoShape, string> = { ROUNDED: '16px', CIRCLE: '9999px', SQUARE: '4px' };

const initials = (name: string) =>
  name.trim().split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

const fieldValue = (f: { key: CardFieldKey; value: string }) => (DATE_FIELDS.includes(f.key) ? fmtDate(f.value) : f.value);

function Logo({ data }: { data: CardDesign }) {
  return data.company.logoUrl ? (
    <span className="flex h-9 max-w-[150px] items-center rounded-md bg-white px-2 py-1 shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived presigned URL */}
      <img src={data.company.logoUrl} alt="" className="max-h-full max-w-full object-contain" />
    </span>
  ) : (
    <span className="text-[13px] font-bold leading-tight tracking-tight" style={{ color: onColor(data.style.headerColor) }}>
      {data.company.name}
    </span>
  );
}

function Title({ data }: { data: CardDesign }) {
  if (!data.style.title) return null;
  return (
    <span className="mt-1.5 text-[8.5px] font-bold uppercase tracking-[0.18em] opacity-90" style={{ color: onColor(data.style.headerColor) }}>
      {data.style.title}
    </span>
  );
}

function Photo({ data, size, ring }: { data: IdCardData; size: number; ring: string }) {
  const emp = data.employee;
  const style = { width: size, height: size, borderRadius: PHOTO_RADIUS[data.style.photoShape], boxShadow: `0 0 0 4px ${ring}` };
  return emp.photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- short-lived presigned URL
    <img src={emp.photoUrl} alt={emp.name} style={style} className="shrink-0 bg-ink-100 object-cover" />
  ) : (
    <span style={{ ...style, background: emp.avatarColor }} className="flex shrink-0 items-center justify-center text-2xl font-bold text-white">
      {initials(emp.name)}
    </span>
  );
}

function Rows({ data }: { data: IdCardData }) {
  const { fields } = data.employee;
  if (fields.length === 0) return null;
  const tones = bodyTones(data.style.bodyColor);
  return (
    <dl className="grid gap-y-1 text-[10.5px] leading-snug">
      {fields.map((f) => (
        <div key={f.key} className="grid grid-cols-[74px_minmax(0,1fr)] gap-2">
          <dt className="font-medium uppercase tracking-wide" style={{ color: readableAccent(data.style), fontSize: 9 }}>
            {CARD_FIELD_LABELS[f.key]}
          </dt>
          <dd className="truncate font-semibold" style={{ color: tones.text }}>
            {fieldValue(f)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CodeChip({ data }: { data: IdCardData }) {
  const accent = readableAccent(data.style);
  return (
    <span className="inline-block rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-semibold" style={{ background: `${accent}22`, color: accent }}>
      {data.employee.employeeCode}
    </span>
  );
}

/* Cards are drawn at 5 px per mm of a CR80 card (85.6 × 54 mm); print scales them back to true size. */
const SIZE = { VERTICAL: { width: 270, height: 428 }, HORIZONTAL: { width: 428, height: 270 } } as const;
const FACE = 'id-card-face relative flex shrink-0 overflow-hidden rounded-[18px] shadow-lift ring-1 ring-ink-200/70';

function Front({ data }: { data: IdCardData }) {
  const s = data.style;
  const tones = bodyTones(s.bodyColor);
  const emp = data.employee;
  if (data.layout === 'HORIZONTAL') {
    return (
      <div className={FACE} style={{ ...SIZE.HORIZONTAL, background: s.bodyColor }}>
        <div
          className="flex w-[132px] shrink-0 flex-col items-center justify-between px-3 py-4"
          style={{ background: headerBg(s), ...(blendsIn(s.headerColor, s.bodyColor) && !s.headerColor2 ? { borderRight: `1px solid ${tones.line}` } : {}) }}
        >
          <div className="flex max-w-full flex-col items-center text-center">
            <Logo data={data} />
            <Title data={data} />
          </div>
          <Photo data={data} size={88} ring="rgba(255,255,255,.9)" />
          <span className="rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold" style={{ background: 'rgba(255,255,255,.9)', color: '#0b1530' }}>
            {emp.employeeCode}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-3 py-4 pl-5 pr-7">
          <div>
            <p className="text-[18px] font-bold leading-tight" style={{ color: tones.text }}>{emp.name}</p>
            <p className="mt-0.5 text-[11.5px] font-medium" style={{ color: tones.muted }}>{emp.designation || 'Employee'}</p>
          </div>
          <Rows data={data} />
          {data.company.logoUrl && <p className="truncate text-[10px] font-semibold" style={{ color: tones.faint }}>{data.company.name}</p>}
        </div>
        <Stripe s={s} vertical={false} className="absolute inset-y-0 right-0 w-2.5" />
      </div>
    );
  }
  return (
    <div className={`${FACE} flex-col`} style={{ ...SIZE.VERTICAL, background: s.bodyColor }}>
      <div
        className="flex h-[132px] shrink-0 flex-col items-center pt-4"
        style={{ background: headerBg(s), ...(blendsIn(s.headerColor, s.bodyColor) && !s.headerColor2 ? { borderBottom: `1px solid ${tones.line}` } : {}) }}
      >
        <Logo data={data} />
        <Title data={data} />
      </div>
      <div className="-mt-11 flex justify-center">
        <Photo data={data} size={100} ring={s.bodyColor} />
      </div>
      <div className="mt-3 px-5 text-center">
        <p className="text-[17px] font-bold leading-tight" style={{ color: tones.text }}>{emp.name}</p>
        <p className="mb-2 mt-0.5 text-[11.5px] font-medium" style={{ color: tones.muted }}>{emp.designation || 'Employee'}</p>
        <CodeChip data={data} />
      </div>
      <div className="mt-3 flex-1 px-6">
        <Rows data={data} />
      </div>
      <Stripe s={s} vertical className="h-2.5 shrink-0" />
    </div>
  );
}

function Back({ data }: { data: IdCardData }) {
  const s = data.style;
  const tones = bodyTones(s.bodyColor);
  const { company } = data;
  const contact = [company.phone, company.email].filter(Boolean).join(' · ');
  const vertical = data.layout === 'VERTICAL';
  return (
    <div
      className={`${FACE} ${vertical ? 'flex-col items-center px-6 pb-6 pt-8 text-center' : 'items-center gap-5 py-4 pl-6 pr-8'}`}
      style={{ ...SIZE[data.layout], background: s.bodyColor }}
    >
      <div className="flex shrink-0 flex-col items-center">
        <div className="rounded-xl bg-white p-2 ring-1 ring-ink-200">
          {data.qr ? (
            // eslint-disable-next-line @next/next/no-img-element -- generated data URL
            <img src={data.qr} alt="Verification QR code" className="h-[104px] w-[104px]" />
          ) : (
            <span className="flex h-[104px] w-[104px] items-center justify-center rounded bg-ink-100 text-[10px] font-medium text-ink-400">QR code</span>
          )}
        </div>
        <p className="mt-1.5 text-[9.5px] font-medium uppercase tracking-wider" style={{ color: tones.faint }}>Scan to verify</p>
      </div>
      <div className={`flex min-w-0 flex-col ${vertical ? 'mt-5 flex-1' : 'flex-1'}`}>
        <p className="text-[12px] font-bold" style={{ color: tones.text }}>{company.name}</p>
        {s.showAddress && company.address && <p className="mt-1 text-[10px] leading-snug" style={{ color: tones.muted }}>{company.address}</p>}
        {s.showContact && contact && <p className="mt-1 text-[10px]" style={{ color: tones.muted }}>{contact}</p>}
        <p className="mt-3 text-[10px] italic leading-snug" style={{ color: tones.muted }}>
          {data.backNote || `This card is the property of the company. If found, please return it${s.showAddress && company.address ? ' to the address above' : ' to HR'}.`}
        </p>
        {s.showSignatory && company.signatoryName && (
          <div className={`${vertical ? 'mx-auto mt-auto' : 'mt-3'} pt-3`}>
            <div className="w-32 border-t pt-1" style={{ borderColor: tones.line }}>
              <p className="text-[10px] font-semibold" style={{ color: tones.text }}>{company.signatoryName}</p>
              <p className="text-[9px]" style={{ color: tones.faint }}>{company.signatoryTitle}</p>
            </div>
          </div>
        )}
      </div>
      <Stripe s={s} vertical={vertical} className={`absolute ${vertical ? 'inset-x-0 bottom-0 h-2.5' : 'inset-y-0 right-0 w-2.5'}`} />
    </div>
  );
}

/**
 * Prints just the card from a blank frame, so the page layout around it can't
 * shrink it: it comes out at true CR80 size (see the print rules in globals.css).
 */
function printCard(card: HTMLElement) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) return frame.remove();
  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((n) => n.outerHTML).join('');
  doc.open();
  doc.write(
    `<!doctype html><html class="${document.documentElement.className}"><head><meta charset="utf-8">${styles}` +
      `<style>@page{size:A4;margin:12mm}body{margin:0;background:#fff}</style></head>` +
      `<body class="${document.body.className}">${card.outerHTML}</body></html>`
  );
  doc.close();
  // Print only once the copied stylesheets, then the fonts they declare and the images, have loaded —
  // printing earlier gives an unstyled card.
  // (The frame's elements belong to its own realm, so tagName, not instanceof.)
  const loaded = (el: HTMLLinkElement | HTMLImageElement) =>
    (el.tagName === 'IMG' ? (el as HTMLImageElement).complete : !!(el as HTMLLinkElement).sheet)
      ? null
      : new Promise((r) => (el.onload = el.onerror = r));
  const sheets = [...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map(loaded);
  void Promise.all(sheets)
    .then(() => Promise.all([...[...doc.images].map(loaded), doc.fonts.ready]))
    .then(() => {
      win.addEventListener('afterprint', () => frame.remove());
      win.focus();
      win.print();
      setTimeout(() => frame.remove(), 60_000); // browsers that never fire afterprint
    });
}

/** Front and back, side by side (stacked on narrow screens). `id-card-print` is what the print view keeps. */
export function IdCard({ data }: { data: IdCardData }) {
  return (
    <div className="id-card-print flex flex-wrap items-start gap-5">
      <Front data={data} />
      <Back data={data} />
    </div>
  );
}

/**
 * An employee's card with its actions. `employeeId` is `me` for the signed-in
 * employee; `canManage` (Admin / HR) adds reissue.
 */
export function IdCardPanel({ employeeId, canManage = false }: { employeeId: string; canManage?: boolean }) {
  const { data, loading, error, setData } = useFetch<IdCardData>(`/id-cards/${employeeId}`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmReissue, setConfirmReissue] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const run = async (fn: () => Promise<IdCardData>) => {
    setBusy(true);
    setActionError(null);
    try {
      setData(await fn());
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const upload = (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    void run(() => api<IdCardData>(`/id-cards/${employeeId}/photo`, { method: 'POST', form: fd }));
  };

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorNote error={error ?? 'Not found'} />;

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">{employeeId === 'me' ? 'My ID card' : 'ID card'}</h2>
          <p className="text-xs text-ink-500">
            Designed by {data.company.name}. Issued {fmtDate(data.employee.issuedOn)}
            {data.employee.expiresOn ? ` · valid till ${fmtDate(data.employee.expiresOn)}` : ''}. The QR code on the back verifies it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
          <Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {data.employee.photoUrl ? 'Change photo' : 'Upload photo'}
          </Button>
          {data.employee.photoUrl && (
            <Button variant="ghost" disabled={busy} onClick={() => void run(() => api<IdCardData>(`/id-cards/${employeeId}/photo`, { method: 'DELETE' }))}>
              Remove photo
            </Button>
          )}
          {canManage && (
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmReissue(true)}>
              Reissue
            </Button>
          )}
          <Button disabled={busy} onClick={() => cardRef.current?.firstElementChild && printCard(cardRef.current.firstElementChild as HTMLElement)}>
            Print card
          </Button>
        </div>
      </div>
      <ErrorNote error={actionError} />
      {!data.employee.photoUrl && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No photo yet — initials are printed instead. Upload a clear, front-facing PNG or JPG (up to 2 MB).
        </p>
      )}
      {data.employee.expiresOn && data.employee.expiresOn < new Date().toISOString().slice(0, 10) && (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          This card expired on {fmtDate(data.employee.expiresOn)} — its QR shows “Expired”. {canManage ? 'Reissue it to renew.' : 'Ask HR to reissue it.'}
        </p>
      )}
      {!data.employee.isActive && (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">This employee is inactive — the card no longer verifies.</p>
      )}
      <div ref={cardRef} className="overflow-x-auto pb-2">
        <IdCard data={data} />
      </div>

      <Modal title="Reissue ID card?" open={confirmReissue} onClose={() => setConfirmReissue(false)}>
        <p className="text-sm text-ink-600">
          The QR code on the current card stops verifying straight away, and validity restarts from today. Use this when a card is lost,
          stolen or expired, then print the new one.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmReissue(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setConfirmReissue(false);
              void run(() => api<IdCardData>(`/id-cards/${employeeId}/reissue`, { method: 'POST' }));
            }}
          >
            Reissue card
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
