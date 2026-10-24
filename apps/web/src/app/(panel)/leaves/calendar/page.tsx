'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Button, Card, ErrorNote, Icon, PageHeader, Spinner } from '@/components/ui';
import { LeaveNav, fmtDays } from '../leave-common';

interface CalendarLeave {
  id: string;
  employeeId: string;
  employeeName: string;
  avatarColor: string;
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  status: string;
  days?: number;
  department?: string;
  leaveType?: { code: string; name: string; color: string };
}

interface CalendarData {
  year: number;
  month: number;
  scope: 'team' | 'company';
  holidays: { id: string; name: string; date: string; optional: boolean }[];
  leaves: CalendarLeave[];
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const key = (d: Date) => d.toISOString().slice(0, 10);

export default function LeaveCalendarPage() {
  const { isCompanyAdmin, isManagerial } = useAuth();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [scope, setScope] = useState<'team' | 'company'>(isCompanyAdmin ? 'company' : 'team');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const { data, loading, error } = useFetch<CalendarData>(`/leaves/calendar?year=${ym.y}&month=${ym.m}&scope=${scope}`);

  const shift = (delta: number) => {
    const d = new Date(Date.UTC(ym.y, ym.m - 1 + delta, 1));
    setYm({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 });
    setSelectedDay(null);
  };

  // Grid cells (Monday-first), each with the leaves / holidays on that day.
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(ym.y, ym.m - 1, 1));
    const daysInMonth = new Date(Date.UTC(ym.y, ym.m, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7;
    const out: ({ date: Date; leaves: CalendarLeave[]; holidays: CalendarData['holidays'] } | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(Date.UTC(ym.y, ym.m - 1, d));
      const k = key(date);
      out.push({
        date,
        leaves: (data?.leaves ?? []).filter((l) => l.fromDate.slice(0, 10) <= k && l.toDate.slice(0, 10) >= k),
        holidays: (data?.holidays ?? []).filter((h) => h.date.slice(0, 10) === k),
      });
    }
    while (out.length % 7) out.push(null);
    return out;
  }, [data, ym]);

  const today = key(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  const day = cells.find((c) => c && key(c.date) === selectedDay) ?? null;
  const monthLabel = new Date(ym.y, ym.m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div>
      <PageHeader
        title="Team calendar"
        subtitle={isManagerial ? 'Approved and pending leave of your people' : 'Who in your team is away'}
        actions={
          <>
            {isCompanyAdmin && (
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as 'team' | 'company')}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="company">Whole company</option>
                <option value="team">My team</option>
              </select>
            )}
            <Button variant="secondary" onClick={() => shift(-1)}>
              ‹
            </Button>
            <span className="min-w-36 text-center text-sm font-semibold text-slate-800">{monthLabel}</span>
            <Button variant="secondary" onClick={() => shift(1)}>
              ›
            </Button>
          </>
        }
      />
      <LeaveNav />
      <ErrorNote error={error} />

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card className="overflow-hidden">
          {loading && !data ? (
            <Spinner />
          ) : (
            <div className="grid grid-cols-7">
              {WEEKDAYS.map((w) => (
                <div key={w} className="border-b border-slate-100 bg-slate-50/60 px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {w}
                </div>
              ))}
              {cells.map((c, i) => {
                if (!c) return <div key={`e${i}`} className="min-h-24 border-b border-r border-slate-100 bg-slate-50/30" />;
                const k = key(c.date);
                const weekend = c.date.getUTCDay() === 0 || c.date.getUTCDay() === 6;
                return (
                  <button
                    key={k}
                    onClick={() => setSelectedDay(k)}
                    className={`min-h-24 border-b border-r border-slate-100 p-1.5 text-left align-top transition-colors hover:bg-indigo-50/40 ${
                      weekend ? 'bg-slate-50/60' : ''
                    } ${selectedDay === k ? 'ring-2 ring-inset ring-indigo-400' : ''}`}
                  >
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                        k === today ? 'bg-indigo-600 text-white' : 'text-slate-600'
                      }`}
                    >
                      {c.date.getUTCDate()}
                    </span>
                    {c.holidays.map((h) => (
                      <span key={h.id} className="mt-0.5 block truncate rounded bg-rose-50 px-1 text-[10px] font-medium text-rose-700">
                        {h.name}
                      </span>
                    ))}
                    {c.leaves.slice(0, 3).map((l) => (
                      <span
                        key={l.id}
                        className={`mt-0.5 block truncate rounded px-1 text-[10px] font-medium ${l.status === 'PENDING' ? 'border border-dashed' : ''}`}
                        style={{
                          backgroundColor: `${l.leaveType?.color ?? '#6366F1'}1f`,
                          color: l.leaveType?.color ?? '#4F46E5',
                          borderColor: l.leaveType?.color ?? '#6366F1',
                        }}
                      >
                        {l.employeeName.split(' ')[0]}
                        {l.halfDay ? ' ½' : ''}
                      </span>
                    ))}
                    {c.leaves.length > 3 && <span className="mt-0.5 block text-[10px] text-slate-400">+{c.leaves.length - 3} more</span>}
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-4">
          {!day ? (
            <div className="text-sm text-slate-500">
              <p className="mb-2 font-medium text-slate-700">{data?.leaves.length ?? 0} leave(s) this month</p>
              <p>Select a day to see who is away. Dashed entries are pending approval.</p>
            </div>
          ) : (
            <div>
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Icon name="calendar" className="h-4 w-4 text-indigo-500" />
                {fmtDate(day.date)}
              </p>
              {day.holidays.map((h) => (
                <p key={h.id} className="mb-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-sm text-rose-700">
                  {h.name}
                  {h.optional && ' (optional)'}
                </p>
              ))}
              {day.leaves.length === 0 ? (
                <p className="text-sm text-slate-400">Nobody is away.</p>
              ) : (
                <ul className="space-y-2.5">
                  {day.leaves.map((l) => (
                    <li key={l.id} className="text-sm">
                      <p className="font-medium text-slate-800">
                        {l.employeeName}
                        {l.status === 'PENDING' && <span className="ml-1.5 text-xs font-normal text-amber-600">pending</span>}
                      </p>
                      <p className="text-xs text-slate-500">
                        {l.leaveType ? `${l.leaveType.name} · ` : ''}
                        {fmtDate(l.fromDate)} → {fmtDate(l.toDate)}
                        {l.days !== undefined && ` · ${fmtDays(l.days)}d`}
                        {l.halfDay && ' (half)'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
