import { Container, Section, SectionHeading } from '@/marketing/components/site/section';
import { Reveal } from '@/marketing/components/site/reveal';
import { TRUST_POINTS } from '@/marketing/lib/content';

export function Trust() {
  return (
    <Section className="border-y border-ink-200/60 bg-white py-16 sm:py-20 lg:py-20" aria-labelledby="trust-title">
      <Container>
        <SectionHeading
          id="trust-title"
          eyebrow="Why teams choose it"
          title="Built for Modern Teams and Growing Businesses"
          description="The foundations that let HR trust the system with every employee record — from your first hire to your hundredth."
        />
        <ul className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {TRUST_POINTS.map((t, i) => (
            <li key={t.title}>
              <Reveal delay={i * 0.06} className="group h-full rounded-2xl border border-ink-200/70 bg-canvas p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-200 hover:bg-white hover:shadow-soft">
                <span className="grid size-10 place-items-center rounded-xl bg-white text-brand-700 ring-1 ring-ink-200/80 transition-colors group-hover:bg-brand-50 group-hover:ring-brand-200">
                  <t.icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-[15px] font-semibold text-ink-950">{t.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{t.text}</p>
              </Reveal>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-center text-[13px] text-ink-500">
          Customer stories and compliance certifications will appear here once published.
        </p>
      </Container>
    </Section>
  );
}
