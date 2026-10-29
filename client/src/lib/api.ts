type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (token) localStorage.setItem('rf_token', token);
  else localStorage.removeItem('rf_token');
}

export function getStoredToken(): string | null {
  if (accessToken) return accessToken;
  const t = localStorage.getItem('rf_token');
  accessToken = t;
  return t;
}

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    if (!res.ok) return false;
    const data = (await res.json()) as { accessToken: string };
    setAccessToken(data.accessToken);
    return true;
  } catch {
    return false;
  }
}

async function request<T>(path: string, opts: { method?: Method; body?: unknown; retry?: boolean; extraHeaders?: Record<string, string> } = {}): Promise<T> {
  const method = opts.method || 'GET';
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const headers: Record<string, string> = {};
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  Object.assign(headers, opts.extraHeaders);
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  // Guard against hung requests leaving the UI in an eternal loading state.
  // Uploads are exempt — large files on slow links may legitimately take longer.
  const timeout = !isForm && typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
    ? AbortSignal.timeout(30_000)
    : undefined;

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'include',
      signal: timeout,
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error('Request timed out — the server took too long to respond. Please try again.', { cause: err });
    }
    throw err;
  }

  if (res.status === 401 && opts.retry !== false) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, { ...opts, retry: false });
    setAccessToken(null);
    onUnauthorized?.();
    throw new Error('Session expired — please sign in again.');
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function requestBlob(path: string, retry = true): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { headers, credentials: 'include' });

  if (res.status === 401 && retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return requestBlob(path, false);
    setAccessToken(null);
    onUnauthorized?.();
    throw new Error('Session expired — please sign in again.');
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  return res.blob();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  postWithHeaders: <T>(path: string, body: unknown, extraHeaders: Record<string, string>) =>
    request<T>(path, { method: 'POST', body, extraHeaders }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  getBlob: (path: string) => requestBlob(path),
};
