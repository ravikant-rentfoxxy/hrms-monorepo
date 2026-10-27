import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/marketing/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full font-semibold', {
  variants: {
    tone: {
      brand: 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-600/15',
      ink: 'bg-ink-100 text-ink-700 ring-1 ring-inset ring-ink-500/10',
      amber: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/15',
      rose: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/15',
      sky: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/15',
      violet: 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-600/15',
    },
    size: { xs: 'px-1.5 py-px text-[10px]', sm: 'px-2 py-0.5 text-[11px]', md: 'px-3 py-1 text-xs' },
  },
  defaultVariants: { tone: 'ink', size: 'sm' },
});

export function Badge({ className, tone, size, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}
