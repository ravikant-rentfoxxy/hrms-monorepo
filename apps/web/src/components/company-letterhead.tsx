'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFetch } from '@/lib/useFetch';
import { errMsg } from './engage';
import { Button, Card, ErrorNote, Field, Input, Spinner, Textarea } from './ui';

interface CompanyProfile {
  id: string;
  name: string;
  code: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  signatoryName: string;
  signatoryTitle: string;
}

/** Company logo, address and signatory — printed on offer letters and every other HR letter. */
export function CompanyLetterhead() {
  const { data, loading, error, setData } = useFetch<CompanyProfile>('/company-profile');
  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorNote error={error ?? 'Not found'} />;
  return <ProfileForm initial={data} onSaved={setData} />;
}

function ProfileForm({ initial, onSaved }: { initial: CompanyProfile; onSaved: (p: CompanyProfile) => void }) {
  // Admin and HR edit the letterhead (HR issues the letters); the API enforces the same.
  const { isCompanyAdmin: canEdit } = useAuth();
  const [form, setForm] = useState({
    address: initial.address ?? '',
    email: initial.email ?? '',
    phone: initial.phone ?? '',
    signatoryName: initial.signatoryName,
    signatoryTitle: initial.signatoryTitle,
  });
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await api<CompanyProfile>('/company-profile', { method: 'PATCH', body: form });
      onSaved(p);
      setSaved(true);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const p = await api<CompanyProfile>('/company-profile/logo', { method: 'POST', form: fd });
      setLogoUrl(p.logoUrl);
      onSaved(p);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeLogo = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await api<CompanyProfile>('/company-profile/logo', { method: 'DELETE' });
      setLogoUrl(p.logoUrl);
      onSaved(p);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <ErrorNote error={error} />

      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold text-ink-900">Logo</h2>
        <p className="mb-4 text-xs text-ink-500">Shown at the top-left of every letter page. PNG or JPG, up to 2 MB — a wide logo on a white background looks best.</p>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-20 w-60 items-center justify-center rounded-xl border border-dashed border-ink-300 bg-ink-50 p-2">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived presigned URL
              <img src={logoUrl} alt="Company logo" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-xs text-ink-400">No logo — the company name is printed instead</span>
            )}
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
              <Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
                {logoUrl ? 'Replace logo' : 'Upload logo'}
              </Button>
              {logoUrl && (
                <Button variant="ghost" disabled={busy} onClick={() => void removeLogo()}>
                  Remove
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink-900">Company details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" hint="Managed by the platform owner">
            <Input value={initial.name} disabled />
          </Field>
          <Field label="Company code" hint="Used on the login screen">
            <Input value={initial.code} disabled />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Office address" hint="Printed in the offer letter: “…in our company situated at <address>”">
              <Textarea rows={2} value={form.address} onChange={set('address')} disabled={!canEdit} placeholder="Unit No. 429, JMD Megapolis, Sector-48, Gurugram-122001 (Haryana)" />
            </Field>
          </div>
          <Field label="HR email">
            <Input type="email" value={form.email} onChange={set('email')} disabled={!canEdit} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={set('phone')} disabled={!canEdit} />
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold text-ink-900">Signatory</h2>
        <p className="mb-4 text-xs text-ink-500">Signs offer letters and HR letters under “For {initial.name}”.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={form.signatoryName} onChange={set('signatoryName')} disabled={!canEdit} placeholder="e.g. Pankaj Yadav" />
          </Field>
          <Field label="Title">
            <Input value={form.signatoryTitle} onChange={set('signatoryTitle')} disabled={!canEdit} placeholder="Authorized Signatory" />
          </Field>
        </div>
      </Card>

      {canEdit ? (
        <div className="flex items-center gap-3">
          <Button disabled={busy} onClick={() => void save()}>
            Save
          </Button>
          {saved && <span className="text-sm text-emerald-600">Saved — new letters will use these details.</span>}
        </div>
      ) : (
        <p className="text-xs text-ink-500">Only Admin or HR can change the company profile.</p>
      )}
    </div>
  );
}
