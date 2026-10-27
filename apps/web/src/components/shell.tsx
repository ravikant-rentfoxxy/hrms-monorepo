'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { api, getActingCompanyId, setActingCompanyId, type Role } from '@/lib/api';
import { Avatar, Badge, Button, Icon, Modal, type IconName } from './ui';
import { LogoMark } from '@/marketing/components/site/logo';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  roles?: Role[]; // undefined = everyone
}

const ADMINS: Role[] = ['SUPER_ADMIN', 'ADMIN', 'HR'];
const MANAGERS: Role[] = ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'];
/** Payroll-side pages: Admin and HR plus the Finance role. */
const PAYROLL: Role[] = [...ADMINS, 'FINANCE'];

/**
 * Kept deliberately short for small businesses: employees, their lifecycle (hire → exit), payroll,
 * the requests employees raise from the mobile app and engagement.
 */
const NAV: { section: string; collapsible?: boolean; items: NavItem[] }[] = [
  {
    section: 'Home',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
      { href: '/approvals', label: 'Approvals', icon: 'check' },
      { href: '/timesheets', label: 'Timesheets', icon: 'tasks' },
      { href: '/companies', label: 'Companies', icon: 'building', roles: ['SUPER_ADMIN'] },
    ],
  },
  {
    section: 'Employees',
    collapsible: true,
    items: [
      { href: '/employees', label: 'Employees', icon: 'users' },
      { href: '/attendance', label: 'Attendance', icon: 'clock' },
      { href: '/leaves', label: 'Leaves', icon: 'leaf' },
      { href: '/holidays', label: 'Holidays', icon: 'calendar' },
      { href: '/projects', label: 'Projects', icon: 'briefcase', roles: MANAGERS },
    ],
  },
  {
    section: 'Employee records',
    collapsible: true,
    items: [
      { href: '/documents', label: 'Documents', icon: 'folder' },
      { href: '/letters', label: 'Letters', icon: 'folder' },
      { href: '/assets', label: 'Assets', icon: 'box' },
    ],
  },
  {
    section: 'Lifecycle',
    collapsible: true,
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
    collapsible: true,
    items: [
      { href: '/salary', label: '1. Salary structures', icon: 'wallet', roles: ADMINS },
      { href: '/payroll-inputs', label: '2. Monthly inputs', icon: 'receipt', roles: PAYROLL },
      { href: '/payroll', label: '3. Payroll runs', icon: 'banknote' },
    ],
  },
  {
    section: 'Requests from the app',
    collapsible: true,
    items: [
      { href: '/expenses', label: 'Expenses', icon: 'receipt' },
      { href: '/travel', label: 'Travel', icon: 'plane' },
      { href: '/overtime', label: 'Overtime', icon: 'history' },
      { href: '/tickets', label: 'Helpdesk', icon: 'ticket' },
    ],
  },
  {
    section: 'Engagement',
    collapsible: true,
    items: [
      { href: '/announcements', label: 'Announcements', icon: 'megaphone' },
      { href: '/recognition', label: 'Recognition', icon: 'award' },
    ],
  },
  {
    section: 'Setup',
    collapsible: true,
    items: [
      { href: '/masters', label: 'Departments & designations', icon: 'box', roles: ADMINS },
      { href: '/offices', label: 'Office & company logo', icon: 'pin', roles: ADMINS },
      { href: '/shifts', label: 'Work timings', icon: 'clock', roles: ADMINS },
      { href: '/leaves/policies', label: 'Leave policies', icon: 'settings', roles: ADMINS },
      { href: '/payroll/statutory', label: 'PF, ESI & tax settings', icon: 'shield', roles: PAYROLL },
    ],
  },
  {
    section: 'Me',
    items: [
      { href: '/profile', label: 'My profile', icon: 'user' },
    ],
  },
];

/** Pinned above every section: step-by-step guides for new users. */
const TUTORIAL: NavItem = { href: '/tutorial', label: 'Tutorial', icon: 'graduation', roles: MANAGERS };

