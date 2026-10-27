import { Check } from 'lucide-react';
import { Container, Section, SectionHeading } from '@/marketing/components/site/section';
import { Reveal } from '@/marketing/components/site/reveal';
import { SOLUTIONS } from '@/marketing/lib/content';

export function Solutions() {
  return (
    <Section id="solutions" className="bg-white" aria-labelledby="solutions-title">
      <Container>
        <SectionHeading
          id="solutions-title"
          eyebrow="Solutions"
          title="Right-sized for where you are today"
          description="Start with the essentials and switch on more structure as your organization grows."
        />
        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
          {SOLUTIONS.map((s, i) => (
            <Reveal key={s.id} delay={i * 0.08}>
              <article id={s.id} className="relative h-full scroll-mt-28 overflow-hidden rounded-[var(--radius-card)] border border-ink-200/80 bg-canvas p-7 transition-all duration-300 hover:border-brand-200 hover:bg-white hover:shadow-lift">
                <div className="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-brand-100/60 blur-2xl" />
                <span className="relative grid size-11 place-items-center rounded-xl bg-ink-900 text-brand-300">
                  <s.icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="relative mt-5 text-lg font-semibold text-ink-950">{s.title}</h3>
                <p className="relative mt-2 text-[15px] leading-relaxed text-ink-600">{s.text}</p>
                <ul className="relative mt-5 space-y-2">
                  {s.points.map((p) => (
                    <li key={p} className="flex items-center gap-2 text-sm text-ink-700">
                      <span className="grid size-5 place-items-center rounded-full bg-brand-50 text-brand-700">
                        <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                      </span>
                      {p}
                    </li>
                  ))}
                </ul>
              </article>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
