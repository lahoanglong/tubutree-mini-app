import { BadRequestException } from '@nestjs/common';

/** Mã lỗi ổn định: batch thêm giỏ bị từ chối vì một món; không có món nào được ghi. FE đọc `reason` và `variationId` để báo đúng món. */
export const CART_BATCH_REJECTED = 'CART_BATCH_REJECTED';
export type CartBatchReason = 'UNAVAILABLE' | 'STOCK';

const NOTHING_ADDED = 'Chưa có món nào được thêm vào giỏ.';

export function cartBatchRejected(i: { reason: CartBatchReason; variationId: string; productName: string | null; message: string }): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: CART_BATCH_REJECTED,
    reason: i.reason,
    variationId: i.variationId,
    productName: i.productName,
    message: `${i.message} ${NOTHING_ADDED}`,
  });
}

/** Câu cho món vượt tồn: hết hẳn thì nói hết hàng, còn thì nói còn bao nhiêu (ux-copy B `overStock`). */
export function batchStockMessage(productName: string, stock: number): string {
  return stock > 0 ? `${productName} chỉ còn ${stock} sản phẩm.` : `${productName} đã hết hàng.`;
}
