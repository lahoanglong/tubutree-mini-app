import type { Prisma } from '@prisma/client';

/** Tiền tố mã giả đời cũ của sản phẩm đối tác (migration p8_seller_merchant_fulfilment đã đổi về NULL). */
export const LEGACY_FAKE_PANCAKE_PREFIX = 'MCH_';

export interface PancakeLineShape {
  /** `Variation.pancakeId` của dòng. */
  pancakeId: string | null | undefined;
  /** `Product.fulfilment` của sản phẩm chứa dòng. Thiếu = đơn/sản phẩm cũ, coi như TUBU. */
  fulfilment?: string | null;
}

/** Mã thật của Pancake: chuỗi khác rỗng và không phải mã giả MCH_. */
export function isRealPancakeId(pancakeId: string | null | undefined): pancakeId is string {
  return typeof pancakeId === 'string' && pancakeId.trim() !== '' && !pancakeId.startsWith(LEGACY_FAKE_PANCAKE_PREFIX);
}

/**
 * Dòng hàng do kho Tubu giao qua Pancake? Nguồn quyết định DUY NHẤT: mọi chỗ gom dòng gửi Pancake và chỗ xếp dòng vào kiện
 * ở checkout đều gọi hàm này (docs/2026-10-14-merchant-fulfilment-design.md mục 2.1). Hàng đối tác tự giao và mọi mã giả
 * không bao giờ tới Pancake.
 */
export function isPancakeFulfilledLine(line: PancakeLineShape): boolean {
  return line.fulfilment !== 'MERCHANT' && isRealPancakeId(line.pancakeId);
}

/**
 * Điều kiện Prisma tương đương `isPancakeFulfilledLine` cho truy vấn Variation (kênh chỉ giao qua Pancake: đại lý, gói định
 * kỳ, CTV lên đơn hộ, bảng giá đại lý).
 */
export const PANCAKE_FULFILLED_VARIATION_WHERE = {
  pancakeId: { not: null },
  NOT: { pancakeId: { startsWith: LEGACY_FAKE_PANCAKE_PREFIX } },
  product: { fulfilment: 'TUBU' },
} as const satisfies Prisma.VariationWhereInput;

/**
 * Đơn do gian hàng đối tác tự giao (D4: `Order.fulfiller = MERCHANT`) không bao giờ có mặt trên Pancake: không đẩy, không
 * báo thanh toán, không huỷ bên Pancake. Mọi đường chiều Tubu → Pancake (job đẩy/thanh toán/huỷ, cron cứu hộ, "Đẩy lại
 * Pancake", bộ lọc "Chưa lên Pancake", móc huỷ D1) hỏi hàm này hoặc điều kiện Prisma đi kèm.
 */
export function isMerchantFulfilledOrder(order: { fulfiller?: string | null }): boolean {
  return order.fulfiller === 'MERCHANT';
}

export const TUBU_FULFILLED_ORDER_WHERE = { fulfiller: 'TUBU' } as const satisfies Prisma.OrderWhereInput;
