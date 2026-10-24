'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { api, saveSession, setActingCompanyId, type Session } from '@/lib/api';
import { Button, ErrorNote, Field, Icon, Input, Select, type IconName } from '@/components/ui';

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'clock', title: 'Geofenced attendance', text: 'Check-in verified against office locations.' },
  { icon: 'leaf', title: 'Leave & approvals', text: 'Balances, policies and one-click decisions.' },
  { icon: 'banknote', title: 'Payroll & expenses', text: 'Payslips, claims and receipts in one place.' },
];

type Step = 'password' | 'code' | 'forgot' | 'reset';
type LoginResponse = Session | { twoFactorRequired: true; challengeToken: string };

export default function LoginPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>('password');
  const [challenge, setChallenge] = useState('');
  const [code, setCode] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companies, setCompanies] = useState<{ id: string; code: string }[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) router.replace('/');
  }, [loading, session, router]);

  useEffect(() => {
    api<{ id: string; code: string }[]>('/auth/companies', { skipAuth: true })
      .then(setCompanies)
      .catch(() => undefined); // server unreachable: login still works without it
  }, []);

  /** Stores the session and enters the panel (full load so the auth context re-hydrates). */
  const finish = (data: Session) => {
    saveSession(data);
    setActingCompanyId(null);
    window.location.replace('/');
  };

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    void run(async () => {
      if (step === 'password') {
        const data = await api<LoginResponse>('/auth/login', {
          method: 'POST',
          body: { email, password, ...(companyId ? { companyId } : {}) },
          skipAuth: true,
        });
        if ('twoFactorRequired' in data) {
          setChallenge(data.challengeToken);
          setCode('');
          setStep('code');
        } else finish(data);
      } else if (step === 'code') {
        finish(await api<Session>('/auth/login/2fa', { method: 'POST', body: { challengeToken: challenge, code }, skipAuth: true }));
      } else if (step === 'forgot') {
        await api('/auth/forgot-password', { method: 'POST', body: { email }, skipAuth: true });
        setOtp('');
        setNewPassword('');
        setStep('reset');
        setNotice('If that email has an account, a 6-digit code is on its way. It is valid for 15 minutes.');
      } else {
        await api('/auth/reset-password', { method: 'POST', body: { email, otp, newPassword }, skipAuth: true });
        setPassword('');
        setStep('password');
        setNotice('Password changed. Sign in with your new password.');
      }
    });
  };

  const goTo = (next: Step) => {
    setError(null);
    setNotice(null);
    setStep(next);
  };

  const heading: Record<Step, [string, string]> = {
    password: ['Welcome back', 'Sign in as super admin, employer or employee.'],
    code: ['Two-factor check', 'Enter the 6-digit code from your authenticator app.'],
    forgot: ['Forgot password', 'We will send a 6-digit reset code to your email.'],
    reset: ['Reset password', 'Enter the code you received and choose a new password.'],
  };

  return (
    <div className="flex min-h-screen">
      {/* Brand panel */}
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-[#0f1222] p-10 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(600px 400px at 20% 10%, rgba(99,102,241,0.35), transparent 60%), radial-gradient(500px 400px at 90% 90%, rgba(139,92,246,0.25), transparent 60%)',
          }}
        />
        <div className="relative flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold shadow-lg shadow-indigo-900/50">
            H
          </span>
          <span className="text-sm font-semibold tracking-wide">HRMS Admin Panel</span>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-snug tracking-tight">
            One workspace for every company you run.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            Multi-tenant HR management — super admins onboard companies, employers run their teams, employees
            self-serve.
          </p>
          <ul className="mt-8 space-y-4">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex items-start gap-3.5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-indigo-300">
                  <Icon name={f.icon} className="h-4.5 w-4.5" />
                </span>
                <div>
                  <p className="text-sm font-semibold">{f.title}</p>
                  <p className="text-[13px] text-slate-400">{f.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11px] text-slate-500">Secured with JWT rotation · rate limiting · tenant isolation</p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center bg-[var(--bg)] px-4">
        <div className="w-full max-w-sm">
          <div className="mb-7 lg:text-left text-center">
            <span className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-lg font-bold text-white shadow-lg shadow-indigo-500/30 lg:hidden">
              H
            </span>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">{heading[step][0]}</h2>
            <p className="mt-1 text-sm text-slate-500">{heading[step][1]}</p>
          </div>
          <form
            onSubmit={submit}
            className="space-y-4 rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.06)]"
          >
            <ErrorNote error={error} />
            {notice && <p className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">{notice}</p>}
            {step === 'password' && (
              <>
                <Field label="Company code" hint="required — only the super admin signs in without one">
                  <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                    <option value="">— select company —</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Email">
                  <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
                </Field>
                <Field label="Password">
                  <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                </Field>
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? 'Signing in…' : 'Sign in'}
                </Button>
                <button type="button" onClick={() => goTo('forgot')} className="block w-full text-center text-xs font-medium text-indigo-600 hover:underline">
                  Forgot password?
                </button>
              </>
            )}
            {step === 'code' && (
              <>
                <Field label="Authentication code">
                  <Input
                    autoFocus
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                  />
                </Field>
                <Button type="submit" disabled={busy || code.length !== 6} className="w-full">
                  {busy ? 'Verifying…' : 'Verify'}
                </Button>
                <button type="button" onClick={() => goTo('password')} className="block w-full text-center text-xs font-medium text-indigo-600 hover:underline">
                  Back to sign in
                </button>
              </>
            )}
            {step === 'forgot' && (
              <>
                <Field label="Email">
                  <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
                </Field>
                <Button type="submit" disabled={busy || !email} className="w-full">
                  {busy ? 'Sending…' : 'Send reset code'}
                </Button>
                <button type="button" onClick={() => goTo('password')} className="block w-full text-center text-xs font-medium text-indigo-600 hover:underline">
                  Back to sign in
                </button>
              </>
            )}
            {step === 'reset' && (
              <>
                <Field label="Reset code">
                  <Input
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                  />
                </Field>
                <Field label="New password" hint="min 8 chars, at least one letter and one digit">
                  <Input type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                </Field>
                <Button type="submit" disabled={busy || otp.length !== 6 || newPassword.length < 8} className="w-full">
                  {busy ? 'Saving…' : 'Set new password'}
                </Button>
                <div className="flex justify-between text-xs font-medium text-indigo-600">
                  <button type="button" onClick={() => goTo('forgot')} className="hover:underline">
                    Resend code
                  </button>
                  <button type="button" onClick={() => goTo('password')} className="hover:underline">
                    Back to sign in
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
