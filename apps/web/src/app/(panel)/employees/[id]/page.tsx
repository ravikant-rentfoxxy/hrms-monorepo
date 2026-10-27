'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate, fmtMoney } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Avatar, Badge, Button, Card, Empty, ErrorNote, Field, Icon, Input, LongText, Modal, PageHeader, Select, Spinner, Table, Tabs, Td, DatePicker,
} from '@/components/ui';
import { IdCardPanel } from '@/components/id-card';
import { AuditTable, type AuditPage } from '@/components/audit-log';
import { SalaryBreakup, SalaryEditor, ctcFor, emptySalaryForm, salaryBody, type SalaryForm } from '@/components/salary';
import {
  CareerHistory, EmploymentStatusBadge, LifecycleTimeline, RaiseTransferModal, SourceOfHireBadge,
  type SourceApplication,
} from '@/components/career';
import { openSecureFile } from '@/lib/secure-file';
import { DeleteAssetDialog, EditAssetDialog, IssueAssetsDialog, type EditableAsset } from '@/components/assets';

interface EmployeeDetail {
  id: string;
  /** Role in this company (ADMIN / HR viewers and self only). */
  companyRole?: string | null;
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
  user?: { email: string; role: string; isActive: boolean; lastLoginAt: string | null };
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

interface SlipRow {
  id: string;
  month: string;
  status: string;
  gross: number;
  totalDeductions: number;
  net: number;
  paidOn: string | null;
}

/** The employee's payslips: open the PDF, or (payroll staff) email a published one to the employee. */
function SalarySlipsTab({ employeeId, email, canSend }: { employeeId: string; email: string | null; canSend: boolean }) {
  const { data, loading, error } = useFetch<SlipRow[]>(`/payroll/payslips?employeeId=${employeeId}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const month = (m: string) => new Date(m).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  // Short-lived signed link (5 min) in a new tab; the shell shows the expiry notice.
  const open = async (id: string) => {
    try {
      await openSecureFile(`/payroll/payslips/${id}/pdf?inline=true`);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not open the payslip' });
    }
  };
  const send = async (slip: SlipRow) => {
    if (!window.confirm(`Email the ${month(slip.month)} payslip to ${email}?`)) return;
    setBusy(slip.id);
    setMsg(null);
    try {
      const r = await api<{ sentTo: string; month: string }>(`/payroll/payslips/${slip.id}/email`, { method: 'POST' });
      setMsg({ ok: true, text: `Payslip for ${r.month} sent to ${r.sentTo}.` });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not send the payslip' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <div className="border-b border-ink-100 px-5 py-4">
        <h2 className="text-sm font-semibold text-ink-900">Salary slips</h2>
        <p className="text-xs text-ink-400">
          Published payslips are visible to the employee in the app (Payroll → Payslips).
          {canSend && ' Use Email to also send the PDF to their inbox.'}
        </p>
      </div>
      {msg && (
        <p className={`mx-5 mt-4 rounded-xl px-3.5 py-2.5 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{msg.text}</p>
      )}
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <div className="p-5">
          <ErrorNote error={error} />
        </div>
      ) : !data?.length ? (
        <Empty message="No payslips yet — they appear once a payroll run includes this employee" />
      ) : (
        <Table headers={['Month', 'Gross', 'Deductions', 'Net pay', 'Status', '']}>
          {data.map((s) => (
            <tr key={s.id}>
              <Td className="font-medium text-ink-900">{month(s.month)}</Td>
              <Td>{fmtMoney(s.gross)}</Td>
              <Td className="text-rose-600">−{fmtMoney(s.totalDeductions)}</Td>
              <Td className="font-semibold text-brand-700">{fmtMoney(s.net)}</Td>
              <Td>
                {s.status === 'PUBLISHED' ? <Badge tone="green">Published</Badge> : <Badge tone="amber">Draft</Badge>}
              </Td>
              <Td>
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" onClick={() => void open(s.id)}>
                    View PDF
                  </Button>
                  {canSend && (
                    <Button
                      variant="secondary"
                      disabled={busy === s.id || s.status !== 'PUBLISHED' || !email}
                      onClick={() => void send(s)}
                    >
                      {busy === s.id ? 'Sending…' : 'Email'}
                    </Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {canSend && data?.some((s) => s.status !== 'PUBLISHED') && (
        <p className="px-5 pb-4 pt-2 text-xs text-ink-400">Draft payslips can’t be emailed — publish the payroll run first.</p>
      )}
    </Card>
  );
}

interface AssetHolding {
  id: string;
  issuedOn: string;
  returnedOn: string | null;
  expectedReturn: string | null;
  conditionOut: string;
  conditionIn: string;
  notes: string;
  asset: EditableAsset;
}

/** Company equipment issued to the employee: what they hold now, and what they returned. */
function AssetsTab({ employeeId, employeeName, canManage }: { employeeId: string; employeeName: string; canManage: boolean }) {
  const { data, loading, error, reload } = useFetch<AssetHolding[]>(`/assets/employee/${employeeId}?includeReturned=true`);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AssetHolding | null>(null);
  const [deleting, setDeleting] = useState<AssetHolding | null>(null);
  const holding = (data ?? []).filter((a) => !a.returnedOn);
  const returned = (data ?? []).filter((a) => a.returnedOn);
  const value = holding.reduce((n, a) => n + (a.asset.cost || 0), 0);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-ink-900">With the employee</h2>
            <p className="text-xs text-ink-400">
              {holding.length} item{holding.length === 1 ? '' : 's'}
              {value > 0 && ` · worth ${fmtMoney(value)}`} · must be returned before exit clearance
            </p>
          </div>
          {canManage && (
            <div className="flex items-center gap-3">
              <a href="/assets" className="text-sm font-medium text-ink-500 hover:text-brand-600">
                Return in Assets →
              </a>
              <Button onClick={() => setAdding(true)}>+ Add asset</Button>
            </div>
          )}
        </div>
        {!holding.length ? (
          <Empty message="No company assets with this employee" />
        ) : (
          <Table headers={['Asset', 'Type', 'Description', 'Issued on', 'Condition', ...(canManage ? [''] : [])]}>
            {holding.map((a) => (
              <tr key={a.id}>
                <Td>
                  <p className="font-medium text-ink-900">{a.asset.name}</p>
                  <p className="text-xs text-ink-400">{a.asset.tag}</p>
                </Td>
                <Td>{a.asset.category}</Td>
                <Td className="text-xs text-ink-600">
                  <LongText text={a.asset.notes || (a.asset.serialNumber ? `Serial no. ${a.asset.serialNumber}` : '')} />
                </Td>
                <Td>
                  {fmtDate(a.issuedOn)}
                  {a.expectedReturn && <p className="text-xs text-ink-400">return by {fmtDate(a.expectedReturn)}</p>}
                </Td>
                <Td>{a.conditionOut || '—'}</Td>
                {canManage && (
                  <Td>
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(a)}
                        title="Edit"
                        aria-label={`Edit ${a.asset.name}`}
                        className="rounded-lg p-2 text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-700"
                      >
                        <Icon name="pencil" className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(a)}
                        title="Delete"
                        aria-label={`Delete ${a.asset.name}`}
                        className="rounded-lg p-2 text-ink-500 transition-colors hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Icon name="trash" className="h-4 w-4" />
                      </button>
                    </div>
                  </Td>
                )}
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {adding && (
        <IssueAssetsDialog
          employeeId={employeeId}
          employeeName={employeeName}
          submit={(items) => api(`/assets/employee/${employeeId}/issue`, { method: 'POST', body: { items } })}
          onClose={() => setAdding(false)}
          onDone={reload}
        />
      )}
      {editing && <EditAssetDialog asset={editing.asset} assignment={editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {deleting && (
        <DeleteAssetDialog
          asset={{ ...deleting.asset, status: 'ASSIGNED', holder: { name: employeeName } }}
          onClose={() => setDeleting(null)}
          onDone={reload}
        />
      )}
      {returned.length > 0 && (
        <Card>
          <h2 className="border-b border-ink-100 px-5 py-4 text-sm font-semibold text-ink-900">Returned</h2>
          <Table headers={['Asset', 'Issued on', 'Returned on', 'Condition on return']}>
            {returned.map((a) => (
              <tr key={a.id}>
                <Td>
                  <p className="font-medium text-ink-700">{a.asset.name}</p>
                  <p className="text-xs text-ink-400">{a.asset.tag}</p>
                </Td>
                <Td>{fmtDate(a.issuedOn)}</Td>
                <Td>{fmtDate(a.returnedOn)}</Td>
                <Td>{a.conditionIn || '—'}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}

const ROLE_OPTIONS: { role: string; label: string; about: string }[] = [
  { role: 'EMPLOYEE', label: 'Employee', about: 'Own profile, attendance, leave, payslips' },
  { role: 'MANAGER', label: 'Manager', about: 'Plus team approvals and hiring requests' },
  { role: 'HR', label: 'HR', about: 'Plus all employees, hiring, onboarding, payroll' },
  { role: 'FINANCE', label: 'Finance', about: 'Plus payroll runs & approval, PF / ESI settings, payroll inputs, loans, tax declarations' },
];

/** Admin changes an employee's role in this company. */
function RoleModal({ employeeId, name, current, onClose, onSaved }: { employeeId: string; name: string; current: string; onClose: () => void; onSaved: () => void }) {
  const [role, setRole] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/employees/${employeeId}/role`, { method: 'POST', body: { role } });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the role');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Change role — ${name}`} open onClose={onClose}>
      <div className="space-y-2">
        <ErrorNote error={error} />
        {ROLE_OPTIONS.map((o) => (
          <label
            key={o.role}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${role === o.role ? 'border-brand-400 bg-brand-50/60' : 'border-ink-200 hover:border-ink-300'}`}
          >
            <input type="radio" name="role" checked={role === o.role} onChange={() => setRole(o.role)} className="mt-1" />
            <span>
              <span className="block text-sm font-semibold text-ink-900">{o.label}</span>
              <span className="block text-xs text-ink-500">{o.about}</span>
            </span>
          </label>
        ))}
        <p className="pt-1 text-xs text-ink-400">The change applies within a few minutes, or when they next sign in.</p>
        <Button onClick={() => void save()} disabled={busy || role === current} className="w-full">
          {busy ? 'Saving…' : 'Save role'}
        </Button>
      </div>
    </Modal>
  );
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
          <p className="text-xs text-ink-500">Share it privately. They should change it from My profile after signing in. Any existing sessions were signed out.</p>
          <Button className="w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <ErrorNote error={error} />
          <p className="text-sm text-ink-600">
            Login email: <span className="font-semibold text-ink-900">{email}</span>
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
        <div className="flex items-center justify-end gap-3 border-t border-ink-100 p-3 text-sm text-ink-500">
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
function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-0.5 text-sm text-ink-800">{value || '—'}</p>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { session, isCompanyAdmin, canManagePayroll } = useAuth();
  const { data: emp, loading, error, reload } = useFetch<EmployeeDetail>(`/employees/${id}`);
  const [editOpen, setEditOpen] = useState<'profile' | 'finance' | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [salary, setSalary] = useState<SalaryForm>(emptySalaryForm);
  const [tab, setTab] = useState('Profile');
  const [transferOpen, setTransferOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
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
    ...(canManagePayroll || isSelf ? ['Salary slips'] : []),
    ...(seesCareer ? ['Assets'] : []),
    ...(isCompanyAdmin || isSelf ? ['ID card'] : []),
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
            {(session?.role === 'ADMIN' || session?.role === 'SUPER_ADMIN') && emp.isActive && !isSelf && emp.companyRole && emp.companyRole !== 'ADMIN' && (
              <Button variant="secondary" onClick={() => setRoleOpen(true)}>
                Role: {ROLE_OPTIONS.find((o) => o.role === emp.companyRole)?.label ?? emp.companyRole}
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
          <span className="text-xs text-ink-500">until {fmtDate(emp.probationEndDate)}</span>
        )}
        {emp.employmentStatus === 'NOTICE_PERIOD' && emp.leavingDate && (
          <span className="text-xs text-ink-500">last day {fmtDate(emp.leavingDate)}</span>
        )}
        {(isCompanyAdmin || isSelf) && <SourceOfHireBadge hireSource={emp.hireSource} application={emp.sourceApplication} />}
        {emp.archivedAt && <Badge tone="slate">archived {fmtDate(emp.archivedAt)}</Badge>}
      </div>

      {separated && (
        <Card className="mb-4 border-l-4 border-l-ink-400 p-4 text-sm text-ink-600">
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

      {tabs.length > 1 && <Tabs tabs={tabs} active={tab} onChange={setTab} />}

      {tab === 'ID card' && (isCompanyAdmin || isSelf) ? (
        <IdCardPanel employeeId={isCompanyAdmin ? id : 'me'} canManage={isCompanyAdmin} />
      ) : tab === 'Assets' && seesCareer ? (
        <AssetsTab employeeId={id} employeeName={emp.name} canManage={isCompanyAdmin} />
      ) : tab === 'Salary slips' && (canManagePayroll || isSelf) ? (
        <SalarySlipsTab employeeId={id} email={emp.user?.email ?? null} canSend={canManagePayroll} />
      ) : tab === 'History' && isCompanyAdmin ? (
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
            <p className="font-semibold text-ink-900">
              {emp.name} <span className="text-sm font-normal text-ink-400">({emp.employeeCode})</span>
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
        </div>
        {(emp.bankName !== undefined || emp.pan !== undefined) && (
          <>
            <h3 className="mb-3 mt-6 flex items-center gap-2 border-t border-ink-100 pt-4 text-sm font-semibold text-ink-900">
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
          <h3 className="mb-1 text-sm font-semibold text-ink-900">Salary Breakup</h3>
          <p className="mb-4 text-xs text-ink-400">
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
                    className={`rounded-md px-2.5 py-1 ${salaryView === v ? 'bg-amber-100 text-amber-900' : 'text-ink-500 hover:text-ink-800'}`}
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

      {roleOpen && emp.companyRole && (
        <RoleModal employeeId={emp.id} name={emp.name} current={emp.companyRole} onClose={() => setRoleOpen(false)} onSaved={reload} />
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
              <p className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
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
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">Bank & tax</p>
          <p className="text-xs text-ink-400">PAN, Aadhaar, account number and UAN are stored encrypted.</p>
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
              <p className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
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
