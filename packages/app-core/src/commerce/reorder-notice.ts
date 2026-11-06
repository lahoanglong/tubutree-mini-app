import { fillCopy } from '../shop-copy';
import { vnd } from './money';
import { isLowStock } from './stock-text';

/** Điều khách cần biết về một dòng của đơn cũ trước khi mua lại. */
export interface ReorderLineFacts {
  available: boolean;
  discontinued: boolean;
  /** Số lượng ở đơn trước. */
  orderedQuantity: number;
  /** Số còn bán (API đã kẹp tồn ảo); null khi API cũ không cho biết. */
  stock: number | null;
  /** Trần số lượng một dòng của sheet (bộ chọn số lượng). */
  cap: number;
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
 * - Còn ít hơn số đã mua mà tồn 1–20: báo đã giảm số lượng, kèm số đã mua, không in số tồn. Tồn trên 20 thì sheet không giảm và không báo
 *   (bộ chọn không kẹp theo tồn đó); máy chủ kẹp lúc thêm vào giỏ.
 * - Đơn trước mua nhiều hơn trần của sheet: báo trần, vì số lượng cũng bị giảm dù còn đủ hàng.
 * - Giá đổi so với đơn giá đã trả: tăng hay giảm, kèm giá cũ.
 */
export function reorderLineNotices(f: ReorderLineFacts): ReorderLineNotice[] {
  if (!f.available) {
    return f.discontinued
      ? [{ kind: 'discontinued', tone: 'danger', text: fillCopy('stock.discontinued') }]
      : [{ kind: 'out', tone: 'danger', text: fillCopy('stock.out') }];
  }
  const notices: ReorderLineNotice[] = [];
  if (f.stock !== null && f.stock < f.orderedQuantity && f.stock <= f.cap && isLowStock(f.stock)) {
    notices.push({ kind: 'reduced', tone: 'warning', text: fillCopy('reorder.qtyReduced', { old: f.orderedQuantity }) });
  } else if (f.orderedQuantity > f.cap) {
    notices.push({ kind: 'reduced', tone: 'warning', text: fillCopy('reorder.qtyCapped', { n: f.cap }) });
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
 * Giá đang bán để so với giá đã trả, null khi không so được. Giờ vàng làm phép so sai: dòng mua giá Giờ vàng (`flashSaleItemId`)
 * so với giá thường sẽ ra "giá tăng", còn biến thể đang có Giờ vàng (`flashActive`) thì giỏ có thể tính giá Giờ vàng thay giá đang bán.
 * API cũ chưa có `flashActive`: không so.
 */
export function reorderComparablePrice(it: { currentPrice?: number | null; flashActive?: boolean; flashSaleItemId?: string | null }): number | null {
  if (it.flashActive !== false || it.flashSaleItemId) return null;
  return typeof it.currentPrice === 'number' ? it.currentPrice : null;
}

/**
 * Dòng đơn đã ngừng bán (biến thể tắt, trang sản phẩm gỡ, biến thể bị xoá). API mới trả cờ `discontinued`.
 * API cũ không có cờ: trang sản phẩm đã gỡ, hoặc không bán được mà vẫn còn tồn, là ngừng bán; còn lại coi là hết hàng.
 */
export function isDiscontinuedItem(it: { available?: boolean; discontinued?: boolean; stock?: number; productPublic?: boolean }): boolean {
  if (typeof it.discontinued === 'boolean') return it.discontinued;
  return it.productPublic === false || (it.available === false && typeof it.stock === 'number' && it.stock > 0);
}
