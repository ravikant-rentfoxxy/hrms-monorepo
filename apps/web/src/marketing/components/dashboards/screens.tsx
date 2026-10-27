'use client';

import {
  ArrowUpRight,
  Briefcase,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Home,
  MapPin,
  Navigation,
  Plane,
  Receipt,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { cn } from '@/marketing/lib/utils';
import { AppFrame } from './app-frame';
import {
  ATTENDANCE_WEEK,
  EVENTS,
  GROWTH,
  KPIS,
  LEAVE_REQUESTS,
  MONTHS,
  PAYROLL_HISTORY,
  PAYROLL_SPLIT,
  PEOPLE,
  PIPELINE,
} from './data';
import { AreaChart, Avatar, Donut, Kpi, Panel, Progress, StackedBars, StatusPill } from './primitives';

const eventTone = {
  brand: 'bg-brand-50 text-brand-700',
  sky: 'bg-sky-50 text-sky-700',
  amber: 'bg-amber-50 text-amber-700',
  violet: 'bg-violet-50 text-violet-700',
} as const;

const ATT_KEYS = [
  { label: 'In office', color: '#059571' },
  { label: 'Remote / field', color: '#6de6bf' },
  { label: 'On leave', color: '#dde2ea' },
];

export function PipelineBars() {
  const max = PIPELINE[0]!.count;
  return (
    <div className="space-y-2">
      {PIPELINE.map((p, i) => (
        <div key={p.stage} className="flex items-center gap-2.5">
          <span className="w-16 shrink-0 text-[10.5px] font-medium text-ink-500">{p.stage}</span>
          <Progress value={(p.count / max) * 100} color={i === PIPELINE.length - 1 ? '#059571' : `rgba(5,149,113,${0.35 + i * 0.13})`} className="h-2 flex-1" />
          <span className="w-7 text-right text-[11px] font-semibold tabular-nums text-ink-800">{p.count}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ HR admin */

export function AdminDashboard({ compact = false }: { compact?: boolean }) {
  return (
    <AppFrame active="dashboard" title="Good morning, Priya" subtitle="Tuesday, 28 October · Head office" url="app.hrms/dashboard">
      <div className="grid grid-cols-2 gap-2.5 @2xl:grid-cols-4">
        <Kpi label="Total employees" value={KPIS.employees} note={KPIS.employeesDelta} icon={<Users />} />
        <Kpi label="Present today" value={`${KPIS.present}`} note={`${KPIS.presentPct}% attendance`} icon={<UserCheck />} tone="sky" />
        <Kpi label="Pending leave" value={KPIS.pendingLeave} note="4 need your approval" icon={<CalendarClock />} tone="amber" />
        <Kpi label="Monthly payroll" value={KPIS.payroll} note={KPIS.payrollNote} icon={<Wallet />} tone="violet" />
      </div>
      <div className="mt-2.5 grid grid-cols-1 gap-2.5 @3xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title="Attendance this week" action={<StatusPill tone="green">↑ 3.2%</StatusPill>}>
          <StackedBars
            height={compact ? 96 : 118}
            keys={ATT_KEYS}
            data={ATTENDANCE_WEEK.map((d) => ({ label: d.day, values: [d.office, d.remote, d.leave] }))}
          />
        </Panel>
        <Panel title="Recruitment pipeline" action={<span className="text-[10px] font-medium text-ink-400">6 open roles</span>}>
          <PipelineBars />
        </Panel>
      </div>
      <div className="mt-2.5 grid grid-cols-1 gap-2.5 @3xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title="Employee growth" action={<span className="text-[10px] font-semibold text-brand-700">+26.5% YoY</span>}>
          <AreaChart id="growth" values={GROWTH} labels={MONTHS.filter((_, i) => i % 2 === 1)} height={compact ? 70 : 90} />
        </Panel>
        <Panel title="Upcoming" className={cn(compact && 'hidden @3xl:block')}>
          <ul className="space-y-2">
            {EVENTS.slice(0, compact ? 3 : 4).map((e) => (
              <li key={e.title} className="flex items-center gap-2.5">
                <span className={cn('grid w-9 shrink-0 place-items-center rounded-lg py-1 text-center leading-none', eventTone[e.tone])}>
                  <span className="text-[12px] font-bold">{e.date}</span>
                  <span className="text-[8.5px] font-semibold uppercase">{e.month}</span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-semibold text-ink-800">{e.title}</span>
                  <span className="block truncate text-[10px] text-ink-500">{e.meta}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </AppFrame>
  );
}

/* ------------------------------------------------------------ Employee self-service */

export function EmployeeDashboard() {
  const me = PEOPLE[0];
  return (
    <AppFrame active="dashboard" title="My workspace" subtitle={`${me.name} · ${me.role}`} url="app.hrms/me">
      <div className="grid grid-cols-1 gap-2.5 @3xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="rounded-xl bg-gradient-to-br from-ink-900 to-ink-800 p-4 text-white">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10.5px] font-medium text-ink-300">Today · General shift 9:30 – 18:30</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">09:24</p>
              <p className="text-[10.5px] text-brand-300">Checked in · on time</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[10px] font-semibold">
              <Home className="size-3" /> Work from home
            </span>
          </div>
          <div className="mt-4 flex items-center gap-2 text-[10.5px] text-ink-300">
            <MapPin className="size-3.5 text-brand-300" />
            Location captured · Indiranagar, Bengaluru
          </div>
          <div className="mt-3 flex gap-2">
            <span className="rounded-full bg-brand-500 px-3 py-1.5 text-[11px] font-semibold text-white">Check out</span>
            <span className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-semibold">Regularize</span>
          </div>
        </div>
        <Panel title="Leave balance">
          <div className="grid grid-cols-3 gap-2">
            {[
              { code: 'CL', left: 7, of: 12, color: '#0ea5e9' },
              { code: 'EL', left: 11.5, of: 15, color: '#059571' },
              { code: 'SL', left: 9, of: 10, color: '#f59e0b' },
            ].map((l) => (
              <div key={l.code} className="rounded-lg bg-ink-50 p-2.5">
                <p className="text-[10px] font-bold" style={{ color: l.color }}>
                  {l.code}
                </p>
                <p className="mt-0.5 text-base font-bold tabular-nums text-ink-950">{l.left}</p>
                <p className="text-[9.5px] text-ink-500">of {l.of} days</p>
                <Progress value={(l.left / l.of) * 100} color={l.color} className="mt-1.5 h-1" />
              </div>
            ))}
          </div>
          <span className="mt-2.5 inline-flex rounded-full bg-ink-900 px-3 py-1.5 text-[10.5px] font-semibold text-white">Apply leave</span>
        </Panel>
      </div>
      <div className="mt-2.5 grid grid-cols-1 gap-2.5 @3xl:grid-cols-3">
        <Panel title="Latest payslip">
          <p className="text-[10.5px] text-ink-500">September 2026 · net pay</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-ink-950">₹84,620</p>
          <div className="mt-2 flex gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-1 text-[10px] font-semibold text-brand-700">
              <FileText className="size-3" /> View
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-1 text-[10px] font-semibold text-ink-700">
              <Download className="size-3" /> PDF
            </span>
          </div>
        </Panel>
        <Panel title="My requests">
          <ul className="space-y-1.5 text-[10.5px]">
            {[
              { icon: Receipt, t: 'Client visit — cab', s: 'Approved', tone: 'green' as const },
              { icon: Plane, t: 'Pune offsite travel', s: 'Pending', tone: 'amber' as const },
              { icon: CalendarDays, t: 'Casual leave · 2 days', s: 'Level 1/2', tone: 'sky' as const },
            ].map(({ icon: Icon, t, s, tone }) => (
              <li key={t} className="flex items-center gap-2">
                <Icon className="size-3.5 shrink-0 text-ink-400" />
                <span className="min-w-0 flex-1 truncate font-medium text-ink-700">{t}</span>
                <StatusPill tone={tone}>{s}</StatusPill>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Announcements">
          <p className="text-[11px] font-semibold text-ink-800">Diwali celebrations on Friday 🎉</p>
          <p className="mt-0.5 line-clamp-2 text-[10.5px] text-ink-500">Join us at 4 PM in the main hall. Office closes early at 5 PM.</p>
          <p className="mt-2 text-[9.5px] font-medium text-ink-400">People team · 2h ago</p>
        </Panel>
      </div>
    </AppFrame>
  );
}

/* ------------------------------------------------------------ Recruitment */

const CANDIDATES = [
  { p: 1, stage: 'Interview', score: 4.4, role: 'Backend Engineer', tone: 'violet' as const },
  { p: 4, stage: 'Offer', score: 4.7, role: 'Finance Analyst', tone: 'green' as const },
  { p: 7, stage: 'Screening', score: 3.9, role: 'Mobile Engineer', tone: 'sky' as const },
  { p: 6, stage: 'Interview', score: 4.1, role: 'Support Lead', tone: 'violet' as const },
];

export function RecruitmentDashboard() {
  return (
    <AppFrame active="hiring" title="Hiring" subtitle="6 open roles · 184 applications this quarter" url="app.hrms/recruitment">
      <div className="mb-2.5 flex gap-1 overflow-hidden rounded-xl border border-ink-200/70 bg-white p-1 text-[10.5px] font-semibold">
        {['1 Request', '2 Post job', '3 Candidates', '4 Interviews', '5 Offers', '6 Pre-joining'].map((s, i) => (
          <span
            key={s}
            className={cn('flex-1 truncate rounded-lg px-2 py-1.5 text-center', i === 2 ? 'bg-ink-900 text-white' : i < 2 ? 'text-brand-700' : 'text-ink-500')}
          >
            {s}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2.5 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <Panel title="Pipeline · all roles">
          <PipelineBars />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-ink-50 p-2">
              <p className="text-[9.5px] text-ink-500">Time to hire</p>
              <p className="text-sm font-bold text-ink-950">24 days</p>
            </div>
            <div className="rounded-lg bg-ink-50 p-2">
              <p className="text-[9.5px] text-ink-500">Offer acceptance</p>
              <p className="text-sm font-bold text-ink-950">83%</p>
            </div>
          </div>
        </Panel>
        <Panel title="Candidates" action={<span className="text-[10px] font-semibold text-brand-700">View all →</span>}>
          <ul className="divide-y divide-ink-100">
            {CANDIDATES.map((c) => {
              const person = PEOPLE[c.p]!;
              return (
                <li key={person.name} className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0">
                  <Avatar name={person.name} color={person.color} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold text-ink-800">{person.name}</span>
                    <span className="block truncate text-[10px] text-ink-500">{c.role}</span>
                  </span>
                  <span className="hidden text-[10.5px] font-semibold tabular-nums text-ink-700 @lg:block">★ {c.score}</span>
                  <StatusPill tone={c.tone}>{c.stage}</StatusPill>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
      <div className="mt-2.5 grid grid-cols-1 gap-2.5 @2xl:grid-cols-3">
        {[
          { t: 'Senior Backend Engineer', d: 'Engineering · Bengaluru', n: 42, s: 'LinkedIn · Naukri' },
          { t: 'Finance Analyst', d: 'Finance · Mumbai', n: 27, s: 'Referral' },
          { t: 'Customer Success Lead', d: 'Support · Remote', n: 31, s: 'Careers page' },
        ].map((j) => (
          <Panel key={j.t}>
            <div className="flex items-start justify-between gap-2">
              <span className="grid size-7 place-items-center rounded-lg bg-brand-50 text-brand-700">
                <Briefcase className="size-3.5" />
              </span>
              <StatusPill tone="green">Live</StatusPill>
            </div>
            <p className="mt-2 truncate text-[11px] font-semibold text-ink-800">{j.t}</p>
            <p className="truncate text-[10px] text-ink-500">{j.d}</p>
            <p className="mt-1.5 text-[10px] text-ink-500">
              <span className="font-semibold text-ink-800">{j.n}</span> applicants · {j.s}
            </p>
          </Panel>
        ))}
      </div>
    </AppFrame>
  );
}

/* ------------------------------------------------------------ Payroll */

export function PayrollDashboard() {
  return (
    <AppFrame active="payroll" title="Payroll · October 2026" subtitle="248 employees · Head office & 2 branches" url="app.hrms/payroll">
      <div className="mb-2.5 flex items-center gap-1.5 overflow-hidden text-[10px] font-semibold">
        {['Draft', 'Locked', 'Approved', 'Published', 'Paid'].map((s, i) => (
          <span key={s} className="flex min-w-0 flex-1 items-center gap-1.5">
            <span
              className={cn(
                'grid size-5 shrink-0 place-items-center rounded-full',
                i < 3 ? 'bg-brand-600 text-white' : i === 3 ? 'bg-white text-brand-700 ring-2 ring-brand-500' : 'bg-ink-100 text-ink-400'
              )}
            >
              {i < 3 ? <CheckCircle2 className="size-3" /> : i + 1}
            </span>
            <span className={cn('truncate', i <= 3 ? 'text-ink-800' : 'text-ink-400')}>{s}</span>
            {i < 4 && <span className={cn('h-px flex-1', i < 3 ? 'bg-brand-400' : 'bg-ink-200')} />}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2.5 @2xl:grid-cols-4">
        <Kpi label="Gross pay" value="₹2.24 Cr" icon={<Wallet />} />
        <Kpi label="Deductions" value="₹38.6 L" note="PF · ESI · PT · TDS" icon={<Receipt />} tone="amber" />
        <Kpi label="Net payout" value="₹1.86 Cr" icon={<ArrowUpRight />} tone="sky" />
        <Kpi label="Payslips" value="248" note="Ready to publish" icon={<FileText />} tone="violet" />
      </div>
      <div className="mt-2.5 grid grid-cols-1 gap-2.5 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Panel title="Cost breakdown">
          <div className="flex items-center gap-4">
            <Donut
              parts={PAYROLL_SPLIT}
              size={96}
              center={
                <span>
                  <span className="block text-[13px] font-bold text-ink-950">₹2.24Cr</span>
                  <span className="block text-[9px] text-ink-500">gross</span>
                </span>
              }
            />
            <ul className="space-y-1.5">
              {PAYROLL_SPLIT.map((p) => (
                <li key={p.label} className="flex items-center gap-2 text-[10.5px]">
                  <span className="size-2 rounded-sm" style={{ background: p.color }} />
                  <span className="text-ink-600">{p.label}</span>
                  <span className="font-semibold tabular-nums text-ink-900">{p.value}%</span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
        <Panel title="Net payout trend" action={<span className="text-[10px] text-ink-400">₹ Cr · 8 months</span>}>
          <AreaChart id="payroll" values={PAYROLL_HISTORY} color="#6366f1" height={84} labels={['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']} />
        </Panel>
      </div>
      <Panel title="Statutory summary" className="mt-2.5">
        <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
          {[
            { k: 'PF (employer + employee)', v: '₹21.4 L' },
            { k: 'ESI', v: '₹1.9 L' },
            { k: 'Professional Tax', v: '₹49,600' },
            { k: 'TDS', v: '₹14.8 L' },
          ].map((s) => (
            <div key={s.k} className="rounded-lg bg-ink-50 p-2">
              <p className="truncate text-[9.5px] text-ink-500">{s.k}</p>
              <p className="text-[12px] font-bold tabular-nums text-ink-950">{s.v}</p>
            </div>
          ))}
        </div>
      </Panel>
    </AppFrame>
  );
}

/* ------------------------------------------------------------ Attendance */

const TODAY = [
  { p: 1, mode: 'Office', time: '09:12', tone: 'green' as const, icon: MapPin, note: '42 m from office' },
  { p: 0, mode: 'WFH', time: '09:24', tone: 'violet' as const, icon: Home, note: 'Location recorded' },
  { p: 3, mode: 'Field', time: '08:55', tone: 'amber' as const, icon: Navigation, note: 'Client site · Whitefield' },
  { p: 5, mode: 'Office', time: '09:48', tone: 'rose' as const, icon: Clock3, note: 'Late by 18 min' },
];

export function AttendanceDashboard() {
  return (
    <AppFrame active="attendance" title="Attendance · Today" subtitle="General shift 9:30 – 18:30 · grace 15 min" url="app.hrms/attendance">
      <div className="grid grid-cols-2 gap-2.5 @2xl:grid-cols-4">
        <Kpi label="Checked in" value="221" note="of 248 employees" icon={<UserCheck />} />
        <Kpi label="Work from home" value="41" note="location captured" icon={<Home />} tone="violet" />
        <Kpi label="Late arrivals" value="9" note="beyond grace time" icon={<Clock3 />} tone="amber" />
        <Kpi label="On leave" value="8" note="2 half-day" icon={<CalendarDays />} tone="sky" />
      </div>
      <div className="mt-2.5 grid grid-cols-1 gap-2.5 @3xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel title="Live check-ins" action={<StatusPill tone="green">● Live</StatusPill>}>
          <ul className="divide-y divide-ink-100">
            {TODAY.map((t) => {
              const person = PEOPLE[t.p]!;
              const Icon = t.icon;
              return (
                <li key={person.name} className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0">
                  <Avatar name={person.name} color={person.color} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold text-ink-800">{person.name}</span>
                    <span className="flex items-center gap-1 truncate text-[10px] text-ink-500">
                      <Icon className="size-3 shrink-0" /> {t.note}
                    </span>
                  </span>
                  <span className="text-[11px] font-semibold tabular-nums text-ink-800">{t.time}</span>
                  <StatusPill tone={t.tone}>{t.mode}</StatusPill>
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel title="This week">
          <StackedBars height={104} keys={ATT_KEYS} data={ATTENDANCE_WEEK.map((d) => ({ label: d.day, values: [d.office, d.remote, d.leave] }))} />
        </Panel>
      </div>
      <Panel title="Pending approvals" className="mt-2.5">
        <ul className="grid grid-cols-1 gap-2 @2xl:grid-cols-3">
          {LEAVE_REQUESTS.map((r) => {
            const person = PEOPLE[r.who]!;
            return (
              <li key={person.name} className="flex items-center gap-2 rounded-lg bg-ink-50 p-2">
                <Avatar name={person.name} color={person.color} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[10.5px] font-semibold text-ink-800">{r.type}</span>
                  <span className="block truncate text-[9.5px] text-ink-500">
                    {person.name.split(' ')[0]} · {r.days} · {r.when}
                  </span>
                </span>
                <span className="rounded-full bg-brand-600 px-2 py-1 text-[9.5px] font-semibold text-white">Approve</span>
              </li>
            );
          })}
        </ul>
      </Panel>
    </AppFrame>
  );
}
