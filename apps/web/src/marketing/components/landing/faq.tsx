import { Container, Section, SectionHeading } from '@/marketing/components/site/section';
import { Reveal } from '@/marketing/components/site/reveal';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/marketing/components/ui/accordion';
import { FAQS } from '@/marketing/lib/content';
import { DemoLink } from '@/marketing/components/demo/demo-dialog';

export function Faq() {
  return (
    <Section id="faq" className="bg-white" aria-labelledby="faq-title">
      <Container>
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-16">
          <div>
            <SectionHeading
              id="faq-title"
              align="left"
              eyebrow="Resources"
              title="Frequently asked questions"
              description={
                <>
                  Can’t find what you’re looking for?{' '}
                  <DemoLink className="font-semibold text-brand-700 underline-offset-4 hover:underline">
                    Talk to our team
                  </DemoLink>
                  .
                </>
              }
            />
          </div>
          <Reveal>
            <Accordion type="single" collapsible defaultValue="item-0" className="rounded-[var(--radius-card)] border border-ink-200/80 bg-canvas px-6">
              {FAQS.map((f, i) => (
                <AccordionItem key={f.q} value={`item-${i}`}>
                  <AccordionTrigger>{f.q}</AccordionTrigger>
                  <AccordionContent>{f.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
