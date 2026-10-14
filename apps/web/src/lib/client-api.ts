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

/** Xoá cờ khi phiên chết (refresh 400/401/403) hoặc đăng xuất — chặn vòng lặp thử lại vô hạn. */
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

/** Kết quả một lượt refresh: 'dead' = phiên chết thật (đã xoá cờ); 'transient' = lỗi tạm, cờ còn nguyên. */
export type RefreshOutcome =
  | { kind: 'ok'; data: { accessToken: string; user?: unknown } }
  | { kind: 'dead' }
  | { kind: 'transient' };

// Khoá Web Locks dùng chung mọi tab cùng origin: các tab mở cùng lúc (khôi phục trình duyệt, mở nhiều
// sản phẩm ở tab mới) refresh lần lượt, tab sau gửi cookie tab trước vừa xoay thay vì cùng một token.
const REFRESH_LOCK = 'tubu_web_refresh';

function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks || typeof locks.request !== 'function') return fn();
  return locks.request(REFRESH_LOCK, fn) as Promise<T>;
}

async function doRefresh(): Promise<RefreshOutcome> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...WEB_CLIENT_HEADER },
      body: '{}',
    });
  } catch {
    return { kind: 'transient' };
  }
  // 400 = không còn cookie (BE đã xoá), 401/403 = token chết/bị thu hồi/tài khoản bị khoá. Mất mạng, 5xx,
  // 429 thì cookie vẫn có thể còn sống: giữ cờ để lần sau còn khôi phục được.
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    accessToken = null;
    clearSessionMarker();
    return { kind: 'dead' };
  }
  if (!res.ok) return { kind: 'transient' };
  try {
    const data = (await res.json()) as { accessToken: string; user?: unknown };
    accessToken = data.accessToken;
    setSessionMarker();
    return { kind: 'ok', data };
  } catch {
    return { kind: 'transient' };
  }
}

let refreshInFlight: Promise<RefreshOutcome> | null = null;

/** Một lượt refresh bằng cookie, gộp các lời gọi trùng trong tab và xếp hàng giữa các tab. */
export function refreshSession(): Promise<RefreshOutcome> {
  if (!hasSessionMarker()) return Promise.resolve({ kind: 'dead' });
  refreshInFlight ??= withRefreshLock(doRefresh).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Khôi phục phiên lúc mở trang: lỗi tạm thời thì thử lại sau từng khoảng trong `retryDelays`. */
export async function restoreSession(
  retryDelays: readonly number[] = [1000, 3000],
  sleep: (ms: number) => Promise<void> = sleepMs,
): Promise<RefreshOutcome> {
  for (let attempt = 0; ; attempt++) {
    const out = await refreshSession();
    if (out.kind !== 'transient' || attempt >= retryDelays.length) return out;
    await sleep(retryDelays[attempt]!);
  }
}

async function rawRefresh(): Promise<string | null> {
  const out = await refreshSession();
  return out.kind === 'ok' ? out.data.accessToken : null;
}

export class ApiError extends Error {
  status: number;
  /** Mã lỗi nghiệp vụ ổn định trong body (vd TOTAL_CHANGED, ADDRESS_OUTDATED); null nếu API không gửi. */
  code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function parseError(res: Response): Promise<{ message: string; code: string | null }> {
  const fallback = 'Có lỗi xảy ra. Vui lòng thử lại.';
  try {
    const data = (await res.json()) as { message?: string | string[]; code?: unknown };
    const m = Array.isArray(data.message) ? data.message[0] : data.message;
    return { message: m ?? fallback, code: typeof data.code === 'string' ? data.code : null };
  } catch {
    return { message: fallback, code: null };
  }
}

export async function apiFetch<T>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean; headers?: Record<string, string> } = {},
  _retried = false,
): Promise<T> {
  const headers: Record<string, string> = { ...opts.headers };
  // Đánh dấu "tôi là web" cho BE phân biệt nguồn gọi (vd checkout.controller.ts dùng để gắn
  // đúng platform cho đơn đặt qua web thay vì mặc định nhầm thành 'miniapp'). KHÔNG phải
  // WEB_CLIENT_HEADER ở trên — đó là header CSRF/cookie-gating riêng cho /auth/*, header này là
  // header thường nên không tốn thêm preflight (Authorization ở dưới đã ép preflight rồi).
  headers['X-Client-Platform'] = 'web';
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
    const newToken = await rawRefresh();
    if (newToken) return apiFetch<T>(path, opts, true);
  }

  if (!res.ok) {
    const { message, code } = await parseError(res);
    throw new ApiError(message, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
