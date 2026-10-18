import type { WasteMeDTO, WasteRequestSummaryDTO } from '@tubutree/shared-types';
import { ApiError, NetworkError } from './client-api';

/** `undefined` ẩn mục, `null` hiện dòng tạo yêu cầu, còn lại là yêu cầu PICKUP mở chưa gắn đơn để bật công tắc. */
export function attachablePickup(me: WasteMeDTO | undefined, pickupFlag: boolean): WasteRequestSummaryDTO | null | undefined {
  if (!pickupFlag || !me || me.blocked || me.shipLockedAt) return undefined;
  return me.openRequests.find((r) => r.method === 'PICKUP' && r.status === 'OPEN' && r.orderCode == null) ?? null;
}

/**
 * Lỗi mà máy chủ có thể đã làm xong việc trước khi trả lời: mất kết nối, quá thời gian, 5xx. Đặt đơn gặp lỗi này phải gửi
 * lại đúng Idempotency-Key cũ và không được tải lại dữ liệu làm thay đổi nội dung đơn; 4xx là máy chủ đã từ chối.
 */
export function isOutcomeUnknown(error: unknown): boolean {
  return error instanceof NetworkError || (error instanceof ApiError && error.status >= 500);
}
