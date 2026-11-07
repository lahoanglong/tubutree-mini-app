import type { ProductCard } from '../api/catalog';
import { cardPricing, type FlashPriceItem } from '../flash-price';
import { serverNow } from '../server-clock';

/**
 * Khối "Gợi ý mua kèm hợp vị" ở trang chi tiết sản phẩm: món đang xem cùng `FBT_PARTNER_MAX` món bổ trợ, tick chọn rồi thêm cả bộ một chạm.
 * Mini App và web cùng gọi các hàm này: món được gợi ý, giá và tổng tiền không được lệch giữa hai nền tảng.
 */

export const FBT_PARTNER_MAX = 2;

export interface FbtLine {
  /** Khoá dòng: phân loại sẽ vào giỏ. */
  key: string;
  productId: string;
  slug: string;
  variationId: string;
  name: string;
  thumbnail: string | null;
  /** Giá khách trả cho một đơn vị (Giờ vàng thắng khi còn hạn và rẻ hơn). */
  price: number;
  compareAt: number | null;
  isCurrent: boolean;
}

export interface FbtCurrent {
  productId: string;
  slug: string;
  name: string;
  thumbnail: string | null;
  /** Phân loại khách đang chọn ở trang; thiếu (chưa chọn được) thì không có bộ nào. */
  variationId: string | null;
  /** Giá khách trả của phân loại đang chọn (đúng số trang đang ghi). */
  price: number;
  compareAt: number | null;
  inStock: boolean;
}

export interface FbtSummary {
  count: number;
  /** Tổng tiền các món đã chọn. */
  bundleTotal: number;
  /** Tổng giá gạch (giá thường khi không gạch) của các món đã chọn. */
  bundleOriginalTotal: number;
  /** Số tiền tiết kiệm so với giá gạch; không có khuyến mãi riêng của bộ nên chỉ là phần Giờ vàng và giá bán đã giảm. */
  bundleSavings: number;
}

export interface FbtBundle extends FbtSummary {
  /** Món đang xem đứng đầu, rồi các món bổ trợ. Tổng ở đây tính khi chọn hết. */
  lines: FbtLine[];
}

export interface FbtPartnerParams {
  /** Sản phẩm đang xem: không tự gợi ý chính nó. */
  currentProductId: string;
  /** Ứng viên theo thứ tự ưu tiên (dải "Khách thường mua cùng" của API: cùng danh mục hoặc hay mua cùng). */
  candidates: readonly ProductCard[] | null | undefined;
  flash?: readonly FlashPriceItem[];
  /** Sản phẩm đã có trong giỏ: không gợi ý lại. */
  cartProductIds?: ReadonlySet<string>;
  now?: number;
  limit?: number;
}

export interface FbtParams extends Omit<FbtPartnerParams, 'currentProductId'> {
  current: FbtCurrent;
}

/** Tổng của các dòng trong `picked` (`FbtLine.key`). */
export function frequentlyBoughtSummary(lines: readonly FbtLine[], picked: ReadonlySet<string>): FbtSummary {
  let count = 0;
  let bundleTotal = 0;
  let bundleOriginalTotal = 0;
  for (const l of lines) {
    if (!picked.has(l.key)) continue;
    count += 1;
    bundleTotal += l.price;
    bundleOriginalTotal += Math.max(l.price, l.compareAt ?? l.price);
  }
  return { count, bundleTotal, bundleOriginalTotal, bundleSavings: bundleOriginalTotal - bundleTotal };
}

/**
 * Các món bổ trợ: tối đa `limit` (mặc định 2, không quá `FBT_PARTNER_MAX`) món lấy theo thứ tự ứng viên. Loại món đang xem, món hết hàng, món không có phân loại để
 * thêm, món đã có trong giỏ và món lặp. Phân loại thêm theo cùng luật nút thêm nhanh của thẻ (ghim > suất Giờ vàng thắng > đại diện). Không phụ thuộc phân loại
 * khách đang chọn ở trang, nên nơi gọi dùng danh sách này để các dải bên dưới bỏ đúng những món đã nằm trong khối (`pdpShelves`).
 */
export function pickFbtPartners(params: FbtPartnerParams): FbtLine[] {
  const now = params.now ?? serverNow();
  const flash = params.flash ?? [];
  const limit = Math.max(0, Math.min(params.limit ?? FBT_PARTNER_MAX, FBT_PARTNER_MAX));
  const seen = new Set<string>([params.currentProductId]);
  const partners: FbtLine[] = [];
  for (const c of Array.isArray(params.candidates) ? params.candidates : []) {
    if (partners.length >= limit) break;
    if (!c.inStock || seen.has(c.id) || params.cartProductIds?.has(c.id)) continue;
    const pricing = cardPricing(c, flash, now);
    const variationId = c.pinnedVariationId ?? pricing.flashVariationId ?? c.repVariationId;
    if (!variationId || !(pricing.price > 0)) continue;
    seen.add(c.id);
    partners.push({
      key: variationId,
      productId: c.id,
      slug: c.slug,
      variationId,
      name: c.name,
      thumbnail: c.thumbnail,
      price: pricing.price,
      compareAt: pricing.compareAt,
      isCurrent: false,
    });
  }
  return partners;
}

/**
 * Bộ gợi ý: món đang xem + các món bổ trợ của `pickFbtPartners`. Trả null khi món đang xem hết hàng hoặc chưa có phân loại, hay không còn món bổ trợ nào
 * (khối ẩn hẳn). Tổng tính khi chọn hết. `partners` có thì dùng thay vì chọn lại (nơi gọi đã chọn để chống trùng các dải khác).
 */
export function buildFrequentlyBoughtBundle(params: FbtParams & { partners?: readonly FbtLine[] }): FbtBundle | null {
  const { current } = params;
  if (!current.inStock || !current.variationId || !(current.price > 0)) return null;
  const partners = params.partners ?? pickFbtPartners({ ...params, currentProductId: current.productId });
  if (partners.length === 0) return null;
  const lines: FbtLine[] = [
    {
      key: current.variationId,
      productId: current.productId,
      slug: current.slug,
      variationId: current.variationId,
      name: current.name,
      thumbnail: current.thumbnail,
      price: current.price,
      compareAt: current.compareAt,
      isCurrent: true,
    },
    ...partners,
  ];
  return { lines, ...frequentlyBoughtSummary(lines, new Set(lines.map((l) => l.key))) };
}

/** Dòng giỏ của các món đã chọn: mỗi món một đơn vị (số lượng ở ô Số lượng của trang không đổi theo bộ). */
export function frequentlyBoughtLines(lines: readonly FbtLine[], picked: ReadonlySet<string>): { variationId: string; quantity: number }[] {
  return lines.filter((l) => picked.has(l.key)).map((l) => ({ variationId: l.variationId, quantity: 1 }));
}
