import type { BundleDTO, ProductBundles } from '../api/bundle';
import { fillCopy } from '../shop-copy';
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

/** Vì sao một phía của khối Combo/Mua kèm không còn dòng nào sau khi đã hiện: bộ hết hạn/tắt (`ended`), hay bộ còn nhưng món hết hàng (`soldOut`). */
export type BundleHold = 'ended' | 'soldOut';

/**
 * Chỉ gọi khi phía đó vừa hết dòng sau khi đã hiện. `heldBundleIds` là mã các bộ của dòng đang giữ: chỉ chính những bộ đó còn hạn mà vẫn không
 * ra dòng nào mới là "hết hàng" (món hết hàng, hay chưa chọn được phân loại). Một bộ KHÁC còn chạy mà chưa từng có dòng (mọi món hết hàng)
 * không được kéo bộ đã tắt thành "Tạm hết hàng". Không truyền `heldBundleIds` thì bộ nào còn hạn cũng tính. Với Mua kèm, API còn báo riêng
 * khi sản phẩm chính hết hàng (`addonsSoldOut`, lúc đó `addons` rỗng nên không có mã để đối chiếu): coi mọi bộ đang giữ là hết hàng.
 * Bộ bị tắt thì API không trả nữa, nên danh sách rỗng đọc là "đã kết thúc".
 */
export function bundleHoldReason(side: 'combos' | 'addons', data: ProductBundles | undefined, now: number, heldBundleIds?: readonly string[]): BundleHold {
  if (!data) return 'ended';
  if (side === 'addons' && data.addonsSoldOut === true) return 'soldOut';
  const held = heldBundleIds ? new Set(heldBundleIds) : null;
  return data[side].some((b) => bundleLive(b, now) && (held === null || held.has(b.id))) ? 'soldOut' : 'ended';
}

/**
 * Giữ danh sách cuối cùng đã hiện khi dữ liệu sau đó rỗng, để khối ở nguyên chỗ (mờ, không bấm được) thay vì bị gỡ giữa trang và đẩy phần
 * dưới nhảy. Hai app dùng chung: mỗi app chỉ giữ `last` trong một `useRef`. Chưa từng hiện mà rỗng thì rỗng, không giữ. `why` nhận danh sách
 * đang giữ để tính lý do theo đúng các dòng đó (`bundleHoldReason`).
 */
export function latchBundleSide<T>(live: T[], last: T[] | null, why: (held: T[]) => BundleHold): { items: T[]; held: BundleHold | null; last: T[] | null } {
  if (live.length > 0) return { items: live, held: null, last: live };
  if (last === null) return { items: [], held: null, last: null };
  return { items: last, held: why(last), last };
}

/** Tiêu đề khối, kèm lý do khi đang giữ ("Mua kèm deal sốc · Tạm hết hàng"; chữ hết hàng dùng chung `stock.out` của thẻ sản phẩm). */
export function bundleHoldTitle(titleKey: 'combo.pdpTitle' | 'addon.title', hold: BundleHold | null): string {
  return hold ? `${fillCopy(titleKey)} · ${fillCopy(hold === 'soldOut' ? 'stock.out' : 'bundle.ended')}` : fillCopy(titleKey);
}

