/**
 * Sign-in for the /login page, using the admin panel's own API client and
 * session storage (same app, same origin — the session is saved directly).
 */
import { api, saveSession, setActingCompanyId, type Session } from '@/lib/api';

export interface CompanyChoice {
  id: string;
  name: string;
  code: string;
  role: string;
}

interface SelectionResponse {
  companySelectionRequired: true;
  selectionToken: string;
  companies: CompanyChoice[];
}

export type SignInResult =
  | { kind: 'session' }
  | { kind: 'select-company'; selectionToken: string; companies: CompanyChoice[] };

function finish(data: Session | SelectionResponse): SignInResult {
  if ('companySelectionRequired' in data) {
    return { kind: 'select-company', selectionToken: data.selectionToken, companies: data.companies };
  }
  saveSession(data);
  setActingCompanyId(null);
  return { kind: 'session' };
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  return finish(await api<Session | SelectionResponse>('/auth/login', { method: 'POST', body: { email, password }, skipAuth: true }));
}

/** Users in several companies pick one after the password step. */
export async function selectCompany(selectionToken: string, companyId: string): Promise<SignInResult> {
  return finish(
    await api<Session | SelectionResponse>('/auth/login/company', { method: 'POST', body: { selectionToken, companyId }, skipAuth: true })
  );
}

/** Emails a 6-digit reset code. Resolves the same whether or not the email exists. */
export async function requestPasswordReset(email: string): Promise<void> {
  await api('/auth/forgot-password', { method: 'POST', body: { email }, skipAuth: true });
}

export async function resetPassword(email: string, otp: string, newPassword: string): Promise<void> {
  await api('/auth/reset-password', { method: 'POST', body: { email, otp, newPassword }, skipAuth: true });
}

/** Full load into the panel so the auth context re-hydrates from the saved session. */
export function continueToApp(): void {
  window.location.replace('/dashboard');
}
