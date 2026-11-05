import { fillTileCopy } from './tile-copy';

/** Còn từng này trở xuống là tồn thấp: chữ "Chỉ còn {n} sản phẩm" và màu cảnh báo (token warning). Một ngưỡng cho cả hai app. */
export const LOW_STOCK_NOTICE = 20;

/** Từ mức này trở lên là tồn ảo (Pancake báo 99.999.988 cho hàng không quản kho): không bao giờ hiện con số, chỉ hiện chữ sẵn sàng giao. */
export const PLENTY_STOCK = 100_000;

/** 0 < stock <= LOW_STOCK_NOTICE. Hết hàng không phải tồn thấp: nó có chữ riêng ("Tạm hết hàng"). */
export function isLowStock(stock: number): boolean {
  return stock > 0 && stock <= LOW_STOCK_NOTICE;
}

/**
 * Chữ tồn kho của một phân loại, một nơi cho bảng chọn, trang chi tiết và giỏ của cả hai app:
 * hết hàng "Tạm hết hàng" (như thẻ); 1–20 "Chỉ còn n sản phẩm"; 21–99.999 "Còn hàng"; từ 100.000 "Còn hàng — Sẵn sàng giao ngay" (không lộ con số ảo).
 */
export function stockText(stock: number): string {
  if (!(stock > 0)) return fillTileCopy('stock.out');
  if (stock >= PLENTY_STOCK) return fillTileCopy('stock.plenty');
  if (stock <= LOW_STOCK_NOTICE) return fillTileCopy('stock.few', { n: stock });
  return fillTileCopy('stock.in');
}

export interface CartStockNote {
  text: string;
  /** `warning`: sắp hết (`isLowStock`) hoặc đang vượt tồn (chặn thanh toán). `neutral`: chỉ báo vì sao nút + khoá, tồn còn nhiều nên không nhấn màu. */
  tone: 'warning' | 'neutral';
}

/**
 * Dòng tồn kho dưới tên sản phẩm ở giỏ, một luật cho cả hai app (web khổ điện thoại phải giống Mini). Chỉ hiện khi khách đã chạm trần tồn (`quantity === stock`, giải thích
 * vì sao nút + khoá) hoặc vượt tồn (`quantity > stock`, đang chặn thanh toán); chưa chạm trần thì không có dòng nên hàng giỏ không đổi cao lúc tải. Hết hàng (`stock <= 0`) trả `null`:
 * chỗ gọi đã có câu hết hàng riêng. Tồn 1–20 dùng `stockText`; tồn cao hơn ghi đúng số ("Còn 40 sản phẩm") vì khách cần biết trần là bao nhiêu (tồn ảo không chạm được trần).
 */
export function cartStockNote(quantity: number, stock: number): CartStockNote | null {
  if (stock <= 0 || quantity < stock) return null;
  const text = isLowStock(stock) ? stockText(stock) : fillTileCopy('stock.left', { n: stock });
  return { text, tone: quantity > stock || isLowStock(stock) ? 'warning' : 'neutral' };
}
