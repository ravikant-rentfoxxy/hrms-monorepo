'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Avatar, Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Spinner } from '@/components/ui';

interface Me {
  id: string;
  email: string;
  role: string;
  lastLoginAt: string | null;
  totpEnabled: boolean;
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

export default function ProfilePage() {
  const { session } = useAuth();
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
              <p className="font-semibold text-slate-900">{me?.employee?.name ?? 'Platform Owner'}</p>
              <p className="text-sm text-slate-500">{me?.email}</p>
            </div>
          </div>
          <dl className="mt-5 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Active role</dt>
              <dd>
                <Badge tone="blue">{session?.role}</Badge>
              </dd>
            </div>
            {me?.activeCompany && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Company</dt>
                <dd className="font-medium text-slate-800">{me.activeCompany.name}</dd>
              </div>
            )}
            {me?.employee && (
              <>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Employee code</dt>
                  <dd>{me.employee.employeeCode}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Designation</dt>
                  <dd>{me.employee.designation || '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Department</dt>
                  <dd>{grade?.departmentRef?.name ?? (me.employee.department || '—')}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Grade</dt>
                  <dd>{grade?.gradeRef ? `${grade.gradeRef.code} · ${grade.gradeRef.name}` : '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Gender</dt>
                  <dd>{me.employee.gender ? me.employee.gender.charAt(0) + me.employee.gender.slice(1).toLowerCase() : '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Manager</dt>
                  <dd>{me.employee.manager?.name ?? '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Joined</dt>
                  <dd>{fmtDate(me.employee.joiningDate)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Probation ends</dt>
                  <dd>
                    {me.employee.confirmedOn
                      ? `Confirmed ${fmtDate(me.employee.confirmedOn)}`
                      : me.employee.probationEndDate
                        ? fmtDate(me.employee.probationEndDate)
                        : '—'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Notice period</dt>
                  <dd>{me.employee.noticePeriodDays} days</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Tax regime</dt>
                  <dd>{me.employee.taxRegime === 'OLD' ? 'Old regime' : 'New regime'}</dd>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <dt className="text-slate-500">Last login</dt>
              <dd>{me?.lastLoginAt ? new Date(me.lastLoginAt).toLocaleString('en-IN') : '—'}</dd>
            </div>
          </dl>

          {me?.employee && (
            <>
              <div className="mb-2 mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
                <h3 className="text-sm font-semibold text-slate-900">Identity & bank</h3>
                <button onClick={() => setReveal(!reveal)} className="text-xs font-medium text-indigo-600 hover:underline">
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
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="font-mono">{mask(value)}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {me && me.memberships.length > 0 && (
            <>
              <h3 className="mb-2 mt-5 border-t border-slate-100 pt-4 text-sm font-semibold text-slate-900">Company access</h3>
              <ul className="space-y-1.5">
                {me.memberships.map((m) => (
                  <li key={m.companyId} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{m.company.name}</span>
                    <Badge tone="slate">{m.role}</Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Two-factor authentication</p>
              <p className="text-xs text-slate-500">{me?.totpEnabled ? 'Enabled — sign-ins need an app code' : 'Off — add an authenticator app'}</p>
            </div>
            <Link href="/settings/security" className="text-sm font-medium text-indigo-600 hover:underline">
              Manage
            </Link>
          </div>
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Change password</h2>
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
    </div>
  );
}
