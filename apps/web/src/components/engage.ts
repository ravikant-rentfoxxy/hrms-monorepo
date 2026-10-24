/** Small helpers shared by the engagement / platform pages (timesheets, travel, integrations, billing). */
import { API_URL, getActingCompanyId, getSession } from '@/lib/api';

/** Authenticated file download (CSV exports need the Bearer token, so a plain link won't do). */
export async function downloadFile(path: string, fileName: string): Promise<void> {
  const session = getSession();
  const headers: Record<string, string> = { Authorization: `Bearer ${session?.accessToken}` };
  const acting = session?.role === 'SUPER_ADMIN' ? getActingCompanyId() : null;
  if (acting) headers['X-Company-Id'] = acting;
  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error ?? `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** "2026-10-19" for a local date. */
export const isoDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The date part of an API value ("2026-10-19T00:00:00.000Z" → "2026-10-19"). */
export const dayOf = (s: string): string => s.slice(0, 10);

/** Monday of the week containing `d` (local). */
export function mondayOf(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

/** "Mon 19" */
export const dayLabel = (d: Date): string => `${d.toLocaleDateString('en-IN', { weekday: 'short' })} ${d.getDate()}`;

export const errMsg = (err: unknown): string => (err instanceof Error ? err.message : 'Something went wrong');

/** Badge tone for timesheet / invoice / subscription statuses not covered by `statusTone`. */
export const extraTone = (s: string): 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'slate' =>
  (
    ({
      DRAFT: 'slate',
      SUBMITTED: 'amber',
      APPROVED: 'green',
      REJECTED: 'red',
      PENDING: 'amber',
      CANCELLED: 'slate',
      DUE: 'amber',
      PAID: 'green',
      VOID: 'slate',
      TRIAL: 'blue',
      ACTIVE: 'green',
      PAST_DUE: 'red',
    }) as Record<string, 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'slate'>
  )[s] ?? 'slate';
