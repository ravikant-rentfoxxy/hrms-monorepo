'use client';

/**
 * Custom calendar pickers (replace the browser's native date/month inputs):
 *   <DatePicker  value="2026-10-19" onChange={(v) => …} />   // '' = empty
 *   <MonthPicker value="2026-10"    onChange={(v) => …} />
 * Values stay the same strings the native inputs produced, so form state and
 * API payloads are unchanged.
 */
import { useEffect, useRef, useState } from 'react';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const pad = (n: number) => String(n).padStart(2, '0');
const toDateStr = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

function parseDate(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

/** Shared popover shell: trigger button + outside-click / Escape handling. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [openUp, setOpenUp] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open && ref.current) {
      // Flip upward when there is no room below the field.
      setOpenUp(window.innerHeight - ref.current.getBoundingClientRect().bottom < 360);
    }
    setOpen((o) => !o);
  };
  return { open, setOpen, toggle, ref, openUp };
}

function Trigger({ label, placeholder, onClick, onClear }: {
  label: string | null;
  placeholder: string;
  onClick: () => void;
  onClear?: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-sm shadow-sm transition-colors hover:border-slate-300 focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-500/10"
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-4 w-4 shrink-0 text-indigo-500">
          <rect x="3" y="4.5" width="14" height="12" rx="2.5" />
          <path d="M3 8.5h14M7 2.5v3.5M13 2.5v3.5" strokeLinecap="round" />
        </svg>
        <span className={`flex-1 truncate ${label ? 'font-medium text-slate-900' : 'text-slate-400'}`}>
          {label ?? placeholder}
        </span>
        {!label && (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-3.5 w-3.5 text-slate-400">
            <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      {label && onClear && (
        <button
          type="button"
          aria-label="Clear"
          onClick={onClear}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-500"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-3.5 w-3.5">
            <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

function NavButton({ dir, onClick }: { dir: -1 | 1; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
      aria-label={dir === -1 ? 'Previous' : 'Next'}
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
        <path d={dir === -1 ? 'M12 5l-5 5 5 5' : 'M8 5l5 5-5 5'} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

const popCls = (openUp: boolean) =>
  `absolute left-0 z-50 w-[300px] rounded-2xl border border-slate-100 bg-white p-3.5 shadow-xl shadow-slate-900/10 ${
    openUp ? 'bottom-full mb-2' : 'top-full mt-2'
  }`;

/* -------------------------------- DatePicker ------------------------------- */

export function DatePicker({ value, onChange, placeholder = 'Select date', clearable = false }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  clearable?: boolean;
}) {
  const { open, setOpen, toggle, ref, openUp } = usePopover();
  const selected = parseDate(value);
  const now = new Date();
  const [view, setView] = useState<{ y: number; m: number }>({ y: now.getFullYear(), m: now.getMonth() });
  const [yearGrid, setYearGrid] = useState(false);

  // Open on the selected month each time.
  const openPicker = () => {
    if (!open) {
      setView(selected ? { y: selected.y, m: selected.m } : { y: now.getFullYear(), m: now.getMonth() });
      setYearGrid(false);
    }
    toggle();
  };

  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const leading = (new Date(view.y, view.m, 1).getDay() + 6) % 7; // Monday-first
  const todayStr = toDateStr(now.getFullYear(), now.getMonth(), now.getDate());
  const label = selected ? `${selected.d} ${MONTHS[selected.m].slice(0, 3)} ${selected.y}` : null;

  const shiftMonth = (delta: number) => {
    const next = new Date(view.y, view.m + delta, 1);
    setView({ y: next.getFullYear(), m: next.getMonth() });
  };

  return (
    <div className="relative" ref={ref}>
      <Trigger
        label={label}
        placeholder={placeholder}
        onClick={openPicker}
        onClear={clearable ? () => onChange('') : undefined}
      />
      {open && (
        <div className={popCls(openUp)}>
          <div className="mb-2 flex items-center justify-between">
            <NavButton dir={-1} onClick={() => (yearGrid ? setView((v) => ({ ...v, y: v.y - 12 })) : shiftMonth(-1))} />
            <button
              type="button"
              onClick={() => setYearGrid((g) => !g)}
              className="rounded-lg px-3 py-1 text-sm font-semibold text-slate-800 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
            >
              {yearGrid ? `${view.y - 5} – ${view.y + 6}` : `${MONTHS[view.m]} ${view.y}`}
            </button>
            <NavButton dir={1} onClick={() => (yearGrid ? setView((v) => ({ ...v, y: v.y + 12 })) : shiftMonth(1))} />
          </div>

          {yearGrid ? (
            <div className="grid grid-cols-4 gap-1.5 py-1">
              {Array.from({ length: 12 }, (_, i) => view.y - 5 + i).map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => {
                    setView((v) => ({ ...v, y }));
                    setYearGrid(false);
                  }}
                  className={`rounded-lg py-2 text-sm font-medium transition-colors ${
                    y === view.y ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-700'
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7">
                {WEEKDAYS.map((d) => (
                  <span key={d} className="py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    {d}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-y-0.5">
                {Array.from({ length: leading }).map((_, i) => (
                  <span key={`x${i}`} />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                  const str = toDateStr(view.y, view.m, d);
                  const isSelected = value.startsWith(str);
                  const isToday = str === todayStr;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        onChange(str);
                        setOpen(false);
                      }}
                      className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                        isSelected
                          ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                          : isToday
                            ? 'text-indigo-700 ring-1 ring-inset ring-indigo-300 hover:bg-indigo-50'
                            : 'text-slate-700 hover:bg-indigo-50 hover:text-indigo-700'
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
            <button
              type="button"
              onClick={() => {
                onChange(todayStr);
                setOpen(false);
              }}
              className="rounded-lg px-2.5 py-1 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-50"
            >
              Today
            </button>
            {clearable && value && (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
                className="rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- MonthPicker ------------------------------- */

export function MonthPicker({ value, onChange, placeholder = 'Select month' }: {
  value: string; // 'yyyy-mm' or ''
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const { open, setOpen, toggle, ref, openUp } = usePopover();
  const match = /^(\d{4})-(\d{2})/.exec(value);
  const selected = match ? { y: Number(match[1]), m: Number(match[2]) - 1 } : null;
  const now = new Date();
  const [year, setYear] = useState(selected?.y ?? now.getFullYear());

  // Open on the selected year each time.
  const openPicker = () => {
    if (!open) setYear(selected?.y ?? now.getFullYear());
    toggle();
  };

  const label = selected ? `${MONTHS[selected.m]} ${selected.y}` : null;

  return (
    <div className="relative" ref={ref}>
      <Trigger label={label} placeholder={placeholder} onClick={openPicker} />
      {open && (
        <div className={popCls(openUp)}>
          <div className="mb-2 flex items-center justify-between">
            <NavButton dir={-1} onClick={() => setYear((y) => y - 1)} />
            <span className="text-sm font-semibold text-slate-800">{year}</span>
            <NavButton dir={1} onClick={() => setYear((y) => y + 1)} />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {MONTHS.map((m, i) => {
              const isSelected = selected?.y === year && selected.m === i;
              const isCurrent = now.getFullYear() === year && now.getMonth() === i;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    onChange(`${year}-${pad(i + 1)}`);
                    setOpen(false);
                  }}
                  className={`rounded-lg py-2 text-sm font-medium transition-colors ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                      : isCurrent
                        ? 'text-indigo-700 ring-1 ring-inset ring-indigo-300 hover:bg-indigo-50'
                        : 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-700'
                  }`}
                >
                  {m.slice(0, 3)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
