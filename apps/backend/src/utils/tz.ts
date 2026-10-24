/**
 * Company-timezone helpers for attendance. Shift times ("09:30") are wall-clock
 * times in the company's timezone; date-only columns are midnight UTC of the
 * local calendar date (same convention as `dateOnlyUTC`).
 */

export const DAY_MS = 86400000;
const DEFAULT_TZ_OFFSET = 330; // Asia/Kolkata

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat | null {
  let f = formatters.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return null; // unknown timezone id → fall back to IST
    }
    formatters.set(timeZone, f);
  }
  return f;
}

/** Offset of `timeZone` from UTC at instant `at`, in minutes (IST = 330). */
export function tzOffsetMinutes(timeZone: string, at: Date = new Date()): number {
  const f = formatter(timeZone);
  if (!f) return DEFAULT_TZ_OFFSET;
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(at)) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year ?? 1970, (p.month ?? 1) - 1, p.day ?? 1, (p.hour ?? 0) % 24, p.minute ?? 0, p.second ?? 0);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The local calendar date of `at` in `timeZone`, as midnight UTC. */
export function localDateOf(at: Date, timeZone: string): Date {
  const shifted = new Date(at.getTime() + tzOffsetMinutes(timeZone, at) * 60000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

/** "HH:mm" → minutes after midnight. */
export function toMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Minutes → "HH:mm" (wraps past midnight). */
export function fromMinutes(total: number): string {
  const t = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** The instant of wall-clock `hhmm` on `date` (+ `addDays`) in `timeZone`. */
export function atLocalTime(date: Date, hhmm: string, timeZone: string, addDays = 0): Date {
  const guess = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + addDays) + toMinutes(hhmm) * 60000;
  const offset = tzOffsetMinutes(timeZone, new Date(guess));
  return new Date(guess - offset * 60000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** "2026-10-19" for a date-only value. */
export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** "8h 05m" for a minute count. */
export function fmtMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
