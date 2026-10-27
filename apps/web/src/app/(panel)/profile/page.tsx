'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Avatar, Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Spinner } from '@/components/ui';
import { IdCardPanel } from '@/components/id-card';

interface Me {
  id: string;
  email: string;
  role: string;
  lastLoginAt: string | null;
  activeCompany: { id: string; name: string; code: string; timezone: string } | null;
  employee: {
    id: string;
    name: string;
    employeeCode: string;
    designation: string;
    department: string;
    joiningDate: string;
    avatarColor: string;
    manager: { id: string; name: string } | null;
    gender: string;
    probationEndDate: string | null;
    confirmedOn: string | null;
    noticePeriodDays: number;
    taxRegime: string;
    pan: string;
    aadhaarNumber: string;
    accountNumber: string;
    uan: string;
  } | null;
  memberships: { companyId: string; role: string; company: { name: string; code: string } }[];
}

const passwordOk = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /[0-9]/.test(p);

/**
 * Reset by email code — for when the current password is not known. The code
 * goes to the sign-in email; a successful reset signs out every session.
 */
function ResetPasswordModal({ email, onClose, onDone }: { email: string; onClose: () => void; onDone: () => void }) {
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };
  const sendCode = () =>
    run(async () => {
      await api('/auth/forgot-password', { method: 'POST', body: { email }, skipAuth: true });
      setOtp('');
      setSent(true);
    });
  const reset = () =>
    run(async () => {
      await api('/auth/reset-password', { method: 'POST', body: { email, otp, newPassword }, skipAuth: true });
      setDone(true);
    });

  return (
    <Modal title="Reset password" open onClose={done ? onDone : onClose}>
      <div className="space-y-4">
        <ErrorNote error={error} />
        {done ? (
          <>
            <p className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
              Password reset. You have been signed out everywhere — sign in again with your new password.
            </p>
            <Button className="w-full" onClick={onDone}>
              Go to sign in
            </Button>
          </>
        ) : !sent ? (
          <>
            <p className="text-sm text-ink-600">
              We will email a 6-digit code to <span className="font-semibold text-ink-900">{email}</span>. The code is
              valid for 15 minutes.
            </p>
            <Button className="w-full" disabled={busy} onClick={() => void sendCode()}>
              {busy ? 'Sending…' : 'Send reset code'}
            </Button>
          </>
        ) : (
          <>
            <p className="rounded-lg bg-ink-50 px-3 py-2.5 text-sm text-ink-600">
              Code sent to <span className="font-semibold text-ink-900">{email}</span>. Check your inbox (and spam).
            </p>
            <Field label="Reset code" required>
              <Input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
              />
            </Field>
            <Field label="New password" hint="At least 8 characters, with a letter and a number" required>
              <Input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </Field>
            <Field label="Confirm new password" required>
              <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            {confirm && confirm !== newPassword && <p className="text-xs text-rose-600">Passwords do not match</p>}
            <Button
              className="w-full"
              disabled={busy || otp.length !== 6 || !passwordOk(newPassword) || confirm !== newPassword}
              onClick={() => void reset()}
            >
              {busy ? 'Saving…' : 'Reset password'}
            </Button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void sendCode()}
              className="block w-full text-center text-xs font-medium text-brand-600 hover:underline"
            >
              Resend code
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

export default function ProfilePage() {
  const { session, logout } = useAuth();
  const [resetOpen, setResetOpen] = useState(false);
  const { data: me, loading } = useFetch<Me>('/auth/me');
  const { data: grade } = useFetch<{ gradeRef: { code: string; name: string } | null; departmentRef: { name: string } | null }>(
    session?.employee ? `/employees/${session.employee.id}` : null
  );
  const [reveal, setReveal] = useState(false);
  const mask = (v?: string) => (!v ? '—' : reveal ? v : v.length <= 4 ? 'XXXX' : `${'X'.repeat(Math.max(6, v.length - 4))}${v.slice(-4)}`);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const changePassword = async () => {
    setError(null);
    setMsg(null);
    try {
      await api('/auth/change-password', { method: 'POST', body: pw });
      setMsg('Password changed. Other sessions were signed out.');
      setPw({ currentPassword: '', newPassword: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader title="My profile" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center gap-4">
            <Avatar name={me?.employee?.name ?? me?.email ?? '?'} color={me?.employee?.avatarColor} />
            <div>
              <p className="font-semibold text-ink-900">{me?.employee?.name ?? 'Platform Owner'}</p>
              <p className="text-sm text-ink-500">{me?.email}</p>
            </div>
          </div>
          <dl className="mt-5 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-500">Active role</dt>
              <dd>
                <Badge tone="blue">{session?.role}</Badge>
              </dd>
            </div>
            {me?.activeCompany && (
              <div className="flex justify-between">
                <dt className="text-ink-500">Company</dt>
                <dd className="font-medium text-ink-800">{me.activeCompany.name}</dd>
              </div>
            )}
            {me?.employee && (
              <>
                <div className="flex justify-between">
                  <dt className="text-ink-500">Employee code</dt>
                  <dd>{me.employee.employeeCode}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-500">Designation</dt>
                  <dd>{me.employee.designation || '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-500">Department</dt>
                  <dd>{grade?.departmentRef?.name ?? (me.employee.department || '—')}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-500">Grade</dt>
                  <dd>{grade?.gradeRef ? `${grade.gradeRef.code} · ${grade.gradeRef.name}` : '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-500">Gender</dt>
                  <dd>{me.employee.gender ? me.employee.gender.charAt(0) + me.employee.gender.slice(1).toLowerCase() : '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-500">Manager</dt>
                  <dd>{me.employee.manager?.name ?? '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-500">Joined</dt>
                  <dd>{fmtDate(me.employee.joiningDate)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-500">Probation ends</dt>
                  <dd>
                    {me.employee.confirmedOn
                      ? `Confirmed ${fmtDate(me.employee.confirmedOn)}`
                      : me.employee.probationEndDate
                        ? fmtDate(me.employee.probationEndDate)
                        : '—'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-500">Notice period</dt>
                  <dd>{me.employee.noticePeriodDays} days</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-500">Tax regime</dt>
                  <dd>{me.employee.taxRegime === 'OLD' ? 'Old regime' : 'New regime'}</dd>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-500">Last login</dt>
              <dd>{me?.lastLoginAt ? new Date(me.lastLoginAt).toLocaleString('en-IN') : '—'}</dd>
            </div>
          </dl>

          {me?.employee && (
            <>
              <div className="mb-2 mt-5 flex items-center justify-between border-t border-ink-100 pt-4">
                <h3 className="text-sm font-semibold text-ink-900">Identity & bank</h3>
                <button onClick={() => setReveal(!reveal)} className="text-xs font-medium text-brand-600 hover:underline">
                  {reveal ? 'Hide numbers' : 'Show full numbers'}
                </button>
              </div>
              <dl className="space-y-2 text-sm">
                {(
                  [
                    ['PAN', me.employee.pan],
                    ['Aadhaar', me.employee.aadhaarNumber],
                    ['Bank account', me.employee.accountNumber],
                    ['UAN', me.employee.uan],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex justify-between">
                    <dt className="text-ink-500">{label}</dt>
                    <dd className="font-mono">{mask(value)}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {me && me.memberships.length > 0 && (
            <>
              <h3 className="mb-2 mt-5 border-t border-ink-100 pt-4 text-sm font-semibold text-ink-900">Company access</h3>
              <ul className="space-y-1.5">
                {me.memberships.map((m) => (
                  <li key={m.companyId} className="flex items-center justify-between text-sm">
                    <span className="text-ink-700">{m.company.name}</span>
                    <Badge tone="slate">{m.role}</Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-ink-50 px-3.5 py-3">
            <div>
              <p className="text-sm font-semibold text-ink-900">Forgot your current password?</p>
              <p className="text-xs text-ink-500">Get a 6-digit code by email and set a new password.</p>
            </div>
            <Button variant="secondary" disabled={!me?.email} onClick={() => setResetOpen(true)}>
              Reset password
            </Button>
          </div>
          <h2 className="mb-4 text-sm font-semibold text-ink-900">Change password</h2>
          <div className="space-y-3">
            <ErrorNote error={error} />
            {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>}
            <Field label="Current password">
              <Input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            </Field>
            <Field label="New password" hint="min 8 chars, at least one letter and one digit">
              <Input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            </Field>
            <Button onClick={() => void changePassword()} disabled={!pw.currentPassword || pw.newPassword.length < 8}>
              Update password
            </Button>
          </div>
        </Card>
      </div>
      {me?.employee && (
        <div className="mt-4">
          <IdCardPanel employeeId="me" />
        </div>
      )}
      {resetOpen && me?.email && (
        <ResetPasswordModal email={me.email} onClose={() => setResetOpen(false)} onDone={() => void logout()} />
      )}
    </div>
  );
}
