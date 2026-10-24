'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { API_URL, api, fmtDate, fmtTime, getActingCompanyId, getSession } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, Card, Empty, ErrorNote, Icon, PageHeader, Spinner, Table, Tabs, Td, statusTone, DatePicker, MonthPicker } from '@/components/ui';

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

interface Record_ {
  id: string;
  date: string;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  checkInDistance: number | null;
  note: string | null;
  lateMinutes?: number;
  workedMinutes?: number | null;
  overtimeMinutes?: number;
  employee?: { id: string; name: string; department: string };
  shift?: { id: string; code: string; name: string; color: string } | null;
}

interface TodaySummary {
  date: string;
  shift: { name: string; code: string; startTime: string; endTime: string; graceMinutes: number; isNight: boolean; color: string };
  isWeeklyOff: boolean;
  holiday: string | null;
  leave: { halfDay: boolean; leaveType: { name: string } } | null;
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
          ? 'Location permission is required for geofenced attendance'
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
          <p className="text-sm font-semibold text-slate-900">
            Today
            {summary && (
              <span className="ml-2 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <span className="h-2 w-2 rounded-full" style={{ background: summary.shift.color }} />
                {summary.shift.name} {summary.shift.startTime}–{summary.shift.endTime}
                {summary.shift.isNight ? ' (+1)' : ''} · grace {summary.shift.graceMinutes}m
                {summary.isWeeklyOff && ' · weekly off'}
                {summary.holiday && ` · ${summary.holiday}`}
                {summary.leave && ` · on ${summary.leave.leaveType.name}${summary.leave.halfDay ? ' (half day)' : ''}`}
              </span>
            )}
          </p>
          <p className="mt-1 text-sm text-slate-500">
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
        subtitle="Geofenced check-in / check-out against each employee's shift"
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
        <Tabs tabs={['My attendance', 'Company', 'Regularizations']} active={tab} onChange={setTab} />
      )}

      {tab === 'My attendance' ? (
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Monthly record</h2>
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
            <Table headers={['Date', 'Status', 'Check in', 'Check out', 'Late', 'Worked', 'OT', 'Distance']}>
              {mine.data.map((r) => (
                <tr key={r.id}>
                  <Td>{fmtDate(r.date)}</Td>
                  <Td>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </Td>
                  <Td>{fmtTime(r.checkIn)}</Td>
                  <Td>{fmtTime(r.checkOut)}</Td>
                  <Td>{r.lateMinutes ? `${r.lateMinutes}m` : '—'}</Td>
                  <Td>{worked(r)}</Td>
                  <Td>{mins(r.overtimeMinutes)}</Td>
                  <Td>{r.checkInDistance != null ? `${Math.round(r.checkInDistance)} m` : '—'}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      ) : tab === 'Regularizations' ? (
        <Card>
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Attendance regularization requests</h2>
          </div>
          {regularizations.loading ? (
            <Spinner />
          ) : !regularizations.data || regularizations.data.length === 0 ? (
            <Empty message="No regularization requests" />
          ) : (
            <Table headers={['Employee', 'Date', 'Reason', 'Note', 'Status', '']}>
              {regularizations.data.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium text-slate-900">{r.employee?.name}</Td>
                  <Td>{fmtDate(r.date)}</Td>
                  <Td>{r.reason}</Td>
                  <Td className="max-w-50 truncate">{r.note || '—'}</Td>
                  <Td>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                    {r.status === 'PENDING' && !!r.currentLevel && r.currentLevel > 1 && (
                      <span className="ml-1 text-xs text-slate-400">level {r.currentLevel}</span>
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
                      <span className="text-xs text-slate-400">{r.approver?.name ?? ''}</span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      ) : (
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Company attendance</h2>
            <div className="w-48">
              <DatePicker value={day} onChange={setDay} />
            </div>
          </div>
          {company.loading ? (
            <Spinner />
          ) : !company.data || company.data.length === 0 ? (
            <Empty message="No punches on this day" />
          ) : (
            <Table headers={['Employee', 'Department', 'Shift', 'Status', 'Check in', 'Check out', 'Late', 'Worked', 'OT']}>
              {company.data.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium text-slate-900">{r.employee?.name}</Td>
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
                  <Td>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </Td>
                  <Td>{fmtTime(r.checkIn)}</Td>
                  <Td>{fmtTime(r.checkOut)}</Td>
                  <Td>{r.lateMinutes ? `${r.lateMinutes}m` : '—'}</Td>
                  <Td>{worked(r)}</Td>
                  <Td>{mins(r.overtimeMinutes)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
