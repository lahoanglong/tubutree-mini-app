import { LOW_STOCK_NOTICE, overStockTarget, PLENTY_STOCK } from '@tubutree/shared-types';
import { fillTileCopy } from './tile-copy';

// Ngưỡng và mức kéo về định nghĩa ở shared-types để API dùng cùng giá trị khi viết lỗi giỏ hàng và kẹp số mua lại.
export { LOW_STOCK_NOTICE, overStockTarget, PLENTY_STOCK };

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

/** Trần nút + khi tồn trên LOW_STOCK_NOTICE. Cố định, bằng trần sheet Mua lại. */
export const QTY_PICK_CAP = 99;

/**
 * Trần nút + của bộ chọn số lượng, một luật cho PDP, bảng chọn phân loại, giỏ, Mua lại và form đặt hộ của CTV ở cả hai app. Tồn 1–20 đã in ra
 * ("Chỉ còn n") nên nút + khoá đúng ở tồn. Tồn cao hơn thì nút + dừng ở QTY_PICK_CAP chứ không ở tồn: khoá ở tồn là để khách bấm + tới khi nút
 * khoá rồi đọc ra tồn thật. Phần vượt tồn do máy chủ từ chối bằng câu không có số. Hết hàng trả 1 (chỗ gọi tự khoá bộ chọn).
 */
export function qtyPickMax(stock: number): number {
  if (isLowStock(stock)) return stock;
  return stock > 0 ? QTY_PICK_CAP : 1;
}

/**
 * Dòng tồn kho dưới tên sản phẩm ở giỏ, một luật cho cả hai app (web khổ điện thoại phải giống Mini); luôn là màu cảnh báo. Tồn 1–20: khi đã chạm
 * hoặc vượt tồn thì ghi "Chỉ còn n sản phẩm" (giải thích vì sao nút + khoá). Tồn cao hơn: chỉ khi vượt tồn (đang chặn thanh toán), câu không có số;
 * chọn đúng bằng tồn thì không có dòng, vì nút + không khoá ở đó và câu "đã chọn hết" là nói ra tồn thật. Hết hàng (`stock <= 0`) trả `null`: chỗ gọi đã
 * có câu hết hàng riêng.
 */
export function cartStockNote(quantity: number, stock: number): string | null {
  if (isLowStock(stock)) return quantity >= stock ? stockText(stock) : null;
  return stock > 0 && quantity > stock ? fillTileCopy('stock.over') : null;
}
