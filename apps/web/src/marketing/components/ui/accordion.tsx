'use client';

import * as React from 'react';
import { Accordion as AccordionPrimitive } from 'radix-ui';
import { Plus } from 'lucide-react';
import { cn } from '@/marketing/lib/utils';

export const Accordion = AccordionPrimitive.Root;

export function AccordionItem({ className, ...props }: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return <AccordionPrimitive.Item className={cn('border-b border-ink-200 last:border-b-0', className)} {...props} />;
}

export function AccordionTrigger({ className, children, ...props }: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        className={cn(
          'group flex flex-1 items-center justify-between gap-6 py-5 text-left text-base font-semibold text-ink-900 transition-colors hover:text-brand-700 sm:text-[17px]',
          className
        )}
        {...props}
      >
        {children}
        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-ink-200 bg-white text-ink-600 transition-transform duration-300 group-data-[state=open]:rotate-45 group-data-[state=open]:border-brand-200 group-data-[state=open]:text-brand-700">
          <Plus className="size-4" />
        </span>
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({ className, children, ...props }: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      className="overflow-hidden text-[15px] leading-relaxed text-ink-600 data-[state=closed]:animate-[collapse_200ms_ease-out] data-[state=open]:animate-[expand_220ms_ease-out]"
      {...props}
    >
      <div className={cn('pb-5 pr-14', className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}
