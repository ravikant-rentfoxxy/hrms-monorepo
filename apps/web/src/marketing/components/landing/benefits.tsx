import { CheckCircle2 } from 'lucide-react';
import { Container, Section, SectionHeading } from '@/marketing/components/site/section';
import { Reveal } from '@/marketing/components/site/reveal';
import { BENEFITS } from '@/marketing/lib/content';

/** A small "before → after" illustration built from UI pieces, not stock art. */
function AutomationIllustration() {
  const steps = ['Leave applied in the app', 'Manager approves in one tap', 'Balance updated automatically', 'Flows into this month’s payroll'];
  return (
    <div className="relative rounded-[var(--radius-card)] border border-ink-200/80 bg-white p-6 shadow-lift" aria-hidden="true">
      <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">One leave request, zero follow-ups</p>
      <ol className="mt-5 space-y-3">
        {steps.map((s) => (
          <li key={s} className="flex items-center gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700 ring-1 ring-brand-600/10">
              <CheckCircle2 className="size-4" />
            </span>
            <span className="flex-1 rounded-xl border border-ink-200/70 bg-canvas px-3.5 py-2.5 text-sm font-medium text-ink-800">{s}</span>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex items-center justify-between rounded-xl bg-ink-900 px-4 py-3 text-white">
        <span className="text-sm font-medium text-ink-300">HR time spent</span>
        <span className="text-sm font-semibold text-brand-300">Approvals only</span>
      </div>
    </div>
  );
}

export function Benefits() {
  return (
    <Section id="benefits" aria-labelledby="benefits-title">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-16">
          <div>
            <SectionHeading
              id="benefits-title"
              align="left"
              eyebrow="Benefits"
              title="Less Administration. More People."
              description="Give HR back the hours spent chasing approvals and fixing spreadsheets — and spend them on the people they serve."
            />
            <ul className="mt-10 grid grid-cols-1 gap-x-8 gap-y-7 sm:grid-cols-2">
              {BENEFITS.map((b, i) => (
                <li key={b.title}>
                  <Reveal delay={i * 0.05} className="group flex gap-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-600/10 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:rotate-3">
                      <b.icon className="size-5" aria-hidden="true" />
                    </span>
                    <span>
                      <h3 className="text-[15px] font-semibold text-ink-950">{b.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-ink-600">{b.text}</p>
                    </span>
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>
          <Reveal delay={0.15}>
            <AutomationIllustration />
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
