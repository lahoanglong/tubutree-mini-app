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
  const price = f.currentPrice === null ? null : priceNotice(f.paidPrice, f.currentPrice);
  if (price) notices.push(price);
  return notices;
}

/** Tăng hay giảm so với đơn giá đã trả, kèm giá cũ; null khi bằng nhau. */
function priceNotice(paid: number, now: number): ReorderLineNotice | null {
  if (now > paid) return { kind: 'priceUp', tone: 'warning', text: fillCopy('reorder.priceUp', { old: vnd(paid) }) };
  if (now < paid) return { kind: 'priceDown', tone: 'success', text: fillCopy('reorder.priceDown', { old: vnd(paid) }) };
  return null;
}

/** Giá một dòng của sheet Mua lại: đủ dữ kiện để tính giá giỏ sẽ tính theo số lượng khách chọn. */
export interface ReorderPricing {
  /** Giá đang bán (giá thường); giá đã trả khi API không cho biết giá hiện tại. */
  standing: number;
  /** Giá Giờ vàng giỏ sẽ tính khi số lượng không vượt `flashAllowance`; null = không có suất Giờ vàng mở. */
  flashPrice: number | null;
  /** Số suất Giờ vàng khách còn mua được; null = API không giới hạn hay không cho biết (áp cho mọi số lượng). */
  flashAllowance: number | null;
  /** Đơn giá đã trả ở đơn trước; null khi không có đơn trước (mua lại một sản phẩm). */
  paidPrice: number | null;
  /** Có đủ cơ sở để so giá với `paidPrice` không (Giờ vàng không làm phép so sai). */
  comparable: boolean;
}

/**
 * Dữ kiện giá của một dòng đơn cũ. API mới luôn gửi `flashPrice` (null = không có suất mở) nên biết chắc giá giỏ sẽ tính và so
 * giá được kể cả khi dòng đơn cũ mua giá Giờ vàng. API cũ không gửi: giữ luật cũ, chỉ so khi biết không có Giờ vàng xen vào.
 */
export function reorderPricing(it: {
  unitPrice: number;
  currentPrice?: number | null;
  flashActive?: boolean;
  flashSaleItemId?: string | null;
  flashPrice?: number | null;
  flashAllowance?: number | null;
}): ReorderPricing {
  const knowsFlash = it.flashPrice !== undefined;
  return {
    standing: it.currentPrice ?? it.unitPrice,
    flashPrice: it.flashPrice ?? null,
    flashAllowance: it.flashAllowance ?? null,
    paidPrice: it.unitPrice,
    comparable: knowsFlash ? typeof it.currentPrice === 'number' : reorderComparablePrice(it) !== null,
  };
}

/** Dữ kiện giá của một sản phẩm đã mua (rail "Mua lại"): không có đơn trước nên không so giá. */
export function purchasedPricing(p: { price: number; salePrice: number | null; flashPrice?: number | null; flashAllowance?: number | null }): ReorderPricing {
  return { standing: p.salePrice ?? p.price, flashPrice: p.flashPrice ?? null, flashAllowance: p.flashAllowance ?? null, paidPrice: null, comparable: false };
}

/**
 * Đơn giá và câu giá của dòng ở số lượng khách chọn, cùng luật với giỏ (priceFlashLine ở API): Giờ vàng còn suất và số lượng không
 * vượt số suất khách còn mua được → min(giá Giờ vàng, giá đang bán); vượt → cả dòng giá đang bán.
 *
 * Giỏ gộp số lượng cùng biến thể rồi mới so với suất, nên `inCart` là số lượng cùng biến thể sẽ nằm chung dòng giỏ với dòng này:
 * phần đã có sẵn trong giỏ và phần của các dòng khác cùng biến thể trong sheet. Không truyền: coi như giỏ chưa có món này.
 */
export function reorderPriceAt(p: ReorderPricing, quantity: number, inCart = 0): { unitPrice: number; notice: ReorderLineNotice | null } {
  const flash = p.flashPrice !== null && (p.flashAllowance === null || quantity + Math.max(inCart, 0) <= p.flashAllowance);
  const unitPrice = flash ? Math.min(p.flashPrice as number, p.standing) : p.standing;
  return { unitPrice, notice: p.comparable && p.paidPrice !== null ? priceNotice(p.paidPrice, unitPrice) : null };
}

/**
 * Tiền các dòng đang chọn rẻ hơn lúc mua trước: tổng (giá đã trả − giá hiện tại) × số lượng trên các dòng so giá được, chỉ khi dương.
 * Dòng đắt lên được trừ vào, vì câu "Tiết kiệm" mà tổng phải trả lại cao hơn lần trước là câu sai với khách. Mọi dòng đều rẻ đi thì
 * số này bằng tổng phần rẻ đi của từng dòng. Dòng không so được (Giờ vàng xen vào, không có giá đã trả) không tính vào cả hai phía.
 */
export function reorderSavings(
  entries: readonly { quantity: number; unitPrice: number; pricing?: Pick<ReorderPricing, 'paidPrice' | 'comparable'> }[],
): number {
  let net = 0;
  for (const e of entries) {
    const paid = e.pricing?.paidPrice ?? null;
    if (e.pricing?.comparable && paid !== null) net += (paid - e.unitPrice) * e.quantity;
  }
  return Math.max(net, 0);
}

/** Câu tiết kiệm dưới dòng Tạm tính của sheet; null khi không có gì tiết kiệm. */
export function reorderSavingsNote(saved: number): string | null {
  return saved > 0 ? fillCopy('reorder.savedVsBefore', { x: vnd(saved) }) : null;
}

/** Số lượng từng biến thể đang có trong giỏ (giỏ mỗi biến thể một dòng; cộng dồn nếu API trả trùng). Chưa tải giỏ: bảng rỗng. */
export function cartUnitsByVariation(items: readonly { variationId: string; quantity: number }[] | undefined): ReadonlyMap<string, number> {
  const units = new Map<string, number>();
  for (const it of items ?? []) units.set(it.variationId, (units.get(it.variationId) ?? 0) + it.quantity);
  return units;
}

/**
 * Sheet chỉ tính đúng giá và số lượng gộp khi đã biết giỏ. Giỏ đang tải lần đầu thì chưa biết: chờ (khoá nút thêm), không coi như giỏ
 * rỗng. Lỗi, không tải giỏ (sheet đóng, chưa đăng nhập) hoặc truy vấn bị tạm dừng vì mất mạng (`paused`: web để truy vấn dừng tới khi có
 * mạng lại) thì không chờ, để khách không kẹt; giá khi đó theo số lượng của sheet.
 */
export function cartUnitsReady(query: {
  enabled: boolean;
  status: 'pending' | 'error' | 'success';
  fetchStatus?: 'fetching' | 'paused' | 'idle';
}): boolean {
  return !query.enabled || query.status !== 'pending' || query.fetchStatus === 'paused';
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
