/**
 * Minimal JSON client. The HRMS API wraps responses as
 * `{ success: true, data }` / `{ success: false, error }`.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Thrown when an integration has no endpoint configured — never faked as success. */
export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotConfiguredError';
  }
}

export async function postJson<T>(url: string, body: unknown, { timeoutMs = 15000 }: { timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new ApiError(
      err instanceof DOMException && err.name === 'AbortError'
        ? 'The server took too long to respond. Please try again.'
        : 'Could not reach the server. Check your connection and try again.',
      0
    );
  } finally {
    clearTimeout(timer);
  }
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string; message?: string } | null;
  if (!res.ok || json?.success === false) {
    throw new ApiError(json?.error || json?.message || `Request failed (${res.status})`, res.status);
  }
  return (json && 'data' in json ? json.data : json) as T;
}
