import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/marketing/components/ui/button';
import { Container, Section } from '@/marketing/components/site/section';
import { Reveal } from '@/marketing/components/site/reveal';
import { DemoLink } from '@/marketing/components/demo/demo-dialog';

export function FinalCta() {
  return (
    <Section className="py-16 sm:py-20" aria-labelledby="cta-title">
      <Container>
        <Reveal className="relative overflow-hidden rounded-[2rem] bg-ink-950 px-6 py-14 text-center sm:px-12 sm:py-20">
          <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:40px_40px] [mask-image:radial-gradient(ellipse_at_center,#000,transparent_75%)]" />
          <div className="pointer-events-none absolute -bottom-32 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-brand-500/30 blur-3xl" />
          <h2 id="cta-title" className="relative mx-auto max-w-3xl text-balance text-3xl font-bold tracking-tight text-white sm:text-5xl">
            Ready to Transform Your HR Operations?
          </h2>
          <p className="relative mx-auto mt-4 max-w-xl text-pretty text-base text-ink-300 sm:text-lg">
            See the platform with your own policies and team structure in a personalized walkthrough.
          </p>
          <div className="relative mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" asChild className="w-full sm:w-auto">
              <DemoLink>
                Book a Demo <ArrowRight aria-hidden="true" />
              </DemoLink>
            </Button>
            <Button size="lg" variant="outline" asChild className="w-full border-white/20 bg-white/5 text-white hover:border-white/30 hover:bg-white/10 sm:w-auto">
              <Link href="/login">Login</Link>
            </Button>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
