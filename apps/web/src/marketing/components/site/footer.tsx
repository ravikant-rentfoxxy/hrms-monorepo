import Link from 'next/link';
import { Mail, MapPin, Phone } from 'lucide-react';
import { FEATURE_GROUPS, SOLUTIONS } from '@/marketing/lib/content';
import { site } from '@/marketing/lib/site';
import { Container } from './section';
import { Logo } from './logo';

/** Simple brand glyphs (lucide no longer ships brand icons). */
function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64Z" />
    </svg>
  );
}
function YouTubeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M23.5 6.2a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.51A3.02 3.02 0 0 0 .5 6.2 31.6 31.6 0 0 0 0 12a31.6 31.6 0 0 0 .5 5.8 3.02 3.02 0 0 0 2.12 2.14c1.88.51 9.38.51 9.38.51s7.5 0 9.38-.51a3.02 3.02 0 0 0 2.12-2.14A31.6 31.6 0 0 0 24 12a31.6 31.6 0 0 0-.5-5.8ZM9.55 15.57V8.43L15.82 12l-6.27 3.57Z" />
    </svg>
  );
}

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { href: '/#product', label: 'Product tour' },
      { href: '/#lifecycle', label: 'Employee lifecycle' },
      { href: '/#how-it-works', label: 'How it works' },
      { href: '/#pricing', label: 'Pricing' },
    ],
  },
  { title: 'Features', links: FEATURE_GROUPS.map((g) => ({ href: `/#${g.id}`, label: g.label })) },
  { title: 'Solutions', links: SOLUTIONS.map((s) => ({ href: `/#${s.id}`, label: s.title })) },
  {
    title: 'Company',
    links: [
      { href: '/demo', label: 'Book a demo' },
      { href: '/login', label: 'Customer login' },
      { href: '/#contact', label: 'Contact' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { href: '/#faq', label: 'FAQ' },
      { href: '/#benefits', label: 'Why an HRMS' },
    ],
  },
];

export function Footer() {
  return (
    <footer id="contact" className="border-t border-ink-200/70 bg-white">
      <Container className="py-16">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,3fr)]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-600">{site.description}</p>
            <ul className="mt-6 space-y-2.5 text-sm text-ink-600">
              <li className="flex items-start gap-2.5">
                <Mail className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" />
                <span>{site.contact.email}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Phone className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" />
                <span>{site.contact.phone}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" />
                <span>{site.contact.address}</span>
              </li>
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-5">
            {COLUMNS.map((col) => (
              <nav key={col.title} aria-label={col.title}>
                <h3 className="text-[13px] font-semibold text-ink-950">{col.title}</h3>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link href={l.href} className="rounded text-sm text-ink-600 transition-colors hover:text-brand-700">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>
        <div className="mt-14 flex flex-col-reverse items-start justify-between gap-6 border-t border-ink-100 pt-8 sm:flex-row sm:items-center">
          <p className="text-[13px] text-ink-500">
            © {new Date().getFullYear()} {site.name}. All rights reserved.
            <span className="mx-2 text-ink-300">·</span>
            <Link href="#" className="hover:text-ink-800">
              Privacy Policy
            </Link>
            <span className="mx-2 text-ink-300">·</span>
            <Link href="#" className="hover:text-ink-800">
              Terms of Service
            </Link>
          </p>
          <div className="flex items-center gap-2">
            {[
              { href: site.social.linkedin, label: 'LinkedIn', icon: <LinkedInIcon /> },
              { href: site.social.x, label: 'X (Twitter)', icon: <XIcon /> },
              { href: site.social.youtube, label: 'YouTube', icon: <YouTubeIcon /> },
            ].map((s) => (
              <a
                key={s.label}
                href={s.href}
                aria-label={s.label}
                className="grid size-9 place-items-center rounded-full border border-ink-200 text-ink-500 transition-colors hover:border-ink-300 hover:text-ink-900"
              >
                {s.icon}
              </a>
            ))}
          </div>
        </div>
      </Container>
    </footer>
  );
}
