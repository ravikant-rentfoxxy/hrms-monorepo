import * as React from 'react';
import { cn } from '@/marketing/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-[var(--radius-card)] border border-ink-200/80 bg-white shadow-soft', className)} {...props} />;
}
