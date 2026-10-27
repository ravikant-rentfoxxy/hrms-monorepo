'use client';

import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check } from 'lucide-react';
import { Container, Section, SectionHeading } from '@/marketing/components/site/section';
import { Reveal } from '@/marketing/components/site/reveal';
import { FEATURE_GROUPS } from '@/marketing/lib/content';
import { cn } from '@/marketing/lib/utils';

/**
 * Feature groups as a tab rail (desktop) / chip row (mobile). Each group also
 * keeps an anchor (#core-hr, #payroll …) so header links land on it.
 */
const subscribeHash = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function Features() {
  const reduce = useReducedMotion();
  // Header links like /#payroll select the matching group; a click wins until the hash changes again.
  const hash = React.useSyncExternalStore(subscribeHash, () => window.location.hash.slice(1), () => '');
  const [picked, setPicked] = React.useState<{ id: string; hash: string } | null>(null);
  const fromHash = FEATURE_GROUPS.some((g) => g.id === hash) ? hash : null;
  const active = picked && picked.hash === hash ? picked.id : (fromHash ?? picked?.id ?? FEATURE_GROUPS[0]!.id);
  const setActive = (id: string) => setPicked({ id, hash });

  const group = FEATURE_GROUPS.find((g) => g.id === active)!;

  return (
    <Section id="features" aria-labelledby="features-title">
      {/* Invisible anchors for each group, positioned at the section top. */}
      <div className="relative">
        {FEATURE_GROUPS.map((g) => (
          <span key={g.id} id={g.id} className="absolute -top-24" aria-hidden="true" />
        ))}
      </div>
      <Container>
        <SectionHeading
          id="features-title"
          eyebrow="Features"
          title="Everything HR runs on, in one place"
          description="Five connected modules that share one employee record — so a hire flows into onboarding, attendance flows into payroll, and nothing is typed twice."
        />

        <div className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-12">
          <Reveal className="min-w-0">
            <div role="tablist" aria-label="Feature groups" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
              {FEATURE_GROUPS.map((g) => {
                const selected = g.id === active;
                const Icon = g.features[0]!.icon;
                return (
                  <button
                    key={g.id}
                    type="button"
                    role="tab"
                    id={`tab-${g.id}`}
                    aria-selected={selected}
                    aria-controls={`panel-${g.id}`}
                    onClick={() => setActive(g.id)}
                    className={cn(
                      'group flex shrink-0 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all lg:w-full',
                      selected ? 'border-ink-900 bg-ink-900 text-white shadow-lift' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300'
                    )}
                  >
                    <span
                      className={cn(
                        'grid size-8 place-items-center rounded-lg transition-colors',
                        selected ? 'bg-white/10 text-brand-300' : 'bg-brand-50 text-brand-700'
                      )}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="text-sm font-semibold">{g.label}</span>
                  </button>
                );
              })}
            </div>
          </Reveal>

          <div id={`panel-${group.id}`} role="tabpanel" aria-labelledby={`tab-${group.id}`} className="min-w-0">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={group.id}
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -6 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <p className="text-lg font-medium text-ink-800">{group.summary}</p>
                <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                  {group.features.map((f) => (
                    <article
                      key={f.title}
                      className="group flex flex-col rounded-[var(--radius-card)] border border-ink-200/80 bg-white p-6 shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-brand-200 hover:shadow-lift"
                    >
                      <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 text-brand-700 ring-1 ring-brand-600/10">
                        <f.icon className="size-5" aria-hidden="true" />
                      </span>
                      <h3 className="mt-5 text-base font-semibold text-ink-950">{f.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-ink-600">{f.text}</p>
                      <ul className="mt-5 space-y-2 border-t border-ink-100 pt-4">
                        {f.points.map((p) => (
                          <li key={p} className="flex items-start gap-2 text-[13px] text-ink-700">
                            <Check className="mt-0.5 size-3.5 shrink-0 text-brand-600" strokeWidth={3} aria-hidden="true" />
                            {p}
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </Container>
    </Section>
  );
}
