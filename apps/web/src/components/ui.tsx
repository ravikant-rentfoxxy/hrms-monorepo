'use client';

import { useEffect, useState, type ReactNode } from 'react';

/* ---------------------------------- Icons --------------------------------- */

const ICON_PATHS: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="9" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5" />
      <rect x="13.5" y="12" width="7.5" height="9" rx="1.5" />
      <rect x="3" y="15.5" width="7.5" height="5.5" rx="1.5" />
    </>
  ),
  building: (
    <>
      <path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
      <path d="M16 9h3a1 1 0 0 1 1 1v11" />
      <path d="M2 21h20" />
      <path d="M8 7h2m-2 4h2m-2 4h2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3.5 20c.5-3.5 2.8-5.25 5.5-5.25S14 16.5 14.5 20" />
      <path d="M16 5.5a3 3 0 0 1 0 5.5M17.5 14.9c1.9.7 2.8 2.3 3 5.1" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  leaf: (
    <>
      <path d="M5 20c0-8 4-13.5 14-14-.5 10-6 14-11.5 14-1 0-2.5 0-2.5 0Z" />
      <path d="M5 20c2-5 5-8.5 9-10.5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  banknote: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </>
  ),
  receipt: (
    <>
      <path d="M5 3h14v18l-2.3-1.5L14.4 21l-2.4-1.5L9.6 21l-2.3-1.5L5 21V3Z" />
      <path d="M9 7.5h6M9 11h6M9 14.5h4" />
    </>
  ),
  tasks: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="m8.5 12 2.5 2.5 5-5.5" />
    </>
  ),
  folder: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </>
  ),
  ticket: (
    <>
      <path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2.5 2.5 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2.5 2.5 0 0 0 0-6Z" />
      <path d="M13 5v2m0 4v2m0 4v2" />
    </>
  ),
  megaphone: (
    <>
      <path d="M3 11v2a1.5 1.5 0 0 0 1.5 1.5H6l4.5 4V7L6 9.5H4.5A1.5 1.5 0 0 0 3 11Z" />
      <path d="M14 9a4 4 0 0 1 0 6M17 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 10h17M8 2.5V6m8-3.5V6" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20.5c.7-4 3.5-6 7-6s6.3 2 7 6" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7" />
      <path d="m17 8 4 4-4 4M21 12H10" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4-4" />
    </>
  ),
  pencil: (
    <>
      <path d="M15.5 5.5 18.5 8.5" />
      <path d="M4 20l1-4.2L16.3 4.5a2.1 2.1 0 0 1 3 0l.2.2a2.1 2.1 0 0 1 0 3L8.2 19 4 20Z" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5h6V7" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  download: <path d="M12 3v11m0 0 4-4m-4 4-4-4M4 20h16" />,
  star: <path d="m12 3 2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 16.9 6.4 20l1.3-6.2L3 9.5l6.3-.7L12 3Z" />,
  check: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.2 2.4 2.4 4.6-5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7M3 12.5h18" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V4M4 20h16" />
      <path d="M8 16v-4m4 4V8m4 8v-6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </>
  ),
  box: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </>
  ),
  door: (
    <>
      <path d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h8A1.5 1.5 0 0 1 16 4.5V21M3 21h16" />
      <path d="M16 12h5m-2-2 2 2-2 2M12.5 12h.01" />
    </>
  ),
  graduation: (
    <>
      <path d="m12 4 10 5-10 5L2 9l10-5Z" />
      <path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v6" />
    </>
  ),
  heart: <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z" />,
  plane: <path d="M10.5 13.5 3 11l1.5-1.5 7.5 1L16.5 6c1-1 2.5-1.3 3-.8s.2 2-.8 3L14 12.5l1 7.5-1.5 1.5-2.5-7.5L7.5 17.5 8 20l-1 1-2-3-3-2 1-1 2.5.5 3.5-3.5" />,
  award: (
    <>
      <circle cx="12" cy="9" r="5.5" />
      <path d="m8.5 13.5-1.5 7.5 5-2.5 5 2.5-1.5-7.5" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v5m6-5v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0V8ZM12 16.5V21" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </>
  ),
  upload: <path d="M12 16V5m0 0 4 4m-4-4-4 4M4 20h16" />,
  sitemap: (
    <>
      <rect x="9" y="3" width="6" height="5" rx="1" />
      <rect x="3" y="16" width="6" height="5" rx="1" />
      <rect x="15" y="16" width="6" height="5" rx="1" />
      <path d="M12 8v4M6 16v-4h12v4" />
    </>
  ),
  wallet: (
    <>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v4" />
      <rect x="4" y="9" width="17" height="11" rx="2" />
      <path d="M16.5 14.5h.01" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5" />
      <path d="M3.5 4v4.5H8M12 8v4l3 2" />
    </>
  ),
};

