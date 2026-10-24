'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { api, getActingCompanyId, setActingCompanyId, type Role } from '@/lib/api';
import { Avatar, Badge, Icon, type IconName } from './ui';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  roles?: Role[]; // undefined = everyone
}

const ADMINS: Role[] = ['SUPER_ADMIN', 'ADMIN', 'HR'];
const MANAGERS: Role[] = ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'];

/**
 * Kept deliberately short for small businesses: employees, their lifecycle (hire → exit) and payroll.
 * Everything else the mobile app uses lives on one "More modules" page (see MORE_MODULES).
 */
const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Home',
    items: [
      { href: '/', label: 'Dashboard', icon: 'dashboard' },
      { href: '/approvals', label: 'Approvals', icon: 'check' },
      { href: '/companies', label: 'Companies', icon: 'building', roles: ['SUPER_ADMIN'] },
    ],
  },
  {
    section: 'Employees',
    items: [
      { href: '/employees', label: 'Employees', icon: 'users' },
      { href: '/attendance', label: 'Attendance', icon: 'clock' },
      { href: '/leaves', label: 'Leaves', icon: 'leaf' },
      { href: '/holidays', label: 'Holidays', icon: 'calendar' },
    ],
  },
  {
    section: 'Lifecycle',
    items: [
      { href: '/lifecycle', label: 'Lifecycle overview', icon: 'history', roles: ADMINS },
      { href: '/recruitment', label: '1. Hiring', icon: 'briefcase', roles: MANAGERS },
      { href: '/onboarding', label: '2. Onboarding', icon: 'tasks' },
      { href: '/confirmations', label: '3. Confirmation', icon: 'shield', roles: MANAGERS },
      { href: '/transfers', label: '4. Transfers & promotions', icon: 'sitemap' },
      { href: '/exits', label: '5. Exit', icon: 'door' },
    ],
  },
  {
    section: 'Payroll',
    items: [
      { href: '/salary', label: '1. Salary structures', icon: 'wallet', roles: ADMINS },
      { href: '/payroll-inputs', label: '2. Monthly inputs', icon: 'receipt', roles: ADMINS },
      { href: '/payroll', label: '3. Payroll runs', icon: 'banknote' },
    ],
  },
  {
    section: 'Setup',
    items: [
      { href: '/masters', label: 'Departments & designations', icon: 'box', roles: ADMINS },
      { href: '/offices', label: 'Office & company logo', icon: 'pin', roles: ADMINS },
      { href: '/shifts', label: 'Work timings', icon: 'clock', roles: ADMINS },
      { href: '/leaves/policies', label: 'Leave policies', icon: 'settings', roles: ADMINS },
      { href: '/payroll/statutory', label: 'PF, ESI & tax settings', icon: 'shield', roles: ADMINS },
    ],
  },
  {
    section: 'Me',
    items: [
      { href: '/profile', label: 'My profile', icon: 'user' },
      { href: '/settings/security', label: 'Password & security', icon: 'shield' },
      { href: '/more', label: 'More modules', icon: 'plus' },
    ],
  },
];

