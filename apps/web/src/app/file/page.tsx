'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Icon, Spinner } from '@/components/ui';

interface SignedLink {
  url: string;
  fileName?: string;
  expiresInSeconds?: number;
}

/** Only our own API paths ("/payroll/payslips/…/pdf"), never a full URL. */
const safePath = (p: string | null): string | null => (p && p.startsWith('/') && !p.startsWith('//') && !p.includes('://') ? p : null);
/** Same API path without `inline`, so the signed link downloads instead of rendering. */
const downloadPath = (p: string): string => {
  const u = new URL(p, 'http://x');
  u.searchParams.delete('inline');
  return u.pathname + u.search;
};
const withInline = (p: string): string => {
  const u = new URL(p, 'http://x');
  u.searchParams.set('inline', 'true');
  return u.pathname + u.search;
};

export default function FilePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <FileViewer />
    </Suspense>
  );
}

/**
 * Secure file viewer: asks the API (which checks access) for a 5-minute signed
 * link, shows the file with a countdown and Download, and replaces it with a
 * friendly "link expired" screen instead of the storage server's XML error.
 */
function FileViewer() {
  const path = safePath(useSearchParams().get('src'));
  const { session, loading: authLoading } = useAuth();
  const [link, setLink] = useState<(SignedLink & { expiresAt: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const fetchLink = useCallback(async () => {
    if (!path) return;
    setFetching(true);
    setError(null);
    try {
      const r = await api<SignedLink>(withInline(path));
      setLink({ ...r, expiresAt: Date.now() + (r.expiresInSeconds ?? 300) * 1000 });
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This file could not be opened');
    } finally {
      setFetching(false);
    }
  }, [path]);

  useEffect(() => {
    // Fetch the first link once signed in; the response lands asynchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (session && path) void fetchLink();
  }, [session, path, fetchLink]);

  useEffect(() => {
    if (!link) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [link]);

  const download = async () => {
    if (!path) return;
    try {
      const r = await api<SignedLink>(downloadPath(path));
      window.location.assign(r.url); // attachment link: the browser saves it and stays on this page
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    }
  };

  const left = link ? Math.max(0, Math.round((link.expiresAt - now) / 1000)) : 0;
  const expired = !!link && left === 0;
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const title = link?.fileName ?? 'Secure file';

  if (!path) return <StateCard icon="x" tone="rose" title="Invalid file link" body="This link is not a valid HRMS file link." />;
  if (authLoading) return <Spinner />;
  if (!session) {
    return (
      <StateCard icon="shield" tone="indigo" title="Sign in to view this file" body="Files are only shown to signed-in users with access to them.">
        <Link href="/login" className="inline-flex rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500">
          Sign in
        </Link>
      </StateCard>
    );
  }
  if (error && !link) return <StateCard icon="shield" tone="rose" title="Can’t open this file" body={error} />;
  if (!link) return <Spinner />;

  if (expired) {
    return (
      <StateCard
        icon="clock"
        tone="amber"
        title="This secure link has expired"
        body="For your security, file links work for 5 minutes only. Get a new link to view or download the file again."
      >
        <Button onClick={() => void fetchLink()} disabled={fetching}>
          {fetching ? 'Getting a new link…' : 'Get a new link'}
        </Button>
        <Button variant="secondary" onClick={() => window.close()}>
          Close tab
        </Button>
      </StateCard>
    );
  }

  const urgent = left <= 60;
  return (
    <div className="flex h-screen flex-col bg-ink-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-ink-200 bg-white px-4 py-3 shadow-sm">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
          <Icon name="folder" className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink-900">{title}</p>
          <p className="text-xs text-ink-500">Secure link · download within 5 minutes, after that the link expires</p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold tabular-nums ring-1 ring-inset ${
            urgent ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-amber-50 text-amber-800 ring-amber-200'
          }`}
          title="Time left on this secure link"
        >
          <Icon name="clock" className="h-3.5 w-3.5" />
          Expires in {mmss}
        </span>
        <Button onClick={() => void download()}>
          <Icon name="download" className="h-4 w-4" /> Download
        </Button>
      </header>
      {error && <p className="bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</p>}
      <iframe src={link.url} title={title} className="min-h-0 w-full flex-1 border-0 bg-white" />
    </div>
  );
}

function StateCard({
  icon,
  tone,
  title,
  body,
  children,
}: {
  icon: 'clock' | 'shield' | 'x';
  tone: 'amber' | 'rose' | 'indigo';
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  const ring = { amber: 'bg-amber-50 text-amber-600', rose: 'bg-rose-50 text-rose-600', indigo: 'bg-brand-50 text-brand-600' }[tone];
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-100 p-4">
      <div className="w-full max-w-md rounded-2xl border border-ink-200/70 bg-white p-8 text-center shadow-[0_8px_30px_rgba(15,23,42,0.08)]">
        <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${ring}`}>
          <Icon name={icon} className="h-7 w-7" />
        </span>
        <h1 className="mt-4 text-lg font-semibold tracking-tight text-ink-900">{title}</h1>
        <p className="mt-1.5 text-sm text-ink-500">{body}</p>
        {children && <div className="mt-6 flex flex-wrap justify-center gap-2">{children}</div>}
      </div>
    </div>
  );
}
