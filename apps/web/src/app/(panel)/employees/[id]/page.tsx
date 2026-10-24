'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate, fmtMoney } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Avatar, Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, DatePicker,
} from '@/components/ui';
import { AuditTable, type AuditPage } from '@/components/audit-log';
import { SalaryBreakup, SalaryEditor, ctcFor, emptySalaryForm, salaryBody, type SalaryForm } from '@/components/salary';
import {
  CareerHistory, EmploymentStatusBadge, LifecycleTimeline, RaiseTransferModal, SourceOfHireBadge,
  type SourceApplication,
} from '@/components/career';

interface EmployeeDetail {
  id: string;
  employeeCode: string;
  name: string;
  designation: string;
  department: string;
  phone: string;
  location: string;
  joiningDate: string;
  leavingDate: string | null;
  dateOfBirth: string | null;
  bloodGroup: string;
  address?: string;
  emergencyContact?: string;
  bankName?: string;
  accountNumber?: string;
  ifsc?: string;
  pan?: string;
  pfNumber?: string;
  uan?: string;
  aadhaarNumber?: string;
  fatherName?: string;
  employmentType: string;
  avatarColor: string;
  salaryBasic?: number;
  salaryHra?: number;
  salaryConveyance?: number;
  salaryMedical?: number;
  salaryAllowance?: number;
  salaryPfEmployer?: number;
  salaryPfEmployee?: number;
  isActive: boolean;
  user?: { email: string; role: string; isActive: boolean; lastLoginAt: string | null; totpEnabled?: boolean };
  manager: { id: string; name: string; designation?: string } | null;
  departmentId: string | null;
  designationId: string | null;
  gradeId?: string | null;
  officeId: string | null;
  gender?: string;
  maritalStatus?: string;
  personalEmail?: string;
  probationEndDate: string | null;
  confirmedOn: string | null;
  noticePeriodDays: number;
  esiNumber?: string;
  taxRegime?: string;
  departmentRef: { id: string; name: string; code: string } | null;
  designationRef: { id: string; name: string; level: number } | null;
  gradeRef?: { id: string; code: string; name: string } | null;
  /** True when identity numbers arrive masked (manager viewing a report). */
  secretsMasked?: boolean;
  employmentStatus: string;
  separatedOn: string | null;
  separationReason?: string;
  rehireEligible?: boolean | null;
  rehireNote?: string;
  archivedAt: string | null;
  hireSource: string;
  sourceApplication?: SourceApplication | null;
}

interface MasterOption {
  id: string;
  name: string;
  code?: string;
}

const titleCase = (v?: string | null) => (v ? v.charAt(0) + v.slice(1).toLowerCase() : '');

/** Change history of this employee (ADMIN / HR). */
interface UpcomingRevision {
  id: string;
  effectiveFrom: string;
  ctcAnnual: number;
  reason: string;
  monthly: { basic: number; hra: number; conveyance: number; medical: number; allowance: number; pfEmployer: number; pfEmployee: number };
}

/** HR / Admin sets the employee's login password (joiners from hiring start without a usable one). */
function SetPasswordModal({ employeeId, name, email, onClose }: { employeeId: string; name: string; email: string; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const rulesOk = password.length >= 8 && /[A-Za-z]/.test(password) && /[0-9]/.test(password);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/employees/${employeeId}/password`, { method: 'POST', body: { password } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Set password — ${name}`} open onClose={onClose}>
      {done ? (
        <div className="space-y-3">
          <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Password set. {name} can now sign in with <span className="font-semibold">{email}</span> on the app or web portal.
          </p>
          <p className="text-xs text-slate-500">Share it privately. They should change it from My profile after signing in. Any existing sessions were signed out.</p>
          <Button className="w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <ErrorNote error={error} />
          <p className="text-sm text-slate-600">
            Login email: <span className="font-semibold text-slate-900">{email}</span>
          </p>
          <Field label="New password" hint="At least 8 characters, with a letter and a number">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirm password">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
          {confirm && confirm !== password && <p className="text-xs text-rose-600">Passwords do not match</p>}
          <Button className="w-full" disabled={busy || !rulesOk || password !== confirm} onClick={() => void save()}>
            Set password
          </Button>
        </div>
      )}
    </Modal>
  );
}

