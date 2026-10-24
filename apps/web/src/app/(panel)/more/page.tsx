'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { MORE_MODULES } from '@/components/shell';
import { Icon, PageHeader } from '@/components/ui';

export default function MorePage() {
  const { session } = useAuth();
  const role = session?.role;
  const groups = MORE_MODULES.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.roles || (role && i.roles.includes(role))),
  })).filter((g) => g.items.length > 0);

  return (
    <div>
      <PageHeader
        title="More modules"
        subtitle="Optional tools. Employees mostly use these from the mobile app — open one only when you need it."
      />
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.group}>
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{g.group}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {g.items.map((i) => (
                <Link
                  key={i.href}
                  href={i.href}
                  className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50/40"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                    <Icon name={i.icon} className="h-[18px] w-[18px]" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{i.label}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{i.about}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
