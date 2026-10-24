'use client';

/**
 * Small dependency-free charts (SVG / CSS) for the dashboard and reports.
 * Series colors follow a fixed order (indigo, then teal); text stays in
 * slate ink. Every chart has an accessible label and a hover tooltip.
 */
import { useState, type ReactNode } from 'react';

export const SERIES_COLORS = ['#4F46E5', '#0D9488'];

type Fmt = (n: number) => string;
const plain: Fmt = (n) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(n);

/** Compact axis label: 1.2L / 3.4Cr / 12k. */
export const compact: Fmt = (n) => {
  const a = Math.abs(n);
  if (a >= 1e7) return `${(n / 1e7).toFixed(1).replace(/\.0$/, '')}Cr`;
  if (a >= 1e5) return `${(n / 1e5).toFixed(1).replace(/\.0$/, '')}L`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return plain(n);
};

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * mag >= v) ?? 10;
  return step * mag;
}

function Tooltip({ children, left }: { children: ReactNode; left: number }) {
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] whitespace-nowrap text-white shadow-lg"
      style={{ left: `${Math.min(88, Math.max(12, left))}%` }}
    >
      {children}
    </div>
  );
}

export function Legend({ series }: { series: { label: string }[] }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-4 text-xs text-slate-500">
      {series.map((s, i) => (
        <span key={s.label} className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

const W = 600;
const PAD = { l: 44, r: 12, t: 12, b: 26 };

/** Line chart for trends (one or two series, one shared y-axis). */
export function LineChart({
  labels,
  series,
  format = plain,
  height = 200,
  label,
}: {
  labels: string[];
  series: { label: string; values: number[] }[];
  format?: Fmt;
  height?: number;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const n = labels.length;
  const iw = W - PAD.l - PAD.r;
  const ih = height - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const every = Math.ceil(n / 6);
  return (
    <div className="space-y-2">
      <Legend series={series} />
      <div className="relative">
        {hover !== null && (
          <Tooltip left={(x(hover) / W) * 100}>
            <p className="font-semibold">{labels[hover]}</p>
            {series.map((s) => (
              <p key={s.label}>
                {series.length > 1 ? `${s.label}: ` : ''}
                {format(s.values[hover] ?? 0)}
              </p>
            ))}
          </Tooltip>
        )}
        <svg
          viewBox={`0 0 ${W} ${height}`}
          className="h-auto w-full"
          role="img"
          aria-label={`${label}: ${labels.map((l, i) => `${l} ${series.map((s) => format(s.values[i] ?? 0)).join(' / ')}`).join(', ')}`}
          onMouseLeave={() => setHover(null)}
        >
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(max * f)} y2={y(max * f)} stroke="#E2E8F0" strokeWidth={1} />
              <text x={PAD.l - 6} y={y(max * f) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">
                {compact(max * f)}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % every === 0 || i === n - 1 ? (
              <text key={l + i} x={x(i)} y={height - 8} textAnchor="middle" className="fill-slate-400 text-[10px]">
                {l}
              </text>
            ) : null
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} stroke="#CBD5E1" strokeWidth={1} />}
          {series.map((s, si) => {
            const color = SERIES_COLORS[si % SERIES_COLORS.length];
            return (
              <g key={s.label}>
                <polyline
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
                />
                {hover !== null && (
                  <circle cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4.5} fill={color} stroke="#fff" strokeWidth={2} />
                )}
              </g>
            );
          })}
          {/* Hit targets wider than the marks. */}
          {labels.map((l, i) => (
            <rect
              key={`hit-${l}-${i}`}
              x={x(i) - iw / Math.max(1, n - 1) / 2}
              y={PAD.t}
              width={iw / Math.max(1, n - 1)}
              height={ih}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

/** Vertical columns (e.g. exits per month). */
export function ColumnChart({
  labels,
  values,
  format = plain,
  height = 180,
  label,
}: {
  labels: string[];
  values: number[];
  format?: Fmt;
  height?: number;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...values));
  const n = labels.length || 1;
  const iw = W - PAD.l - PAD.r;
  const ih = height - PAD.t - PAD.b;
  const slot = iw / n;
  const bw = Math.min(36, slot - 2);
  const every = Math.ceil(n / 8);
  return (
    <div className="relative">
      {hover !== null && (
        <Tooltip left={((PAD.l + slot * hover + slot / 2) / W) * 100}>
          <span className="font-semibold">{labels[hover]}</span> · {format(values[hover] ?? 0)}
        </Tooltip>
      )}
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${label}: ${labels.map((l, i) => `${l} ${format(values[i] ?? 0)}`).join(', ')}`}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih - f * ih} y2={PAD.t + ih - f * ih} stroke="#E2E8F0" />
            <text x={PAD.l - 6} y={PAD.t + ih - f * ih + 3} textAnchor="end" className="fill-slate-400 text-[10px]">
              {compact(max * f)}
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          const h = (v / max) * ih;
          const cx = PAD.l + slot * i + slot / 2;
          const r = Math.min(4, h / 2);
          const top = PAD.t + ih - h;
          return (
            <g key={`${labels[i]}-${i}`} onMouseEnter={() => setHover(i)}>
              <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={ih} fill="transparent" />
              {h > 0 && (
                // Rounded data-end, square baseline.
                <path
                  d={`M${cx - bw / 2},${PAD.t + ih} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${PAD.t + ih} Z`}
                  fill={SERIES_COLORS[0]}
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
              {(i % every === 0 || i === n - 1) && (
                <text x={cx} y={height - 8} textAnchor="middle" className="fill-slate-400 text-[10px]">
                  {labels[i]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Horizontal bars for categories (departments, groups). */
export function BarList({
  items,
  format = plain,
  label,
  limit = 10,
}: {
  items: { label: string; value: number }[];
  format?: Fmt;
  label: string;
  limit?: number;
}) {
  const shown = items.slice(0, limit);
  const max = Math.max(0, ...shown.map((i) => i.value)) || 1;
  return (
    <ul className="space-y-2.5" aria-label={label}>
      {shown.map((item) => (
        <li key={item.label} className="group" title={`${item.label}: ${format(item.value)}`}>
          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
            <span className="truncate text-slate-600">{item.label}</span>
            <span className="font-medium text-slate-900 tabular-nums">{format(item.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full transition-[filter] group-hover:brightness-110"
              style={{ width: `${Math.max(1.5, (item.value / max) * 100)}%`, background: SERIES_COLORS[0] }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** One stacked bar split into labelled parts (e.g. today's attendance). Labels carry identity, not only color. */
export function SplitBar({ parts, label }: { parts: { label: string; value: number; color: string }[]; label: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}`}>
        {total > 0 &&
          parts
            .filter((p) => p.value > 0)
            .map((p) => (
              <div key={p.label} title={`${p.label}: ${p.value}`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
            ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-1.5 text-slate-500">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            {p.label}
            <b className="ml-auto font-semibold text-slate-900 tabular-nums">{p.value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
