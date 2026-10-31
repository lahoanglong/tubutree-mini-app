import { fillTemplate } from '../copy-template';

/**
 * Chữ của thẻ sản phẩm (nhãn, hết hàng, chữ đọc giá và meta), nằm trên đường nạp của gói đầu Mini App vì `productCardView` dùng ở mọi thẻ.
 * Tách khỏi `shop-copy.ts` để thẻ không kéo cả bảng ~140 khoá vào gói đầu (+7 KB, vượt trần 700 KB); `SHOP_COPY` spread lại bảng này nên
 * chỉ có một nơi định nghĩa và `shop-copy.spec.ts` vẫn kiểm độ dài. Khoá mới của thẻ thêm ở đây VÀ ở `shop-copy-budget.ts`.
 */
export const TILE_COPY = {
  'flash.badge': 'Giờ vàng -{pct}%',
  'rank.spoken': 'Hạng {n} bán chạy',
  'badge.discount': '-{pct}%',
  'badge.new': 'Mới',
  'badge.featured': 'Tubu chọn',
  'badge.loved': 'Được yêu thích',
  'badge.freeship': 'Miễn phí giao hàng',
  'badge.flashSpoken': 'Giờ vàng giảm {pct}%',
  'badge.discountSpoken': 'Giảm {pct}%',
  'stock.out': 'Tạm hết hàng',
  'price.spoken': 'Giá {price}',
  'price.flashSpoken': 'Giá Giờ vàng {price}',
  'price.compareSpoken': ', giá gốc {price}',
  'combo.tileTag': 'Có combo',
  'meta.ratingSpoken': '{avg} sao',
  'meta.soldSpoken': 'đã bán {n}',
  'meta.soldSpokenOver': 'đã bán hơn {n}',
} as const;

export type TileCopyKey = keyof typeof TILE_COPY;

/** Điền mẫu `TILE_COPY[key]`; thiếu biến thì ném lỗi (không để lộ "{pct}" ra cho khách). */
export function fillTileCopy(key: TileCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(TILE_COPY[key], vars, key);
}
