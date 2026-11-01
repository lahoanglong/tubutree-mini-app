import type { CardVariant } from './product-card-view';

/**
 * Số đo (px) thân thẻ sản phẩm: ProductTile Mini, ProductTile web và khung chờ cùng đọc ở đây, nên đổi một chỗ là đổi cả ba (bài học 4a:
 * khung chờ lệch nội dung thật làm trang nhảy). Dòng tên 22px/dòng (không hạ: chữ hoa hai dấu "Ẩ", "Ổ" bị cắt đỉnh khi `overflow:hidden`);
 * hàng giá 20 theo `--type-price-tile-lh` (16px × 1,25); meta 16 theo `--type-label-lh`.
 */
export const TILE_METRICS = {
  inset: 8,
  brand: 16,
  /** Tên 2 dòng body-sm. */
  name: 44,
  /** Tên 2 dòng caption (thẻ hẹp rail-sm). */
  nameCaption: 40,
  /** Tên 1 dòng caption: thẻ Giờ vàng ở Trang chủ chỉ có chỗ cho một dòng (thiết kế Q11), nên cắt "…" thay vì cao thêm 20px. */
  nameFlash: 20,
  gap: 4,
  /** Khoảng giữa hàng giá và meta. */
  metaGap: 2,
  price: 20,
  /** Dòng giá gạch xếp chồng dưới giá (thẻ hẹp). */
  compare: 16,
  meta: 16,
  note: 16,
  line: 80,
} as const;

export interface TileBodyOptions {
  /** Có dòng nhãn hiệu không; mặc định có ở grid và rail-md, không ở biến thể khác. */
  brand?: boolean;
  /** Có dòng ghi chú một dòng dưới giá. */
  note?: boolean;
  /** Chiều cao phần `footer` (thanh % đã bán, nút nhắc) nằm trong thẻ. */
  footer?: number;
}

const M = TILE_METRICS;

/** Chiều cao thân thẻ (phần dưới ảnh) theo biến thể: mọi thẻ cùng biến thể và cùng tuỳ chọn có đúng chiều cao này, kể cả khi thiếu meta. */
export function tileBodyHeight(variant: CardVariant, o: TileBodyOptions = {}): number {
  if (variant === 'line') return M.line;
  const brand = o.brand ?? (variant === 'grid' || variant === 'rail-md');
  const extra = (o.note ? M.note : 0) + (o.footer ?? 0);
  switch (variant) {
    case 'grid':
      return M.inset + (brand ? M.brand : 0) + M.name + M.gap + M.price + M.metaGap + M.meta + M.inset + extra;
    case 'rail-md':
      return M.inset + (brand ? M.brand : 0) + M.name + M.gap + M.price + M.compare + M.metaGap + M.meta + M.inset + extra;
    case 'rank':
      return M.inset + M.name + M.gap + M.price + M.compare + M.metaGap + M.meta + M.inset + extra;
    case 'rail-sm':
      return M.inset + M.nameCaption + M.gap + M.price + M.compare + M.inset + extra;
    case 'flash':
      return M.inset + M.nameFlash + M.gap + M.price + M.compare + M.inset + extra;
  }
}
