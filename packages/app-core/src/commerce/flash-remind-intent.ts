import type { UpcomingFlashItem } from '../api/flash-sale';

/** Nhắc mà khách bấm khi chưa đăng nhập: đặt nốt sau khi đăng nhập xong, khách không phải bấm lần hai. */
export interface RemindIntent {
  itemId: string;
  startAt: string;
}

/**
 * Làm gì với ý định nhắc khi đã có phiên và đã tải danh sách "sắp diễn ra" của khách. Chỉ đặt khi món còn sắp diễn ra và CHƯA được nhắc:
 * nút Nhắc tôi là công tắc, nên bấm lại một món đã nhắc từ trước (khách từng nhắc trên máy khác) sẽ huỷ nhắc, ngược ý khách.
 */
export function remindIntentAction(intent: RemindIntent, upcoming: readonly Pick<UpcomingFlashItem, 'itemId' | 'reminded'>[]): 'remind' | 'drop' {
  const item = upcoming.find((u) => u.itemId === intent.itemId);
  return item && !item.reminded ? 'remind' : 'drop';
}
