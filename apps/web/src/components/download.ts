'use client';

import { API_URL, getActingCompanyId, getSession } from '@/lib/api';

/**
 * Authenticated file download (the API needs the Bearer token, so a plain
 * link cannot be used). Throws with the server's message on failure.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const session = getSession();
  const headers: Record<string, string> = { Authorization: `Bearer ${session?.accessToken ?? ''}` };
  const acting = session?.role === 'SUPER_ADMIN' ? getActingCompanyId() : null;
  if (acting) headers['X-Company-Id'] = acting;
  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? `Download failed (${res.status})`);
  }
  const name = /filename="?([^"]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