/** The most specific nav entry for a path ("/payroll/statutory" wins over "/payroll"). */
function activeItem(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const group of [{ section: '', items: [TUTORIAL] }, ...NAV]) {
    for (const item of group.items) {
      const hit = pathname === item.href || pathname.startsWith(item.href + '/');
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
  FINANCE: 'violet',
};

const switcherCls =
  'rounded-full border border-ink-200 bg-white px-3.5 py-2 text-xs font-semibold text-ink-700 shadow-[0_1px_2px_rgb(11_26_54/0.04)] transition-colors hover:border-ink-300 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15';

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
    if (companies.length === 0) return <span className="text-xs text-ink-400">No companies yet</span>;
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
    return <span className="text-xs font-semibold text-ink-600">{session.activeCompany?.name}</span>;
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

/** Per-viewer open / closed sidebar sections (a convenience: works without storage too). */
const NAV_OPEN_KEY = 'hrms.nav.open';

function readNavOpen(): Record<string, boolean> {
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(NAV_OPEN_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeNavOpen(open: Record<string, boolean>) {
  try {
    window.localStorage.setItem(NAV_OPEN_KEY, JSON.stringify(open));
  } catch {
    // private window / blocked storage: the choice just isn't remembered
  }
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
    >
      <path
        fillRule="evenodd"
        d="M7.2 14.8a.75.75 0 0 1 0-1.06L10.94 10 7.2 6.26a.75.75 0 1 1 1.06-1.06l4.27 4.27a.75.75 0 0 1 0 1.06L8.26 14.8a.75.75 0 0 1-1.06 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** Sidebar section the current page belongs to (shown above the page title). */
function pageSection(pathname: string): string {
  const href = activeItem(pathname)?.href;
  return NAV.find((g) => g.items.some((i) => i.href === href))?.section ?? (href === TUTORIAL.href ? 'Getting started' : '');
}

function pageTitle(pathname: string): string {
  return activeItem(pathname)?.label.replace(/^\d+\. /, '') ?? 'HRMS';
}

export function Shell({ children }: { children: ReactNode }) {
  const { session, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState<Record<string, boolean>>(readNavOpen);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // Opening a page inside a collapsed section expands that section.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    const section = NAV.find((g) => g.collapsible && g.items.some((i) => i.href === activeItem(pathname)?.href))?.section;
    if (section && navOpen[section] === false) {
      const next = { ...navOpen, [section]: true };
      setNavOpen(next);
      writeNavOpen(next);
    }
  }

  useEffect(() => {
    if (!loading && !session) router.replace('/login');
  }, [loading, session, router]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
        <div className="h-8 w-8 animate-spin rounded-full border-[2.5px] border-brand-100 border-t-brand-600" />
      </div>
    );
  }

  const activeHref = activeItem(pathname)?.href;
  const visible = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || item.roles.includes(session.role)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex min-h-screen bg-[var(--bg)]">
      {/* ------------------------------- Sidebar ------------------------------- */}
      <aside className="fixed inset-y-0 left-0 z-40 flex w-[256px] flex-col overflow-hidden bg-[var(--sidebar)] text-ink-300">
        {/* Soft brand glow behind the logo, as on the marketing site. */}
        <div className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full bg-brand-500/15 blur-3xl" />
        <div className="relative flex h-[68px] items-center gap-2.5 px-5">
          <LogoMark className="size-8" />
          <div className="min-w-0 leading-tight">
            <p className="text-[15px] font-bold tracking-tight text-white">HRMS</p>
            <p className="truncate text-[11px] font-medium text-[var(--sidebar-muted)]">
              {session.activeCompany?.name ?? 'Platform administration'}
            </p>
          </div>
        </div>

        <nav className="sidebar-scroll relative flex-1 overflow-y-auto px-3 pb-4 pt-2">
          {TUTORIAL.roles?.includes(session.role) && (
            <Link
              href={TUTORIAL.href}
              className={`mb-5 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-colors ${
                activeHref === TUTORIAL.href
                  ? 'bg-gradient-to-r from-brand-600 to-teal-500 text-white shadow-lg shadow-brand-900/40'
                  : 'bg-white/[0.07] text-white ring-1 ring-white/10 hover:bg-white/[0.11]'
              }`}
            >
              <Icon name={TUTORIAL.icon} className="h-[18px] w-[18px]" />
              {TUTORIAL.label}
              <span className="ml-auto rounded-full bg-brand-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-200">Start here</span>
            </Link>
          )}
          {visible.map((group) => {
            const hasActive = group.items.some((i) => i.href === activeHref);
            // Collapsed by default; the section holding the current page starts open.
            const open = !group.collapsible || (navOpen[group.section] ?? hasActive);
            const toggle = () => {
              const next = { ...navOpen, [group.section]: !open };
              setNavOpen(next);
              writeNavOpen(next);
            };
            return (
              <div key={group.section} className={group.collapsible ? 'mb-1.5' : 'mb-5'}>
                {group.collapsible ? (
                  <button
                    type="button"
                    onClick={toggle}
                    aria-expanded={open}
                    className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors hover:bg-white/5 hover:text-ink-200 ${
                      hasActive && !open ? 'text-brand-300' : 'text-[var(--sidebar-muted)]'
                    }`}
                  >
                    <span className="flex-1 text-left">{group.section}</span>
                    {!open && (
                      <span className="rounded-full bg-white/10 px-1.5 text-[10px] tracking-normal">{group.items.length}</span>
                    )}
                    <Chevron open={open} />
                  </button>
                ) : (
                  <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--sidebar-muted)]">
                    {group.section}
                  </p>
                )}
                {open &&
                  group.items.map((item) => {
                    const active = item.href === activeHref;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`group relative mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors ${
                          active ? 'bg-white/[0.08] text-white ring-1 ring-white/[0.06]' : 'text-ink-400 hover:bg-white/[0.04] hover:text-ink-100'
                        }`}
                      >
                        {active && <span className="absolute -left-3 h-5 w-1 rounded-r-full bg-brand-400 shadow-[0_0_12px_rgb(52_209_163/0.7)]" />}
                        <Icon
                          name={item.icon}
                          className={`h-[18px] w-[18px] transition-colors ${active ? 'text-brand-300' : 'text-ink-500 group-hover:text-ink-300'}`}
                        />
                        {item.label}
                      </Link>
                    );
                  })}
                {group.collapsible && open && <div className="mb-3.5" />}
              </div>
            );
          })}
        </nav>

        <div className="relative border-t border-white/[0.07] p-3">
          <div className="flex items-center gap-2.5 rounded-2xl bg-white/[0.05] px-3 py-2.5 ring-1 ring-white/[0.06]">
            <Avatar name={session.employee?.name ?? session.user.email} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-white">{session.employee?.name ?? 'Platform Owner'}</p>
              <p className="truncate text-[11px] text-[var(--sidebar-muted)]">{session.user.email}</p>
            </div>
            <button
              onClick={() => setConfirmLogout(true)}
              title="Sign out"
              aria-label="Sign out"
              className="rounded-lg p-1.5 text-ink-500 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Icon name="logout" className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <Modal title="Sign out?" open={confirmLogout} onClose={() => !signingOut && setConfirmLogout(false)}>
        <p className="text-sm text-ink-600">
          You will be signed out of <span className="font-semibold text-ink-900">{session.activeCompany?.name ?? 'HRMS'}</span> on this
          device. Any unsaved changes on this page will be lost.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" disabled={signingOut} onClick={() => setConfirmLogout(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              void logout();
            }}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </Modal>

      {/* -------------------------------- Content ------------------------------- */}
      <div className="ml-[256px] flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[68px] items-center justify-between gap-4 border-b border-ink-200/70 bg-white/80 px-8 backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium text-ink-400">{pageSection(pathname) || 'Workspace'}</p>
              <h2 className="truncate text-[15px] font-bold leading-tight tracking-tight text-ink-950">{pageTitle(pathname)}</h2>
            </div>
            <Badge tone={roleTone[session.role]}>{session.role.replace('_', ' ')}</Badge>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 xl:inline-flex"
            >
              View website
            </Link>
            {session.role === 'SUPER_ADMIN' && (
              <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">acting in</span>
            )}
            <CompanySwitcher />
          </div>
        </header>
        <main className="flex-1 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
