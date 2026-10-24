'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/** Fetch `path` on mount (and when it changes); `reload()` refetches. Pass null to skip. */
export function useFetch<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!path) return;
    setLoading(true);
    setError(null);
    api<T>(path)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => {
    // Initial fetch on mount / path change; state updates land asynchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  return { data, loading, error, reload, setData };
}
