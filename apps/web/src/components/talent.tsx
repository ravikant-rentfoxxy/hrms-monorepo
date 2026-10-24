'use client';

/**
 * Shared bits for the talent pages (recruitment, reviews, training, surveys):
 * pure-SVG bar charts, error helper, authenticated CSV download.
 */
import { API_URL, getActingCompanyId, getSession } from '@/lib/api';

export const errMsg = (err: unknown): string => (err instanceof Error ? err.message : 'Something went wrong');

export const pct = (x: number | null | undefined, digits = 0): string =>
  x === null || x === undefined ? '—' : `${(x * 100).toFixed(digits)}%`;

export const label = (s: string): string => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** Authenticated file download (the API needs the Bearer token). */
export async function downloadFile(path: string, fileName: string): Promise<void> {
  const session = getSession();
  const headers: Record<string, string> = { Authorization: `Bearer ${session?.accessToken}` };
  const acting = session?.role === 'SUPER_ADMIN' ? getActingCompanyId() : null;
  if (acting) headers['X-Company-Id'] = acting;
  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export interface BarDatum {
  label: string;
  value: number;
  /** Optional comparison value (e.g. target), drawn as a dashed outline behind the bar. */
  target?: number;
  /** Text shown above the bar (defaults to the value). */
  valueLabel?: string;
}

/**
 * Vertical bar chart in plain SVG. Single series in indigo; an optional
 * target per bar is a neutral dashed outline. Hover shows a native tooltip.
 */
export function BarChart({
  data,
  height = 180,
  valueSuffix = '',
  targetLabel = 'Target',
  valueName = 'Actual',
}: {
  data: BarDatum[];
  height?: number;
  valueSuffix?: string;
  targetLabel?: string;
  valueName?: string;
}) {
  const hasTarget = data.some((d) => d.target !== undefined);
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.target ?? 0)));
  const slot = 56;
  const barW = 24;
  const top = 18;
  const bottom = 24;
  const plotH = height - top - bottom;
  const width = Math.max(data.length * slot, 120);
  const y = (v: number) => top + plotH - (v / max) * plotH;

  return (
    <div>
      {hasTarget && (
        <div className="mb-2 flex items-center gap-4 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-indigo-500" /> {valueName}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-slate-400" /> {targetLabel}
          </span>
        </div>
      )}
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ minWidth: width, maxWidth: Math.max(width, 480) }} role="img">
          <line x1={0} x2={width} y1={top + plotH} y2={top + plotH} className="stroke-slate-200" strokeWidth={1} />
          {data.map((d, i) => {
            const cx = i * slot + slot / 2;
            const h = Math.max(0, top + plotH - y(d.value));
            const r = Math.min(4, h / 2);
            return (
              <g key={`${d.label}-${i}`}>
                <title>{`${d.label}: ${d.valueLabel ?? d.value}${valueSuffix}${d.target !== undefined ? ` · ${targetLabel.toLowerCase()} ${d.target}${valueSuffix}` : ''}`}</title>
                {/* Hit target larger than the mark. */}
                <rect x={cx - slot / 2 + 2} y={top} width={slot - 4} height={plotH} fill="transparent" />
                {d.target !== undefined && (
                  <rect
                    x={cx - barW / 2 - 4}
                    y={y(d.target)}
                    width={barW + 8}
                    height={Math.max(0, top + plotH - y(d.target))}
                    rx={4}
                    fill="none"
                    strokeDasharray="3 3"
                    className="stroke-slate-400"
                    strokeWidth={1.25}
                  />
                )}
                {h > 0 && (
                  <path
                    d={`M${cx - barW / 2},${top + plotH} V${y(d.value) + r} Q${cx - barW / 2},${y(d.value)} ${cx - barW / 2 + r},${y(d.value)} H${cx + barW / 2 - r} Q${cx + barW / 2},${y(d.value)} ${cx + barW / 2},${y(d.value) + r} V${top + plotH} Z`}
                    className="fill-indigo-500"
                  />
                )}
                <text x={cx} y={y(Math.max(d.value, d.target ?? 0)) - 5} textAnchor="middle" className="fill-slate-600 text-[10px] font-medium">
                  {d.valueLabel ?? d.value}
                  {valueSuffix}
                </text>
                <text x={cx} y={height - 8} textAnchor="middle" className="fill-slate-500 text-[10px]">
                  {d.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/** Horizontal bars — for long category labels (choice questions, sources, funnel). */
export function HBarList({ data, total, valueSuffix = '' }: { data: { label: string; value: number }[]; total?: number; valueSuffix?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2">
      {data.map((d) => {
        const share = total ? d.value / total : null;
        return (
          <div key={d.label} title={`${d.label}: ${d.value}${valueSuffix}${share !== null ? ` (${pct(share)})` : ''}`}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="truncate text-slate-600">{d.label}</span>
              <span className="ml-2 shrink-0 font-medium text-slate-700">
                {d.value}
                {valueSuffix}
                {share !== null && <span className="ml-1 font-normal text-slate-400">{pct(share)}</span>}
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${(d.value / max) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Thin progress bar with a percentage. */
export function Progress({ value, className = '' }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-1.5 flex-1 rounded-full bg-slate-100">
        <div className={`h-1.5 rounded-full ${v >= 1 ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${v * 100}%` }} />
      </div>
      <span className="w-9 text-right text-xs font-medium text-slate-600">{Math.round(v * 100)}%</span>
    </div>
  );
}
