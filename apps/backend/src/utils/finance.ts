/**
 * Small month / money helpers shared by the payroll self-service modules
 * (salary revisions, tax declarations, loans, payroll inputs).
 * Months are stored as the first day of the month at midnight UTC (`@db.Date`).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** First day of the month of `d` (UTC). */
export function monthStart(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** First day of the month `n` months after the month of `d`. */
export function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

/** Last day of the month of `d` (UTC midnight). */
export function monthEnd(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

/** "Oct 2026". */
export function monthLabel(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Parses "2026-10" / "2026-10-01" / a Date into the first day of that month. */
export function parseMonth(value: string | Date): Date {
  if (value instanceof Date) return monthStart(value);
  const m = /^(\d{4})-(\d{2})/.exec(value);
  if (!m) throw new Error(`Invalid month "${value}"`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
}

/** Rupee rounding (whole rupees, as on payslips). */
export const rupees = (n: number): number => Math.round(n);