function HistoryTab({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const { data, loading, error } = useFetch<AuditPage>(`/audit?entity=Employee&entityId=${id}&page=${page}&pageSize=25`);
  if (loading) return <Spinner />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <Card>
      <ErrorNote error={error} />
      <AuditTable items={data?.items ?? []} showEntity={false} />
      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 p-3 text-sm text-slate-500">
          <span>
            Page {page} of {pages}
          </span>
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Corporate ID-badge style card shown at the top of the profile. */
function EmployeeIdCard({ emp, company }: { emp: EmployeeDetail; company: string }) {
  return (
    <div className="mb-4 overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-950 via-indigo-900 to-violet-900 p-5 text-white shadow-lg shadow-indigo-950/20">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/15 text-xs font-bold">
            {company.slice(0, 1).toUpperCase()}
          </span>
          <span className="text-sm font-semibold tracking-wide">{company}</span>
        </div>
        <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-indigo-200">
          Employee card
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-bold ring-2 ring-white/30"
          style={{ backgroundColor: emp.avatarColor || '#6366F1' }}
        >
          {emp.name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold">{emp.name}</p>
          <p className="truncate text-sm text-indigo-200">
            {emp.designation}
            {emp.department ? ` · ${emp.department}` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-300">Employee ID</p>
          <p className="font-mono text-xl font-bold tracking-wider">{emp.employeeCode}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-white/10 pt-3 text-xs text-indigo-200">
        {emp.user?.email && <span>{emp.user.email}</span>}
        <span>Joined {fmtDate(emp.joiningDate)}</span>
        <span>{emp.employmentType}</span>
      </div>
    </div>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800">{value || '—'}</p>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { session, isCompanyAdmin } = useAuth();
  const { data: emp, loading, error, reload } = useFetch<EmployeeDetail>(`/employees/${id}`);
  const [editOpen, setEditOpen] = useState<'profile' | 'finance' | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [salary, setSalary] = useState<SalaryForm>(emptySalaryForm);
  const [tab, setTab] = useState('Profile');
  const [transferOpen, setTransferOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const { data: departments } = useFetch<MasterOption[]>(isCompanyAdmin ? '/masters/departments' : null);
  const { data: designations } = useFetch<MasterOption[]>(isCompanyAdmin ? '/masters/designations' : null);
  const { data: grades } = useFetch<MasterOption[]>(isCompanyAdmin ? '/masters/grades' : null);
  const { data: offices } = useFetch<MasterOption[]>(isCompanyAdmin ? '/offices' : null);
  // An approved revision waiting for its effective date (applied by the daily job on that day).
  const { data: upcomingRevisions } = useFetch<UpcomingRevision[]>(isCompanyAdmin ? `/salary/revisions?employeeId=${id}&status=APPROVED` : null);
  const [salaryView, setSalaryView] = useState<'current' | 'upcoming'>('current');

  const isSelf = session?.employee?.id === id;
  const canEdit = isCompanyAdmin || isSelf;

  if (loading) return <Spinner />;
  if (error || !emp) return <Card className="p-6 text-sm text-rose-600">{error ?? 'Not found'}</Card>;

  // Career tabs: the employee, their reporting manager and ADMIN/HR.
  const isManagerOf = !!session?.employee?.id && emp.manager?.id === session.employee.id;
  const seesCareer = isCompanyAdmin || isSelf || isManagerOf;
  const separated = emp.employmentStatus === 'SEPARATED' || !emp.isActive;
  const tabs = [
    'Profile',
    ...(seesCareer ? ['Lifecycle timeline', 'Career history'] : []),
    ...(isCompanyAdmin ? ['History'] : []),
  ];

  const upcoming = upcomingRevisions?.[upcomingRevisions.length - 1] ?? null; // soonest first-to-apply (list is newest first)

  // Gross excludes employer contributions; CTC adds employer PF, employer ESI and the gratuity provision.
  const grossMonthly =
    (emp.salaryBasic ?? 0) + (emp.salaryHra ?? 0) + (emp.salaryConveyance ?? 0) +
    (emp.salaryMedical ?? 0) + (emp.salaryAllowance ?? 0);
  const monthlyCtc = ctcFor(grossMonthly, emp.salaryBasic ?? 0, emp.salaryPfEmployer ?? 0);

  // Personal details vs. bank/salary — each has its own edit dialog.
  // Department / designation come from masters when the company has them (free text otherwise).
  const useDeptMaster = !!departments?.length;
  const useDesMaster = !!designations?.length;
  const profileKeys = isCompanyAdmin
    ? [
        'name', ...(useDesMaster ? [] : ['designation']), ...(useDeptMaster ? [] : ['department']),
        'phone', 'location', 'address', 'emergencyContact', 'bloodGroup', 'personalEmail',
      ]
    : ['phone', 'address', 'emergencyContact', 'bloodGroup', 'personalEmail'];
  // Picker fields: '' clears them (sent as null / '').
  const selectKeys = isCompanyAdmin
    ? ['departmentId', 'designationId', 'gradeId', 'officeId', 'gender', 'maritalStatus', 'taxRegime', 'noticePeriodDays']
    : ['maritalStatus'];
  // Joining / birth / leaving / probation dates — HR/ADMIN only, rendered as date pickers.
  const dateKeys = isCompanyAdmin ? ['joiningDate', 'dateOfBirth', 'leavingDate', 'probationEndDate', 'confirmedOn'] : [];
  const financeKeys = [
    'bankName', 'accountNumber', 'ifsc', 'pan', 'pfNumber', 'uan', 'aadhaarNumber', 'fatherName',
    ...(isCompanyAdmin ? ['esiNumber'] : []),
  ];
  const nullableKeys = ['departmentId', 'designationId', 'gradeId', 'officeId', 'leavingDate', 'probationEndDate', 'confirmedOn'];

  const openEdit = (kind: 'profile' | 'finance') => {
    setEditError(null);
    setForm({
      name: emp.name, designation: emp.designation, department: emp.department, phone: emp.phone,
      location: emp.location, address: emp.address ?? '', emergencyContact: emp.emergencyContact ?? '',
      bloodGroup: emp.bloodGroup, bankName: emp.bankName ?? '', accountNumber: emp.accountNumber ?? '',
      ifsc: emp.ifsc ?? '', pan: emp.pan ?? '', pfNumber: emp.pfNumber ?? '', uan: emp.uan ?? '',
      aadhaarNumber: emp.aadhaarNumber ?? '', fatherName: emp.fatherName ?? '',
      joiningDate: emp.joiningDate?.slice(0, 10) ?? '', dateOfBirth: emp.dateOfBirth?.slice(0, 10) ?? '',
      leavingDate: emp.leavingDate?.slice(0, 10) ?? '', probationEndDate: emp.probationEndDate?.slice(0, 10) ?? '',
      confirmedOn: emp.confirmedOn?.slice(0, 10) ?? '', departmentId: emp.departmentId ?? '',
      designationId: emp.designationId ?? '', gradeId: emp.gradeId ?? '', officeId: emp.officeId ?? '',
      gender: emp.gender ?? '', maritalStatus: emp.maritalStatus ?? '', personalEmail: emp.personalEmail ?? '',
      noticePeriodDays: String(emp.noticePeriodDays ?? 30), esiNumber: emp.esiNumber ?? '', taxRegime: emp.taxRegime ?? 'NEW',
    });
    setSalary({
      salaryBasic: emp.salaryBasic ? String(emp.salaryBasic) : '',
      salaryHra: emp.salaryHra ? String(emp.salaryHra) : '',
      salaryConveyance: emp.salaryConveyance ? String(emp.salaryConveyance) : '',
      salaryMedical: emp.salaryMedical ? String(emp.salaryMedical) : '',
      salaryAllowance: emp.salaryAllowance ? String(emp.salaryAllowance) : '',
      salaryPfEmployer: emp.salaryPfEmployer ? String(emp.salaryPfEmployer) : '',
      salaryPfEmployee: emp.salaryPfEmployee ? String(emp.salaryPfEmployee) : '',
    });
    setEditOpen(kind);
  };

  const save = async (keys: string[]) => {
    setEditError(null);
    try {
      const body: Record<string, unknown> = Object.fromEntries(
        Object.entries(form).filter(([key, value]) => keys.includes(key) && value !== '')
      );
      // Emptied pickers clear the value explicitly (e.g. no leaving date = no longer exiting).
      const current = emp as unknown as Record<string, unknown>;
      for (const key of keys) {
        if (form[key] !== '' || !current[key]) continue;
        body[key] = nullableKeys.includes(key) ? null : '';
      }
      if (body.noticePeriodDays !== undefined) body.noticePeriodDays = Number(body.noticePeriodDays);
      // Masked identity numbers (XXXX1234) are display-only — never send them back.
      for (const key of ['pan', 'aadhaarNumber', 'accountNumber', 'uan']) {
        if (typeof body[key] === 'string' && /^X{4,}/.test(body[key] as string)) delete body[key];
      }
      if (editOpen === 'finance' && isCompanyAdmin) Object.assign(body, salaryBody(salary));
      await api(`/employees/${id}`, { method: 'PATCH', body });
      setEditOpen(null);
      reload();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const deactivate = async () => {
    if (!confirm(`Deactivate ${emp.name}? Their access to this company will be revoked.`)) return;
    await api(`/employees/${id}`, { method: 'DELETE' });
    router.push('/employees');
  };

  return (
    <div>
      <PageHeader
        title={emp.name}
        subtitle={`${emp.designation}${emp.department ? ` · ${emp.department}` : ''}`}
        actions={
          <>
            {canEdit && (
              <>
                <Button variant="secondary" onClick={() => openEdit('profile')}>
                  Edit profile
                </Button>
                <Button variant="secondary" onClick={() => openEdit('finance')}>
                  Edit finance
                </Button>
              </>
            )}
            {(isCompanyAdmin || isManagerOf) && !separated && !isSelf && (
              <Button variant="secondary" onClick={() => setTransferOpen(true)}>
                Transfer / promote
              </Button>
            )}
            {isCompanyAdmin && emp.isActive && !isSelf && emp.user && (
              <Button variant="secondary" onClick={() => setPasswordOpen(true)}>
                Set password
              </Button>
            )}
            {isCompanyAdmin && emp.isActive && !isSelf && (
              <Button variant="danger" onClick={() => void deactivate()}>
                Deactivate
              </Button>
            )}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <EmploymentStatusBadge status={emp.employmentStatus} />
        {emp.employmentStatus === 'PROBATION' && emp.probationEndDate && (
          <span className="text-xs text-slate-500">until {fmtDate(emp.probationEndDate)}</span>
        )}
        {emp.employmentStatus === 'NOTICE_PERIOD' && emp.leavingDate && (
          <span className="text-xs text-slate-500">last day {fmtDate(emp.leavingDate)}</span>
        )}
        {(isCompanyAdmin || isSelf) && <SourceOfHireBadge hireSource={emp.hireSource} application={emp.sourceApplication} />}
        {emp.archivedAt && <Badge tone="slate">archived {fmtDate(emp.archivedAt)}</Badge>}
      </div>

      {separated && (
        <Card className="mb-4 border-l-4 border-l-slate-400 p-4 text-sm text-slate-600">
          Former employee — left on {fmtDate(emp.separatedOn ?? emp.leavingDate)}
          {emp.separationReason ? ` (${emp.separationReason})` : ''}.
          {emp.rehireEligible !== undefined && (
            <span className="ml-1">
              Rehire:{' '}
              {emp.rehireEligible === true ? 'eligible' : emp.rehireEligible === false ? 'not eligible' : 'not decided'}
              {emp.rehireNote ? ` — ${emp.rehireNote}` : ''}.
            </span>
          )}{' '}
          The profile, history and documents are kept read-only.
        </Card>
      )}

      <EmployeeIdCard emp={emp} company={session?.activeCompany?.name ?? 'Company'} />

      {tabs.length > 1 && <Tabs tabs={tabs} active={tab} onChange={setTab} />}

      {tab === 'History' && isCompanyAdmin ? (
        <HistoryTab id={id} />
      ) : tab === 'Career history' && seesCareer ? (
        <Card className="p-5">
          <CareerHistory employeeId={id} />
        </Card>
      ) : tab === 'Lifecycle timeline' && seesCareer ? (
        <LifecycleTimeline employeeId={id} />
      ) : (
      <>
      <Card className="p-5">
        <div className="mb-5 flex items-center gap-4">
          <Avatar name={emp.name} color={emp.avatarColor} />
          <div>
            <p className="font-semibold text-slate-900">
              {emp.name} <span className="text-sm font-normal text-slate-400">({emp.employeeCode})</span>
            </p>
            <div className="mt-1 flex gap-2">
              {emp.isActive ? <Badge tone="green">active</Badge> : <Badge tone="red">deactivated</Badge>}
              <Badge tone="slate">{emp.employmentType}</Badge>
              {emp.user && <Badge tone="blue">{emp.user.role}</Badge>}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3">
          <Item label="Email" value={emp.user?.email} />
          <Item label="Phone" value={emp.phone} />
          <Item label="Location" value={emp.location} />
          <Item label="Manager" value={emp.manager?.name} />
          <Item label="Joined" value={fmtDate(emp.joiningDate)} />
          <Item
            label="Leaving date"
            value={
              emp.leavingDate ? (
                <span className="font-semibold text-rose-600">{fmtDate(emp.leavingDate)}</span>
              ) : (
                '—'
              )
            }
          />
          <Item label="Date of birth" value={emp.dateOfBirth ? fmtDate(emp.dateOfBirth) : '—'} />
          <Item label="Blood group" value={emp.bloodGroup} />
          <Item label="Emergency contact" value={emp.emergencyContact} />
          <Item label="Address" value={emp.address} />
          <Item label="Department" value={emp.departmentRef?.name ?? emp.department} />
          <Item label="Designation" value={emp.designationRef?.name ?? emp.designation} />
          {emp.gradeRef && (
            <Item label="Grade" value={emp.gradeRef ? `${emp.gradeRef.code} · ${emp.gradeRef.name}` : '—'} />
          )}
          {emp.gender !== undefined && <Item label="Gender" value={titleCase(emp.gender)} />}
          {emp.maritalStatus !== undefined && <Item label="Marital status" value={titleCase(emp.maritalStatus)} />}
          {emp.personalEmail !== undefined && <Item label="Personal email" value={emp.personalEmail} />}
          <Item label="Probation ends" value={emp.probationEndDate ? fmtDate(emp.probationEndDate) : '—'} />
          <Item label="Confirmed on" value={emp.confirmedOn ? fmtDate(emp.confirmedOn) : '—'} />
          <Item label="Notice period" value={`${emp.noticePeriodDays} days`} />
          {emp.user?.totpEnabled !== undefined && (
            <Item label="Two-factor sign-in" value={emp.user.totpEnabled ? 'Enabled' : 'Off'} />
          )}
        </div>
        {(emp.bankName !== undefined || emp.pan !== undefined) && (
          <>
            <h3 className="mb-3 mt-6 flex items-center gap-2 border-t border-slate-100 pt-4 text-sm font-semibold text-slate-900">
              {emp.secretsMasked ? 'Identity numbers' : 'Bank, tax & statutory'}
              {emp.secretsMasked && <Badge tone="slate">masked</Badge>}
            </h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
              {emp.bankName !== undefined && <Item label="Bank" value={emp.bankName} />}
              <Item label="Account no." value={emp.accountNumber} />
              {emp.ifsc !== undefined && <Item label="IFSC" value={emp.ifsc} />}
              <Item label="PAN" value={emp.pan} />
              {emp.pfNumber !== undefined && <Item label="PF number" value={emp.pfNumber} />}
              <Item label="UAN" value={emp.uan} />
              <Item label="Aadhaar" value={emp.aadhaarNumber} />
              {emp.esiNumber !== undefined && <Item label="ESI number" value={emp.esiNumber} />}
              {emp.taxRegime !== undefined && <Item label="Tax regime" value={emp.taxRegime === 'OLD' ? 'Old regime' : 'New regime'} />}
              {emp.fatherName !== undefined && <Item label="Father's name" value={emp.fatherName} />}
            </div>
          </>
        )}
      </Card>

      {emp.salaryBasic !== undefined && (
        <Card className="mt-4 p-5">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Salary Breakup</h3>
          <p className="mb-4 text-xs text-slate-400">
            Monthly CTC {fmtMoney(monthlyCtc)} · Annual CTC {fmtMoney(monthlyCtc * 12)}
          </p>
          {upcoming && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm text-amber-800">
                <span className="font-semibold">Revised salary from {fmtDate(upcoming.effectiveFrom)}</span>
                {upcoming.reason ? ` — ${upcoming.reason}` : ''}. Payroll uses the current structure until then.
              </p>
              <div className="flex rounded-lg border border-amber-200 bg-white p-0.5 text-xs font-medium">
                {(['current', 'upcoming'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setSalaryView(v)}
                    className={`rounded-md px-2.5 py-1 ${salaryView === v ? 'bg-amber-100 text-amber-900' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    {v === 'current' ? 'Current' : `From ${fmtDate(upcoming.effectiveFrom)}`}
                  </button>
                ))}
              </div>
            </div>
          )}
          {grossMonthly > 0 ? (
            <div className="mx-auto max-w-md">
              {upcoming && salaryView === 'upcoming' ? (
                <SalaryBreakup
                  key="upcoming"
                  basic={upcoming.monthly.basic}
                  hra={upcoming.monthly.hra}
                  conveyance={upcoming.monthly.conveyance}
                  medical={upcoming.monthly.medical}
                  allowance={upcoming.monthly.allowance}
                  pfEmployer={upcoming.monthly.pfEmployer}
                  pfEmployee={upcoming.monthly.pfEmployee}
                />
              ) : (
                <SalaryBreakup
                  key="current"
                  basic={emp.salaryBasic ?? 0}
                  hra={emp.salaryHra ?? 0}
                  conveyance={emp.salaryConveyance ?? 0}
                  medical={emp.salaryMedical ?? 0}
                  allowance={emp.salaryAllowance ?? 0}
                  pfEmployer={emp.salaryPfEmployer ?? 0}
                  pfEmployee={emp.salaryPfEmployee ?? 0}
                />
              )}
            </div>
          ) : (
            <p className="text-xs text-amber-600">
              No salary structure set — this employee will be skipped by the payroll run.
              {isCompanyAdmin && ' Use “Edit finance” to enter it.'}
            </p>
          )}
        </Card>
      )}

      </>
      )}

      {passwordOpen && emp.user && (
        <SetPasswordModal employeeId={emp.id} name={emp.name} email={emp.user.email} onClose={() => setPasswordOpen(false)} />
      )}

      <Modal title={`Edit profile — ${emp.name}`} open={editOpen === 'profile'} onClose={() => setEditOpen(null)} wide>
        <div className="space-y-3">
          <ErrorNote error={editError} />
          <div className="grid grid-cols-2 gap-3">
            {profileKeys.map((key) => (
              <Field key={key} label={key.replace(/([A-Z])/g, ' $1')}>
                <Input value={form[key] ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              </Field>
            ))}
            <Field label="Marital status">
              <Select value={form.maritalStatus ?? ''} onChange={(e) => setForm({ ...form, maritalStatus: e.target.value })}>
                <option value="">— not set —</option>
                {['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'].map((v) => (
                  <option key={v} value={v}>
                    {titleCase(v)}
                  </option>
                ))}
              </Select>
            </Field>
            {isCompanyAdmin && (
              <>
                <Field label="Gender">
                  <Select value={form.gender ?? ''} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                    <option value="">— not set —</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="OTHER">Other</option>
                  </Select>
                </Field>
                {useDeptMaster && (
                  <Field label="Department">
                    <Select value={form.departmentId ?? ''} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                      <option value="">— none —</option>
                      {departments?.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {useDesMaster && (
                  <Field label="Designation">
                    <Select value={form.designationId ?? ''} onChange={(e) => setForm({ ...form, designationId: e.target.value })}>
                      <option value="">— none —</option>
                      {designations?.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {grades && grades.length > 0 && (
                  <Field label="Grade (optional)">
                    <Select value={form.gradeId ?? ''} onChange={(e) => setForm({ ...form, gradeId: e.target.value })}>
                      <option value="">— none —</option>
                      {grades?.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.code} · {g.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label="Work office" hint="drives PT / LWF state">
                  <Select value={form.officeId ?? ''} onChange={(e) => setForm({ ...form, officeId: e.target.value })}>
                    <option value="">— none —</option>
                    {offices?.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Notice period (days)">
                  <Input type="number" min={0} max={365} value={form.noticePeriodDays ?? ''} onChange={(e) => setForm({ ...form, noticePeriodDays: e.target.value })} />
                </Field>
              </>
            )}
          </div>
          {isCompanyAdmin && (
            <>
              <p className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Employment dates
              </p>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Date of joining">
                  <DatePicker value={form.joiningDate ?? ''} onChange={(v) => setForm({ ...form, joiningDate: v })} />
                </Field>
                <Field label="Date of birth">
                  <DatePicker value={form.dateOfBirth ?? ''} onChange={(v) => setForm({ ...form, dateOfBirth: v })} />
                </Field>
                <Field label="Leaving date" hint="last working day — clear it to cancel the exit">
                  <DatePicker
                    clearable
                    value={form.leavingDate ?? ''}
                    onChange={(v) => setForm({ ...form, leavingDate: v })}
                  />
                </Field>
                <Field label="Probation ends">
                  <DatePicker clearable value={form.probationEndDate ?? ''} onChange={(v) => setForm({ ...form, probationEndDate: v })} />
                </Field>
                <Field label="Confirmed on">
                  <DatePicker clearable value={form.confirmedOn ?? ''} onChange={(v) => setForm({ ...form, confirmedOn: v })} />
                </Field>
              </div>
            </>
          )}
          {isCompanyAdmin && (
            <Field label="Reason for change" hint="recorded in career history for department / designation / grade / manager / location changes">
              <Input value={form.changeReason ?? ''} maxLength={500} onChange={(e) => setForm({ ...form, changeReason: e.target.value })} />
            </Field>
          )}
          <Button onClick={() => void save([...profileKeys, ...selectKeys, ...dateKeys, ...(isCompanyAdmin ? ['changeReason'] : [])])} className="w-full">
            Save profile
          </Button>
        </div>
      </Modal>

      {transferOpen && (
        <RaiseTransferModal
          employee={{ id: emp.id, name: emp.name }}
          onClose={() => setTransferOpen(false)}
          onDone={() => {
            setTransferOpen(false);
            reload();
          }}
        />
      )}

      <Modal title={`Edit finance — ${emp.name}`} open={editOpen === 'finance'} onClose={() => setEditOpen(null)} wide>
        <div className="space-y-3">
          <ErrorNote error={editError} />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Bank & tax</p>
          <p className="text-xs text-slate-400">PAN, Aadhaar, account number and UAN are stored encrypted.</p>
          <div className="grid grid-cols-2 gap-3">
            {financeKeys.map((key) => (
              <Field key={key} label={key.replace(/([A-Z])/g, ' $1')}>
                <Input value={form[key] ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              </Field>
            ))}
            {isCompanyAdmin && (
              <Field label="Tax regime">
                <Select value={form.taxRegime ?? 'NEW'} onChange={(e) => setForm({ ...form, taxRegime: e.target.value })}>
                  <option value="NEW">New regime</option>
                  <option value="OLD">Old regime</option>
                </Select>
              </Field>
            )}
          </div>
          {isCompanyAdmin && (
            <>
              <p className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Monthly salary structure
              </p>
              <SalaryEditor form={salary} onChange={setSalary} />
            </>
          )}
          <Button onClick={() => void save([...financeKeys, ...(isCompanyAdmin ? ['taxRegime'] : [])])} className="w-full">
            Save finance details
          </Button>
        </div>
      </Modal>
    </div>
  );
}
