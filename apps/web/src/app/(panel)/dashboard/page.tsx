'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useFetch } from '@/lib/useFetch';
import { fmtDate, fmtMoney, fmtTime } from '@/lib/api';
import { Avatar, Badge, Card, Empty, Icon, Spinner, Stat, statusTone, type IconName } from '@/components/ui';
import { BarList, SplitBar } from '@/components/charts';
import { AreaChart, Progress, StackedBars } from '@/marketing/components/dashboards/primitives';

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
  overview: Overview;
}

/** Headline widgets — same layout as the product preview on the website. */
interface Overview {
  location: string | null;
  pendingLeave: { total: number; toApprove: number };
  payroll: { month: string; status: string; net: number; employees: number } | null;
  attendanceWeek: {
    days: { date: string; label: string; office: number; remote: number; leave: number }[];
    rate: number | null;
    previousRate: number | null;
  };
  pipeline: { stages: { stage: string; count: number }[]; openRoles: number; openings: number };
  growth: { months: { month: string; headcount: number }[]; changePct: number | null };
  upcoming: { date: string; kind: 'birthday' | 'anniversary' | 'holiday'; title: string; meta: string }[];
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
    <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
      <h2 className="text-sm font-semibold text-ink-900">{children}</h2>
      {href && (
        <Link href={href} className="text-xs font-medium text-brand-600 hover:text-brand-500">
          {action ?? 'View'}
        </Link>
      )}
    </div>
  );
}


/** ₹1.86 Cr / ₹21.1 L / ₹84,620 — the compact amounts used on the dashboard. */
function inrShort(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return fmtMoney(n);
}

const monthName = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' });

function Kpi({ label, value, note, icon, tone }: { label: string; value: React.ReactNode; note?: React.ReactNode; icon: IconName; tone: 'brand' | 'sky' | 'amber' | 'violet' }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-700',
    sky: 'bg-sky-50 text-sky-700',
    amber: 'bg-amber-50 text-amber-700',
    violet: 'bg-violet-50 text-violet-700',
  };
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-500">{label}</p>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
          <Icon name={icon} className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className="mt-2 text-[28px] font-bold leading-none tracking-tight text-ink-950 tabular-nums">{value}</p>
      {note && <p className="mt-2 truncate text-[13px] font-medium text-ink-500">{note}</p>}
    </Card>
  );
}

