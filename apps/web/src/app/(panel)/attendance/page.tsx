'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { API_URL, api, fmtDate, fmtTime, getActingCompanyId, getSession } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, Card, Empty, ErrorNote, Icon, Input, LongText, PageHeader, Spinner, Table, Tabs, Td, statusTone, DatePicker, MonthPicker } from '@/components/ui';

interface Regularization {
  id: string;
  date: string;
  reason: string;
  note: string | null;
  status: string;
  appliedOn: string;
  remarks: string | null;
  employee?: { id: string; name: string; department: string };
  approver?: { id: string; name: string } | null;
  currentLevel?: number | null;
}

type WorkMode = 'OFFICE' | 'REMOTE' | 'FIELD';

const WORK_MODES: { value: WorkMode; label: string; short: string; tone: 'blue' | 'violet' | 'amber'; hint: string }[] = [
  { value: 'OFFICE', label: 'Work from office', short: 'Office', tone: 'blue', hint: 'Check-in only inside the office location (geofence)' },
  { value: 'REMOTE', label: 'Work from home', short: 'WFH', tone: 'violet', hint: 'Check-in from anywhere — location is recorded' },
  { value: 'FIELD', label: 'Field work', short: 'Field', tone: 'amber', hint: 'Check-in from anywhere — location is recorded' },
];
const modeOf = (m: WorkMode | null | undefined) => WORK_MODES.find((x) => x.value === m) ?? WORK_MODES[0];

function ModeBadge({ mode }: { mode: WorkMode | null | undefined }) {
  const m = modeOf(mode);
  return <Badge tone={m.tone}>{m.short}</Badge>;
}

/** Office punches show the distance from the office; WFH / field punches link to the captured spot on a map. */
function PunchLocation({ r }: { r: Record_ }) {
  if (r.checkInDistance != null) return <>{Math.round(r.checkInDistance)} m from office</>;
  if (r.checkInLat == null || r.checkInLng == null) return <>—</>;
  const pin = (lat: number, lng: number, label: string) => (
    <a
      href={`https://www.google.com/maps?q=${lat},${lng}`}
      target="_blank"
      rel="noreferrer"
      className="text-brand-600 hover:underline"
    >
      {label}
    </a>
  );
  return (
    <span className="inline-flex gap-2">
      {pin(r.checkInLat, r.checkInLng, 'In ↗')}
      {r.checkOutLat != null && r.checkOutLng != null && pin(r.checkOutLat, r.checkOutLng, 'Out ↗')}
    </span>
  );
}

interface Record_ {
  id: string;
  date: string;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  checkInDistance: number | null;
  checkInLat?: number | null;
  checkInLng?: number | null;
  checkOutLat?: number | null;
  checkOutLng?: number | null;
  workMode?: WorkMode | null;
  note: string | null;
  lateMinutes?: number;
  workedMinutes?: number | null;
  overtimeMinutes?: number;
  employee?: { id: string; name: string; department: string; workMode?: WorkMode };
  shift?: { id: string; code: string; name: string; color: string } | null;
}

interface TodaySummary {
  date: string;
  shift: { name: string; code: string; startTime: string; endTime: string; graceMinutes: number; isNight: boolean; color: string };
  isWeeklyOff: boolean;
  holiday: string | null;
  leave: { halfDay: boolean; leaveType: { name: string } } | null;
  workMode: WorkMode;
  geofenced: boolean;
  record: Record_ | null;
}

const mins = (m: number | null | undefined) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '—');

/** Worked minutes from the server (break deducted) when available, else the raw punch span. */
const worked = (r: Record_) => (r.workedMinutes != null ? mins(r.workedMinutes) : hoursBetween(r.checkIn, r.checkOut));

function hoursBetween(a: string | null, b: string | null): string {
  if (!a || !b) return '—';
  const ms = new Date(b).getTime() - new Date(a).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
  );
}

