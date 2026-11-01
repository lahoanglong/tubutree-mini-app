import type { BundleDTO } from '../api/bundle';
import { productCardView, type ProductCardView } from './product-card-view';
import { comboTotals } from './shop-page';

/** Khớp `maxItems` của kệ `pdp.combos` / `pdp.addons` và giới hạn ở API. */
export const PDP_COMBO_MAX = 2;
export const PDP_ADDON_MAX = 3;

/** Bộ còn hiệu lực theo giờ máy chủ (`now` là mili giây): đúng lúc `endAt` là đã hết, như `bundleLiveWhere` ở API. */
export function bundleLive(b: Pick<BundleDTO, 'endAt'>, now: number): boolean {
  const end = Date.parse(b.endAt);
  return Number.isFinite(end) && end > now;
}

const priceOf = (p: { salePrice: number | null; basePrice: number }) => p.salePrice ?? p.basePrice;

export interface ComboView {
  id: string;
  title: string;
  pct: number;
  items: ProductCardView[];
  /** Mỗi món một đơn vị: đúng thứ "Thêm cả combo" gửi lên giỏ. */
  lines: { variationId: string; quantity: number }[];
  /** Tổng giá lẻ các món. */
  total: number;
  /** Tổng sau giảm theo cùng phép floor từng món của `allocateBundleDiscounts` (giỏ vẫn là nguồn chính thức). */
  comboTotal: number;
}

/**
 * Dạng hiển thị của một combo (BUNDLE_PCT). null khi hết hạn, dưới hai sản phẩm khác nhau, `pct` không dương, hay có món chưa chọn được
 * phân loại: không quảng cáo "mua cả bộ" cho thứ giỏ không giảm hoặc không thêm được.
 */
export function comboView(b: BundleDTO, now: number): ComboView | null {
  if (b.kind !== 'BUNDLE_PCT' || !bundleLive(b, now)) return null;
  if (typeof b.pct !== 'number' || !(b.pct > 0)) return null;
  if (new Set(b.items.map((i) => i.productId)).size < 2) return null;
  const lines: { variationId: string; quantity: number }[] = [];
  for (const it of b.items) {
    if (!it.variationId) return null;
    lines.push({ variationId: it.variationId, quantity: 1 });
  }
  const { total, comboTotal } = comboTotals(b.items.map((i) => priceOf(i.product)), b.pct);
  const items = b.items.map((i) =>
    productCardView({ product: { ...i.product, inStock: i.inStock && i.product.inStock !== false }, flash: null, variant: 'line', now, showBrand: false }),
  );
  return { id: b.id, title: b.title, pct: b.pct, items, lines, total, comboTotal };
}

export interface AddonRow {
  /** `${bundleId}:${productId}`: khoá chọn của dòng. */
  key: string;
  bundleId: string;
  productId: string;
  variationId: string;
  name: string;
  thumbnail: string | null;
  /** Giá đang bán của món (chưa mua kèm). */
  listPrice: number;
  addonPrice: number;
  savingPct: number;
  maxQty: number;
}

/**
 * Các dòng "Mua kèm deal sốc" từ các bộ ADDON còn hiệu lực. Bỏ món hết hàng, chưa có phân loại, và món có giá kèm không thấp hơn giá
 * đang bán (không giảm được đồng nào). Một sản phẩm nằm ở nhiều bộ chỉ một dòng, lấy giá kèm thấp nhất: thêm hai dòng cùng phân loại
 * sẽ thành hai đơn vị. Cắt còn `max` dòng.
 */
export function addonRows(bundles: readonly BundleDTO[], now: number, max: number = PDP_ADDON_MAX): AddonRow[] {
  const byProduct = new Map<string, AddonRow>();
  const order: string[] = [];
  for (const b of bundles) {
    if (b.kind !== 'ADDON' || !bundleLive(b, now)) continue;
    for (const it of b.items) {
      if (!it.inStock || !it.variationId || it.addonPrice === null) continue;
      const listPrice = priceOf(it.product);
      if (!(it.addonPrice < listPrice)) continue;
      const row: AddonRow = {
        key: `${b.id}:${it.productId}`,
        bundleId: b.id,
        productId: it.productId,
        variationId: it.variationId,
        name: it.product.name,
        thumbnail: it.product.thumbnail,
        listPrice,
        addonPrice: it.addonPrice,
        savingPct: Math.round(((listPrice - it.addonPrice) / listPrice) * 100),
        maxQty: it.maxQty,
      };
      const seen = byProduct.get(it.productId);
      if (!seen) order.push(it.productId);
      if (!seen || row.addonPrice < seen.addonPrice) byProduct.set(it.productId, row);
    }
  }
  return order.slice(0, Math.max(0, max)).map((id) => byProduct.get(id)!);
}

/** Số món, số tiền phải trả và số tiền tiết kiệm của các dòng đã chọn (`picked` chứa `AddonRow.key`). */
export function addonSummary(rows: readonly AddonRow[], picked: ReadonlySet<string>): { count: number; pay: number; save: number } {
  let count = 0;
  let pay = 0;
  let save = 0;
  for (const r of rows) {
    if (!picked.has(r.key)) continue;
    count += 1;
    pay += r.addonPrice;
    save += r.listPrice - r.addonPrice;
  }
  return { count, pay, save };
}

/** Dòng giỏ của các món mua kèm đã chọn: mỗi món một đơn vị, không kèm sản phẩm chính (khách tự thêm bằng nút mua của trang). */
export function addonLines(rows: readonly AddonRow[], picked: ReadonlySet<string>): { variationId: string; quantity: number }[] {
  return rows.filter((r) => picked.has(r.key)).map((r) => ({ variationId: r.variationId, quantity: 1 }));
}
