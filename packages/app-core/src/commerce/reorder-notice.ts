import { fillCopy } from '../shop-copy';
import { vnd } from './money';

/** Điều khách cần biết về một dòng của đơn cũ trước khi mua lại. */
export interface ReorderLineFacts {
  available: boolean;
  discontinued: boolean;
  /** Số lượng ở đơn trước. */
  orderedQuantity: number;
  /** Số còn bán (API đã kẹp tồn ảo); null khi API cũ không cho biết. */
  stock: number | null;
  /** Đơn giá đã trả ở đơn trước. */
  paidPrice: number;
  /** Đơn giá đang bán; null khi API cũ không cho biết. */
  currentPrice: number | null;
}

export type ReorderNoticeKind = 'discontinued' | 'out' | 'reduced' | 'priceUp' | 'priceDown';

export interface ReorderLineNotice {
  kind: ReorderNoticeKind;
  tone: 'danger' | 'warning' | 'success';
  text: string;
}

/**
 * Câu dưới từng dòng của sheet Mua lại.
 * - Không bán được: "Ngừng bán" hoặc "Tạm hết hàng", và chỉ câu đó.
 * - Còn ít hơn số đã mua: báo đã giảm số lượng, kèm số đã mua. Không in số tồn (tồn trên 20 không bao giờ ghi số).
 * - Giá đổi so với đơn giá đã trả: tăng hay giảm, kèm giá cũ.
 */
export function reorderLineNotices(f: ReorderLineFacts): ReorderLineNotice[] {
  if (!f.available) {
    return f.discontinued
      ? [{ kind: 'discontinued', tone: 'danger', text: fillCopy('stock.discontinued') }]
      : [{ kind: 'out', tone: 'danger', text: fillCopy('stock.out') }];
  }
  const notices: ReorderLineNotice[] = [];
  if (f.stock !== null && f.stock < f.orderedQuantity) {
    notices.push({ kind: 'reduced', tone: 'warning', text: fillCopy('reorder.qtyReduced', { old: f.orderedQuantity }) });
  }
  if (f.currentPrice !== null && f.currentPrice > f.paidPrice) {
    notices.push({ kind: 'priceUp', tone: 'warning', text: fillCopy('reorder.priceUp', { old: vnd(f.paidPrice) }) });
  } else if (f.currentPrice !== null && f.currentPrice < f.paidPrice) {
    notices.push({ kind: 'priceDown', tone: 'success', text: fillCopy('reorder.priceDown', { old: vnd(f.paidPrice) }) });
  }
  return notices;
}

/** Câu đầu sheet khi có dòng không thêm được: một phần hay cả đơn. null khi mọi dòng còn bán. */
export function reorderSkippedNote(lines: readonly { available: boolean }[]): string | null {
  const skipped = lines.filter((l) => !l.available).length;
  if (skipped === 0) return null;
  return skipped === lines.length ? fillCopy('reorder.allSkipped') : fillCopy('reorder.someSkipped', { n: skipped });
}

/**
 * Dòng đơn đã ngừng bán (biến thể tắt, trang sản phẩm gỡ, biến thể bị xoá). API mới trả cờ `discontinued`.
 * API cũ không có cờ: trang sản phẩm đã gỡ, hoặc không bán được mà vẫn còn tồn, là ngừng bán; còn lại coi là hết hàng.
 */
export function isDiscontinuedItem(it: { available?: boolean; discontinued?: boolean; stock?: number; productPublic?: boolean }): boolean {
  if (typeof it.discontinued === 'boolean') return it.discontinued;
  return it.productPublic === false || (it.available === false && typeof it.stock === 'number' && it.stock > 0);
}
