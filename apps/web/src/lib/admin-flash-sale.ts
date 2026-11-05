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
