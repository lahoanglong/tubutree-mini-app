import { fillCopy } from '../shop-copy';

/** Mã lỗi API khi đặt đơn vượt giới hạn mua mỗi khách của một suất Giờ vàng (kèm `limit`). Sửa được ngay ở giỏ: giảm số lượng. */
export const FLASH_LIMIT_CODE = 'FLASH_LIMIT';

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
