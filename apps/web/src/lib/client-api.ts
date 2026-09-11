'use client';

// Client-side API cho web shop (cart/checkout/auth/orders). Access token giữ in-memory.
//
// Refresh token KHÔNG nằm trong localStorage nữa: nó ở cookie `HttpOnly` do BE set (xem
// apps/api/src/modules/auth/refresh-cookie.ts). JS ở đây không đọc, không ghi và không gửi nó
// — trình duyệt tự đính kèm khi gọi /api/auth/*. Một lỗ XSS vì thế không lấy được token 30 ngày.
//
// Thứ JS giữ chỉ là một cờ `tubu_web_session` trong localStorage (không phải bí mật, chỉ là
// "có phiên đáng thử khôi phục không"). Cố tình KHÔNG dùng cookie cho cờ này: cookie do API set
// thuộc origin của API, nên nếu API ở api.tubutree.com còn web ở tubutree.com thì web không đọc
// được, và mọi lần mở trang đều tưởng chưa đăng nhập.
const BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

const SESSION_MARKER = 'tubu_web_session';

let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(t: string | null): void {
  accessToken = t;
}

/** Có cờ phiên không — KHÔNG phải bằng chứng phiên còn sống, chỉ để tránh gọi refresh vô ích. */
export function hasSessionMarker(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SESSION_MARKER) === '1';
  } catch {
    // Trình duyệt chặn storage (chế độ riêng tư) → coi như không có cờ. Tệ nhất là mất một lượt
    // khôi phục phiên tự động, không phải lỗi.
    return false;
  }
}

/** Đánh dấu vừa đăng nhập thành công — gọi ngay sau khi BE trả access token. */
export function setSessionMarker(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SESSION_MARKER, '1');
  } catch {
    /* không có storage thì chỉ mất khôi phục phiên tự động */
  }
}

/** Xoá cờ khi phiên chết (refresh 401) hoặc đăng xuất — chặn vòng lặp thử lại vô hạn. */
export function clearSessionMarker(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(SESSION_MARKER);
  } catch {
    /* không có storage thì không có gì để xoá */
  }
}

/** Header đánh dấu "tôi là web shop" — bật chế độ cookie ở BE, đồng thời là lớp chống CSRF. */
const WEB_CLIENT_HEADER = { 'x-client': 'web' } as const;

async function rawRefresh(): Promise<string | null> {
  if (!hasSessionMarker()) return null;
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...WEB_CLIENT_HEADER },
      body: '{}',
    });
    if (!res.ok) throw new Error('refresh failed');
    const data = (await res.json()) as { accessToken: string };
    accessToken = data.accessToken;
    setSessionMarker();
    return data.accessToken;
  } catch {
    accessToken = null;
    clearSessionMarker();
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
  // Chỉ gắn header tuỳ biến cho /auth/* — header lạ ép trình duyệt preflight, gắn cho MỌI
  // request là thêm một lượt OPTIONS cho từng lần gọi API.
  if (path.startsWith('/auth/')) Object.assign(headers, WEB_CLIENT_HEADER);

  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    // Cookie refresh giới hạn Path=/api/auth nên chỉ thực sự được gửi ở các route auth.
    credentials: 'include',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  // opts.auth === false đánh dấu endpoint không cần Authorization (login/refresh/logout) —
  // bỏ qua guard này thì một 401 từ chính /auth/refresh hay /auth/zalo-oauth (vd code đã
  // dùng, hết hạn) sẽ vô tình refresh + retry bằng phiên khác đang lưu trong cookie, âm thầm
  // đổi session hiện tại thay vì trả lỗi 401 gốc.
  if (res.status === 401 && !_retried && opts.auth !== false && hasSessionMarker()) {
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
