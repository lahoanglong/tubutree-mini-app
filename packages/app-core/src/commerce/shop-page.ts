import type { CatalogSort } from '../api/catalog';
import { formatVnNumber } from '../number-format';
import { fillCopy } from '../shop-copy';
import { SHOP_MAX_SECTIONS } from './collection-view';
import type { ShopStat } from './shop-stats';
import { expiryText, type VoucherView } from './voucher';

/** Số sản phẩm mỗi trang của tab Sản phẩm (Mini App "Xem thêm", web lg phân trang số). */
export const SHOP_PAGE_SIZE = 20;

export type ShopTabKey = 'shop' | 'products' | 'categories' | 'story';
export interface ShopTab {
  key: ShopTabKey;
  label: string;
  count?: number;
}

/** Tab của trang shop. Thương hiệu không có bộ sưu tập nên truyền `hasCategories: false` và thêm `hasStory`. */
export function shopTabs(i: { productCount: number; hasStory?: boolean; hasCategories?: boolean }): ShopTab[] {
  const tabs: ShopTab[] = [
    { key: 'shop', label: fillCopy('shop.tabShop') },
    { key: 'products', label: fillCopy('shop.tabProducts'), count: i.productCount },
  ];
  if (i.hasCategories !== false) tabs.push({ key: 'categories', label: fillCopy('shop.tabCategories') });
  if (i.hasStory) tabs.push({ key: 'story', label: fillCopy('shop.tabStory') });
  return tabs;
}

export type ShopSort = 'popular' | 'newest' | 'best_seller_30d' | 'price_asc' | 'price_desc';

/** Bốn mục của SortBar; "Giá" là một mục tự đảo chiều (xem `nextShopSort`). */
export const SHOP_SORT_OPTIONS: { value: string; label: string; spoken?: string }[] = [
  { value: 'popular', label: fillCopy('shop.sortPopular') },
  { value: 'newest', label: fillCopy('shop.sortNew') },
  { value: 'best_seller_30d', label: fillCopy('shop.sortSold') },
  { value: 'price', label: fillCopy('shop.sortPrice'), spoken: fillCopy('shop.sortPriceSpoken') },
];

export function shopSortValue(s: ShopSort): string {
  return s === 'price_asc' || s === 'price_desc' ? 'price' : s;
}

/** Bấm "Giá" khi đang xếp theo giá thì đảo chiều, còn lại bắt đầu từ tăng dần; mục khác đổi thẳng. */
export function nextShopSort(current: ShopSort, picked: string): ShopSort {
  if (picked === 'price') return current === 'price_asc' ? 'price_desc' : 'price_asc';
  return picked as ShopSort;
}

/** `popular` là thứ tự mặc định của API nên không gửi tham số. */
export function shopSortToCatalog(s: ShopSort): CatalogSort | undefined {
  return s === 'popular' ? undefined : s;
}

export interface ShopProductLike {
  id: string;
  basePrice: number;
  salePrice?: number | null;
  sold?: number | null;
  createdAt?: string | null;
}

const price = (x: ShopProductLike) => x.salePrice ?? x.basePrice;
const time = (x: ShopProductLike) => {
  const t = x.createdAt ? Date.parse(x.createdAt) : Number.NaN;
  return Number.isNaN(t) ? -Infinity : t;
};

/** Sắp xếp phía máy khách cho gian hàng CTV (API chưa có endpoint sản phẩm theo gian hàng). Ổn định; không đổi mảng vào. */
export function sortShopProducts<T extends ShopProductLike>(items: readonly T[], s: ShopSort): T[] {
  const list = [...items];
  if (s === 'popular') return list;
  const by: Record<Exclude<ShopSort, 'popular'>, (a: T, b: T) => number> = {
    price_asc: (a, b) => price(a) - price(b),
    price_desc: (a, b) => price(b) - price(a),
    newest: (a, b) => time(b) - time(a),
    best_seller_30d: (a, b) => Number(b.sold ?? 0) - Number(a.sold ?? 0),
  };
  return list.sort(by[s]);
}

/** Mọi sản phẩm của shop, bỏ trùng giữa các bộ, giữ thứ tự khối. */
export function uniqueShopProducts<P extends { id: string }>(collections: { items: { product: P }[] }[]): P[] {
  const seen = new Set<string>();
  const out: P[] = [];
  for (const c of collections) {
    for (const it of c.items) {
      if (seen.has(it.product.id)) continue;
      seen.add(it.product.id);
      out.push(it.product);
    }
  }
  return out;
}

/**
 * Chia bộ sưu tập: tối đa `SHOP_MAX_SECTIONS` khối ở tab Shop, phần còn lại chỉ có ở tab Danh mục. Bộ rỗng bỏ; combo chưa đủ 2 sản phẩm
 * khác nhau cũng bỏ (checkout không giảm, trang không được hứa "Combo -x%").
 */
export function planShopSections<C extends { kind: string; items: { product: { id: string } }[] }>(collections: C[]): { main: C[]; extra: C[] } {
  const live = collections.filter((c) => c.items.length > 0 && (c.kind !== 'COMBO' || new Set(c.items.map((i) => i.product.id)).size >= 2));
  return { main: live.slice(0, SHOP_MAX_SECTIONS), extra: live.slice(SHOP_MAX_SECTIONS) };
}

