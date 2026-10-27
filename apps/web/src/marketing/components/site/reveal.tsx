'use client';

import * as React from 'react';
import { useReveal } from '@/marketing/hooks/use-reveal';
import { cn } from '@/marketing/lib/utils';

/** Fades and lifts its children in the first time they scroll into view (CSS-driven; static with reduced motion). */
export function Reveal({
  delay = 0,
  className,
  style,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { delay?: number }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      data-reveal=""
      className={cn(className)}
      style={{ ...style, ['--reveal-delay' as string]: `${delay}s` }}
      {...props}
    >
      {children}
    </div>
  );
}
