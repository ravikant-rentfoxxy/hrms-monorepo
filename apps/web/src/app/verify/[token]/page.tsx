'use client';

/**
 * ID card verification (public, no login): where the QR code on the back of an
 * employee ID card points. Shows only what the card itself prints, plus
 * whether it is still valid. Lives outside the (panel) group, so no session/shell.
 */
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { Spinner } from '@/components/ui';

interface Verification {
  valid: boolean;
  reason: 'SEPARATED' | 'EXPIRED' | null;
  expiresOn: string | null;
  name: string;
  employeeCode: string;
  designation: string;
  avatarColor: string;
  photoUrl: string | null;
  company: { name: string; brandColor: string; logoUrl: string | null };
}

export default function VerifyIdCardPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Verification | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Verification>(`/public/id-cards/${encodeURIComponent(token)}`, { skipAuth: true })
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'This ID card could not be verified'));
  }, [token]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      {!data && !error ? (
        <Spinner />
      ) : !data ? (
        <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-lift">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-2xl text-rose-600">✕</span>
          <h1 className="mt-4 text-lg font-bold text-ink-900">Not a valid ID card</h1>
          <p className="mt-1 text-sm text-ink-500">{error}</p>
        </div>
      ) : (
        <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white text-center shadow-lift">
          <div className="flex h-32 items-start justify-center pt-5" style={{ background: data.company.brandColor }}>
            {data.company.logoUrl ? (
              <span className="flex h-10 max-w-[180px] items-center rounded-md bg-white px-2 py-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived presigned URL */}
                <img src={data.company.logoUrl} alt={data.company.name} className="max-h-full max-w-full object-contain" />
              </span>
            ) : (
              <span className="text-base font-bold text-white">{data.company.name}</span>
            )}
          </div>
          <div className="-mt-10 flex justify-center">
            {data.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived presigned URL
              <img src={data.photoUrl} alt={data.name} className="h-24 w-24 rounded-2xl object-cover ring-4 ring-white" />
            ) : (
              <span className="flex h-24 w-24 items-center justify-center rounded-2xl text-2xl font-bold text-white ring-4 ring-white" style={{ background: data.avatarColor }}>
                {data.name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
              </span>
            )}
          </div>
          <div className="px-6 pb-8 pt-4">
            <h1 className="text-xl font-bold text-ink-950">{data.name}</h1>
            <p className="text-sm text-ink-500">{data.designation || 'Employee'}</p>
            <p className="mt-1 font-mono text-xs text-ink-400">{data.employeeCode}</p>
            <div
              className={`mt-5 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold ${
                data.valid ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
              }`}
            >
              {data.valid ? '✓ Verified employee' : data.reason === 'EXPIRED' ? '✕ Card expired' : '✕ No longer valid'}
            </div>
            <p className="mt-3 text-xs text-ink-500">
              {data.valid
                ? `Currently employed at ${data.company.name}.${data.expiresOn ? ` Card valid till ${fmtDate(data.expiresOn)}.` : ''}`
                : data.reason === 'EXPIRED'
                  ? `This card expired on ${fmtDate(data.expiresOn)}. Ask ${data.company.name} HR for a new one.`
                  : `This person no longer works at ${data.company.name}.`}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
