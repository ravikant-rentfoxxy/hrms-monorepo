'use client';

import * as React from 'react';
import Link from 'next/link';
import { Dialog, NavigationMenu } from 'radix-ui';
import { ArrowRight, ChevronDown, Menu, X } from 'lucide-react';
import { FEATURE_GROUPS, SOLUTIONS } from '@/marketing/lib/content';
import { cn } from '@/marketing/lib/utils';
import { Button } from '@/marketing/components/ui/button';
import { useAuth } from '@/lib/auth';
import { Logo } from './logo';
import { DemoLink } from '@/marketing/components/demo/demo-dialog';

/** Anchors are absolute ("/#…") so they also work from /login and /demo. */
const LINKS = [
  { href: '/#product', label: 'Product' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/#faq', label: 'Resources' },
  { href: '/#contact', label: 'Contact' },
] as const;

const triggerCls =
  'group inline-flex h-9 items-center gap-1 rounded-full px-3.5 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-100/70 hover:text-ink-950 data-[state=open]:bg-ink-100/70 data-[state=open]:text-ink-950';

function Dropdown({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <NavigationMenu.Item>
      <NavigationMenu.Trigger className={triggerCls}>
        {label}
        <ChevronDown className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180" aria-hidden="true" />
      </NavigationMenu.Trigger>
      <NavigationMenu.Content className="absolute left-0 top-0 w-auto">
        {children}
      </NavigationMenu.Content>
    </NavigationMenu.Item>
  );
}

function DropLink({ href, title, text, icon }: { href: string; title: string; text: string; icon?: React.ReactNode }) {
  return (
    <NavigationMenu.Link asChild>
      <Link href={href} className="group flex gap-3 rounded-xl p-3 transition-colors hover:bg-ink-50 focus-visible:bg-ink-50">
        {icon && (
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-brand-600/10 [&_svg]:size-[18px]">
            {icon}
          </span>
        )}
        <span>
          <span className="flex items-center gap-1 text-sm font-semibold text-ink-900">
            {title}
            <ArrowRight className="size-3.5 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" aria-hidden="true" />
          </span>
          <span className="mt-0.5 block text-[13px] leading-snug text-ink-500">{text}</span>
        </span>
      </Link>
    </NavigationMenu.Link>
  );
}

/** Signed-in visitors get a shortcut to the dashboard instead of Login. */
function useAccountLink() {
  const { session } = useAuth();
  return session ? { href: '/dashboard', label: 'Dashboard' } : { href: '/login', label: 'Login' };
}

function MobileMenu() {
  const [open, setOpen] = React.useState(false);
  const account = useAccountLink();
  const close = () => setOpen(false);
  const item = 'block rounded-xl px-3 py-3 text-[15px] font-medium text-ink-800 hover:bg-ink-50';
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
          <Menu />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink-950/30 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col bg-white shadow-lift focus:outline-none">
          <div className="flex h-16 items-center justify-between border-b border-ink-100 px-4">
            <Dialog.Title className="sr-only">Menu</Dialog.Title>
            <Dialog.Description className="sr-only">Site navigation</Dialog.Description>
            <Logo />
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close menu">
                <X />
              </Button>
            </Dialog.Close>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Mobile">
            <Link href="/#product" className={item} onClick={close}>
              Product
            </Link>
            <p className="px-3 pb-1 pt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">Features</p>
            {FEATURE_GROUPS.map((g) => (
              <Link key={g.id} href={`/#${g.id}`} className={item} onClick={close}>
                {g.label}
              </Link>
            ))}
            <p className="px-3 pb-1 pt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">Solutions</p>
            {SOLUTIONS.map((s) => (
              <Link key={s.id} href={`/#${s.id}`} className={item} onClick={close}>
                {s.title}
              </Link>
            ))}
            <div className="my-3 h-px bg-ink-100" />
            {LINKS.filter((l) => l.label !== 'Product').map((l) => (
              <Link key={l.href} href={l.href} className={item} onClick={close}>
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="grid grid-cols-1 gap-2 border-t border-ink-100 p-4">
            <Button variant="outline" size="lg" asChild>
              <Link href={account.href} onClick={close}>
                {account.label}
              </Link>
            </Button>
            <Button size="lg" asChild>
              <DemoLink onClick={close}>
                Book a Demo
              </DemoLink>
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Header() {
  const [scrolled, setScrolled] = React.useState(false);
  const account = useAccountLink();
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full transition-[background-color,box-shadow,border-color] duration-300',
        scrolled ? 'border-b border-ink-200/70 bg-white/85 shadow-[0_1px_12px_rgb(11_26_54/0.05)] backdrop-blur-xl' : 'border-b border-transparent bg-transparent'
      )}
    >
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-ink-900 px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:absolute focus:left-4 focus:top-3"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:h-[72px] lg:px-8">
        <Logo />

        <NavigationMenu.Root className="relative hidden lg:block" aria-label="Main">
          <NavigationMenu.List className="flex items-center gap-0.5">
            <NavigationMenu.Item>
              <NavigationMenu.Link asChild>
                <Link href="/#product" className={triggerCls}>
                  Product
                </Link>
              </NavigationMenu.Link>
            </NavigationMenu.Item>
            <Dropdown label="Features">
              <div className="grid w-[640px] grid-cols-2 gap-1 p-3">
                {FEATURE_GROUPS.map((g) => {
                  const Icon = g.features[0]!.icon;
                  return <DropLink key={g.id} href={`/#${g.id}`} title={g.label} text={g.summary} icon={<Icon />} />;
                })}
                <Link
                  href="/#features"
                  className="flex items-center justify-between rounded-xl bg-ink-50 p-3 text-sm font-semibold text-ink-800 hover:bg-ink-100"
                >
                  All features <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </div>
            </Dropdown>
            <Dropdown label="Solutions">
              <div className="grid w-[420px] gap-1 p-3">
                {SOLUTIONS.map((s) => (
                  <DropLink key={s.id} href={`/#${s.id}`} title={s.title} text={s.text} icon={<s.icon />} />
                ))}
              </div>
            </Dropdown>
            {LINKS.filter((l) => l.label !== 'Product').map((l) => (
              <NavigationMenu.Item key={l.href}>
                <NavigationMenu.Link asChild>
                  <Link href={l.href} className={triggerCls}>
                    {l.label}
                  </Link>
                </NavigationMenu.Link>
              </NavigationMenu.Item>
            ))}
          </NavigationMenu.List>
          <div className="absolute left-1/2 top-full flex -translate-x-1/2 justify-center pt-3">
            <NavigationMenu.Viewport className="relative h-[var(--radix-navigation-menu-viewport-height)] w-[var(--radix-navigation-menu-viewport-width)] origin-top overflow-hidden rounded-2xl border border-ink-200/80 bg-white shadow-lift transition-[width,height] duration-300 data-[state=closed]:animate-[menu-out_150ms_ease-in] data-[state=open]:animate-[menu-in_200ms_ease-out]" />
          </div>
        </NavigationMenu.Root>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link href={account.href}>{account.label}</Link>
          </Button>
          <Button size="sm" asChild className="hidden sm:inline-flex">
            <DemoLink>
              Book a Demo <ArrowRight aria-hidden="true" />
            </DemoLink>
          </Button>
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}
