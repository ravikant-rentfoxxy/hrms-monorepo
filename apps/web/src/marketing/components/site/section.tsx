import * as React from 'react';
import { cn } from '@/marketing/lib/utils';
import { Reveal } from './reveal';

export function Container({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8', className)} {...props} />;
}

export function Section({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn('py-20 sm:py-24 lg:py-28', className)} {...props} />;
}

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('inline-flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-brand-700', className)}>
      <span className="h-px w-5 bg-brand-500" aria-hidden="true" />
      {children}
    </p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'center',
  id,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: 'center' | 'left';
  id?: string;
}) {
  return (
    <Reveal className={cn('max-w-3xl', align === 'center' && 'mx-auto text-center')}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 id={id} className="mt-4 text-balance text-3xl font-bold tracking-tight text-ink-950 sm:text-4xl lg:text-[44px] lg:leading-[1.1]">
        {title}
      </h2>
      {description && <p className="mt-4 text-pretty text-base leading-relaxed text-ink-600 sm:text-lg">{description}</p>}
    </Reveal>
  );
}
