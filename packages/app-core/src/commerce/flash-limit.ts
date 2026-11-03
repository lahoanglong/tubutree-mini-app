import { fillCopy } from '../shop-copy';

/** Mã lỗi API khi đặt đơn vượt giới hạn mua mỗi khách của một suất Giờ vàng (kèm `limit`). Sửa được ngay ở giỏ: giảm số lượng. */
export const FLASH_LIMIT_CODE = 'FLASH_LIMIT';

/**
 * Hai câu lỗi cũ của máy chủ (`flash-sale-notice.ts`) mà Mini App đã phát hành còn so khớp đúng từng chữ để biết lỗi sửa được ở giỏ: không đổi chữ.
 * Máy chủ mới trả FLASH_LIMIT (có mã) thay cho câu vượt giới hạn; câu cũ vẫn gặp ở API cũ hoặc lúc hai bản chạy song song.
 */
export const FLASH_SOLD_OUT_MESSAGE = 'Hết suất ưu đãi.';
export const FLASH_OVER_LIMIT_MESSAGE = 'Vượt giới hạn mua ưu đãi.';

/** Lỗi đặt đơn mà khách chỉ sửa được bằng cách đổi/bỏ dòng ở giỏ hàng: thiếu tồn kho (câu có số nên so theo cụm) hoặc hai câu Giờ vàng cũ. */
export function isCartFixableError(message: string): boolean {
  return /không đủ tồn kho/.test(message) || message === FLASH_OVER_LIMIT_MESSAGE || message === FLASH_SOLD_OUT_MESSAGE;
}

interface ErrorBody {
  code?: unknown;
  limit?: unknown;
  message?: unknown;
}

/** Mini (axios) để thân phản hồi ở `response.data`; web (ApiError) để `code` và `message` thẳng trên lỗi. */
function bodyOf(err: unknown): ErrorBody | null {
  if (typeof err !== 'object' || err === null) return null;
  const direct = err as ErrorBody & { response?: { data?: ErrorBody } };
  const data = direct.response?.data;
  return {
    code: data?.code ?? direct.code,
    limit: data?.limit ?? direct.limit,
    message: data?.message ?? direct.message,
  };
}

/**
 * Câu báo khách khi lỗi là FLASH_LIMIT, ngược lại null. Có `limit` thì điền vào câu của kế hoạch; ApiError của web không mang `limit`
 * nên dùng `message` của máy chủ (đã là câu hoàn chỉnh); thiếu cả hai thì null thay vì bịa một con số.
 */
export function flashLimitNotice(err: unknown): string | null {
  const body = bodyOf(err);
  if (!body || body.code !== FLASH_LIMIT_CODE) return null;
  if (typeof body.limit === 'number' && Number.isFinite(body.limit)) return fillCopy('flash.overLimitError', { n: body.limit });
  return typeof body.message === 'string' && body.message !== '' ? body.message : null;
}
