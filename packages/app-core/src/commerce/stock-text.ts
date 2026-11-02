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

export interface CartStockNote {
  text: string;
  /** `warning`: sắp hết (`isLowStock`) hoặc đang vượt tồn (chặn thanh toán). `neutral`: chỉ báo vì sao nút + khoá, tồn còn nhiều nên không nhấn màu. */
  tone: 'warning' | 'neutral';
}

/**
 * Dòng tồn kho dưới tên sản phẩm ở giỏ, một luật cho cả hai app (web khổ điện thoại phải giống Mini). Chỉ hiện khi khách đã chạm trần tồn (`quantity === stock`, giải thích
 * vì sao nút + khoá) hoặc vượt tồn (`quantity > stock`, đang chặn thanh toán); chưa chạm trần thì không có dòng nên hàng giỏ không đổi cao lúc tải. Hết hàng (`stock <= 0`) trả `null`:
 * chỗ gọi đã có câu hết hàng riêng.
 */
export function cartStockNote(quantity: number, stock: number): CartStockNote | null {
  if (stock <= 0 || quantity < stock) return null;
  return { text: stockText(stock), tone: quantity > stock || isLowStock(stock) ? 'warning' : 'neutral' };
}
