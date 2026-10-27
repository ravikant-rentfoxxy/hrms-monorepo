import { Container, Section } from '@/marketing/components/site/section';
import { Reveal } from '@/marketing/components/site/reveal';
import { LIFECYCLE } from '@/marketing/lib/content';

export function Lifecycle() {
  return (
    <Section id="lifecycle" className="relative overflow-hidden bg-ink-950 text-white" aria-labelledby="lifecycle-title">
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:44px_44px]" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[50rem] -translate-x-1/2 rounded-full bg-brand-500/20 blur-3xl" />
      <Container className="relative">
        <div className="mx-auto max-w-3xl text-center">
          <p className="inline-flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-brand-300">
            <span className="h-px w-5 bg-brand-400" aria-hidden="true" />
            Employee lifecycle
          </p>
          <h2 id="lifecycle-title" className="mt-4 text-balance text-3xl font-bold tracking-tight sm:text-4xl lg:text-[44px] lg:leading-[1.1]">
            Hire to retire, on one connected record
          </h2>
          <p className="mt-4 text-pretty text-base leading-relaxed text-ink-300 sm:text-lg">
            Each stage hands off to the next automatically — the offer becomes an onboarding case, attendance feeds payroll, and the exit
            closes with a final settlement.
          </p>
        </div>

        <ol className="relative mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Connector line on large screens (two rows of four). */}
          <div className="pointer-events-none absolute inset-x-8 top-7 hidden h-px bg-gradient-to-r from-brand-500/0 via-brand-400/50 to-brand-500/0 lg:block" />
          {LIFECYCLE.map((s, i) => (
            <li key={s.title}>
              <Reveal
                delay={i * 0.07}
                className="group relative h-full rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors duration-300 hover:border-brand-400/60 hover:bg-white/[0.08]"
              >
                <div className="flex items-center gap-3">
                  <span className="relative grid size-11 place-items-center rounded-xl bg-white/5 text-brand-300 ring-1 ring-white/10 transition-colors group-hover:bg-brand-500 group-hover:text-white group-hover:ring-brand-300">
                    <s.icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="text-[12px] font-semibold tabular-nums text-ink-400">{String(i + 1).padStart(2, '0')}</span>
                </div>
                <h3 className="mt-4 text-[15px] font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-300">{s.text}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  );
}
