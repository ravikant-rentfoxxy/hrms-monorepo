'use client';

import * as React from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Building2, CheckCircle2, Eye, EyeOff, Loader2, LockKeyhole } from 'lucide-react';
import { Button } from '@/marketing/components/ui/button';
import { Checkbox } from '@/marketing/components/ui/checkbox';
import { FormField, fieldAria } from '@/marketing/components/ui/form-field';
import { Input } from '@/marketing/components/ui/input';
import { Label } from '@/marketing/components/ui/label';
import {
  continueToApp,
  requestPasswordReset,
  resetPassword,
  selectCompany,
  signIn,
  type CompanyChoice,
  type SignInResult,
} from '@/marketing/lib/api/auth';
import { compact, v } from '@/marketing/lib/validation';
import { DemoLink } from '@/marketing/components/demo/demo-dialog';

type View = 'signin' | 'company' | 'forgot' | 'reset';
const REMEMBER_KEY = 'hrms.landing.email';

const ROLE_LABEL: Record<string, string> = { ADMIN: 'Admin', HR: 'HR', MANAGER: 'Manager', EMPLOYEE: 'Employee', FINANCE: 'Finance' };

const noSubscribe = () => () => {};

function readRemembered(): string {
  try {
    return typeof window === 'undefined' ? '' : (window.localStorage.getItem(REMEMBER_KEY) ?? '');
  } catch {
    return '';
  }
}

