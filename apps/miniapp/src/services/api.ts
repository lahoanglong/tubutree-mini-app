import type { LoginResponse } from '@tubutree/shared-types';
import { vi } from '../i18n/vi';
import type { FirstTouch } from './first-touch';
import { createTransport, HttpError, isHttpError, type HttpResponse, type RequestConfig } from './http';

export { HttpError, isHttpError };
export type { HttpResponse, RequestConfig };

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api';
const TIMEOUT_MS = 15_000;

const send = createTransport(BASE_URL, TIMEOUT_MS);

/**
 * Ảnh do chính API phục vụ (vd ảnh đánh giá base64 → "/reviews/:id/images/0?v=…") được trả dạng đường dẫn tương đối API
 * để JSON nhẹ; ghép với gốc API cho thẻ img. URL tuyệt đối (Cloudinary), data URL và đường dẫn "//host" giữ nguyên.
 */
export function apiMediaUrl(src: string): string {
  return src.startsWith('/') && !src.startsWith('//') ? `${BASE_URL.replace(/\/+$/, '')}${src}` : src;
}

let accessToken: string | null = null;
let onUnauthorized: (() => Promise<string | null>) | null = null;
/**
 * Phiên đang được khôi phục lúc mở app. Mọi request (trừ chính /auth/*) chờ nó xong rồi mới
 * gửi, để KHÔNG bay đi khi chưa có access token.
 *
 * Vì sao cần: mở app từ push/deeplink thì trang đích fetch ngay, trong khi restore() còn đang
 * chạy → request đi không kèm Authorization → 401. React Query đặt `retry: false` cho 4xx nên
 * màn hình kẹt ở trạng thái lỗi vĩnh viễn dù ~200ms sau phiên đã sẵn sàng. Trước đây từng màn
 * phải tự vá bằng `enabled: status === 'authenticated'`, và hơn 40 query vẫn chưa có.
 */
let authReady: Promise<unknown> | null = null;
/**
 * Trần chờ, để phiên treo không giữ mọi request tới lúc timeout 15s.
 *
 * Hết trần mà authReady vẫn chưa xong thì request bên dưới VẪN được gửi đi — nhưng KHÔNG kèm
 * Authorization (accessToken lúc đó còn null) → 401 chắc chắn. Fix triệt để (đánh dấu các request
 * này rồi gọi queryClient.invalidateQueries() sau khi restore() xong) cần truy cập queryClient,
 * nhưng nó được khởi tạo cục bộ (không export) ở components/app.tsx — ngoài phạm vi sửa của file
 * này. Nới trần lên 15s là giảm thiểu TẠM THỜI (khớp timeout tổng của request ở trên): giảm mạnh xác
 * suất rơi vào trường hợp này (restore() thực tế thường xong trong <1-2s), KHÔNG loại bỏ hẳn.
 */
const AUTH_READY_TIMEOUT_MS = 15_000;
/** Refresh đang chạy — các 401 song song chờ chung 1 promise, tránh refresh bão. */
let refreshInFlight: Promise<string | null> | null = null;

/**
 * 429: GET được thử lại đúng một lần nếu Retry-After ngắn (hoặc vắng — vd 429 từ proxy phía
 * trước). Throttler của API khoá trọn ttl 60s nên 429 từ chính API thường vượt trần và báo lỗi
 * ngay: không giữ màn hình quay cả phút. Không rút ngắn blockDuration phía server được, vì hết
 * khoá là bộ đếm về 0 và giới hạn/phút sẽ thành giới hạn/vài giây. Không bao giờ thử lại
 * POST/PUT/PATCH/DELETE: request đầu có thể đã được xử lý xong ở server.
 */
const RATE_LIMIT_DEFAULT_WAIT_MS = 1_500;
const RATE_LIMIT_MAX_WAIT_MS = 5_000;
const RATE_LIMIT_RETRY_METHODS = new Set(['GET', 'HEAD']);
export const RATE_LIMITED_MESSAGE = 'Bạn thao tác hơi nhanh, đợi vài giây rồi thử lại nhé.';

