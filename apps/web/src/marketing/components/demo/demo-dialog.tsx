'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { DemoForm } from '@/marketing/components/forms/demo-form';

const DemoDialogContext = React.createContext<{ open: () => void } | null>(null);

/** One demo-request dialog for the whole site; any DemoLink opens it. */
export function DemoDialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  // Remount the form each time the dialog opens, so a finished request starts fresh.
  const [session, setSession] = React.useState(0);
  const value = React.useMemo(
    () => ({
      open: () => {
        setSession((n) => n + 1);
        setOpen(true);
      },
    }),
    []
  );

  return (
    <DemoDialogContext.Provider value={value}>
      {children}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-ink-950/40 backdrop-blur-sm data-[state=open]:animate-[overlay-in_200ms_ease-out]" />
          <Dialog.Content
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col rounded-t-[1.75rem] bg-white shadow-lift focus:outline-none data-[state=open]:animate-[sheet-in_280ms_cubic-bezier(0.22,1,0.36,1)] sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[90dvh] sm:w-[min(44rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[1.75rem] sm:data-[state=open]:animate-[dialog-in_240ms_cubic-bezier(0.22,1,0.36,1)]"
          >
            <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-6 pb-4 pt-6 sm:px-8 sm:pt-7">
              <div>
                <Dialog.Title className="text-xl font-bold tracking-tight text-ink-950 sm:text-2xl">Book a demo</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-ink-500">
                  Tell us about your team — we’ll tailor a walkthrough to the modules you pick.
                </Dialog.Description>
              </div>
              <Dialog.Close
                className="grid size-9 shrink-0 place-items-center rounded-full text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
                aria-label="Close"
              >
                <X className="size-5" />
              </Dialog.Close>
            </div>
            <div className="overflow-y-auto overscroll-contain px-6 py-6 sm:px-8">
              <DemoForm key={session} onClose={() => setOpen(false)} />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </DemoDialogContext.Provider>
  );
}

export function useDemoDialog() {
  return React.useContext(DemoDialogContext);
}

/**
 * A link to /demo that opens the demo dialog instead. Still a real link, so it
 * works without JavaScript, with modifier-clicks (new tab) and on /demo itself.
 */
export function DemoLink({
  onClick,
  ...props
}: Omit<React.ComponentProps<typeof Link>, 'href'>) {
  const demo = useDemoDialog();
  const pathname = usePathname();
  return (
    <Link
      href="/demo"
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (!demo || pathname === '/demo' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        demo.open();
      }}
    />
  );
}
