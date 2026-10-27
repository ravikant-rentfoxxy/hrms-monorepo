import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, CalendarCheck2, CheckCircle2, MapPin, ShieldCheck, Wallet } from 'lucide-react';
import { Logo } from '@/marketing/components/site/logo';
import { LoginForm } from '@/marketing/components/forms/login-form';
import { RedirectIfSignedIn } from '@/marketing/components/forms/redirect-if-signed-in';
import { AreaChart, Avatar, Kpi } from '@/marketing/components/dashboards/primitives';
import { GROWTH, PEOPLE } from '@/marketing/components/dashboards/data';
import { site } from '@/marketing/lib/site';

export const metadata: Metadata = {
  title: 'Sign in',
  description: `Sign in to your ${site.name} workspace.`,
  alternates: { canonical: '/login' },
  robots: { index: false },
};

const BENEFITS = [
  { icon: CalendarCheck2, text: 'Attendance, leave and approvals in one place' },
  { icon: Wallet, text: 'Payroll runs with PF, ESI and TDS built in' },
  { icon: ShieldCheck, text: 'Role-based access and encrypted employee data' },
];

/** Decorative product collage for the brand panel. */
function Illustration() {
  return (
    <div className="relative mx-auto w-full max-w-md" aria-hidden="true">
      <div className="rounded-2xl border border-white/10 bg-white p-4 shadow-[0_30px_60px_-20px_rgb(0_0_0/0.5)]">
        <div className="grid grid-cols-2 gap-2.5">
          <Kpi label="Present today" value="221" note="89% attendance" icon={<CheckCircle2 />} />
          <Kpi label="Payroll" value="₹1.86 Cr" note="Approved" icon={<Wallet />} tone="violet" />
        </div>
        <div className="mt-2.5 rounded-xl border border-ink-200/70 p-3">
          <p className="mb-2 text-[11px] font-semibold text-ink-800">Headcount</p>
          <AreaChart id="login-growth" values={GROWTH} height={64} />
        </div>
      </div>
      <div className="absolute -bottom-6 -right-4 flex items-center gap-2.5 rounded-2xl border border-ink-200/80 bg-white p-3 shadow-float sm:-right-8">
        <Avatar name={PEOPLE[1].name} color={PEOPLE[1].color} size={30} />
        <div>
          <p className="text-[12px] font-semibold text-ink-900">Checked in · 09:12</p>
          <p className="flex items-center gap-1 text-[11px] text-ink-500">
            <MapPin className="size-3 text-brand-600" /> Inside office geofence
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden flex-col overflow-hidden bg-ink-950 p-10 text-white lg:flex xl:p-14">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="pointer-events-none absolute -left-24 -top-24 size-96 rounded-full bg-brand-500/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 right-0 size-96 rounded-full bg-teal-400/10 blur-3xl" />
        <div className="relative">
          <Logo light />
        </div>
        <div className="relative my-auto py-12">
          <h2 className="max-w-md text-balance text-4xl font-bold leading-tight tracking-tight">Welcome back to your people platform.</h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-300">
            Everything your HR team needs — from today’s attendance to this month’s payroll — is a sign-in away.
          </p>
          <ul className="mt-8 space-y-3.5">
            {BENEFITS.map((b) => (
              <li key={b.text} className="flex items-center gap-3 text-[15px] text-ink-200">
                <span className="grid size-8 place-items-center rounded-lg bg-white/10 text-brand-300">
                  <b.icon className="size-4" aria-hidden="true" />
                </span>
                {b.text}
              </li>
            ))}
          </ul>
          <div className="mt-14">
            <Illustration />
          </div>
        </div>
        <p className="relative text-[13px] text-ink-400">Protected by rate limiting and account lockout after repeated failed attempts.</p>
      </aside>

      <main id="main" className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <div className="lg:invisible">
            <Logo />
          </div>
          <Link href="/" className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900">
            <ArrowLeft className="size-4" aria-hidden="true" /> Back to site
          </Link>
        </div>
        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-10">
          <RedirectIfSignedIn />
          <LoginForm />
        </div>
        <p className="text-center text-[12px] text-ink-400">
          © {new Date().getFullYear()} {site.name} ·{' '}
          <Link href="#" className="hover:text-ink-700">
            Privacy
          </Link>{' '}
          ·{' '}
          <Link href="#" className="hover:text-ink-700">
            Terms
          </Link>
        </p>
      </main>
    </div>
  );
}