export type IconName = keyof typeof ICON_PATHS;

export function Icon({ name, className = 'h-5 w-5' }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

/* --------------------------------- Layout --------------------------------- */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[20px] border border-ink-200/70 bg-white shadow-soft ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-ink-950">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/* --------------------------------- Buttons -------------------------------- */

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  className?: string;
}) {
  const styles = {
    primary:
      'bg-brand-600 text-white shadow-[0_1px_0_rgb(255_255_255/0.2)_inset,0_6px_16px_-6px_rgb(5_149_113/0.65)] hover:bg-brand-700 active:translate-y-px disabled:bg-brand-300 disabled:shadow-none',
    secondary:
      'border border-ink-200 bg-white text-ink-800 shadow-[0_1px_2px_rgb(11_26_54/0.04)] hover:border-ink-300 hover:bg-ink-50 disabled:text-ink-400',
    danger:
      'bg-rose-600 text-white shadow-[0_6px_16px_-6px_rgb(225_29_72/0.55)] hover:bg-rose-700 active:translate-y-px disabled:bg-rose-300 disabled:shadow-none',
    ghost: 'text-brand-700 hover:bg-brand-50 disabled:text-ink-400',
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

/* ---------------------------------- Forms --------------------------------- */

export function Field({ label, children, hint, required }: { label: string; children: ReactNode; hint?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-800">
        {label}
        {required && (
          <span className="ml-0.5 text-rose-500" aria-hidden>
            *
          </span>
        )}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 shadow-[0_1px_2px_rgb(11_26_54/0.04)] placeholder:text-ink-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  if (props.type === 'password') return <PasswordInput {...props} />;
  return <input {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

/** Password field with an eye button to show / hide what was typed. */
function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={visible ? 'text' : 'password'} className={`${inputCls} pr-11 ${props.className ?? ''}`} />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-ink-400 transition-colors hover:text-ink-700"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden>
          {visible ? (
            <>
              <path d="M3 3l18 18" />
              <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
              <path d="M9.9 4.2A9.8 9.8 0 0 1 12 4c5 0 9 4.5 10 8a11.6 11.6 0 0 1-2.6 4.1M6.6 6.6C4.4 8 2.8 10 2 12c1 3.5 5 8 10 8a9.7 9.7 0 0 0 5.4-1.6" />
            </>
          ) : (
            <>
              <path d="M2 12c1-3.5 5-8 10-8s9 4.5 10 8c-1 3.5-5 8-10 8S3 15.5 2 12Z" />
              <circle cx="12" cy="12" r="3" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

/* --------------------------------- Badges --------------------------------- */

const badgeTones: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/15',
  red: 'bg-rose-50 text-rose-700 ring-rose-600/15',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/15',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/15',
  slate: 'bg-ink-100 text-ink-600 ring-ink-500/15',
};

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: keyof typeof badgeTones }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

export const statusTone = (status: string): keyof typeof badgeTones =>
  (({
    PENDING: 'amber',
    APPROVED: 'green',
    REJECTED: 'red',
    CANCELLED: 'slate',
    PRESENT: 'green',
    LATE: 'amber',
    ABSENT: 'red',
    LEAVE: 'violet',
    OPEN: 'amber',
    IN_PROGRESS: 'blue',
    RESOLVED: 'green',
    CLOSED: 'slate',
  }) as Record<string, keyof typeof badgeTones>)[status] ?? 'slate';

/* ---------------------------------- Table --------------------------------- */

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-ink-200/70 bg-ink-50/70 text-[11px] uppercase tracking-[0.08em] text-ink-500">
            {headers.map((head, i) => (
              <th key={`${head}-${i}`} className="px-4 py-3 font-semibold first:rounded-tl-[20px] last:rounded-tr-[20px]">
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100 [&>tr]:transition-colors [&>tr:hover]:bg-brand-50/30">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-3.5 align-middle text-ink-700 ${className}`}>{children}</td>;
}

/**
 * Long free text in a table cell (descriptions, notes): wraps and shows two
 * lines, with "Show more" to read the whole text in place.
 */
export function LongText({ text, lines = 2 }: { text: string | null | undefined; lines?: 2 | 3 }) {
  const [open, setOpen] = useState(false);
  if (!text) return <>—</>;
  const long = text.length > 70 || text.includes('\n');
  return (
    <div className="max-w-sm min-w-48">
      <p className={`whitespace-pre-line break-words ${open || !long ? '' : lines === 3 ? 'line-clamp-3' : 'line-clamp-2'}`}>{text}</p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-0.5 text-xs font-semibold text-brand-700 hover:underline"
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

/* ---------------------------------- Modal --------------------------------- */

export function Modal({
  title,
  open,
  onClose,
  children,
  wide,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/40 p-4 pt-16 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`animate-modal-in w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-3xl bg-white p-6 shadow-lift sm:p-7`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight text-ink-950">{title}</h2>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
            aria-label="Close"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* --------------------------------- Feedback -------------------------------- */

export function Spinner() {
  return (
    <div className="flex justify-center py-14">
      <div className="h-7 w-7 animate-spin rounded-full border-[2.5px] border-brand-100 border-t-brand-600" role="status" aria-label="Loading" />
    </div>
  );
}

export function Empty({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-50 text-ink-400 ring-1 ring-ink-200/70">
        <Icon name="search" className="h-5 w-5" />
      </span>
      <p className="text-sm font-medium text-ink-500">{message}</p>
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="rounded-xl border border-rose-100 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</p>
  );
}

/* ----------------------------------- Stat ---------------------------------- */

export function Stat({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: ReactNode;
  accent?: string;
  icon?: IconName;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[12px] font-medium text-ink-500">{label}</p>
          <div className={`mt-1.5 text-[26px] font-bold leading-tight tracking-tight tabular-nums ${accent ?? 'text-ink-950'}`}>{value}</div>
        </div>
        {icon && (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 text-brand-700 ring-1 ring-brand-600/10">
            <Icon name={icon} className="h-4.5 w-4.5" />
          </span>
        )}
      </div>
    </Card>
  );
}

/* ----------------------------------- Tabs ---------------------------------- */

export function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="mb-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-ink-200/80 bg-white p-1 shadow-soft">
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold transition-all ${
            active === tab ? 'bg-ink-900 text-white shadow-sm' : 'text-ink-500 hover:text-ink-900'
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------- Avatar --------------------------------- */

export function Avatar({ name, color }: { name: string; color?: string }) {
  const init = name
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ring-2 ring-white/80"
      style={{ background: `linear-gradient(135deg, ${color ?? '#059571'}, ${color ?? '#059571'}cc)` }}
    >
      {init}
    </span>
  );
}

/* ------------------------------ Date pickers ------------------------------ */
// The project-wide calendar components. Import them from here like every
// other UI primitive: `import { DatePicker, MonthPicker } from '@/components/ui'`.
export { DatePicker, MonthPicker } from './datepicker';