function Panel({ title, action, href, className = '', children }: { title: string; action?: React.ReactNode; href?: string; className?: string; children: React.ReactNode }) {
  return (
    <Card className={`p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
        {action}
        {href && !action && (
          <Link href={href} className="text-xs font-semibold text-brand-700 hover:underline">
            View
          </Link>
        )}
      </div>
      {children}
    </Card>
  );
}

const ATT_KEYS = [
  { label: 'In office', color: '#059571' },
  { label: 'Remote / field', color: '#6de6bf' },
  { label: 'On leave', color: '#dde2ea' },
];

const EVENT_TONE = {
  birthday: 'bg-amber-50 text-amber-700',
  anniversary: 'bg-brand-50 text-brand-700',
  holiday: 'bg-sky-50 text-sky-700',
} as const;

/** The admin home: KPIs, attendance, hiring, growth and what's coming up. */
function Overview({ c }: { c: CompanyAnalytics }) {
  const o = c.overview;
  const present = c.today.present + c.today.late;
  const presentPct = c.today.total ? Math.round((present / c.today.total) * 100) : 0;
  const months = o.growth.months;
  const quarterDelta = months.length >= 4 ? months[months.length - 1]!.headcount - months[months.length - 4]!.headcount : null;
  const delta = o.attendanceWeek.rate != null && o.attendanceWeek.previousRate != null ? Math.round((o.attendanceWeek.rate - o.attendanceWeek.previousRate) * 10) / 10 : null;
  const pipelineMax = Math.max(1, o.pipeline.stages[0]?.count ?? 0);

  return (
    <section aria-label="Company overview" className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Total employees"
          value={c.headcount}
          note={quarterDelta == null ? undefined : `${quarterDelta >= 0 ? '+' : '−'}${Math.abs(quarterDelta)} this quarter`}
          icon="users"
          tone="brand"
        />
        <Kpi label="Present today" value={present} note={`${presentPct}% attendance`} icon="check" tone="sky" />
        <Kpi
          label="Pending leave"
          value={o.pendingLeave.total}
          note={
            <Link href="/leaves" className="hover:text-ink-800">
              {o.pendingLeave.toApprove} need your approval
            </Link>
          }
          icon="leaf"
          tone="amber"
        />
        <Kpi
          label="Monthly payroll"
          value={o.payroll ? inrShort(o.payroll.net) : '—'}
          note={o.payroll ? `${monthName(o.payroll.month)} run · ${o.payroll.status.toLowerCase()}` : 'No payroll run yet'}
          icon="wallet"
          tone="violet"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel
          title="Attendance · last 5 working days"
          action={
            delta == null ? undefined : (
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${delta >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}%
              </span>
            )
          }
        >
          <StackedBars
            large
            height={170}
            keys={ATT_KEYS}
            data={o.attendanceWeek.days.map((d) => ({ label: `${d.label} ${Number(d.date.slice(8))}`, values: [d.office, d.remote, d.leave] }))}
          />
        </Panel>
        <Panel title="Recruitment pipeline" action={<Link href="/recruitment" className="text-xs font-medium text-ink-400 hover:text-ink-700">{o.pipeline.openRoles} open role{o.pipeline.openRoles === 1 ? '' : 's'}</Link>}>
          <div className="space-y-3.5">
            {o.pipeline.stages.map((p, i) => (
              <div key={p.stage} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-[13px] font-medium text-ink-500">{p.stage}</span>
                <Progress
                  value={(p.count / pipelineMax) * 100}
                  color={i === o.pipeline.stages.length - 1 ? '#059571' : `rgba(5,149,113,${0.35 + i * 0.13})`}
                  className="h-2.5 flex-1"
                />
                <span className="w-8 text-right text-sm font-semibold tabular-nums text-ink-800">{p.count}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-ink-400">Applications in the last 90 days, by the furthest stage reached.</p>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel
          title="Employee growth"
          action={
            o.growth.changePct == null ? undefined : (
              <span className="text-xs font-semibold text-brand-700">
                {o.growth.changePct >= 0 ? '+' : ''}
                {o.growth.changePct}% in 12 months
              </span>
            )
          }
        >
          <AreaChart
            large
            id="growth"
            height={170}
            values={months.map((m) => m.headcount)}
            labels={months.filter((_, i) => i % 2 === 1).map((m) => m.month.split(' ')[0] ?? m.month)}
          />
        </Panel>
        <Panel title="Upcoming">
          {o.upcoming.length === 0 ? (
            <Empty message="Nothing in the next 30 days" />
          ) : (
            <ul className="space-y-3">
              {o.upcoming.slice(0, 4).map((e) => {
                const d = new Date(e.date);
                return (
                  <li key={e.date + e.title} className="flex items-center gap-3">
                    <span className={`grid w-11 shrink-0 place-items-center rounded-xl py-1.5 text-center leading-none ${EVENT_TONE[e.kind]}`}>
                      <span className="text-[15px] font-bold">{String(d.getUTCDate()).padStart(2, '0')}</span>
                      <span className="mt-0.5 text-[10px] font-semibold uppercase">{d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' })}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink-800">{e.title}</span>
                      <span className="block truncate text-xs text-ink-500">{e.meta}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </section>
  );
}

/** Secondary company numbers below the overview. */
function CompanyInsights({ c }: { c: CompanyAnalytics }) {
  return (
    <section aria-label="More insights" className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Joiners / exits (month)"
          icon="door"
          value={
            <span>
              <span className="text-emerald-600">+{c.joinersThisMonth}</span>
              <span className="mx-1 text-ink-300">/</span>
              <span className="text-rose-600">−{c.exitsThisMonth}</span>
            </span>
          }
        />
        <Stat label="Attrition (12 months)" value={`${c.attritionRate12m}%`} icon="chart" />
        <Stat label="Pending approvals" value={c.pendingApprovals} accent="text-amber-600" icon="check" />
        <Stat
          label="Open positions"
          value={
            <span>
              {c.openPositions.openings}
              <span className="ml-1 text-sm font-normal text-ink-400">in {c.openPositions.jobs} jobs</span>
            </span>
          }
          icon="briefcase"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Today's attendance" href="/attendance">
          <p className="mb-3 text-2xl font-bold tracking-tight text-ink-950">
            {c.today.present + c.today.late}
            <span className="text-sm font-normal text-ink-400"> / {c.today.total} in</span>
          </p>
          <SplitBar label="Today's attendance" parts={splitParts(c.today)} />
        </Panel>
        <Panel title="By department" href="/employees">
          {c.departments.length === 0 ? <Empty message="No employees yet" /> : <BarList label="Headcount by department" items={c.departments.map((d) => ({ label: d.name, value: d.count }))} limit={6} />}
        </Panel>
        <Panel title="Probation due" href="/confirmations">
          {c.probationDue.items.length === 0 ? (
            <Empty message="No confirmations due" />
          ) : (
            <ul className="-mx-1 divide-y divide-ink-100">
              {c.probationDue.items.slice(0, 5).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-1 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-800">{p.name}</p>
                    <p className="text-xs text-ink-400">{p.department}</p>
                  </div>
                  {p.daysLeft < 0 ? <Badge tone="red">{-p.daysLeft}d overdue</Badge> : <Badge tone="amber">{fmtDate(p.probationEndDate)}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
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
          <p className="mb-3 text-2xl font-semibold tracking-tight text-ink-900">
            {t.today.present + t.today.late}
            <span className="text-sm font-normal text-ink-400"> / {t.size} in</span>
          </p>
          <SplitBar label="Team attendance today" parts={splitParts(t.today)} />
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-ink-100 pt-4 text-sm">
            <Link href="/leaves" className="rounded-xl bg-ink-50 px-3 py-2 hover:bg-ink-100">
              <p className="text-[11px] font-semibold tracking-wider text-ink-500 uppercase">Leave requests</p>
              <p className="text-lg font-semibold text-amber-600">{t.pendingRequests.leaves}</p>
            </Link>
            <Link href="/approvals" className="rounded-xl bg-ink-50 px-3 py-2 hover:bg-ink-100">
              <p className="text-[11px] font-semibold tracking-wider text-ink-500 uppercase">Expenses</p>
              <p className="text-lg font-semibold text-amber-600">{t.pendingRequests.expenses}</p>
            </Link>
            <Link href="/attendance" className="rounded-xl bg-ink-50 px-3 py-2 hover:bg-ink-100">
              <p className="text-[11px] font-semibold tracking-wider text-ink-500 uppercase">Regularizations</p>
              <p className="text-lg font-semibold text-amber-600">{t.pendingRequests.regularizations}</p>
            </Link>
            <div className="rounded-xl bg-ink-50 px-3 py-2">
              <p className="text-[11px] font-semibold tracking-wider text-ink-500 uppercase">Awaiting you</p>
              <p className="text-lg font-semibold text-brand-600">{t.pendingRequests.awaitingYou}</p>
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
          <ul className="divide-y divide-ink-100">
            {t.members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar name={m.name} color={m.avatarColor} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900">{m.name}</p>
                  <p className="truncate text-xs text-ink-400">{m.designation || '—'}</p>
                </div>
                {m.checkIn && <span className="text-xs text-ink-400">In {fmtTime(m.checkIn)}</span>}
                <Badge tone={statusTone(m.status)}>{m.status === 'NOT_MARKED' ? 'Not marked' : m.status.replace('_', ' ')}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function greeting(now: Date) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { session, hasRole } = useAuth();
  const isSuper = hasRole('SUPER_ADMIN');
  const { data: platform } = useFetch<PlatformStats>(isSuper ? '/superadmin/stats' : null);
  const { data, loading, error } = useFetch<Dashboard>('/dashboard');
  const now = new Date();
  const firstName = session?.employee?.name?.split(' ')[0];
  const place = data?.company?.overview.location ?? session?.activeCompany?.name;

  return (
    <div>
      <div className="mb-7">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-ink-950">
          {greeting(now)}
          {firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="mt-1 text-[15px] text-ink-500">
          {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          {place ? ` · ${place}` : ''}
        </p>
      </div>

      {isSuper && platform && (
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Companies" value={platform.companies} accent="text-brand-600" icon="building" />
          <Stat label="Active companies" value={platform.activeCompanies} icon="building" />
          <Stat label="Users" value={platform.users} icon="user" />
          <Stat label="Employees" value={platform.employees} icon="users" />
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : error ? (
        <Card className="p-6 text-sm text-ink-500">{error}</Card>
      ) : data ? (
        <>
          {data.company ? (
            <>
              <Overview c={data.company} />
              <CompanyInsights c={data.company} />
            </>
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat
                label="Today"
                icon="clock"
                value={
                  data.todayAttendance ? (
                    <Badge tone={statusTone(data.todayAttendance.status)}>{data.todayAttendance.status}</Badge>
                  ) : (
                    <span className="text-ink-400">Not checked in</span>
                  )
                }
              />
              <Stat label="Pending leaves" value={data.pendingLeaves} accent="text-amber-600" icon="leaf" />
              <Stat label="Pending expenses" value={data.pendingExpenses} accent="text-amber-600" icon="receipt" />
              {data.myPending && data.myPending.approvals > 0 ? (
                <Stat label="Awaiting your approval" value={data.myPending.approvals} accent="text-brand-600" icon="check" />
              ) : (
                <Stat label="Open tickets" value={data.openTickets} accent="text-brand-600" icon="ticket" />
              )}
            </div>
          )}

          {data.team && <TeamSection t={data.team} />}

          <div className={`mt-4 grid gap-4 ${data.company ? '' : 'lg:grid-cols-2'}`}>
            <Panel
              title="Latest announcements"
              action={data.unreadAnnouncements > 0 ? <Badge tone="red">{data.unreadAnnouncements} new</Badge> : undefined}
            >
              {data.announcements.length === 0 ? (
                <Empty message="No announcements yet" />
              ) : (
                <ul className="-mx-1 divide-y divide-ink-100">
                  {data.announcements.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-1 py-2.5">
                      <div className="min-w-0">
                        <p className={`truncate text-sm ${a.read ? 'text-ink-600' : 'font-semibold text-ink-900'}`}>{a.title}</p>
                        <p className="text-xs text-ink-400">
                          {a.category} · {fmtDate(a.postedOn)}
                        </p>
                      </div>
                      {!a.read && <Badge tone="blue">new</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {/* Admins see holidays in "Upcoming"; everyone else gets them here. */}
            {!data.company && (
              <Panel title="Upcoming holidays">
                {data.upcomingHolidays.length === 0 ? (
                  <Empty message="No upcoming holidays" />
                ) : (
                  <ul className="-mx-1 divide-y divide-ink-100">
                    {data.upcomingHolidays.map((holiday) => (
                      <li key={holiday.id} className="flex items-center justify-between px-1 py-2.5">
                        <p className="text-sm text-ink-700">{holiday.name}</p>
                        <div className="flex items-center gap-2">
                          {holiday.optional && <Badge tone="slate">optional</Badge>}
                          <span className="text-xs text-ink-400">{fmtDate(holiday.date)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
