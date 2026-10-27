import { ApiError, NetworkError } from '@/lib/client-api';

const RATE_LIMITED = 'Bạn thao tác hơi nhanh, đợi vài giây rồi thử lại nhé.';
const SERVER_BUSY = 'Máy chủ đang bận, thử lại nhé.';
const OFFLINE = 'Có vẻ mất mạng. Kiểm tra kết nối rồi thử lại nhé.';
const GENERIC = 'Có chút trục trặc, thử lại nhé';

/** Lời kỹ thuật tiếng Anh của framework (Nest/class-validator/proxy) lọt ra từ 4xx: không phải lời nghiệp vụ, khách không đọc hiểu. */
const TECHNICAL_MESSAGE = /^(?=[\x00-\x7F]*$)(cannot (get|post|put|patch|delete)\b|not found|bad request|unauthorized|forbidden|conflict|unprocessable|too many|request failed|throttler|validation failed|.*\b(must be|should not|should be)\b)/i;

/**
 * Chữ báo lỗi tải dữ liệu, cùng quy tắc với getErrorMessage của Mini App: lỗi nghiệp vụ 4xx hiện lời của máy chủ (trừ lời kỹ thuật tiếng
 * Anh thì dùng câu chung), 429 và 5xx và 4xx không có lời có câu riêng, không có phản hồi thì tuỳ máy đang mất mạng thật hay máy chủ/CORS
 * không đáp. Màn lỗi hai bên nhờ vậy nói giống hệt khi cùng một sự cố.
 */
export function loadErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return RATE_LIMITED;
    if (error.status < 500 && error.message) return TECHNICAL_MESSAGE.test(error.message.trim()) ? GENERIC : error.message;
    return SERVER_BUSY;
  }
  if (error instanceof NetworkError) {
    if (error.timedOut) return 'Hơi chậm tí, bạn đợi nhé';
    return typeof navigator !== 'undefined' && navigator.onLine === false ? OFFLINE : SERVER_BUSY;
  }
  return GENERIC;
}
