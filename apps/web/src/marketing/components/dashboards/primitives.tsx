'use client';

import * as React from 'react';
import { useReveal } from '@/marketing/hooks/use-reveal';
import { cn } from '@/marketing/lib/utils';

export function Avatar({ name, color, size = 28, className }: { name: string; color: string; size?: number; className?: string }) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('');
  return (
    <span
      aria-hidden="true"
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold text-white ring-2 ring-white', className)}
      style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}
    >
      {initials}
    </span>
  );
}

export function Panel({ title, action, className, children }: { title?: string; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('rounded-xl border border-ink-200/70 bg-white p-3.5', className)}>
      {title && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[12px] font-semibold text-ink-800">{title}</p>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Kpi({
  label,
  value,
  note,
  icon,
  tone = 'brand',
}: {
  label: string;
  value: React.ReactNode;
  note?: string;
  icon: React.ReactNode;
  tone?: 'brand' | 'sky' | 'amber' | 'violet';
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-700',
    sky: 'bg-sky-50 text-sky-700',
    amber: 'bg-amber-50 text-amber-700',
    violet: 'bg-violet-50 text-violet-700',
  };
  return (
    <div className="rounded-xl border border-ink-200/70 bg-white p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-ink-500">{label}</p>
        <span className={cn('grid size-6 place-items-center rounded-md [&_svg]:size-3.5', tones[tone])}>{icon}</span>
      </div>
      <p className="mt-1.5 text-lg font-bold tracking-tight text-ink-950 tabular-nums">{value}</p>
      {note && <p className="mt-0.5 truncate text-[10px] font-medium text-ink-500">{note}</p>}
    </div>
  );
}

/** Stacked weekly bars. */
export function StackedBars({
  data,
  keys,
  height = 120,
  large = false,
}: {
  data: { label: string; values: number[] }[];
  keys: { label: string; color: string }[];
  height?: number;
  /** Full-size text (the real dashboard) instead of preview-sized. */
  large?: boolean;
}) {
  const ref = useReveal<HTMLDivElement>();
  const max = Math.max(1, ...data.map((d) => d.values.reduce((a, b) => a + b, 0)));
  return (
    <div ref={ref} data-chart="">
      <div className="flex items-end gap-2.5" style={{ height }}>
        {data.map((d, i) => {
          const total = d.values.reduce((a, b) => a + b, 0);
          return (
            <div key={d.label} className="flex h-full flex-1 flex-col justify-end">
              <div
                className={cn('chart-bar mx-auto flex w-full flex-col-reverse overflow-hidden rounded-md', large ? 'max-w-12' : 'max-w-7')}
                style={{ height: `${(total / max) * 100}%`, ['--d' as string]: `${0.05 * i}s` }}
              >
                {d.values.map((v, k) => (
                  <div key={k} style={{ height: `${total ? (v / total) * 100 : 0}%`, background: keys[k]!.color }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-2.5">
        {data.map((d) => (
          <span key={d.label} className={cn('flex-1 text-center font-medium text-ink-400', large ? 'text-xs' : 'text-[10px]')}>
            {d.label}
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {keys.map((k) => (
          <span key={k.label} className={cn('inline-flex items-center gap-1.5 font-medium text-ink-500', large ? 'text-xs' : 'text-[10px]')}>
            <span className="size-2 rounded-sm" style={{ background: k.color }} />
            {k.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Smooth area line chart. */
export function AreaChart({
  values,
  labels,
  height = 110,
  color = '#059571',
  id,
  large = false,
}: {
  values: number[];
  labels?: string[];
  height?: number;
  color?: string;
  id: string;
  large?: boolean;
}) {
  const ref = useReveal<HTMLDivElement>();
  if (values.length < 2) return null;
  const w = 300;
  const h = 100;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 8 - ((v - min) / (max - min || 1)) * (h - 20)] as const);
  const line = pts.reduce((acc, [x, y], i) => {
    if (i === 0) return `M${x},${y}`;
    const [px, py] = pts[i - 1]!;
    const cx = (px + x) / 2;
    return `${acc} C${cx},${py} ${cx},${y} ${x},${y}`;
  }, '');
  const area = `${line} L${w},${h} L0,${h} Z`;
  const last = pts[pts.length - 1]!;
  return (
    <div ref={ref} data-chart="">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full overflow-visible" style={{ height }} aria-hidden="true">
        <defs>
          <linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.22" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1="0" x2={w} y1={h * g} y2={h * g} stroke="#eef1f5" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <path className="chart-fade" d={area} fill={`url(#area-${id})`} />
        <path
          className="chart-line"
          d={line}
          pathLength={1}
          fill="none"
          stroke={color}
          strokeWidth="2.25"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle className="chart-fade" cx={last[0]} cy={last[1]} r="3.5" fill="#fff" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      {labels && (
        <div className="mt-1 flex justify-between">
          {labels.map((l, i) => (
            <span key={l + i} className={cn('font-medium text-ink-400', large ? 'text-xs' : 'text-[9px]')}>
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Donut({ parts, size = 108, center }: { parts: { value: number; color: string }[]; size?: number; center?: React.ReactNode }) {
  const ref = useReveal<HTMLDivElement>();
  const total = parts.reduce((a, p) => a + p.value, 0);
  // Each slice starts where the previous ones end (lengths in % of the ring).
  const segments = parts.map((p, i) => ({
    ...p,
    len: (p.value / total) * 100,
    offset: parts.slice(0, i).reduce((a, q) => a + (q.value / total) * 100, 0),
  }));
  return (
    <div ref={ref} data-chart="" className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r="40" fill="none" stroke="#eef1f5" strokeWidth="12" />
        {segments.map((p, i) => (
          <circle
            key={i}
            className="chart-fade"
            cx="50"
            cy="50"
            r="40"
            pathLength={100}
            fill="none"
            stroke={p.color}
            strokeWidth="12"
            strokeDasharray={`${Math.max(p.len - 0.8, 0)} 100`}
            strokeDashoffset={-p.offset}
          />
        ))}
      </svg>
      {center && <div className="absolute inset-0 grid place-items-center text-center">{center}</div>}
    </div>
  );
}

export function Progress({ value, color = '#059571', className }: { value: number; color?: string; className?: string }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} data-chart="" className={cn('h-1.5 overflow-hidden rounded-full bg-ink-100', className)}>
      <div className="chart-hbar h-full rounded-full" style={{ background: color, width: `${value}%` }} />
    </div>
  );
}

export function StatusPill({ tone, children }: { tone: 'green' | 'amber' | 'sky' | 'rose' | 'ink' | 'violet'; children: React.ReactNode }) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    sky: 'bg-sky-50 text-sky-700',
    rose: 'bg-rose-50 text-rose-700',
    ink: 'bg-ink-100 text-ink-600',
    violet: 'bg-violet-50 text-violet-700',
  };
  return <span className={cn('inline-flex items-center rounded-full px-1.5 py-px text-[9.5px] font-semibold', tones[tone])}>{children}</span>;
}
