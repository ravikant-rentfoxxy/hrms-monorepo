'use client';

/** Types and small shared pieces of the exit (separation) pages. */

import { Badge, Card, statusTone } from '@/components/ui';
import { humanize } from '@/components/lifecycle';

export interface StageStep {
  key: string;
  label: string;
  done: boolean;
}

export interface Stage {
  steps: StageStep[];
  current: string;
  currentLabel: string;
  progress: number;
}

export interface Notice {
  startDate: string;
  lastDay: string;
  totalDays: number;
  servedDays: number;
  remainingDays: number;
  serving: boolean;
}

export interface ExitEmployee {
  id: string;
  name: string;
  employeeCode: string;
  designation: string;
  department: string;
  joiningDate: string;
  managerId: string | null;
  isActive: boolean;
  employmentStatus: string;
  separatedOn: string | null;
  rehireEligible: boolean | null;
  rehireNote: string;
  archivedAt: string | null;
}

export interface ExitRow {
  id: string;
  code: string | null;
  exitType: string;
  reason: string;
  status: string;
  appliedOn: string;
  noticePeriodDays: number;
  requestedLastDay: string;
  approvedLastDay: string | null;
  shortfallDays: number;
  noticeWaived: boolean;
  closedAt: string | null;
  lastDayChangeStatus: string;
  clearedCount: number;
  clearanceCount: number;
  clearanceStatus: string;
  handoverCount: number;
  handoverVerified: number;
  interviewDone: boolean;
  settlement: { status: string; netAmount: number; dueDate: string | null; paidOn: string | null } | null;
  fnfOverdue: boolean;
  notice: Notice;
  stage: Stage;
  employee: ExitEmployee;
}

export const exitTone = (s: string) => (s === 'COMPLETED' ? 'violet' : s === 'WITHDRAWN' ? 'slate' : statusTone(s));

/** Status shown to people: an approved exit whose last day is ahead reads "Serving notice". */
export function exitStatusLabel(r: { status: string; closedAt: string | null; notice: Notice }): string {
  if (r.closedAt) return 'Closed';
  if (r.status === 'APPROVED') return r.notice.serving ? 'Serving notice' : 'Last day passed';
  return humanize(r.status);
}

export function ExitStatusBadge({ r }: { r: { status: string; closedAt: string | null; notice: Notice } }) {
  const tone = r.closedAt ? 'slate' : r.status === 'APPROVED' ? 'blue' : exitTone(r.status);
  return <Badge tone={tone}>{exitStatusLabel(r)}</Badge>;
}

export const clearanceTone = (s: string) => (s === 'CLEARED' || s === 'COMPLETED' ? 'green' : s === 'IN_PROGRESS' ? 'blue' : 'amber');

export function StageBar({ stage, compact }: { stage: Stage; compact?: boolean }) {
  const pct = Math.max(0, Math.min(100, stage.progress));
  return (
    <div className={compact ? 'min-w-36' : ''}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-600">{stage.currentLabel}</span>
        <span className="text-[11px] text-ink-400">{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
        <div className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Full stepper: Resignation submitted → … → Closed / archived. */
export function StageStepper({ stage, stopped }: { stage: Stage; stopped?: string }) {
  const pct = Math.max(0, Math.min(100, stage.progress));
  return (
    <Card className="mb-5 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">Exit progress</p>
          <p className="text-sm font-semibold text-ink-900">{stopped ?? `Current stage: ${stage.currentLabel}`}</p>
        </div>
        <span className="text-sm font-semibold text-brand-600">{pct}%</span>
      </div>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-ink-100">
        <div className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
      </div>
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {stage.steps.map((s, i) => {
          const current = !stopped && s.key === stage.current && !s.done;
          return (
            <li key={s.key} className="flex items-start gap-2">
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                  s.done
                    ? 'bg-emerald-500 text-white'
                    : current
                      ? 'bg-brand-600 text-white ring-4 ring-brand-100'
                      : 'bg-ink-100 text-ink-400'
                }`}
              >
                {s.done ? '✓' : i + 1}
              </span>
              <span className={`text-xs leading-snug ${s.done ? 'text-ink-700' : current ? 'font-semibold text-brand-700' : 'text-ink-400'}`}>
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

export function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}

export function MiniStat({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: string }) {
  return (
    <Card className="p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">{label}</p>
      <p className={`mt-1 font-semibold ${accent ?? 'text-ink-900'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-400">{sub}</p>}
    </Card>
  );
}
