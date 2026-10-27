import Link from 'next/link';
import { ArrowRight, BadgeCheck, CheckCircle2, MapPin, Sparkles, Wallet } from 'lucide-react';
import { Button } from '@/marketing/components/ui/button';
import { Container } from '@/marketing/components/site/section';
import { AdminDashboard } from '@/marketing/components/dashboards/screens';
import { Avatar } from '@/marketing/components/dashboards/primitives';
import { PEOPLE } from '@/marketing/components/dashboards/data';
import { DemoLink } from '@/marketing/components/demo/demo-dialog';

/** Decorative floating card over the dashboard (CSS fade-in + gentle float). */
function FloatCard({ className, delay, children }: { className: string; delay: number; children: React.ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-float absolute z-10 hidden rounded-2xl border border-ink-200/80 bg-white/95 p-3 shadow-float backdrop-blur md:block ${className}`}
      style={{ animationDelay: `${delay}s, ${delay + 0.6}s` }}
    >
      {children}
    </div>
  );
}

export function Hero() {

  return (
    <section className="relative overflow-hidden pb-16 pt-12 sm:pb-24 sm:pt-16 lg:pt-20" aria-labelledby="hero-title">
      {/* Backdrop: faint grid fading out + soft brand glow. */}
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_70%_55%_at_50%_0%,#000_40%,transparent_100%)]" />
      <div className="pointer-events-none absolute left-1/2 top-[-12rem] -z-10 h-[34rem] w-[64rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(16_184_138/0.16),transparent)]" />

      <Container>
        <div className="mx-auto max-w-4xl text-center">
          <div className="animate-fade-up" style={{ animationDelay: '0s' }}>
            <Link
              href="/#features"
              className="group inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white/80 py-1 pl-1 pr-3 text-[13px] font-medium text-ink-700 shadow-soft backdrop-blur transition-colors hover:border-brand-300"
            >
              <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-brand-50 px-2 py-0.5 text-[12px] font-semibold text-brand-700">
                <Sparkles className="size-3.5" aria-hidden="true" /> All-in-one
              </span>
              <span className="sm:hidden">Hiring to payroll to exit</span>
              <span className="hidden sm:inline">Hiring to payroll to exit — one connected platform</span>
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </div>
          <h1
            id="hero-title"
            className="animate-fade-up mt-7 text-balance text-[40px] font-bold leading-[1.05] tracking-[-0.03em] text-ink-950 sm:text-6xl lg:text-[76px]"
            style={{ animationDelay: '0.08s' }}
          >
            One Platform. Every Employee.{' '}
            <span className="bg-gradient-to-r from-brand-600 via-brand-500 to-teal-500 bg-clip-text text-transparent">Endless Possibilities.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-ink-600 sm:text-xl animate-fade-up" style={{ animationDelay: '0.16s' }}>
            Manage your entire employee lifecycle — from hiring and onboarding to attendance, payroll, performance, and offboarding — all
            in one intelligent HRMS platform.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row animate-fade-up" style={{ animationDelay: '0.24s' }}>
            <Button size="lg" asChild className="w-full sm:w-auto">
              <DemoLink>
                Book a Free Demo <ArrowRight aria-hidden="true" />
              </DemoLink>
            </Button>
            <Button size="lg" variant="outline" asChild className="w-full sm:w-auto">
              <Link href="/#features">Explore Features</Link>
            </Button>
          </div>
          <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-ink-500 animate-fade-up" style={{ animationDelay: '0.3s' }}>
            {['Admin panel + employee mobile app', 'Indian payroll & statutory', 'Multi-company ready'].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-brand-600" aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mx-auto mt-14 max-w-6xl sm:mt-16">
          <div className="pointer-events-none absolute -inset-x-6 -bottom-8 top-10 -z-10 rounded-[2.5rem] bg-gradient-to-b from-brand-100/50 via-white/0 to-transparent blur-2xl" />
          <div className="animate-rise-in" style={{ animationDelay: '0.35s' }}>
            <AdminDashboard compact />
          </div>

          <FloatCard className="-left-6 top-[70%] w-56 lg:-left-16" delay={1}>
            <div className="flex items-center gap-2.5">
              <Avatar name={PEOPLE[0].name} color={PEOPLE[0].color} size={32} />
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-ink-900">Leave approved</p>
                <p className="truncate text-[11px] text-ink-500">Ananya · Casual Leave · 2 days</p>
              </div>
            </div>
          </FloatCard>

          <FloatCard className="-right-6 -top-7 w-60 lg:-right-14" delay={1.25}>
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-xl bg-violet-50 text-violet-700">
                <Wallet className="size-4" />
              </span>
              <div>
                <p className="text-[12px] font-semibold text-ink-900">October payroll approved</p>
                <p className="text-[11px] text-ink-500">248 payslips ready to publish</p>
              </div>
            </div>
          </FloatCard>

          <FloatCard className="-bottom-7 right-[9%] w-64" delay={1.5}>
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-xl bg-brand-50 text-brand-700">
                <MapPin className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1 text-[12px] font-semibold text-ink-900">
                  Checked in · 09:12 <BadgeCheck className="size-3.5 text-brand-600" />
                </p>
                <p className="truncate text-[11px] text-ink-500">Rohan · inside office geofence (42 m)</p>
              </div>
            </div>
          </FloatCard>
        </div>
      </Container>
    </section>
  );
}