function TodayCard() {
  const { data: summary, reload } = useFetch<TodaySummary>('/attendance/today/summary');
  const today = summary?.record ?? null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const punch = async (type: 'check-in' | 'check-out') => {
    setError(null);
    setBusy(true);
    try {
      const pos = await getPosition();
      await api(`/attendance/${type}`, {
        method: 'POST',
        body: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
      });
      reload();
    } catch (err) {
      setError(
        err instanceof GeolocationPositionError
          ? 'Allow location access in your browser — your location is recorded with every check-in'
          : err instanceof Error
            ? err.message
            : 'Failed'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-ink-900">
            Today
            {summary && (
              <span className="ml-2 inline-flex items-center gap-1.5 text-xs font-medium text-ink-500">
                <span className="h-2 w-2 rounded-full" style={{ background: summary.shift.color }} />
                {summary.shift.name} {summary.shift.startTime}–{summary.shift.endTime}
                {summary.shift.isNight ? ' (+1)' : ''} · grace {summary.shift.graceMinutes}m
                {summary.isWeeklyOff && ' · weekly off'}
                {summary.holiday && ` · ${summary.holiday}`}
                {summary.leave && ` · on ${summary.leave.leaveType.name}${summary.leave.halfDay ? ' (half day)' : ''}`}
              </span>
            )}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            {today?.checkIn ? (
              <>
                In <b>{fmtTime(today.checkIn)}</b>
                {today.checkOut && (
                  <>
                    {' '}
                    · Out <b>{fmtTime(today.checkOut)}</b> · Worked <b>{worked(today)}</b>
                    {!!today.overtimeMinutes && (
                      <>
                        {' '}
                        · OT <b>{mins(today.overtimeMinutes)}</b>
                      </>
                    )}
                  </>
                )}
                {!!today.lateMinutes && ` · ${today.lateMinutes} min late`}
                {today.checkInDistance != null && ` · ${Math.round(today.checkInDistance)} m from office`}
              </>
            ) : (
              'Not checked in yet'
            )}
          </p>
          {summary && (
            <p className="mt-2 flex items-center gap-2 text-xs text-ink-500">
              <ModeBadge mode={summary.workMode} />
              {modeOf(summary.workMode).hint}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {today?.status && <Badge tone={statusTone(today.status)}>{today.status}</Badge>}
          {!today?.checkIn && (
            <Button onClick={() => void punch('check-in')} disabled={busy}>
              {busy ? '…' : 'Check in'}
            </Button>
          )}
          {today?.checkIn && !today.checkOut && (
            <Button variant="danger" onClick={() => void punch('check-out')} disabled={busy}>
              {busy ? '…' : 'Check out'}
            </Button>
          )}
        </div>
      </div>
      {error && <div className="mt-3"><ErrorNote error={error} /></div>}
    </Card>
  );
}

export default function AttendancePage() {
  const { session, isManagerial, isCompanyAdmin } = useAuth();
  const [tab, setTab] = useState('My attendance');
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [day, setDay] = useState(now.toISOString().slice(0, 10));

  const [y, m] = month.split('-');
  const mine = useFetch<Record_[]>(
    tab === 'My attendance' && session?.employee ? `/attendance?year=${y}&month=${Number(m)}` : null
  );
  const company = useFetch<Record_[]>(tab === 'Company' ? `/attendance/company?date=${day}` : null);
  const regularizations = useFetch<Regularization[]>(
    tab === 'Regularizations' ? '/attendance/regularizations?scope=company' : null
  );

  const [actionError, setActionError] = useState<string | null>(null);

  const decide = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    setActionError(null);
    try {
      const remarks = decision === 'REJECTED' ? (prompt('Reason for rejection (optional)') ?? undefined) : undefined;
      await api(`/attendance/regularizations/${id}/decide`, { method: 'POST', body: { decision, remarks } });
      regularizations.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed');
    }
  };

  /** Authenticated CSV download (the API needs the Bearer token). */
  const download = async (path: string, fileName: string) => {
    setActionError(null);
    const sessionData = getSession();
    const headers: Record<string, string> = { Authorization: `Bearer ${sessionData?.accessToken}` };
    const acting = sessionData?.role === 'SUPER_ADMIN' ? getActingCompanyId() : null;
    if (acting) headers['X-Company-Id'] = acting;
    const res = await fetch(`${API_URL}${path}?year=${y}&month=${Number(m)}`, { headers });
    if (!res.ok) {
      setActionError(`Download failed (${res.status})`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Attendance"
        subtitle="Check-in / check-out against each employee's shift — office staff inside the geofence, work from home and field staff from anywhere"
        actions={
          isCompanyAdmin ? (
            <>
              <Button variant="secondary" onClick={() => void download('/attendance/muster.csv', `muster-${month}.csv`)}>
                <Icon name="download" className="h-4 w-4" /> Muster {month}
              </Button>
              <Button variant="secondary" onClick={() => void download('/attendance/export', `attendance-${month}.csv`)}>
                Export {month} CSV
              </Button>
            </>
          ) : undefined
        }
      />
      {session?.employee && <TodayCard />}
      {actionError && (
        <div className="mb-4">
          <ErrorNote error={actionError} />
        </div>
      )}
      {isManagerial && (
        <Tabs
          tabs={['My attendance', 'Company', 'Regularizations', ...(isCompanyAdmin ? ['Work mode'] : [])]}
          active={tab}
          onChange={setTab}
        />
      )}

      {tab === 'Work mode' && isCompanyAdmin ? (
        <WorkModePanel />
      ) : tab === 'My attendance' ? (
        <Card>
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink-900">Monthly record</h2>
            <div className="w-48">
              <MonthPicker value={month} onChange={setMonth} />
            </div>
          </div>
          {mine.loading ? (
            <Spinner />
          ) : !session?.employee ? (
            <Empty message="No employee profile on this account" />
          ) : !mine.data || mine.data.length === 0 ? (
            <Empty message="No records for this month" />
          ) : (
            <Table headers={['Date', 'Status', 'Mode', 'Check in', 'Check out', 'Late', 'Worked', 'OT', 'Location']}>
              {mine.data.map((r) => (
                <tr key={r.id}>
                  <Td>{fmtDate(r.date)}</Td>
                  <Td>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </Td>
                  <Td>{r.checkIn ? <ModeBadge mode={r.workMode} /> : '—'}</Td>
                  <Td>{fmtTime(r.checkIn)}</Td>
                  <Td>{fmtTime(r.checkOut)}</Td>
                  <Td>{r.lateMinutes ? `${r.lateMinutes}m` : '—'}</Td>
                  <Td>{worked(r)}</Td>
                  <Td>{mins(r.overtimeMinutes)}</Td>
                  <Td>
                    <PunchLocation r={r} />
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      ) : tab === 'Regularizations' ? (
        <Card>
          <div className="border-b border-ink-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink-900">Attendance regularization requests</h2>
          </div>
          {regularizations.loading ? (
            <Spinner />
          ) : !regularizations.data || regularizations.data.length === 0 ? (
            <Empty message="No regularization requests" />
          ) : (
            <Table headers={['Employee', 'Date', 'Reason', 'Note', 'Status', '']}>
              {regularizations.data.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium text-ink-900">{r.employee?.name}</Td>
                  <Td>{fmtDate(r.date)}</Td>
                  <Td>{r.reason}</Td>
                  <Td>
                  <LongText text={r.note} />
                </Td>
                  <Td>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                    {r.status === 'PENDING' && !!r.currentLevel && r.currentLevel > 1 && (
                      <span className="ml-1 text-xs text-ink-400">level {r.currentLevel}</span>
                    )}
                  </Td>
                  <Td>
                    {r.status === 'PENDING' ? (
                      <div className="flex gap-2">
                        <Button onClick={() => void decide(r.id, 'APPROVED')}>Approve</Button>
                        <Button variant="danger" onClick={() => void decide(r.id, 'REJECTED')}>
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-ink-400">{r.approver?.name ?? ''}</span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      ) : (
        <Card>
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink-900">Company attendance</h2>
            <div className="w-48">
              <DatePicker value={day} onChange={setDay} />
            </div>
          </div>
          {company.loading ? (
            <Spinner />
          ) : !company.data || company.data.length === 0 ? (
            <Empty message="No punches on this day" />
          ) : (
            <Table headers={['Employee', 'Department', 'Shift', 'Mode', 'Status', 'Check in', 'Check out', 'Late', 'Worked', 'OT', 'Location']}>
              {company.data.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium text-ink-900">{r.employee?.name}</Td>
                  <Td>{r.employee?.department || '—'}</Td>
                  <Td>
                    {r.shift ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: r.shift.color }} />
                        {r.shift.code}
                      </span>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>{r.checkIn ? <ModeBadge mode={r.workMode} /> : '—'}</Td>
                  <Td>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </Td>
                  <Td>{fmtTime(r.checkIn)}</Td>
                  <Td>{fmtTime(r.checkOut)}</Td>
                  <Td>{r.lateMinutes ? `${r.lateMinutes}m` : '—'}</Td>
                  <Td>{worked(r)}</Td>
                  <Td>{mins(r.overtimeMinutes)}</Td>
                  <Td>
                    <PunchLocation r={r} />
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}

interface WorkModeRow {
  id: string;
  name: string;
  employeeCode: string;
  department: string;
  designation: string;
  workMode: WorkMode;
}

/** HR / Admin: who works from the office (geofenced), from home or in the field. */
function WorkModePanel() {
  const { data, loading, error, reload } = useFetch<{ items: WorkModeRow[]; counts: Record<WorkMode, number> }>(
    '/attendance/work-modes'
  );
  const [filter, setFilter] = useState<WorkMode | ''>('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.items ?? []).filter(
      (e) =>
        (!filter || e.workMode === filter) &&
        (!term || [e.name, e.employeeCode, e.department, e.designation].some((v) => v.toLowerCase().includes(term)))
    );
  }, [data, filter, q]);

  const save = async (employeeIds: string[], workMode: WorkMode) => {
    setErr(null);
    setBusy(true);
    try {
      await api('/attendance/work-modes', { method: 'PUT', body: { employeeIds, workMode } });
      setSelected(new Set());
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allShown = rows.length > 0 && rows.every((r) => selected.has(r.id));

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  const total = data?.items.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {WORK_MODES.map((m) => (
          <Card key={m.value} className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-ink-900">{m.label}</p>
              <Badge tone={m.tone}>{data?.counts[m.value] ?? 0}</Badge>
            </div>
            <p className="mt-1 text-xs text-ink-500">{m.hint}</p>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {[{ value: '' as const, short: 'All', count: total }, ...WORK_MODES.map((m) => ({ value: m.value, short: m.label, count: data?.counts[m.value] ?? 0 }))].map(
              (c) => (
                <button
                  key={c.value || 'ALL'}
                  type="button"
                  onClick={() => setFilter(c.value)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    filter === c.value ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                  }`}
                >
                  {c.short} ({c.count})
                </button>
              )
            )}
          </div>
          <div className="w-64">
            <Input placeholder="Search name, ID, department…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-brand-100 bg-brand-50 px-4 py-2.5 text-sm">
            <span className="font-medium text-brand-900">{selected.size} selected — set to:</span>
            {WORK_MODES.map((m) => (
              <Button key={m.value} variant="secondary" disabled={busy} onClick={() => void save([...selected], m.value)}>
                {m.label}
              </Button>
            ))}
            <button type="button" className="ml-auto text-xs text-ink-500 hover:underline" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          </div>
        )}
        {err && (
          <div className="px-4 pt-3">
            <ErrorNote error={err} />
          </div>
        )}

        {rows.length === 0 ? (
          <Empty message={total === 0 ? 'No employees yet' : 'No employees match'} />
        ) : (
          <Table headers={['', 'Employee', 'Department', 'Work mode']}>
            <tr className="bg-ink-50/60">
              <Td>
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  checked={allShown}
                  onChange={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      for (const r of rows) {
                        if (allShown) next.delete(r.id);
                        else next.add(r.id);
                      }
                      return next;
                    })
                  }
                />
              </Td>
              <Td className="text-xs text-ink-500">Select all shown ({rows.length})</Td>
              <Td>{''}</Td>
              <Td>{''}</Td>
            </tr>
            {rows.map((e) => (
              <tr key={e.id}>
                <Td>
                  <input type="checkbox" aria-label={`Select ${e.name}`} checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                </Td>
                <Td>
                  <p className="font-medium text-ink-900">{e.name}</p>
                  <p className="text-xs text-ink-500">
                    {e.employeeCode}
                    {e.designation && ` · ${e.designation}`}
                  </p>
                </Td>
                <Td>{e.department || '—'}</Td>
                <Td>
                  <div className="inline-flex rounded-lg bg-ink-100 p-0.5">
                    {WORK_MODES.map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        disabled={busy}
                        title={m.hint}
                        onClick={() => e.workMode !== m.value && void save([e.id], m.value)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          e.workMode === m.value ? 'bg-white text-brand-700 shadow-sm' : 'text-ink-500 hover:text-ink-800'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <p className="text-xs text-ink-500">
        A change applies from the employee&apos;s next check-in. An office location must be set under Settings for the
        office geofence to apply.
      </p>
    </div>
  );
}
