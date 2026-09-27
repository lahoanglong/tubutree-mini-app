/**
 * Heuristic map message lỗi tiếng Việt (throw ở checkout.service.ts quote/placeOrder) sang
 * error_code chuẩn hoá cho sự kiện `order_place_failed` — không chính xác 100% cho message mới
 * chưa liệt kê, mặc định rơi về VALIDATION.
 */
export type OrderErrorCode = 'OUT_OF_STOCK' | 'PRICE_CHANGED' | 'ADDRESS_INVALID' | 'BALANCE' | 'VALIDATION';

export function classifyOrderError(message: string): OrderErrorCode {
  if (message.includes('tồn kho')) return 'OUT_OF_STOCK';
  if (message === 'PRICE_CHANGED' || message.includes('giá')) return 'PRICE_CHANGED';
  if (message.includes('Địa chỉ giao hàng')) return 'ADDRESS_INVALID';
  if (message.includes('Số dư') || message.includes('điểm Xanh') || message.includes('COD')) {
    return 'BALANCE';
  }
  return 'VALIDATION';
}
