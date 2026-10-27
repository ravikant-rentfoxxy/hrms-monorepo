'use client';

/** Types and small components shared by the leave pages. */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Card, Icon, statusTone, type IconName } from '@/components/ui';

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  totalPerYear: number;
  color: string;
  isActive: boolean;
  accrualType: 'YEARLY' | 'MONTHLY' | 'NONE';
  accrualRate: number;
  carryForwardMax: number;
  encashable: boolean;
  maxEncashDays: number;
  maxConsecutive: number;
  minNoticeDays: number;
  allowNegative: boolean;
  maxNegative: number;
  applicableAfterDays: number;
  gender: '' | 'MALE' | 'FEMALE';
  sandwichRule: boolean;
  allowHalfDay: boolean;
  isCompOff: boolean;
  compOffExpiryDays: number;
  isPaid: boolean;
}

export interface Balance {
  leaveType: LeaveType;
  year: number;
  total: number;
  used: number;
  pending: number;
  available: number;
  balance: number;
  accrued: number;
  carriedForward: number;
  adjusted: number;
  encashed: number;
  lapsed: number;
  pendingEncashment: number;
}

export interface TrailStep {
  level: number;
  status: string;
  approverName: string | null;
  actedByName: string | null;
  actedAt: string | null;
  remarks: string | null;
}

export interface EmployeeRef {
  id: string;
  name: string;
  department?: string;
  employeeCode?: string;
}

export interface LeaveRequest {
  id: string;
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  days: number;
  reason: string;
  status: string;
  appliedOn: string;
  remarks: string | null;
  leaveType: LeaveType;
  employee?: EmployeeRef;
  approver?: { id: string; name: string } | null;
  approvalSteps?: TrailStep[];
}

export interface CompOffRequest {
  id: string;
  workDate: string;
  days: number;
  reason: string;
  status: string;
  remarks: string | null;
  appliedOn: string;
  employee?: EmployeeRef;
  approvalSteps?: TrailStep[];
}

export interface Encashment {
  id: string;
  days: number;
  amount: number;
  status: string;
  remarks: string | null;
  appliedOn: string;
  paidInMonth: string | null;
  employee?: EmployeeRef;
  leaveType: Pick<LeaveType, 'id' | 'code' | 'name' | 'color'>;
  approvalSteps?: TrailStep[];
}

export const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));

/** Who the request is waiting on, e.g. "Level 2 · HR". */
export function waitingOn(steps?: TrailStep[]): string | null {
  const s = steps?.find((x) => x.status === 'PENDING');
  return s ? `Level ${s.level} · ${s.approverName ?? 'Approver'}` : null;
}

/** Sub-navigation across the leave pages. */
export function LeaveNav() {
  const pathname = usePathname();
  const { isCompanyAdmin } = useAuth();
  const items: { href: string; label: string; icon: IconName }[] = [
    { href: '/leaves', label: 'Requests', icon: 'leaf' },
    { href: '/leaves/calendar', label: 'Team calendar', icon: 'calendar' },
    { href: '/leaves/ledger', label: 'Ledger', icon: 'history' },
    ...(isCompanyAdmin ? [{ href: '/leaves/policies', label: 'Policies', icon: 'settings' as IconName }] : []),
  ];
  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {items.map((i) => {
        const active = i.href === '/leaves' ? pathname === '/leaves' : pathname.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors ${
              active ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-ink-200 bg-white text-ink-600 hover:bg-ink-50'
            }`}
          >
            <Icon name={i.icon} className="h-4 w-4" />
            {i.label}
          </Link>
        );
      })}
    </div>
  );
}

/** Vertical approval timeline. */
export function Trail({ steps }: { steps?: TrailStep[] }) {
  if (!steps || steps.length === 0) {
    return <p className="text-sm text-ink-400">Awaiting the reporting manager (approval chain starts on first action).</p>;
  }
  return (
    <ol className="space-y-3">
      {steps.map((s) => (
        <li key={s.level} className="flex gap-3">
          <span
            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
              s.status === 'APPROVED'
                ? 'bg-emerald-100 text-emerald-700'
                : s.status === 'REJECTED'
                  ? 'bg-rose-100 text-rose-700'
                  : s.status === 'PENDING'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-ink-100 text-ink-500'
            }`}
          >
            {s.level}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-ink-800">{s.approverName ?? 'Approver'}</span>
              <Badge tone={statusTone(s.status)}>{s.status}</Badge>
            </div>
            {s.actedAt && (
              <p className="text-xs text-ink-500">
                {s.actedByName ?? '—'} · {fmtDate(s.actedAt)}
              </p>
            )}
            {s.remarks && <p className="mt-0.5 text-sm text-ink-600">“{s.remarks}”</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Balance cards with the ledger breakdown. */
export function BalanceCards({ balances }: { balances: Balance[] }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {balances.map((b) => (
        <Card key={b.leaveType.id} className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{b.leaveType.name}</p>
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.leaveType.color }} />
          </div>
          <p className="mt-1 text-2xl font-semibold text-ink-900">
            {fmtDays(b.available)}
            <span className="text-sm font-normal text-ink-400"> / {fmtDays(b.total)}</span>
          </p>
          <p className="text-xs text-ink-400">
            used {fmtDays(b.used)} · pending {fmtDays(b.pending)}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-ink-100 pt-2 text-[11px] text-ink-500">
            <span>{b.leaveType.isCompOff ? 'earned' : 'accrued'} {fmtDays(b.accrued)}</span>
            {b.carriedForward !== 0 && <span>carried {fmtDays(b.carriedForward)}</span>}
            {b.adjusted !== 0 && <span>adjusted {b.adjusted > 0 ? '+' : ''}{fmtDays(b.adjusted)}</span>}
            {b.encashed !== 0 && <span>encashed {fmtDays(b.encashed)}</span>}
            {b.lapsed !== 0 && <span>{b.leaveType.isCompOff ? 'expired' : 'lapsed'} {fmtDays(b.lapsed)}</span>}
            {b.pendingEncashment !== 0 && <span>encash pending {fmtDays(b.pendingEncashment)}</span>}
          </div>
        </Card>
      ))}
    </div>
  );
}
