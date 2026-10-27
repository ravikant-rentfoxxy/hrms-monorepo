import type { Metadata } from 'next';
import { CalendarClock, CheckCircle2, Clock3, Presentation, ShieldCheck, Users } from 'lucide-react';
import { Header } from '@/marketing/components/site/header';
import { Footer } from '@/marketing/components/site/footer';
import { Container } from '@/marketing/components/site/section';
import { DemoForm } from '@/marketing/components/forms/demo-form';

export const metadata: Metadata = {
  title: 'Book a demo',
  description: 'Schedule a personalized walkthrough of the HRMS — attendance, leave, payroll, hiring and more.',
  alternates: { canonical: '/demo' },
};

const EXPECT = [
  { icon: Presentation, title: 'A walkthrough of your modules', text: 'We focus on the modules you pick — not a generic tour.' },
  { icon: Users, title: 'Your structure, your policies', text: 'See how your departments, shifts and leave rules would be set up.' },
  { icon: CalendarClock, title: 'Setup and migration plan', text: 'How to import employees and go live with your first payroll.' },
  { icon: ShieldCheck, title: 'Security & access questions', text: 'Roles, data isolation and how employee data is protected.' },
];

export default function DemoPage() {
  return (
    <>
      <Header />
      <main id="main" className="relative overflow-hidden">
        <div className="bg-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[32rem] [mask-image:linear-gradient(to_bottom,#000,transparent)]" />
        <div className="pointer-events-none absolute -top-40 left-1/4 -z-10 h-96 w-[48rem] rounded-full bg-brand-100/60 blur-3xl" />
        <Container className="grid gap-12 py-14 sm:py-20 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
          <div className="lg:pt-6">
            <p className="inline-flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-brand-700">
              <span className="h-px w-5 bg-brand-500" aria-hidden="true" />
              Book a demo
            </p>
            <h1 className="mt-4 text-balance text-4xl font-bold tracking-tight text-ink-950 sm:text-5xl lg:text-[52px] lg:leading-[1.08]">
              See How Smarter HR Management Works
            </h1>
            <p className="mt-5 max-w-lg text-pretty text-lg leading-relaxed text-ink-600">
              Discover how our HRMS can simplify your HR operations. Schedule a personalized product demonstration with our team.
            </p>
            <h2 className="mt-10 text-sm font-semibold text-ink-950">What to expect</h2>
            <ul className="mt-4 space-y-4">
              {EXPECT.map((e) => (
                <li key={e.title} className="flex gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-brand-700 shadow-soft ring-1 ring-ink-200/80">
                    <e.icon className="size-5" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-[15px] font-semibold text-ink-900">{e.title}</span>
                    <span className="block text-sm leading-relaxed text-ink-600">{e.text}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-[13px] font-medium text-ink-600">
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="size-4 text-brand-600" aria-hidden="true" /> About 30–45 minutes
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-brand-600" aria-hidden="true" /> No commitment
              </span>
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-ink-200/80 bg-white p-6 shadow-lift sm:p-9">
            <h2 className="text-xl font-bold tracking-tight text-ink-950">Request your demo</h2>
            <p className="mt-1 text-sm text-ink-500">
              Fields marked <span className="text-rose-600">*</span> are required.
            </p>
            <div className="mt-7">
              <DemoForm />
            </div>
          </div>
        </Container>
      </main>
      <Footer />
    </>
  );
}