/** Retry-After dạng số giây hoặc HTTP-date; không đọc được thì null. */
function retryAfterMs(headers: Record<string, string> | undefined): number | null {
  const raw = headers?.['retry-after'];
  if (raw == null || raw === '') return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Auth store gọi khi bắt đầu khôi phục/đăng nhập phiên; truyền null khi đã xong. */
export function setAuthReady(promise: Promise<unknown> | null): void {
  authReady = promise;
}

/** Đăng ký callback refresh khi gặp 401 (set bởi auth store). */
export function setUnauthorizedHandler(handler: (() => Promise<string | null>) | null): void {
  onUnauthorized = handler;
}

interface PendingRequest {
  method: string;
  url: string;
  params?: Record<string, unknown>;
  data?: unknown;
  headers: Headers;
  timeout?: number;
  retried?: boolean;
  retried429?: boolean;
}

// store/auth import api.ts nên chỉ nạp được lúc chạy; dùng chung một lần nạp cho các request đồng thời.
const loadAuthModule = () => import('../store/auth');
let authModulePromise: ReturnType<typeof loadAuthModule> | null = null;
const authModule = () => (authModulePromise ??= loadAuthModule());

/** Gắn phiên vào request ngay trước khi gửi (chạy lại ở mỗi lần gửi lại). */
async function prepare(req: PendingRequest): Promise<void> {
  // Chính các lệnh /auth/* KHÔNG được chờ authReady — chúng là thứ tạo ra nó (deadlock).
  if (authReady && !req.url.includes('/auth/')) {
    const pending = authReady;
    await Promise.race([
      pending.catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, AUTH_READY_TIMEOUT_MS)),
    ]);
  }
  // Đọc token SAU khi chờ — đây mới là lúc nó đã có.
  if (accessToken) {
    req.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  const { getDeviceId } = await authModule();
  const deviceId = await getDeviceId().catch(() => undefined);
  if (deviceId) req.headers.set('X-Device-Id', deviceId);
  req.headers.set('X-Client-Platform', 'miniapp');
}

async function execute<T>(req: PendingRequest): Promise<HttpResponse<T>> {
  await prepare(req);
  try {
    return await send<T>(req);
  } catch (error) {
    if (!isHttpError(error)) throw error;
    const status = error.response?.status;
    if (status === 429 && !req.retried429 && RATE_LIMIT_RETRY_METHODS.has(req.method)) {
      const wait = retryAfterMs(error.response?.headers) ?? RATE_LIMIT_DEFAULT_WAIT_MS;
      if (wait <= RATE_LIMIT_MAX_WAIT_MS) {
        req.retried429 = true;
        await new Promise((resolve) => setTimeout(resolve, wait));
        return execute<T>(req);
      }
    }
    // KHÔNG refresh cho chính endpoint /auth/* — nếu /auth/refresh trả 401, gọi lại
    // refresh sẽ await chính promise đang chờ nó → deadlock tới khi timeout 15s.
    const isAuthCall = req.url.includes('/auth/');
    if (status === 401 && !req.retried && onUnauthorized && !isAuthCall) {
      req.retried = true;
      refreshInFlight ??= onUnauthorized().finally(() => {
        refreshInFlight = null;
      });
      const newToken = await refreshInFlight;
      if (newToken) {
        req.headers.set('Authorization', `Bearer ${newToken}`);
        return execute<T>(req);
      }
    }
    throw error;
  }
}

function request<T, R>(method: string, url: string, data: unknown, config: RequestConfig | undefined): Promise<R> {
  const headers = new Headers({ Accept: 'application/json, text/plain, */*' });
  for (const [name, value] of Object.entries(config?.headers ?? {})) headers.set(name, value);
  return execute<T>({ method, url, data, headers, params: config?.params, timeout: config?.timeout }) as Promise<R>;
}

/**
 * Client dùng chung (dáng giống axios để mọi service giữ nguyên chữ ký gọi). Access token giữ trong
 * memory (an toàn hơn storage), refresh token lưu qua ZMP storage (xem store/auth.ts).
 */
export const api = {
  get: <T = unknown, R = HttpResponse<T>>(url: string, config?: RequestConfig) => request<T, R>('GET', url, undefined, config),
  delete: <T = unknown, R = HttpResponse<T>>(url: string, config?: RequestConfig) => request<T, R>('DELETE', url, undefined, config),
  post: <T = unknown, R = HttpResponse<T>>(url: string, data?: unknown, config?: RequestConfig) => request<T, R>('POST', url, data, config),
  put: <T = unknown, R = HttpResponse<T>>(url: string, data?: unknown, config?: RequestConfig) => request<T, R>('PUT', url, data, config),
  patch: <T = unknown, R = HttpResponse<T>>(url: string, data?: unknown, config?: RequestConfig) => request<T, R>('PATCH', url, data, config),
};

