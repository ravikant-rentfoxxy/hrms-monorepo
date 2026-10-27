import { ArrowRight, Check } from 'lucide-react';
import { Button } from '@/marketing/components/ui/button';
import { Container, Section } from '@/marketing/components/site/section';
import { Reveal } from '@/marketing/components/site/reveal';
import { DemoLink } from '@/marketing/components/demo/demo-dialog';

const INCLUDED = ['All core modules', 'Admin panel + employee mobile app', 'Guided setup & data import', 'Multi-company support'];

/** Plans aren't published yet — this invites a conversation instead of showing invented prices. */
export function Pricing() {
  return (
    <Section id="pricing" className="py-16 sm:py-20 lg:py-20" aria-labelledby="pricing-title">
      <Container>
        <Reveal className="grid items-center gap-8 overflow-hidden rounded-[2rem] border border-ink-200/80 bg-white p-8 shadow-soft sm:p-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:p-12">
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand-700">Pricing</p>
            <h2 id="pricing-title" className="mt-3 text-3xl font-bold tracking-tight text-ink-950 sm:text-4xl">
              Pricing that fits your team size
            </h2>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-ink-600">
              Plans depend on headcount and the modules you need. Book a demo and we’ll put together a quote for your organization.
            </p>
            <Button size="lg" asChild className="mt-7">
              <DemoLink>
                Get a quote <ArrowRight aria-hidden="true" />
              </DemoLink>
            </Button>
          </div>
          <ul className="grid grid-cols-1 gap-3 rounded-2xl bg-canvas p-6 ring-1 ring-ink-200/70">
            {INCLUDED.map((t) => (
              <li key={t} className="flex items-center gap-3 text-[15px] font-medium text-ink-800">
                <span className="grid size-6 place-items-center rounded-full bg-brand-600 text-white">
                  <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </Reveal>
      </Container>
    </Section>
  );
}
