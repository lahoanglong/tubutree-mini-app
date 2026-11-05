import type { AdminFlashSale } from './admin-client';

export type FlashSaleState = 'live' | 'scheduled' | 'ended' | 'off';
export type FlashSaleFilter = 'open' | 'ended' | 'all';

export const FLASH_SALE_PAGE_SIZE = 20;

/**
 * Trạng thái theo thời gian, không chỉ theo cờ bật/tắt: đợt đã qua giờ kết thúc luôn là "đã kết thúc" dù cờ còn bật;
 * đợt chưa kết thúc mà bị tắt là "đang tắt".
 */
export function flashSaleState(sale: Pick<AdminFlashSale, 'startAt' | 'endAt' | 'isActive'>, now: number = Date.now()): FlashSaleState {
  if (new Date(sale.endAt).getTime() < now) return 'ended';
  if (!sale.isActive) return 'off';
  return new Date(sale.startAt).getTime() > now ? 'scheduled' : 'live';
}

export const FLASH_WINDOW_ORDER_MESSAGE = 'Giờ kết thúc phải sau giờ bắt đầu. Chọn lại một trong hai mốc để lưu.';

/**
 * Hai mốc giờ của ô nhập ("yyyy-mm-ddTHH:mm", giờ VN, cùng dạng nên so chuỗi là đủ): câu báo khi giờ kết thúc không sau giờ bắt đầu,
 * cùng luật với máy chủ. Chưa nhập đủ hai mốc thì chưa báo.
 */
export function flashWindowOrderError(startAt: string, endAt: string): string | null {
  return startAt && endAt && endAt <= startAt ? FLASH_WINDOW_ORDER_MESSAGE : null;
}