/** Secondary modules — mostly requests employees raise from the mobile app that HR handles here. */
export const MORE_MODULES: { group: string; items: (NavItem & { about: string })[] }[] = [
  {
    group: 'Requests from the app',
    items: [
      { href: '/expenses', label: 'Expenses', icon: 'receipt', about: 'Expense claims; approved claims can be paid through payroll.' },
      { href: '/loans', label: 'Loans & advances', icon: 'banknote', about: 'Salary advances recovered as monthly EMIs.' },
      { href: '/travel', label: 'Travel', icon: 'plane', about: 'Travel requests and advances.' },
      { href: '/overtime', label: 'Overtime', icon: 'history', about: 'Overtime claims paid in the next payroll.' },
      { href: '/tax-declarations', label: 'Tax declarations', icon: 'shield', roles: ADMINS, about: 'Verify 80C / HRA proofs employees submit.' },
      { href: '/tickets', label: 'Helpdesk', icon: 'ticket', about: 'Questions and issues raised by employees.' },
    ],
  },
  {
    group: 'Employee records',
    items: [
      { href: '/documents', label: 'Documents', icon: 'folder', about: 'Company policies and employee documents.' },
      { href: '/letters', label: 'Letters', icon: 'folder', about: 'Generate offer, confirmation and experience letters.' },
      { href: '/assets', label: 'Assets', icon: 'box', about: 'Laptops and devices issued to employees.' },
      { href: '/career', label: 'Skills & certifications', icon: 'award', about: 'Skills matrix and certificates.' },
    ],
  },
  {
    group: 'Work & growth',
    items: [
      { href: '/roster', label: 'Roster', icon: 'calendar', roles: MANAGERS, about: 'Assign shifts week by week.' },
      { href: '/timesheets', label: 'Timesheets', icon: 'tasks', about: 'Hours logged against projects.' },
      { href: '/projects', label: 'Projects', icon: 'briefcase', roles: MANAGERS, about: 'Projects used in timesheets.' },
      { href: '/tasks', label: 'Tasks', icon: 'tasks', about: 'To-dos assigned to employees.' },
      { href: '/performance', label: 'Goals', icon: 'target', about: 'Goals and progress.' },
      { href: '/reviews', label: 'Reviews', icon: 'star', about: 'Review cycles, ratings and increments.' },
      { href: '/training', label: 'Learning', icon: 'graduation', about: 'Courses assigned to employees.' },
    ],
  },
  {
    group: 'Engagement',
    items: [
      { href: '/announcements', label: 'Announcements', icon: 'megaphone', about: 'News shown on the mobile app home.' },
      { href: '/surveys', label: 'Surveys', icon: 'heart', about: 'Pulse and feedback surveys.' },
      { href: '/recognition', label: 'Recognition', icon: 'award', about: 'Kudos between colleagues.' },
    ],
  },
];

/** Pinned above every section: step-by-step guides for new users. */
const TUTORIAL: NavItem = { href: '/tutorial', label: 'Tutorial', icon: 'graduation', roles: MANAGERS };

/** The most specific nav entry for a path ("/payroll/statutory" wins over "/payroll"). */
function activeItem(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  const more = MORE_MODULES.flatMap((g) => g.items);
  for (const group of [{ section: '', items: [TUTORIAL] }, ...NAV, { section: '', items: more }]) {
    for (const item of group.items) {
      const hit = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(item.href + '/');
      if (hit && (!best || item.href.length > best.href.length)) best = item;
    }
  }
  return best;
}

const roleTone: Record<Role, 'violet' | 'blue' | 'green' | 'amber' | 'slate'> = {
  SUPER_ADMIN: 'violet',
  ADMIN: 'blue',
  HR: 'green',
  MANAGER: 'amber',
  EMPLOYEE: 'slate',
};

const switcherCls =
  'rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm transition-colors focus:border-indigo-400 focus:outline-none';

function CompanySwitcher() {
  const { session, switchCompany } = useAuth();
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [acting, setActing] = useState<string>('');

  const isSuper = session?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (!session || !isSuper) return;
    api<{ id: string; name: string }[]>('/superadmin/companies')
      .then((list) => {
        setCompanies(list);
        const current = getActingCompanyId();
        if (current && list.some((c) => c.id === current)) setActing(current);
        else if (list.length > 0) {
          setActingCompanyId(list[0].id);
          setActing(list[0].id);
        }
      })
      .catch(() => undefined);
  }, [session, isSuper]);

  if (!session) return null;

  if (isSuper) {
    if (companies.length === 0) return <span className="text-xs text-slate-400">No companies yet</span>;
    return (
      <select
        value={acting}
        onChange={(e) => {
          setActingCompanyId(e.target.value);
          setActing(e.target.value);
          window.location.reload();
        }}
        className={switcherCls}
        title="Acting in company"
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    );
  }

  if (session.memberships.length <= 1) {
    return <span className="text-xs font-semibold text-slate-600">{session.activeCompany?.name}</span>;
  }
  return (
    <select
      value={session.activeCompany?.id ?? ''}
      onChange={(e) => void switchCompany(e.target.value)}
      className={switcherCls}
      title="Switch company"
    >
      {session.memberships.map((m) => (
        <option key={m.companyId} value={m.companyId}>
          {m.company.name} ({m.role})
        </option>
      ))}
    </select>
  );
}

