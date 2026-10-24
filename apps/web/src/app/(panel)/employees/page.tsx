'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Avatar, Badge, Button, Card, DatePicker, Empty, ErrorNote, Field, Input, Modal, MonthPicker, PageHeader, Select, Spinner, Table, Tabs, Td,
} from '@/components/ui';
import { SalaryEditor, emptySalaryForm, salaryBody, type SalaryForm } from '@/components/salary';
import { EmploymentStatusBadge } from '@/components/career';
import { downloadFile } from '@/components/download';

/** Status tabs → `status` query value. "Former employees" is ADMIN/HR only. */
const STATUS_TABS: { label: string; status: string; count?: 'PROBATION' | 'ACTIVE' | 'NOTICE_PERIOD' | 'SEPARATED' }[] = [
  { label: 'Current', status: 'CURRENT' },
  { label: 'On probation', status: 'PROBATION', count: 'PROBATION' },
  { label: 'Active', status: 'ACTIVE', count: 'ACTIVE' },
  { label: 'Serving notice', status: 'NOTICE_PERIOD', count: 'NOTICE_PERIOD' },
  { label: 'Former employees', status: 'SEPARATED', count: 'SEPARATED' },
];

interface MasterOption {
  id: string;
  name: string;
  code?: string;
}

interface EmployeeRow {
  id: string;
  employeeCode: string;
  name: string;
  designation: string;
  department: string;
  location: string;
  avatarColor: string;
  user: { email: string };
  manager: { id: string; name: string } | null;
  employmentStatus: string;
  joiningDate: string;
  probationEndDate: string | null;
  isActive: boolean;
  // Former-employee archive only.
  separatedOn?: string | null;
  leavingDate?: string | null;
  separationReason?: string;
  rehireEligible?: boolean | null;
  archivedAt?: string | null;
}

