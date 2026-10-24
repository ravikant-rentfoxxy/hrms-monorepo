'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useFetch } from '@/lib/useFetch';
import { Button, Card, Empty, ErrorNote, Icon, PageHeader, Select, Spinner, Tabs } from '@/components/ui';

type CellType = 'SHIFT' | 'WEEK_OFF' | 'HOLIDAY' | 'LEAVE' | 'HALF_LEAVE' | 'NOT_EMPLOYED';

interface RosterCell {
  date: string;
  type: CellType;
  shiftId: string;
  code: string;
  color: string;
  label: string;
}

interface Roster {
  from: string;
  to: string;
  days: string[];
  shifts: { id: string; name: string; code: string; startTime: string; endTime: string; color: string; isDefault: boolean; isActive: boolean }[];
  employees: { id: string; name: string; employeeCode: string; department: string; cells: RosterCell[] }[];
}

interface Department {
  id: string;
  name: string;
}

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Monday of the week containing `d` (UTC date). */
function weekStart(d: Date): Date {
  const day = d.getUTCDay();
  return new Date(d.getTime() - ((day + 6) % 7) * DAY);
}

function range(view: string, anchor: Date): { from: Date; to: Date } {
  if (view === 'Week') {
    const from = weekStart(anchor);
    return { from, to: new Date(from.getTime() + 6 * DAY) };
  }
  const from = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  return { from, to: new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)) };
}

function shiftAnchor(view: string, anchor: Date, delta: number): Date {
  if (view === 'Week') return new Date(anchor.getTime() + delta * 7 * DAY);
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + delta, 1));
}

const CELL_STYLE: Record<Exclude<CellType, 'SHIFT'>, { bg: string; text: string; short: string }> = {
  WEEK_OFF: { bg: '#F1F5F9', text: '#94A3B8', short: 'WO' },
  HOLIDAY: { bg: '#E0F2FE', text: '#0284C7', short: 'H' },
  LEAVE: { bg: '#EDE9FE', text: '#7C3AED', short: 'L' },
  HALF_LEAVE: { bg: '#F5F3FF', text: '#7C3AED', short: '½L' },
  NOT_EMPLOYED: { bg: 'transparent', text: '#CBD5E1', short: '' },
};

export default function RosterPage() {
  const { isManagerial } = useAuth();
  const now = new Date();
  const [view, setView] = useState('Week');
  const [anchor, setAnchor] = useState(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  const [departmentId, setDepartmentId] = useState('');
  const { from, to } = range(view, anchor);
  const roster = useFetch<Roster>(
    isManagerial ? `/shifts/roster?from=${iso(from)}&to=${iso(to)}${departmentId ? `&departmentId=${departmentId}` : ''}` : null
  );
  // Department filter is optional: hidden when the masters API is unavailable.
  const departments = useFetch<Department[]>(isManagerial ? '/masters/departments' : null);

  if (!isManagerial) return <Empty message="Only managers, HR and admins can view the roster." />;

  const todayIso = iso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  const title =
    view === 'Week'
      ? `${from.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })} – ${to.toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        })}`
      : from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div>
      <PageHeader title="Roster" subtitle="Who works which shift — weekly offs, holidays and approved leave included" />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Tabs tabs={['Week', 'Month']} active={view} onChange={setView} />
        <div className="mb-5 flex items-center gap-1">
          <Button variant="secondary" onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}>
            ‹
          </Button>
          <span className="min-w-44 text-center text-sm font-semibold text-slate-800">{title}</span>
          <Button variant="secondary" onClick={() => setAnchor(shiftAnchor(view, anchor, 1))}>
            ›
          </Button>
          <Button variant="ghost" onClick={() => setAnchor(utc(todayIso))}>
            Today
          </Button>
        </div>
        {departments.data && departments.data.length > 0 && (
          <div className="mb-5 w-56">
            <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">All departments</option>
              {departments.data.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {roster.data && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
          {roster.data.shifts
            .filter((s) => s.isActive)
            .map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded" style={{ background: s.color }} />
                {s.code} · {s.name} {s.startTime}–{s.endTime}
              </span>
            ))}
          {(['WEEK_OFF', 'HOLIDAY', 'LEAVE'] as const).map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded" style={{ background: CELL_STYLE[t].bg, outline: `1px solid ${CELL_STYLE[t].text}33` }} />
              {CELL_STYLE[t].short} = {t === 'WEEK_OFF' ? 'Week off' : t === 'HOLIDAY' ? 'Holiday' : 'Leave'}
            </span>
          ))}
        </div>
      )}

      <Card>
        {roster.loading ? (
          <Spinner />
        ) : roster.error ? (
          <div className="p-4">
            <ErrorNote error={roster.error} />
          </div>
        ) : !roster.data || roster.data.employees.length === 0 ? (
          <Empty message="No employees in this view" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-left text-xs">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="sticky left-0 z-10 min-w-48 border-b border-slate-200 bg-slate-50 px-4 py-3 font-semibold">Employee</th>
                  {roster.data.days.map((d) => {
                    const date = utc(d);
                    const isToday = d === todayIso;
                    return (
                      <th
                        key={d}
                        className={`border-b border-slate-200 px-1 py-2 text-center font-semibold ${isToday ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-50'}`}
                      >
                        <div>{date.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }).slice(0, 2)}</div>
                        <div className="text-sm text-slate-800">{date.getUTCDate()}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {roster.data.employees.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50/50">
                    <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-4 py-2">
                      <p className="font-medium text-slate-900">{e.name}</p>
                      <p className="text-[11px] text-slate-400">
                        {e.employeeCode}
                        {e.department ? ` · ${e.department}` : ''}
                      </p>
                    </td>
                    {e.cells.map((c) => {
                      const special = c.type === 'SHIFT' ? null : CELL_STYLE[c.type];
                      return (
                        <td key={c.date} className="border-b border-slate-100 p-0.5 text-center" title={`${c.date} · ${c.label}`}>
                          <div
                            className="mx-auto flex h-8 min-w-9 items-center justify-center rounded-md text-[11px] font-semibold"
                            style={
                              special
                                ? { background: special.bg, color: special.text }
                                : { background: `${c.color}1f`, color: c.color, boxShadow: `inset 0 0 0 1px ${c.color}40` }
                            }
                          >
                            {special ? special.short : c.code}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
        <Icon name="clock" className="h-3.5 w-3.5" /> Change shifts from Shifts → Assign shift. Hover a cell for details.
      </p>
    </div>
  );
}
