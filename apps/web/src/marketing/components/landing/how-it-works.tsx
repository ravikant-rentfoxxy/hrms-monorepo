import { Container, Section, SectionHeading } from '@/marketing/components/site/section';
import { Reveal } from '@/marketing/components/site/reveal';
import { STEPS } from '@/marketing/lib/content';

export function HowItWorks() {
  return (
    <Section id="how-it-works" className="bg-white" aria-labelledby="how-title">
      <Container>
        <SectionHeading id="how-title" eyebrow="How it works" title="Up and running in four steps" />
        <ol className="relative mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <div className="pointer-events-none absolute left-0 right-0 top-6 hidden h-px border-t border-dashed border-ink-300 lg:block" />
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <Reveal delay={i * 0.08} className="relative">
                <span className="relative grid size-12 place-items-center rounded-2xl bg-ink-900 text-base font-bold text-white shadow-lift ring-4 ring-white">
                  {i + 1}
                </span>
                <h3 className="mt-5 text-lg font-semibold text-ink-950">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-600">{s.text}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  );
}
