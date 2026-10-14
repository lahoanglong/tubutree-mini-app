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
  let reply: Reply;
  try {
    reply = await exchange(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...WEB_CLIENT_HEADER },
      body: '{}',
    });
  } catch {
    // Mất mạng/quá hạn (NetworkError) hoặc thân 2xx hỏng: không nói lên gì về phiên, giữ cờ.
    return { kind: 'transient' };
  }
  // 400 = không còn cookie (BE đã xoá), 401/403 = token chết/bị thu hồi/tài khoản bị khoá. Mất mạng, 5xx,
  // 429 thì cookie vẫn có thể còn sống: giữ cờ để lần sau còn khôi phục được.
  if (reply.status === 400 || reply.status === 401 || reply.status === 403) {
    accessToken = null;
    clearSessionMarker();
    return { kind: 'dead' };
  }
  const data = reply.body as { accessToken?: string; user?: unknown } | undefined;
  if (!reply.ok || typeof data?.accessToken !== 'string') return { kind: 'transient' };
  accessToken = data.accessToken;
  setSessionMarker();
  return { kind: 'ok', data: { accessToken: data.accessToken, user: data.user } };
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

/** Không nhận được phản hồi nào (mất mạng, DNS, hết thời gian chờ). Cố ý KHÔNG kế thừa ApiError: không có status HTTP. */
export class NetworkError extends Error {
  readonly timedOut: boolean;
  constructor(timedOut: boolean) {
    super(timedOut ? TIMEOUT_MESSAGE : OFFLINE_MESSAGE);
    this.name = 'NetworkError';
    this.timedOut = timedOut;
  }
}

/** Quá hạn thì thôi chờ: mạng yếu/máy chủ treo không được giữ nút "Đang đặt hàng…" mãi. */
export const REQUEST_TIMEOUT_MS = 20_000;
const OFFLINE_MESSAGE = 'Mất kết nối. Vui lòng kiểm tra mạng rồi thử lại.';
const TIMEOUT_MESSAGE = 'Máy chủ phản hồi quá lâu. Vui lòng thử lại.';
const GENERIC_ERROR = 'Có lỗi xảy ra. Vui lòng thử lại.';

interface Reply {
  status: number;
  ok: boolean;
  body: unknown;
}

/**
 * Một lượt gọi + đọc thân phản hồi, giới hạn REQUEST_TIMEOUT_MS cho cả hai. Lỗi tầng mạng (fetch ném TypeError,
 * hoặc bị ngắt vì quá hạn) đổi thành NetworkError với câu tiếng Việt thay vì "Failed to fetch" thô.
 */
async function exchange(url: string, init: RequestInit): Promise<Reply> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    let body: unknown;
    if (res.status !== 204) {
      try {
        body = await res.json();
      } catch (e) {
        // Thân hỏng/không phải JSON: phản hồi lỗi vẫn có status để báo; phản hồi thành công thì ném như trước.
        if (res.ok || ctrl.signal.aborted) throw e;
      }
    }
    return { status: res.status, ok: res.ok, body };
  } catch (e) {
    if (ctrl.signal.aborted) throw new NetworkError(true);
    if (e instanceof TypeError) throw new NetworkError(false);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function parseError(body: unknown): { message: string; code: string | null } {
  const data = (body ?? {}) as { message?: string | string[]; code?: unknown };
  const m = Array.isArray(data.message) ? data.message[0] : data.message;
  return { message: m ?? GENERIC_ERROR, code: typeof data.code === 'string' ? data.code : null };
}

export async function apiFetch<T>(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    auth?: boolean;
    headers?: Record<string, string>;
    cache?: RequestCache;
  } = {},
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

  const reply = await exchange(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    // Cookie refresh giới hạn Path=/api/auth nên chỉ thực sự được gửi ở các route auth.
    credentials: 'include',
    ...(opts.cache ? { cache: opts.cache } : {}),
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  // opts.auth === false đánh dấu endpoint không cần Authorization (login/refresh/logout) —
  // bỏ qua guard này thì một 401 từ chính /auth/refresh hay /auth/zalo-oauth (vd code đã
  // dùng, hết hạn) sẽ vô tình refresh + retry bằng phiên khác đang lưu trong cookie, âm thầm
  // đổi session hiện tại thay vì trả lỗi 401 gốc.
  if (reply.status === 401 && !_retried && opts.auth !== false && hasSessionMarker()) {
    const newToken = await rawRefresh();
    if (newToken) return apiFetch<T>(path, opts, true);
  }

  if (!reply.ok) {
    const { message, code } = parseError(reply.body);
    throw new ApiError(message, reply.status, code);
  }
  if (reply.status === 204) return undefined as T;
  return reply.body as T;
}

/** Xuất toàn bộ dữ liệu có thể lâu hơn hạn chờ thường của apiFetch (API ghi dần từng lô). */
export const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

/**
 * Tải một tệp do API sinh (CSV xuất dữ liệu) bằng phiên hiện tại rồi mở hộp lưu tệp của trình duyệt. Thẻ <a href> trần
 * không gửi được Authorization nên phải tải qua fetch; 401 thì làm mới phiên và thử lại một lần như apiFetch.
 */
export async function apiDownload(path: string, fallbackName: string, _retried = false): Promise<{ filename: string; bytes: number }> {
  const headers: Record<string, string> = { 'X-Client-Platform': 'web' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  let res: Response;
  let blob: Blob;
  try {
    res = await fetch(`${BASE}${path}`, { headers, credentials: 'include', signal: ctrl.signal });
    if (res.status === 401 && !_retried && hasSessionMarker() && (await rawRefresh())) {
      return apiDownload(path, fallbackName, true);
    }
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => undefined);
      const { message, code } = parseError(body);
      throw new ApiError(message, res.status, code);
    }
    blob = await res.blob();
  } catch (e) {
    if (ctrl.signal.aborted) throw new NetworkError(true);
    if (e instanceof TypeError) throw new NetworkError(false);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { filename, bytes: blob.size };
}