/**
 * Chuẩn hóa mọi lỗi API thành message Việt thân thiện (Voice & Tone §7.5).
 * Ưu tiên message backend (NestJS trả tiếng Việt sẵn, vd "Giỏ hàng trống."),
 * fallback theo loại lỗi. Component KHÔNG tự diễn dịch HttpError.
 */
export function getErrorMessage(error: unknown): string {
  if (isHttpError(error)) {
    // Message của throttler là tiếng Anh kỹ thuật ("ThrottlerException: ...") — không hiển thị.
    if (error.response?.status === 429) return RATE_LIMITED_MESSAGE;
    const data = error.response?.data as { message?: string | string[] } | undefined;
    const backendMsg = Array.isArray(data?.message) ? data.message[0] : data?.message;
    // Message backend 4xx là nghiệp vụ (viết sẵn tiếng Việt) — hiển thị thẳng.
    if (backendMsg && error.response && error.response.status < 500) return backendMsg;
    if (error.code === 'ECONNABORTED') return vi.errors.timeout;
    // Không có response: phân biệt MẤT MẠNG thật (navigator.onLine=false) với server/CORS không
    // phản hồi (vẫn có mạng) — tránh báo "mất mạng" sai khi thực chất là lỗi máy chủ.
    if (!error.response) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      return offline ? vi.errors.offline : vi.errors.server;
    }
    return vi.errors.server;
  }
  return vi.errors.generic;
}

/** Máy chủ trả 404: trang đang xem không còn (sản phẩm/đơn không có), thử lại cũng không ra khác. */
export function isNotFoundError(error: unknown): boolean {
  return isHttpError(error) && error.response?.status === 404;
}

/**
 * Lỗi mà máy chủ có thể đã làm xong việc trước khi trả lời: quá thời gian, mất kết nối giữa chừng, 5xx (kể cả proxy phía trước).
 * Lệnh tạo đơn/tiền gặp lỗi này phải gửi lại đúng Idempotency-Key cũ; 4xx là máy chủ đã từ chối, không có gì được ghi.
 */
export function isOutcomeUnknown(error: unknown): boolean {
  if (!isHttpError(error)) return false;
  const status = error.response?.status;
  return status === undefined || status >= 500;
}

/** Mã lỗi nghiệp vụ ổn định của API (`code` trong body 4xx, vd TOTAL_CHANGED, ADDRESS_OUTDATED). */
export function getErrorCode(error: unknown): string | null {
  if (!isHttpError(error)) return null;
  const code = (error.response?.data as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : null;
}

// ── Auth endpoints ────────────────────────────────────
export async function loginZaloMiniApp(
  code: string,
  zaloAccessToken: string,
  phoneToken?: string,
  referralCode?: string,
  firstTouch?: FirstTouch,
): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/zalo-mini-app', {
    code,
    accessToken: zaloAccessToken,
    phoneToken,
    referralCode,
    firstTouch,
  });
  return data;
}

export async function loginGuest(deviceId: string, referralCode?: string, firstTouch?: FirstTouch): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/guest', { deviceId, referralCode, firstTouch });
  return data;
}

export async function refreshTokens(refreshToken: string): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/refresh', { refreshToken });
  return data;
}

/**
 * POST /auth/ensure-phone (A7-01, audit 2026-09) — khác loginZaloMiniApp(): gửi kèm access
 * token CỦA PHIÊN HIỆN TẠI (interceptor tự đính Authorization) nên BE biết chính xác đang là ai
 * và không bao giờ âm thầm trả token của một user khác. Dùng cho cả checkout ensurePhone() (kèm
 * phoneToken) lẫn nâng cấp ngầm phiên khách ở store/auth.ts restore() (không kèm phoneToken).
 */
export async function ensurePhoneApi(
  code: string,
  zaloAccessToken: string,
  phoneToken?: string,
): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/ensure-phone', {
    code,
    accessToken: zaloAccessToken,
    phoneToken,
  });
  return data;
}