export default function EmployeesPage() {
  const { isCompanyAdmin } = useAuth();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusTab, setStatusTab] = useState('Current');
  const [rehire, setRehire] = useState('');
  const status = STATUS_TABS.find((t) => t.label === statusTab)?.status ?? 'CURRENT';
  const former = status === 'SEPARATED';
  const filterQs = `${query ? `&q=${encodeURIComponent(query)}` : ''}${deptFilter ? `&departmentId=${deptFilter}` : ''}${
    former && rehire ? `&rehireEligible=${rehire}` : ''}`;
  const { data, loading, reload } = useFetch<{
    items: EmployeeRow[];
    total: number;
    counts?: Record<'PROBATION' | 'ACTIVE' | 'NOTICE_PERIOD' | 'SEPARATED', number>;
  }>(`/employees?pageSize=100&status=${status}${filterQs}`);
  const tabs = STATUS_TABS.filter((t) => isCompanyAdmin || t.status !== 'SEPARATED').map((t) =>
    t.count && data?.counts ? `${t.label} (${data.counts[t.count]})` : t.label
  );
  const activeTabLabel = tabs.find((t) => t.startsWith(statusTab)) ?? statusTab;
  const [exportError, setExportError] = useState<string | null>(null);
  const { data: departments } = useFetch<MasterOption[]>('/masters/departments');
  const { data: designations } = useFetch<MasterOption[]>(isCompanyAdmin ? '/masters/designations' : null);
  const { data: grades } = useFetch<MasterOption[]>(isCompanyAdmin ? '/masters/grades' : null);
  // Working-days column: payable days (check-ins + approved leave) for the picked month.
  const now = new Date();
  const [wdMonth, setWdMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const { data: workingDays } = useFetch<{
    workingDays: number;
    source: 'auto' | 'fixed';
    calendarDays: number;
    weekendDays: number;
    holidayDays: number;
    items: { employeeId: string; worked: number; leave: number; payable: number }[];
  }>(isCompanyAdmin && wdMonth ? `/attendance/working-days?year=${wdMonth.slice(0, 4)}&month=${Number(wdMonth.slice(5, 7))}` : null);
  const payableBy = new Map((workingDays?.items ?? []).map((i) => [i.employeeId, i]));
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const empty = {
    name: '', email: '', password: '', designation: '', department: '', departmentId: '', designationId: '', gradeId: '',
    role: 'EMPLOYEE', managerId: '', phone: '', dateOfBirth: '', joiningDate: '', gender: '', probationEndDate: '',
    noticePeriodDays: '', personalEmail: '',
  };
  const [form, setForm] = useState(empty);
  const [salary, setSalary] = useState<SalaryForm>(emptySalaryForm);

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      await api('/employees', {
        method: 'POST',
        body: {
          name: form.name,
          email: form.email,
          ...(form.password ? { password: form.password } : {}),
          // A picked master wins; free text stays for companies without masters yet.
          ...(form.departmentId ? { departmentId: form.departmentId } : { department: form.department }),
          ...(form.designationId ? { designationId: form.designationId } : { designation: form.designation }),
          ...(form.gradeId ? { gradeId: form.gradeId } : {}),
          ...(form.gender ? { gender: form.gender } : {}),
          ...(form.probationEndDate ? { probationEndDate: form.probationEndDate } : {}),
          ...(form.noticePeriodDays ? { noticePeriodDays: Number(form.noticePeriodDays) } : {}),
          ...(form.personalEmail ? { personalEmail: form.personalEmail } : {}),
          role: form.role,
          ...(form.managerId ? { managerId: form.managerId } : {}),
          ...(form.phone ? { phone: form.phone } : {}),
          ...(form.dateOfBirth ? { dateOfBirth: form.dateOfBirth } : {}),
          ...(form.joiningDate ? { joiningDate: form.joiningDate } : {}),
          ...salaryBody(salary),
        },
      });
      setShowCreate(false);
      setForm(empty);
      setSalary(emptySalaryForm);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle={former ? `${data?.total ?? 0} former employees in the archive` : `${data?.total ?? 0} people in the directory`}
        actions={
          isCompanyAdmin ? (
            former ? (
              <Button
                variant="secondary"
                onClick={() =>
                  void downloadFile(`/employees/former/export?status=SEPARATED${filterQs}`, 'former-employees.csv').catch((err: unknown) =>
                    setExportError(err instanceof Error ? err.message : 'Export failed')
                  )
                }
              >
                Export CSV
              </Button>
            ) : (
              <Button onClick={() => setShowCreate(true)}>+ Add employee</Button>
            )
          ) : undefined
        }
      />

      <Tabs tabs={tabs} active={activeTabLabel} onChange={(t) => setStatusTab(STATUS_TABS.find((x) => t.startsWith(x.label))?.label ?? 'Current')} />
      <ErrorNote error={exportError} />

      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q);
        }}
      >
        <Input
          placeholder={former ? 'Search name, ID, reason for leaving…' : 'Search name, ID, designation, department…'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-sm"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {departments && departments.length > 0 && (
          <div className="w-52">
            <Select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        {former && (
          <div className="w-48">
            <Select value={rehire} onChange={(e) => setRehire(e.target.value)}>
              <option value="">Any rehire eligibility</option>
              <option value="true">Eligible for rehire</option>
              <option value="false">Not eligible</option>
            </Select>
          </div>
        )}
        {isCompanyAdmin && !former && (
          <div className="ml-auto flex items-center gap-2">
            <div className="text-right">
              <span className="block text-xs font-medium text-slate-500">Working days for</span>
              {workingDays && (
                <span className="block text-[11px] text-slate-400">
                  {workingDays.workingDays} days
                  {workingDays.source === 'auto'
                    ? ` = ${workingDays.calendarDays} − ${workingDays.weekendDays} weekend − ${workingDays.holidayDays} holiday`
                    : ' (fixed office norm)'}
                </span>
              )}
            </div>
            <div className="w-44">
              <MonthPicker value={wdMonth} onChange={setWdMonth} />
            </div>
          </div>
        )}
      </form>

      <Card>
        {loading ? (
          <Spinner />
        ) : !data || data.items.length === 0 ? (
          <Empty message={former ? 'No former employees found' : 'No employees found'} />
        ) : former ? (
          <Table headers={['Employee', 'Code', 'Department', 'Designation', 'Joined', 'Separated on', 'Reason', 'Rehire']}>
            {data.items.map((emp) => (
              <tr key={emp.id} className="hover:bg-slate-50">
                <Td>
                  <Link href={`/employees/${emp.id}`} className="flex items-center gap-2.5">
                    <Avatar name={emp.name} color={emp.avatarColor} />
                    <span>
                      <span className="block font-medium text-indigo-700 hover:underline">{emp.name}</span>
                      <span className="block text-xs text-slate-400">{emp.user.email}</span>
                    </span>
                  </Link>
                </Td>
                <Td>{emp.employeeCode}</Td>
                <Td>{emp.department || '—'}</Td>
                <Td>{emp.designation || '—'}</Td>
                <Td>{fmtDate(emp.joiningDate)}</Td>
                <Td>
                  {emp.separatedOn || emp.leavingDate ? fmtDate(emp.separatedOn ?? emp.leavingDate) : '—'}
                  {emp.archivedAt && <span className="block text-xs text-slate-400">archived</span>}
                </Td>
                <Td className="max-w-xs truncate">{emp.separationReason || '—'}</Td>
                <Td>
                  {emp.rehireEligible === true ? (
                    <Badge tone="green">eligible</Badge>
                  ) : emp.rehireEligible === false ? (
                    <Badge tone="red">not eligible</Badge>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <Table
            headers={[
              'Employee', 'Code', 'Department', 'Designation', 'Manager', 'Location',
              ...(isCompanyAdmin ? ['Working days'] : []),
            ]}
          >
            {data.items.map((emp) => {
              const wd = payableBy.get(emp.id);
              return (
                <tr key={emp.id} className="hover:bg-slate-50">
                  <Td>
                    <Link href={`/employees/${emp.id}`} className="flex items-center gap-2.5">
                      <Avatar name={emp.name} color={emp.avatarColor} />
                      <span>
                        <span className="flex items-center gap-1.5">
                          <span className="font-medium text-indigo-700 hover:underline">{emp.name}</span>
                          <EmploymentStatusBadge status={emp.employmentStatus} hideActive />
                        </span>
                        <span className="block text-xs text-slate-400">{emp.user.email}</span>
                      </span>
                    </Link>
                  </Td>
                  <Td>{emp.employeeCode}</Td>
                  <Td>{emp.department || '—'}</Td>
                  <Td>{emp.designation || '—'}</Td>
                  <Td>{emp.manager?.name ?? '—'}</Td>
                  <Td>{emp.location || '—'}</Td>
                  {isCompanyAdmin && (
                    <Td>
                      <span className={`font-semibold tabular-nums ${wd ? 'text-slate-800' : 'text-slate-300'}`}>
                        {wd ? wd.payable : 0} / {workingDays?.workingDays ?? '…'}
                      </span>
                      {wd && wd.leave > 0 && (
                        <span className="block text-xs text-amber-600">incl. {wd.leave} leave</span>
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Modal title="Add employee" open={showCreate} onClose={() => setShowCreate(false)} wide>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Password" hint="leave empty if this email already has an account">
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <Field label="Designation">
              {designations && designations.length > 0 ? (
                <Select value={form.designationId} onChange={(e) => setForm({ ...form, designationId: e.target.value })}>
                  <option value="">— select —</option>
                  {designations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
              )}
            </Field>
            <Field label="Department">
              {departments && departments.length > 0 ? (
                <Select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                  <option value="">— select —</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
              )}
            </Field>
            {grades && grades.length > 0 && (
              <Field label="Grade (optional)">
                <Select value={form.gradeId} onChange={(e) => setForm({ ...form, gradeId: e.target.value })}>
                  <option value="">— none —</option>
                  {grades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.code} · {g.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Gender">
              <Select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="">— not set —</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </Select>
            </Field>
            <Field label="Role">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {['EMPLOYEE', 'MANAGER', 'HR'].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            </Field>
            <Field label="Manager">
              <Select value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.target.value })}>
                <option value="">— none —</option>
                {data?.items.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Date of birth">
              <DatePicker value={form.dateOfBirth} onChange={(v) => setForm({ ...form, dateOfBirth: v })} />
            </Field>
            <Field label="Date of joining" hint="defaults to today if left empty">
              <DatePicker value={form.joiningDate} onChange={(v) => setForm({ ...form, joiningDate: v })} />
            </Field>
            <Field label="Probation ends">
              <DatePicker clearable value={form.probationEndDate} onChange={(v) => setForm({ ...form, probationEndDate: v })} />
            </Field>
            <Field label="Notice period (days)" hint="defaults to 30">
              <Input type="number" min={0} max={365} value={form.noticePeriodDays} onChange={(e) => setForm({ ...form, noticePeriodDays: e.target.value })} />
            </Field>
            <Field label="Personal email">
              <Input type="email" value={form.personalEmail} onChange={(e) => setForm({ ...form, personalEmail: e.target.value })} />
            </Field>
          </div>
          <p className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Monthly salary structure (optional — needed for the payroll run)
          </p>
          <SalaryEditor form={salary} onChange={setSalary} />
          <Button
            onClick={() => void create()}
            disabled={busy || !form.name || !form.email}
            className="w-full"
          >
            Create employee
          </Button>
        </div>
      </Modal>
    </div>
  );
}