function Banner({ tone, children }: { tone: 'error' | 'success'; children: React.ReactNode }) {
  const Icon = tone === 'error' ? AlertCircle : CheckCircle2;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={
        tone === 'error'
          ? 'flex gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-800'
          : 'flex gap-2.5 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-3 text-sm text-brand-800'
      }
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function LoginForm() {
  const [view, setView] = React.useState<View>('signin');
  // Remembered email: empty on the server, filled from storage on the client (no hydration mismatch).
  const remembered = React.useSyncExternalStore(noSubscribe, readRemembered, () => '');
  const [typedEmail, setEmail] = React.useState<string | null>(null);
  const [rememberChoice, setRemember] = React.useState<boolean | null>(null);
  const email = typedEmail ?? remembered;
  const remember = rememberChoice ?? remembered !== '';
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [errors, setErrors] = React.useState<Partial<Record<'email' | 'password' | 'otp' | 'newPassword', string>>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [redirecting, setRedirecting] = React.useState(false);
  const [companies, setCompanies] = React.useState<CompanyChoice[]>([]);
  const [selectionToken, setSelectionToken] = React.useState('');
  const [pickedId, setPickedId] = React.useState<string | null>(null);
  const [otp, setOtp] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');

  const go = (next: View) => {
    setErrors({});
    setFormError(null);
    setNotice(null);
    setView(next);
  };

  const run = async (fn: () => Promise<void>) => {
    setFormError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handle = (result: SignInResult) => {
    if (result.kind === 'select-company') {
      setCompanies(result.companies);
      setSelectionToken(result.selectionToken);
      go('company');
      return;
    }
    setRedirecting(true);
    continueToApp();
  };

  const rememberEmail = () => {
    try {
      if (remember) window.localStorage.setItem(REMEMBER_KEY, email.trim());
      else window.localStorage.removeItem(REMEMBER_KEY);
    } catch {
      // storage blocked: nothing to remember
    }
  };

  const onSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    const found = compact({ email: v.email(email), password: password ? undefined : 'Password is required' });
    setErrors(found);
    if (Object.keys(found).length) return;
    void run(async () => {
      const result = await signIn(email.trim().toLowerCase(), password);
      rememberEmail();
      handle(result);
    });
  };

  const onPick = (companyId: string) => {
    setPickedId(companyId);
    void run(async () => {
      try {
        handle(await selectCompany(selectionToken, companyId));
      } finally {
        setPickedId(null);
      }
    });
  };

  const onForgot = (e: React.FormEvent) => {
    e.preventDefault();
    const found = compact({ email: v.email(email) });
    setErrors(found);
    if (Object.keys(found).length) return;
    void run(async () => {
      await requestPasswordReset(email.trim().toLowerCase());
      setOtp('');
      setNewPassword('');
      go('reset');
      setNotice('If that email has an account, a 6-digit code is on its way. It’s valid for 15 minutes.');
    });
  };

  const onReset = (e: React.FormEvent) => {
    e.preventDefault();
    const found = compact({
      otp: /^\d{6}$/.test(otp) ? undefined : 'Enter the 6-digit code from the email',
      newPassword: v.newPassword(newPassword),
    });
    setErrors(found);
    if (Object.keys(found).length) return;
    void run(async () => {
      await resetPassword(email.trim().toLowerCase(), otp, newPassword);
      setPassword('');
      go('signin');
      setNotice('Password updated. Sign in with your new password.');
    });
  };

  const heading: Record<View, [string, string]> = {
    signin: ['Welcome Back', 'Sign in to your workspace'],
    company: ['Choose a company', 'Your account belongs to more than one company.'],
    forgot: ['Reset your password', 'We’ll email you a 6-digit code.'],
    reset: ['Enter your code', 'Then choose a new password.'],
  };

  if (redirecting) {
    return (
      <div className="flex flex-col items-center py-16 text-center" role="status">
        <Loader2 className="size-8 animate-spin text-brand-600" aria-hidden="true" />
        <p className="mt-4 text-lg font-semibold text-ink-950">Signed in</p>
        <p className="mt-1 text-sm text-ink-500">Opening your workspace…</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-[28px] font-bold tracking-tight text-ink-950 sm:text-3xl">{heading[view][0]}</h1>
      <p className="mt-1.5 text-[15px] text-ink-500">{heading[view][1]}</p>

      <div className="mt-6 space-y-3 empty:hidden">
        {formError && <Banner tone="error">{formError}</Banner>}
        {notice && <Banner tone="success">{notice}</Banner>}
      </div>

      {view === 'signin' && (
        <form onSubmit={onSignIn} noValidate className="mt-7 space-y-5">
          <FormField id="email" label="Email address" error={errors.email}>
            <Input
              {...fieldAria('email', errors.email)}
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>
          <FormField id="password" label="Password" error={errors.password}>
            <div className="relative">
              <Input
                {...fieldAria('password', errors.password)}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Enter your password"
                className="pr-11"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </FormField>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Checkbox id="remember" checked={remember} onCheckedChange={(c) => setRemember(c === true)} />
              <Label htmlFor="remember" className="cursor-pointer font-normal text-ink-600">
                Remember my email
              </Label>
            </div>
            <button type="button" onClick={() => go('forgot')} className="rounded text-sm font-semibold text-brand-700 hover:underline">
              Forgot password?
            </button>
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" /> Signing in…
              </>
            ) : (
              <>
                Sign In <ArrowRight aria-hidden="true" />
              </>
            )}
          </Button>
        </form>
      )}

      {view === 'company' && (
        <div className="mt-7 space-y-2.5">
          {companies.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={busy}
              onClick={() => onPick(c.id)}
              className="group flex w-full items-center gap-3 rounded-2xl border border-ink-200 bg-white p-3.5 text-left transition-all hover:border-brand-300 hover:shadow-soft disabled:opacity-60"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink-900 text-brand-300">
                <Building2 className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink-950">{c.name}</span>
                <span className="block text-[13px] text-ink-500">
                  {c.code} · {ROLE_LABEL[c.role] ?? c.role}
                </span>
              </span>
              {pickedId === c.id ? (
                <Loader2 className="size-4 animate-spin text-brand-600" aria-hidden="true" />
              ) : (
                <ArrowRight className="size-4 text-ink-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" aria-hidden="true" />
              )}
            </button>
          ))}
          <button type="button" onClick={() => go('signin')} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-ink-900">
            <ArrowLeft className="size-4" aria-hidden="true" /> Use a different account
          </button>
        </div>
      )}

      {view === 'forgot' && (
        <form onSubmit={onForgot} noValidate className="mt-7 space-y-5">
          <FormField id="forgot-email" label="Email address" error={errors.email}>
            <Input
              {...fieldAria('forgot-email', errors.email)}
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {busy ? 'Sending code…' : 'Send reset code'}
          </Button>
          <button type="button" onClick={() => go('signin')} className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-ink-900">
            <ArrowLeft className="size-4" aria-hidden="true" /> Back to sign in
          </button>
        </form>
      )}

      {view === 'reset' && (
        <form onSubmit={onReset} noValidate className="mt-7 space-y-5">
          <FormField id="otp" label="6-digit code" error={errors.otp} hint={`Sent to ${email.trim()}`}>
            <Input
              {...fieldAria('otp', errors.otp, 'hint')}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              className="tracking-[0.3em]"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            />
          </FormField>
          <FormField id="new-password" label="New password" error={errors.newPassword} hint="At least 8 characters, with a letter and a number">
            <Input
              {...fieldAria('new-password', errors.newPassword, 'hint')}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </FormField>
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
            {busy ? 'Updating…' : 'Set new password'}
          </Button>
          <div className="flex justify-between text-sm font-semibold">
            <button type="button" onClick={() => go('forgot')} className="text-brand-700 hover:underline">
              Resend code
            </button>
            <button type="button" onClick={() => go('signin')} className="text-ink-600 hover:text-ink-900">
              Back to sign in
            </button>
          </div>
        </form>
      )}

      <p className="mt-8 text-center text-sm text-ink-500">
        New to the platform?{' '}
        <DemoLink className="font-semibold text-brand-700 hover:underline">
          Book a demo
        </DemoLink>
      </p>
    </div>
  );
}
