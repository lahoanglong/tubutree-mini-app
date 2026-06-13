'use client';

// Client-side API cho web shop (cart/checkout/auth/orders). Access token giữ in-memory,
// refresh token lưu localStorage. Tự refresh khi 401 rồi retry 1 lần.
const BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

const REFRESH_KEY = 'tubu_web_refresh';

let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(t: string | null): void {
  accessToken = t;
}
export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_KEY);
}
export function setRefreshToken(t: string | null): void {
  if (typeof window === 'undefined') return;
  if (t) window.localStorage.setItem(REFRESH_KEY, t);
  else window.localStorage.removeItem(REFRESH_KEY);
}

async function rawRefresh(): Promise<string | null> {
  const rt = getRefreshToken();
  if (!rt) return null;
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!res.ok) throw new Error('refresh failed');
    const data = (await res.json()) as { accessToken: string; refreshToken: string };
    accessToken = data.accessToken;
    setRefreshToken(data.refreshToken);
    return data.accessToken;
  } catch {
    accessToken = null;
    setRefreshToken(null);
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string | string[] };
    const m = Array.isArray(data.message) ? data.message[0] : data.message;
    return m ?? 'Có lỗi xảy ra. Vui lòng thử lại.';
  } catch {
    return 'Có lỗi xảy ra. Vui lòng thử lại.';
  }
}

export async function apiFetch<T>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean; headers?: Record<string, string> } = {},
  _retried = false,
): Promise<T> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false && accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && !_retried && getRefreshToken()) {
    refreshPromise ??= rawRefresh().finally(() => {
      refreshPromise = null;
    });
    const newToken = await refreshPromise;
    if (newToken) return apiFetch<T>(path, opts, true);
  }

  if (!res.ok) throw new ApiError(await parseError(res), res.status);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
