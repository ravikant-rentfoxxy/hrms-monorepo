'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useFetch } from '@/lib/useFetch';
import { fmtDate, fmtMoney, fmtTime } from '@/lib/api';
import { Avatar, Badge, Card, Empty, PageHeader, Spinner, Stat, statusTone } from '@/components/ui';
import { BarList, LineChart, SplitBar } from '@/components/charts';

interface TodaySplit {
  total: number;
  present: number;
  late: number;
  absent: number;
  onLeave: number;
  notMarked: number;
  off: number;
}

interface Person {
  id: string;
  name: string;
  department: string;
  designation: string;
}

interface CompanyAnalytics {
  headcount: number;
  joinersThisMonth: number;
  exitsThisMonth: number;
  attritionRate12m: number;
  today: TodaySplit;
  pendingApprovals: number;
  payrollLastMonth: { month: string; employees: number; gross: number; net: number; employer: number; cost: number } | null;
  upcomingBirthdays: (Person & { date: string })[];
  upcomingAnniversaries: (Person & { date: string; years: number | null })[];
  probationDue: { count: number; items: (Person & { probationEndDate: string; daysLeft: number })[] };
  openPositions: { jobs: number; openings: number };
  openTickets: number;
  headcountTrend: { month: string; headcount: number; joiners: number; exits: number }[];
  departments: { name: string; count: number }[];
}

interface TeamToday {
  size: number;
  today: TodaySplit;
  pendingRequests: { leaves: number; expenses: number; regularizations: number; awaitingYou: number; total: number };
  members: {
    id: string;
    name: string;
    designation: string;
    avatarColor: string;
    status: string;
    checkIn: string | null;
  }[];
}

interface Dashboard {
  todayAttendance: { status: string; checkIn: string | null; checkOut: string | null } | null;
  pendingLeaves: number;
  upcomingHolidays: { id: string; name: string; date: string; optional: boolean }[];
  announcements: { id: string; title: string; category: string; postedOn: string; read: boolean }[];
  unreadAnnouncements: number;
  openTickets: number;
  pendingExpenses: number;
  tasksDue: number;
  myPending?: { approvals: number };
  company?: CompanyAnalytics | null;
  team?: TeamToday | null;
}

interface PlatformStats {
  companies: number;
  activeCompanies: number;
  users: number;
  employees: number;
}

const SPLIT_COLORS = {
  present: '#10B981',
  late: '#F59E0B',
  absent: '#F43F5E',
  onLeave: '#8B5CF6',
  notMarked: '#CBD5E1',
};

function splitParts(t: TodaySplit) {
  return [
    { label: 'Present', value: t.present, color: SPLIT_COLORS.present },
    { label: 'Late', value: t.late, color: SPLIT_COLORS.late },
    { label: 'Absent', value: t.absent, color: SPLIT_COLORS.absent },
    { label: 'On leave', value: t.onLeave, color: SPLIT_COLORS.onLeave },
    { label: 'Not marked', value: t.notMarked + t.off, color: SPLIT_COLORS.notMarked },
  ];
}

function CardTitle({ children, href, action }: { children: React.ReactNode; href?: string; action?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
      <h2 className="text-sm font-semibold text-slate-900">{children}</h2>
      {href && (
        <Link href={href} className="text-xs font-medium text-indigo-600 hover:text-indigo-500">
          {action ?? 'View'}
        </Link>
      )}
    </div>
  );
}

