import { ApiError, GENERIC_ERROR, NetworkError } from '@/lib/client-api';

const RATE_LIMITED = 'Bạn thao tác hơi nhanh, đợi vài giây rồi thử lại nhé.';
const SERVER_BUSY = 'Máy chủ đang bận, thử lại nhé.';
const OFFLINE = 'Có vẻ mất mạng. Kiểm tra kết nối rồi thử lại nhé.';
const GENERIC = 'Có chút trục trặc, thử lại nhé';
export const SESSION_EXPIRED_TEXT = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
const LOAD_TIMEOUT = 'Tải chậm quá, thử lại nhé.';
const ACTION_TIMEOUT = 'Mạng chậm, chưa rõ đã xong chưa. Bạn kiểm tra lại rồi thử lại nhé.';

/** Lời kỹ thuật tiếng Anh của framework (Nest/class-validator/proxy) lọt ra từ 4xx: không phải lời nghiệp vụ, khách không đọc hiểu. */
const NO_VIETNAMESE = /^(?=[^]*[A-Za-z])[^\u0080-\uffff]*$/;
const TECHNICAL_MESSAGE = /^(?=[ -~]*$)(cannot \w+ \/|not found|bad request|unauthorized|forbidden|conflict|unprocessable|too many|request failed|throttler|validation failed|.*\b(must be|should not|should be|too large|not allowed|not acceptable|unexpected token)\b)/i;

/**
 * Chữ báo lỗi, cùng quy tắc với getErrorMessage của Mini App: lỗi nghiệp vụ 4xx hiện lời của máy chủ (lời tiếng Anh của framework thì dùng câu
 * chung), 401 báo hết phiên (trừ 401 mang lời nghiệp vụ như tài khoản bị khoá thì giữ lời đó), 429 của bộ giới hạn tốc độ và 5xx có câu riêng, 429 kèm mã nghiệp vụ (CHAT_DAILY_LIMIT, hết lượt tích điểm...)
 * giữ lời máy chủ, không có phản hồi thì tuỳ máy đang mất mạng thật hay máy chủ/CORS không đáp. Hết thời gian: tải dữ liệu nói tải chậm,
 * bấm nút (actionErrorText) nói chưa rõ kết quả vì máy chủ có thể đã làm xong.
 */
function errorText(error: unknown, timeout: string): string {
  if (error instanceof ApiError) {
    const message = error.message.trim();
    const businessText = message && message !== GENERIC_ERROR && !TECHNICAL_MESSAGE.test(message) && !NO_VIETNAMESE.test(message);
    if (error.status === 429) return error.code && businessText ? message : RATE_LIMITED;
    // Mã của máy chủ quyết định: SESSION_EXPIRED luôn là câu hết phiên của web; 401 khác mang lời tiếng Việt (tài khoản bị khoá) giữ lời đó.
    if (error.status === 401) return error.code !== 'SESSION_EXPIRED' && businessText ? message : SESSION_EXPIRED_TEXT;
    if (error.status < 500 && message) return businessText ? message : GENERIC;
    return SERVER_BUSY;
  }
  if (error instanceof NetworkError) {
    if (error.timedOut) return timeout;
    return typeof navigator !== 'undefined' && navigator.onLine === false ? OFFLINE : SERVER_BUSY;
  }
  // Lỗi do chính web ném (không qua máy chủ) kèm lời tiếng Việt tự viết thì giữ; lời tiếng Anh của trình duyệt/thư viện (Failed to fetch…) thì câu chung.
  if (error instanceof Error && /[^\x00-\x7F]/.test(error.message)) return error.message;
  return GENERIC;
}

export const loadErrorText = (error: unknown): string => errorText(error, LOAD_TIMEOUT);
export const actionErrorText = (error: unknown): string => errorText(error, ACTION_TIMEOUT);