function pageTitle(pathname: string): string {
  return activeItem(pathname)?.label.replace(/^\d+\. /, '') ?? 'HRMS';
}

export function Shell({ children }: { children: ReactNode }) {
  const { session, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) router.replace('/login');
  }, [loading, session, router]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
        <div className="h-8 w-8 animate-spin rounded-full border-[2.5px] border-indigo-100 border-t-indigo-600" />
      </div>
    );
  }

  // Secondary pages highlight "More modules" in the sidebar.
  const hit = activeItem(pathname)?.href;
  const activeHref = hit && MORE_MODULES.some((g) => g.items.some((i) => i.href === hit)) ? '/more' : hit;
  const visible = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || item.roles.includes(session.role)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex min-h-screen bg-[var(--bg)]">
      {/* ------------------------------- Sidebar ------------------------------- */}
      <aside className="fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-[var(--sidebar)] text-slate-300">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-lg shadow-indigo-900/50">
            H
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-white">HRMS</p>
            <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--sidebar-muted)]">Admin Panel</p>
          </div>
        </div>

        <nav className="sidebar-scroll flex-1 overflow-y-auto px-3 pb-4 pt-2">
          {TUTORIAL.roles?.includes(session.role) && (
            <Link
              href={TUTORIAL.href}
              className={`mb-5 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-colors ${
                activeHref === TUTORIAL.href
                  ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-900/40'
                  : 'bg-white/10 text-white hover:bg-white/15'
              }`}
            >
              <Icon name={TUTORIAL.icon} className="h-[18px] w-[18px]" />
              {TUTORIAL.label}
              <span className="ml-auto rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">Start here</span>
            </Link>
          )}
          {visible.map((group) => (
            <div key={group.section} className="mb-5">
              <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--sidebar-muted)]">
                {group.section}
              </p>
              {group.items.map((item) => {
                const active = item.href === activeHref;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`group relative mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors ${
                      active ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
                    }`}
                  >
                    {active && <span className="absolute -left-3 h-5 w-1 rounded-r-full bg-indigo-400" />}
                    <Icon
                      name={item.icon}
                      className={`h-[18px] w-[18px] transition-colors ${active ? 'text-indigo-300' : 'text-slate-500 group-hover:text-slate-300'}`}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-white/8 p-3">
          <div className="flex items-center gap-2.5 rounded-xl bg-white/5 px-3 py-2.5">
            <Avatar name={session.employee?.name ?? session.user.email} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-white">{session.employee?.name ?? 'Platform Owner'}</p>
              <p className="truncate text-[11px] text-[var(--sidebar-muted)]">{session.user.email}</p>
            </div>
            <button
              onClick={() => void logout()}
              title="Sign out"
              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Icon name="logout" className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* -------------------------------- Content ------------------------------- */}
      <div className="ml-[248px] flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200/70 bg-white/80 px-7 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">{pageTitle(pathname)}</h2>
            <Badge tone={roleTone[session.role]}>{session.role.replace('_', ' ')}</Badge>
          </div>
          <div className="flex items-center gap-2">
            {session.role === 'SUPER_ADMIN' && (
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">acting in</span>
            )}
            <CompanySwitcher />
          </div>
        </header>
        <main className="flex-1 px-7 py-7">{children}</main>
      </div>
    </div>
  );
}
