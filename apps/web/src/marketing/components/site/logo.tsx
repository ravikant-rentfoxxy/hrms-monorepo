import Link from 'next/link';
import { site } from '@/marketing/lib/site';
import { cn } from '@/marketing/lib/utils';

/** Brand mark: three rising bars inside a rounded tile — people, growth, structure. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-8', className)}>
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#10b88a" />
          <stop offset="1" stopColor="#04775d" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#logo-g)" />
      <rect x="8" y="15" width="4" height="9" rx="2" fill="#fff" opacity=".7" />
      <rect x="14" y="11" width="4" height="13" rx="2" fill="#fff" opacity=".85" />
      <rect x="20" y="7" width="4" height="17" rx="2" fill="#fff" />
    </svg>
  );
}

export function Logo({ className, light = false }: { className?: string; light?: boolean }) {
  return (
    <Link href="/" className={cn('inline-flex items-center gap-2.5 rounded-lg', className)} aria-label={`${site.name} home`}>
      <LogoMark />
      <span className={cn('text-[17px] font-bold tracking-tight', light ? 'text-white' : 'text-ink-900')}>{site.name}</span>
    </Link>
  );
}
