'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, getSession, saveSession, setActingCompanyId, type Role, type Session } from './api';

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  login: (email: string, password: string, companyId?: string) => Promise<void>;
  logout: () => Promise<void>;
  switchCompany: (companyId: string) => Promise<void>;
  /** True when the active role is one of the given roles. */
  hasRole: (...roles: Role[]) => boolean;
  /** Employer-side: can manage people/approvals. */
  isManagerial: boolean;
  /** Can administer company settings (offices, payroll, announcements...). */
  isCompanyAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Hydrate the session from localStorage after mount (it is not available
  // during SSR, so this cannot be a useState initializer).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(getSession());
    setLoading(false);
  }, []);

  const login = useCallback(
    async (email: string, password: string, companyId?: string) => {
      const data = await api<Session & { twoFactorRequired?: boolean }>('/auth/login', {
        method: 'POST',
        body: { email, password, ...(companyId ? { companyId } : {}) },
        skipAuth: true,
      });
      // 2FA accounts get a challenge instead of tokens; the login page handles that step itself.
      if (data.twoFactorRequired) throw new Error('Two-factor code required — sign in from the login page');
      saveSession(data);
      setActingCompanyId(null);
      setSession(data);
      router.replace('/');
    },
    [router]
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // local logout regardless
    }
    saveSession(null);
    setActingCompanyId(null);
    setSession(null);
    router.replace('/login');
  }, [router]);

  const switchCompany = useCallback(async (companyId: string) => {
    const current = getSession();
    if (!current) return;
    const data = await api<{ accessToken: string; refreshToken: string; role: Role; activeCompany: Session['activeCompany'] }>(
      '/auth/switch-company',
      { method: 'POST', body: { companyId } }
    );
    const next: Session = { ...current, ...data };
    saveSession(next);
    setSession(next);
    window.location.reload();
  }, []);

  const hasRole = useCallback((...roles: Role[]) => !!session && roles.includes(session.role), [session]);

  const value: AuthContextValue = {
    session,
    loading,
    login,
    logout,
    switchCompany,
    hasRole,
    isManagerial: !!session && ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'].includes(session.role),
    isCompanyAdmin: !!session && ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(session.role),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
