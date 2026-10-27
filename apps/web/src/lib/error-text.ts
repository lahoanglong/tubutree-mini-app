import { ApiError, NetworkError } from '@/lib/client-api';

const RATE_LIMITED = 'Bạn thao tác hơi nhanh, đợi vài giây rồi thử lại nhé.';
const SERVER_BUSY = 'Máy chủ đang bận, thử lại nhé.';
const GENERIC = 'Có chút trục trặc, thử lại nhé';

/**
 * Chữ báo lỗi tải dữ liệu, cùng quy tắc với getErrorMessage của Mini App: lỗi nghiệp vụ 4xx hiện lời của máy chủ, 429 và 5xx và
 * mất kết nối có câu riêng, còn lại là câu chung. Màn lỗi hai bên nhờ vậy nói giống hệt khi cùng một sự cố.
 */
export function loadErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return RATE_LIMITED;
    if (error.status < 500 && error.message) return error.message;
    return SERVER_BUSY;
  }
  if (error instanceof NetworkError) return error.timedOut ? 'Hơi chậm tí, bạn đợi nhé' : error.message;
  return GENERIC;
}
