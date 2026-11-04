/**
 * Chữ giỏ hàng và thanh toán dùng chung cho Mini App và web: dòng hết hàng, lời chặn nút Thanh toán, giỏ trống, điểm Xanh bị giữ.
 * Giọng chữ: không "Vui lòng", không "chúng tôi".
 */
import { formatVnNumber } from './number-format';

export const CART_OUT_OF_STOCK = 'Sản phẩm đã hết hàng';

export const CART_OVER_STOCK_BLOCKED = 'Giảm số lượng sản phẩm vượt tồn kho để thanh toán.';

export function cartOutOfStockBlocked(names: string[]): string {
  return `${names.map((n) => `"${n}"`).join(', ')} đã hết hàng. Bỏ chọn hoặc xoá ${names.length > 1 ? 'các sản phẩm' : 'sản phẩm'} này để thanh toán.`;
}

export const CART_EMPTY = {
  heading: 'Giỏ còn trống đấy',
  body: 'Khám phá sản phẩm Tubu chọn riêng cho bạn',
  cta: 'Khám phá ngay',
} as const;

/** "1.250 điểm từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được" — phần điểm Xanh bị giữ ở ô thanh toán. */
export function heldPointsNote(held: number): string {
  return `${formatVnNumber(held)} điểm từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được`;
}
