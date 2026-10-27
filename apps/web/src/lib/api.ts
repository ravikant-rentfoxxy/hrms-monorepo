/** Client for the dedicated admin API (separate from the Flutter app API). */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/admin/v1';

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'HR' | 'MANAGER' | 'EMPLOYEE' | 'FINANCE';

export interface Membership {
  companyId: string;
  role: Role;
  company: { id: string; name: string; code: string };
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string };
  role: Role;
  activeCompany: { id: string; name: string; code: string } | null;
  employee: { id: string; name: string } | null;
  memberships: Membership[];
}

const KEY = 'hrms.session';
const COMPANY_KEY = 'hrms.superadmin.companyId';

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null): void {
  if (typeof window === 'undefined') return;
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
}

/** Company a SUPER_ADMIN is currently acting in (sent as X-Company-Id). */
export function getActingCompanyId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(COMPANY_KEY);
}

export function setActingCompanyId(id: string | null): void {
  if (id) localStorage.setItem(COMPANY_KEY, id);
  else localStorage.removeItem(COMPANY_KEY);
}

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  form?: FormData;
  skipAuth?: boolean;
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const session = getSession();
  if (!session?.refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      const json = await res.json();
      if (!res.ok || !json?.data?.accessToken) return false;
      saveSession({ ...session, accessToken: json.data.accessToken, refreshToken: json.data.refreshToken });
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T = unknown>(path: string, opts: Options = {}, retried = false): Promise<T> {
  const session = getSession();
  const headers: Record<string, string> = {};
  if (!opts.skipAuth && session) headers.Authorization = `Bearer ${session.accessToken}`;
  if (session?.role === 'SUPER_ADMIN') {
    const acting = getActingCompanyId();
    if (acting) headers['X-Company-Id'] = acting;
  }
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(`${API_URL}${path}`, { method: opts.method ?? 'GET', headers, body });
  const json = await res.json().catch(() => ({}));

  if (res.status === 401 && !opts.skipAuth && !retried && (await tryRefresh())) {
    return api<T>(path, opts, true);
  }
  if (res.status === 401 && !opts.skipAuth) {
    saveSession(null);
    if (typeof window !== 'undefined') window.location.href = '/login';
  }
  if (!res.ok) {
    throw new ApiRequestError(res.status, json?.error ?? `Request failed (${res.status})`, json?.details);
  }
  return json.data as T;
}

export const fmtDate = (d: string | Date | null | undefined): string =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const fmtTime = (d: string | Date | null | undefined): string =>
  d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—';

export const fmtMoney = (n: number): string =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

export const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '')).toUpperCase();
};