const dayMonth = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function CompanySection({ c }: { c: CompanyAnalytics }) {
  return (
    <section aria-label="Company analytics" className="mt-6 space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Headcount" value={c.headcount} accent="text-indigo-600" icon="users" />
        <Stat
          label="Joiners / exits (month)"
          icon="door"
          value={
            <span>
              <span className="text-emerald-600">+{c.joinersThisMonth}</span>
              <span className="mx-1 text-slate-300">/</span>
              <span className="text-rose-600">−{c.exitsThisMonth}</span>
            </span>
          }
        />
        <Stat label="Attrition (12 months)" value={`${c.attritionRate12m}%`} icon="chart" />
        <Stat label="Pending approvals" value={c.pendingApprovals} accent="text-amber-600" icon="check" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>
            Headcount trend
          </CardTitle>
          <div className="p-4">
            <LineChart
              label="Headcount at month end"
              labels={c.headcountTrend.map((t) => t.month.split(' ')[0] ?? t.month)}
              series={[{ label: 'Headcount', values: c.headcountTrend.map((t) => t.headcount) }]}
              height={180}
            />
          </div>
        </Card>
        <Card>
          <CardTitle>
            Today&apos;s attendance
          </CardTitle>
          <div className="p-4">
            <p className="mb-3 text-2xl font-semibold tracking-tight text-slate-900">
              {c.today.present + c.today.late}
              <span className="text-sm font-normal text-slate-400"> / {c.today.total} in</span>
            </p>
            <SplitBar label="Today's attendance" parts={splitParts(c.today)} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label={c.payrollLastMonth ? `Payroll cost · ${c.payrollLastMonth.month}` : 'Payroll cost (last month)'}
          value={c.payrollLastMonth ? fmtMoney(c.payrollLastMonth.cost) : <span className="text-base text-slate-400">Not published</span>}
          icon="banknote"
        />
        <Stat
          label="Open positions"
          value={
            <span>
              {c.openPositions.openings}
              <span className="ml-1 text-sm font-normal text-slate-400">in {c.openPositions.jobs} jobs</span>
            </span>
          }
          icon="briefcase"
        />
        <Stat label="Open tickets" value={c.openTickets} icon="ticket" />
        <Stat label="Probation due (30 days)" value={c.probationDue.count} accent={c.probationDue.count ? 'text-amber-600' : undefined} icon="shield" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardTitle>
            By department
          </CardTitle>
          <div className="p-4">
            {c.departments.length === 0 ? <Empty message="No employees yet" /> : <BarList label="Headcount by department" items={c.departments.map((d) => ({ label: d.name, value: d.count }))} limit={8} />}
          </div>
        </Card>
        <Card>
          <CardTitle>
            Celebrations · next 30 days
          </CardTitle>
          {c.upcomingBirthdays.length + c.upcomingAnniversaries.length === 0 ? (
            <Empty message="Nothing coming up" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {[
                ...c.upcomingBirthdays.map((b) => ({ ...b, kind: 'Birthday' as const, years: null as number | null })),
                ...c.upcomingAnniversaries.map((a) => ({ ...a, kind: 'Anniversary' as const })),
              ]
                .sort((a, b) => a.date.localeCompare(b.date))
                .slice(0, 8)
                .map((p) => (
                  <li key={`${p.kind}-${p.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-800">{p.name}</p>
                      <p className="text-xs text-slate-400">
                        {p.kind === 'Birthday' ? 'Birthday' : `${p.years} yr${p.years === 1 ? '' : 's'} at work`} · {p.department}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-500">{dayMonth(p.date)}</span>
                  </li>
                ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>
            Probation due
          </CardTitle>
          {c.probationDue.items.length === 0 ? (
            <Empty message="No confirmations due" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {c.probationDue.items.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-800">{p.name}</p>
                    <p className="text-xs text-slate-400">{p.department}</p>
                  </div>
                  {p.daysLeft < 0 ? <Badge tone="red">{-p.daysLeft}d overdue</Badge> : <Badge tone="amber">{fmtDate(p.probationEndDate)}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </section>
  );
}

function TeamSection({ t }: { t: TeamToday }) {
  return (
    <section aria-label="My team" className="mt-6 grid gap-4 lg:grid-cols-3">
      <Card>
        <CardTitle>My team today</CardTitle>
        <div className="p-4">
          <p className="mb-3 text-2xl font-semibold tracking-tight text-slate-900">
            {t.today.present + t.today.late}
            <span className="text-sm font-normal text-slate-400"> / {t.size} in</span>
          </p>
          <SplitBar label="Team attendance today" parts={splitParts(t.today)} />
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-4 text-sm">
            <Link href="/leaves" className="rounded-xl bg-slate-50 px-3 py-2 hover:bg-slate-100">
              <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Leave requests</p>
              <p className="text-lg font-semibold text-amber-600">{t.pendingRequests.leaves}</p>
            </Link>
            <Link href="/approvals" className="rounded-xl bg-slate-50 px-3 py-2 hover:bg-slate-100">
              <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Expenses</p>
              <p className="text-lg font-semibold text-amber-600">{t.pendingRequests.expenses}</p>
            </Link>
            <Link href="/attendance" className="rounded-xl bg-slate-50 px-3 py-2 hover:bg-slate-100">
              <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Regularizations</p>
              <p className="text-lg font-semibold text-amber-600">{t.pendingRequests.regularizations}</p>
            </Link>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Awaiting you</p>
              <p className="text-lg font-semibold text-indigo-600">{t.pendingRequests.awaitingYou}</p>
            </div>
          </div>
        </div>
      </Card>
      <Card className="lg:col-span-2">
        <CardTitle>
          Team members
        </CardTitle>
        {t.members.length === 0 ? (
          <Empty message="No direct reports" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {t.members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar name={m.name} color={m.avatarColor} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{m.name}</p>
                  <p className="truncate text-xs text-slate-400">{m.designation || '—'}</p>
                </div>
                {m.checkIn && <span className="text-xs text-slate-400">In {fmtTime(m.checkIn)}</span>}
                <Badge tone={statusTone(m.status)}>{m.status === 'NOT_MARKED' ? 'Not marked' : m.status.replace('_', ' ')}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

export default function DashboardPage() {
  const { session, hasRole } = useAuth();
  const isSuper = hasRole('SUPER_ADMIN');
  const { data: platform } = useFetch<PlatformStats>(isSuper ? '/superadmin/stats' : null);
  const { data, loading, error } = useFetch<Dashboard>('/dashboard');

  return (
    <div>
      <PageHeader
        title={`Welcome${session?.employee?.name ? `, ${session.employee.name.split(' ')[0]}` : ''}`}
        subtitle={isSuper ? 'Platform overview and the company you are acting in' : session?.activeCompany?.name}
      />

      {isSuper && platform && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Companies" value={platform.companies} accent="text-indigo-600" icon="building" />
          <Stat label="Active companies" value={platform.activeCompanies} icon="building" />
          <Stat label="Users" value={platform.users} icon="user" />
          <Stat label="Employees" value={platform.employees} icon="users" />
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : error ? (
        <Card className="p-6 text-sm text-slate-500">{error}</Card>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat
              label="Today"
              icon="clock"
              value={
                data.todayAttendance ? (
                  <Badge tone={statusTone(data.todayAttendance.status)}>{data.todayAttendance.status}</Badge>
                ) : (
                  <span className="text-slate-400">Not checked in</span>
                )
              }
            />
            <Stat label="Pending leaves" value={data.pendingLeaves} accent="text-amber-600" icon="leaf" />
            <Stat label="Pending expenses" value={data.pendingExpenses} accent="text-amber-600" icon="receipt" />
            {data.myPending && data.myPending.approvals > 0 ? (
              <Stat label="Awaiting your approval" value={data.myPending.approvals} accent="text-indigo-600" icon="check" />
            ) : (
              <Stat label="Tasks due" value={data.tasksDue} accent="text-indigo-600" icon="tasks" />
            )}
          </div>

          {data.company && <CompanySection c={data.company} />}
          {data.team && <TeamSection t={data.team} />}

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">
                Latest announcements {data.unreadAnnouncements > 0 && <Badge tone="red">{data.unreadAnnouncements} new</Badge>}
              </h2>
              {data.announcements.length === 0 ? (
                <Empty message="No announcements yet" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.announcements.map((a) => (
                    <li key={a.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className={`text-sm ${a.read ? 'text-slate-600' : 'font-medium text-slate-900'}`}>{a.title}</p>
                        <p className="text-xs text-slate-400">
                          {a.category} · {fmtDate(a.postedOn)}
                        </p>
                      </div>
                      {!a.read && <Badge tone="blue">new</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Upcoming holidays</h2>
              {data.upcomingHolidays.length === 0 ? (
                <Empty message="No upcoming holidays" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.upcomingHolidays.map((holiday) => (
                    <li key={holiday.id} className="flex items-center justify-between px-4 py-3">
                      <p className="text-sm text-slate-700">{holiday.name}</p>
                      <div className="flex items-center gap-2">
                        {holiday.optional && <Badge tone="slate">optional</Badge>}
                        <span className="text-xs text-slate-400">{fmtDate(holiday.date)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
