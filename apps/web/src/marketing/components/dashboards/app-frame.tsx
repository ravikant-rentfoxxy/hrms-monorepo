import * as React from 'react';
import {
  BarChart3,
  Briefcase,
  CalendarCheck2,
  CheckCheck,
  LayoutDashboard,
  Settings,
  Users,
  Wallet,
} from 'lucide-react';
import { LogoMark } from '@/marketing/components/site/logo';
import { cn } from '@/marketing/lib/utils';

const NAV = [
  { icon: LayoutDashboard, key: 'dashboard' },
  { icon: Users, key: 'people' },
  { icon: CalendarCheck2, key: 'attendance' },
  { icon: Wallet, key: 'payroll' },
  { icon: Briefcase, key: 'hiring' },
  { icon: CheckCheck, key: 'approvals' },
  { icon: BarChart3, key: 'reports' },
] as const;

export type FrameNav = (typeof NAV)[number]['key'];

/**
 * Product window chrome around a dashboard preview: browser bar, slim icon
 * sidebar and a top bar. The content area is a container-query context so
 * previews reflow by the frame's width, not the viewport's.
 */
export function AppFrame({
  active,
  title,
  subtitle,
  url,
  children,
  className,
}: {
  active: FrameNav;
  title: string;
  subtitle?: string;
  url: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('overflow-hidden rounded-2xl border border-ink-200/80 bg-white shadow-lift', className)} aria-hidden="true">
      <div className="flex h-9 items-center gap-3 border-b border-ink-100 bg-ink-50/80 px-3.5">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="mx-auto flex h-5 w-full max-w-xs items-center justify-center rounded-md bg-white px-3 text-[10px] font-medium text-ink-400 ring-1 ring-ink-200/70">
          {url}
        </div>
        <div className="w-10" />
      </div>
      <div className="flex">
        <div className="hidden w-12 shrink-0 flex-col items-center gap-1.5 border-r border-ink-100 bg-ink-950 py-3 sm:flex">
          <LogoMark className="mb-2 size-7" />
          {NAV.map(({ icon: Icon, key }) => (
            <span
              key={key}
              className={cn(
                'grid size-8 place-items-center rounded-lg',
                key === active ? 'bg-white/12 text-brand-300' : 'text-ink-400'
              )}
            >
              <Icon className="size-4" />
            </span>
          ))}
          <span className="mt-auto grid size-8 place-items-center rounded-lg text-ink-400">
            <Settings className="size-4" />
          </span>
        </div>
        <div className="@container min-w-0 flex-1 bg-ink-50/60">
          <div className="flex items-center justify-between gap-3 border-b border-ink-100 bg-white px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-ink-950">{title}</p>
              {subtitle && <p className="truncate text-[10.5px] text-ink-500">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-[10px] font-bold text-white">
                PN
              </span>
            </div>
          </div>
          <div className="p-3 sm:p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
