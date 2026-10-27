import type { Prisma } from '@prisma/client';
import { SELLABLE_VARIATION_WHERE } from '../cart/sellable';

/**
 * Giá niêm yết có thể bị hạ sau khi tạo đợt (đồng bộ Pancake, sửa tay) làm giá flash không còn rẻ hơn. Giỏ hàng vẫn tính
 * min(flash, giá đang bán) nên khách không trả cao hơn, nhưng quảng bá món đó là "giờ vàng" kèm % âm là sai (BUYERMINI-12).
 */
export function isStillDiscounted(it: { flashPrice: number; variation: { salePrice: number | null; retailPrice: number } }): boolean {
  return it.flashPrice < (it.variation.salePrice ?? it.variation.retailPrice);
}

/** Thứ tự cố định của suất đang chạy: sản phẩm nhiều suất không đổi thứ tự theo DB giữa hai lần gọi. */
export const ACTIVE_FLASH_ORDER_BY = [{ flashPrice: 'asc' }, { variationId: 'asc' }, { id: 'asc' }] satisfies Prisma.FlashSaleItemOrderByWithRelationInput[];

export const activeFlashWhere = (now: Date) =>
  ({
    variation: SELLABLE_VARIATION_WHERE,
    flashSale: { isActive: true, startAt: { lte: now }, endAt: { gt: now } },
  }) satisfies Prisma.FlashSaleItemWhereInput;
