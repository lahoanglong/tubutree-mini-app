import { fillTileCopy } from './tile-copy';

/** Còn từng này trở xuống là tồn thấp: chỉ nhấn bằng màu cảnh báo (token warning), chữ không đổi. Một ngưỡng cho cả hai app. */
export const LOW_STOCK_NOTICE = 5;

/** 0 < stock <= LOW_STOCK_NOTICE. Hết hàng không phải tồn thấp: nó có chữ riêng ("Tạm hết hàng"). */
export function isLowStock(stock: number): boolean {
  return stock > 0 && stock <= LOW_STOCK_NOTICE;
}

/**
 * Chữ tồn kho của một phân loại, một nơi cho bảng chọn, trang chi tiết và giỏ của cả hai app: "Còn {n} sản phẩm" cho mọi n > 0 (không "Chỉ còn",
 * không "Còn 40" trần), hết hàng thì "Tạm hết hàng" như thẻ.
 */
export function stockText(stock: number): string {
  return stock > 0 ? fillTileCopy('stock.left', { n: stock }) : fillTileCopy('stock.out');
}
