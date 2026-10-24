'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Spinner } from '@/components/ui';

interface Setup {
  secret: string;
  otpauthUri: string;
}

/** Groups a base32 secret in fours for easier manual entry. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

export default function SecuritySettingsPage() {
  const { data: status, loading, reload } = useFetch<{ enabled: boolean }>('/auth/2fa');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      setSetup(await api<Setup>('/auth/2fa/setup', { method: 'POST' }));
      setCode('');
    });

  const enable = () =>
    run(async () => {
      await api('/auth/2fa/enable', { method: 'POST', body: { code } });
      setSetup(null);
      setCode('');
      setMsg('Two-factor authentication is on. You will be asked for a code at every sign-in.');
      reload();
    });

  const disable = () =>
    run(async () => {
      await api('/auth/2fa/disable', { method: 'POST', body: { password } });
      setPassword('');
      setMsg('Two-factor authentication is off.');
      reload();
    });

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Security" subtitle="Protect your account with an authenticator app" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Two-factor authentication</h2>
            {status?.enabled ? <Badge tone="green">enabled</Badge> : <Badge tone="slate">off</Badge>}
          </div>
          <div className="space-y-3">
            <ErrorNote error={error} />
            {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>}

            {status?.enabled ? (
              <>
                <p className="text-sm text-slate-600">
                  Sign-ins ask for a 6-digit code from your authenticator app. To turn it off, confirm your password.
                </p>
                <Field label="Password">
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
                <Button variant="danger" disabled={busy || !password} onClick={() => void disable()}>
                  Turn off two-factor
                </Button>
              </>
            ) : setup ? (
              <>
                <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-600">
                  <li>Open Google Authenticator, Microsoft Authenticator, Authy or 1Password and add an account.</li>
                  <li>
                    Choose <span className="font-medium">Enter a setup key</span> and type this key (time-based):
                    <code className="mt-1.5 block select-all rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm tracking-wider text-slate-900">
                      {grouped(setup.secret)}
                    </code>
                  </li>
                  <li>
                    Or paste this link into an app that accepts <code>otpauth://</code> links:
                    <code className="mt-1.5 block select-all break-all rounded-lg bg-slate-100 px-3 py-2 font-mono text-[11px] text-slate-700">
                      {setup.otpauthUri}
                    </code>
                  </li>
                  <li>Enter the 6-digit code the app shows to finish.</li>
                </ol>
                <Field label="Code from the app">
                  <Input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                  />
                </Field>
                <div className="flex gap-2">
                  <Button disabled={busy || code.length !== 6} onClick={() => void enable()}>
                    Verify & enable
                  </Button>
                  <Button variant="secondary" onClick={() => setSetup(null)}>
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-600">
                  Add a second step to sign-in: after your password, enter a code from an authenticator app on your phone.
                  Strongly recommended for ADMIN and HR accounts.
                </p>
                <Button disabled={busy} onClick={() => void start()}>
                  Set up two-factor
                </Button>
              </>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Sign-in protection</h2>
          <ul className="space-y-2 text-sm text-slate-600">
            <li>• 5 wrong passwords or codes lock the account for 15 minutes.</li>
            <li>• Forgot your password? Use “Forgot password” on the sign-in page to get a 6-digit reset code.</li>
            <li>• Changing or resetting your password signs out every other session.</li>
            <li>• PAN, Aadhaar, bank account and UAN numbers are encrypted at rest.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
