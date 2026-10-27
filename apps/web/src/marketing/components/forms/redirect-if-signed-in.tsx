'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

/** Already signed in? Skip the login page and go to the dashboard. */
export function RedirectIfSignedIn() {
  const { session, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && session) router.replace('/dashboard');
  }, [loading, session, router]);
  return null;
}