/**
 * Tổng combo để hiện "Mua cả bộ": giảm sàn từng dòng, đúng phép tính `allocateComboDiscounts` của API, nên số ở trang shop
 * khớp số giỏ trừ (giỏ vẫn là nguồn chính thức). `pct` hỏng hoặc ≤0 thì không giảm, quá 100 kẹp 100.
 */
export function comboTotals(prices: readonly number[], pct: number | null): { total: number; comboTotal: number; saving: number } {
  const total = prices.reduce((s, p) => s + p, 0);
  const rate = typeof pct === 'number' && Number.isFinite(pct) && pct > 0 ? Math.min(pct, 100) : 0;
  const saving = prices.reduce((s, p) => s + Math.floor((p * rate) / 100), 0);
  return { total, comboTotal: total - saving, saving };
}

/** Bậc CTV chỉ hiện từ bậc thứ 2 (§4 Q9): thiếu cờ `publicBadge` (API cũ) cũng ẩn. */
export function publicTier(t: { name: string; emoji: string; publicBadge?: boolean } | null | undefined): { name: string; emoji: string } | null {
  return t && t.publicBadge === true ? { name: t.name, emoji: t.emoji } : null;
}

/** Số tối thiểu đánh giá để khoe sao trung bình của cả shop. */
const MIN_REVIEWS_FOR_RATING = 5;

interface StatProduct {
  ratingAvg?: number | null;
  reviewCount?: number | null;
  sold?: number | null;
}

function rollUp(products: StatProduct[]): { ratingAvg: number | null; sold: number | null } {
  let reviews = 0;
  let weighted = 0;
  let sold = 0;
  for (const p of products) {
    const n = Number(p.reviewCount ?? 0);
    const avg = Number(p.ratingAvg ?? 0);
    if (Number.isFinite(n) && n > 0 && Number.isFinite(avg)) {
      reviews += n;
      weighted += avg * n;
    }
    const s = Number(p.sold ?? 0);
    if (Number.isFinite(s) && s > 0) sold += s;
  }
  return { ratingAvg: reviews >= MIN_REVIEWS_FOR_RATING ? weighted / reviews : null, sold: sold > 0 ? sold : null };
}

/** Đầu vào `shopStats` của gian hàng CTV, tính từ các bộ sưu tập trong phản hồi công khai. */
export function storefrontStatsInput(collections: { items: { product: { id: string } & StatProduct }[] }[]): { productCount: number; ratingAvg: number | null; sold: number | null } {
  const products = uniqueShopProducts(collections);
  return { productCount: products.length, ...rollUp(products) };
}

/**
 * Đầu vào `shopStats` của thương hiệu. `products` chỉ là 30 món đầu (client cũ): khi tổng lớn hơn danh sách thì sao và số bán
 * tính trên phần cụt sẽ sai, nên chỉ khoe số sản phẩm.
 */
export function brandStatsInput(b: { productCount?: number; products: StatProduct[] }): { productCount: number; ratingAvg: number | null; sold: number | null } {
  const total = typeof b.productCount === 'number' && Number.isFinite(b.productCount) ? b.productCount : b.products.length;
  if (total > b.products.length) return { productCount: total, ratingAvg: null, sold: null };
  return { productCount: total, ...rollUp(b.products) };
}

/** Ô "người theo dõi" của thương hiệu (gian hàng CTV không có theo dõi). */
export function followerStat(n: number | null | undefined): ShopStat | null {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v < 1) return null;
  return { label: fillCopy('stats.followers'), value: formatVnNumber(v), spoken: fillCopy('stats.followersSpoken', { n: formatVnNumber(v) }) };
}

/** Khuyến mãi của thương hiệu thành phiếu `VoucherTicket variant="chip"`: có mã thì sao chép được, không mã chỉ là thông tin. */
export function promotionVoucher(p: { id: string; title: string; subtitle?: string | null; couponCode?: string | null; endAt: string }, now: number): VoucherView {
  const end = Date.parse(p.endAt);
  return {
    id: p.id,
    code: p.couponCode ?? '',
    title: p.title,
    kind: 'shop',
    condition: p.subtitle ?? '',
    expiry: expiryText(Number.isNaN(end) ? null : end, now),
    state: p.couponCode ? 'collectable' : 'saved',
  };
}

/** Dãy số của thanh phân trang: trang đầu, cuối, trang hiện tại ±1; khoảng hở đúng một trang thì in số thay vì dấu …. */
export function pageWindow(page: number, pages: number): (number | '…')[] {
  if (!Number.isFinite(pages) || pages < 1) return [];
  const last = Math.floor(pages);
  const cur = Math.min(Math.max(1, Math.floor(page)), last);
  const keep = new Set<number>([1, last, cur - 1, cur, cur + 1]);
  if (cur <= 2) [1, 2, 3].forEach((n) => keep.add(n));
  if (cur >= last - 1) [last - 2, last - 1, last].forEach((n) => keep.add(n));
  const nums = [...keep].filter((n) => n >= 1 && n <= last).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  nums.forEach((n, i) => {
    const prev = nums[i - 1];
    if (prev !== undefined && n - prev === 2) out.push(prev + 1);
    else if (prev !== undefined && n - prev > 2) out.push('…');
    out.push(n);
  });
  return out;
}
