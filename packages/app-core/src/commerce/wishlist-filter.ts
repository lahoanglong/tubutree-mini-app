import type { ProductCard } from '../api/catalog';
import type { MyRestockAlerts } from '../api/restock-alerts';
import { cardPricing, type FlashPriceItem } from '../flash-price';
import { serverNow } from '../server-clock';
import { fillCopy } from '../shop-copy';

/**
 * Dải lọc nhanh của trang Sản phẩm yêu thích (Mini App và web cùng gọi `wishlistFilterView`): số trên chip, danh sách sau lọc và
 * lời báo khi lọc ra rỗng không được lệch giữa hai nền tảng.
 *
 * "Đang giảm" là món mà thẻ đang vẽ giá giảm: giá khuyến mãi của chính sản phẩm HOẶC suất Giờ vàng đang chạy thắng trên thẻ. Cùng một hàm với thẻ
 * (`cardPricing`: giá gạch, hết hạn theo `endAt`, suất rẻ hơn giá đang bán, phân loại CTV ghim), nên một thẻ gạch giá thì luôn nằm trong "Đang giảm" và
 * ngược lại; giá khuyến mãi hỏng hoặc không thấp hơn giá gốc không được đếm. Nơi gọi truyền danh sách Giờ vàng và mốc giờ MÀ THẺ ĐANG DÙNG (cùng khoá
 * `flash-sales/active`, cùng đồng hồ), không truyền thì chỉ xét giá khuyến mãi.
 * "Còn hàng" là `inStock !== false`: API cũ chưa trả cờ thì coi là còn, cùng luật với nút giỏ nhanh.
 * "Chờ hàng về" là đúng các thẻ mang nhãn "Đang chờ hàng về" (`wishlistRestockView` kind `waiting`): hết hàng VÀ khách có đăng ký đang chờ cho
 * một phân loại của sản phẩm. Chip này chỉ có khi đếm được ít nhất một món; đang chọn mà số về 0 (vừa huỷ món cuối) thì lọc về Tất cả.
 */

export type WishlistFilterKey = 'all' | 'sale' | 'inStock' | 'restock';

export type WishlistFilterItem = Pick<ProductCard, 'id' | 'slug' | 'basePrice' | 'salePrice' | 'inStock' | 'repVariationId' | 'pinnedVariationId'>;

export interface WishlistFilterChip {
  key: WishlistFilterKey;
  label: string;
  count: number;
  selected: boolean;
}

export interface WishlistFilterEmpty {
  /** Câu báo lọc ra rỗng, đặt làm tiêu đề trạng thái rỗng. */
  message: string;
  ctaLabel: string;
}

export interface WishlistFilterView<T extends WishlistFilterItem> {
  /** Bộ lọc thật sự áp dụng: khác bộ lọc nơi gọi giữ khi chip "Chờ hàng về" vừa mất (nơi gọi đặt lại state theo số này). */
  active: WishlistFilterKey;
  groupAria: string;
  chips: WishlistFilterChip[];
  /** Danh sách sau lọc, giữ nguyên thứ tự gốc. */
  items: T[];
  /** Có khi danh sách gốc còn món nhưng bộ lọc đang chọn không khớp món nào; danh sách gốc rỗng thì null (trang có trạng thái rỗng riêng). */
  empty: WishlistFilterEmpty | null;
}

const ORDER: readonly WishlistFilterKey[] = ['all', 'sale', 'inStock', 'restock'];
const NO_WATCH: ReadonlyMap<string, readonly string[]> = new Map();

export function isOnSale(
  p: Pick<ProductCard, 'slug' | 'basePrice' | 'salePrice' | 'repVariationId' | 'pinnedVariationId'>,
  allFlash: readonly FlashPriceItem[] = [],
  now: number = serverNow(),
): boolean {
  const pricing = cardPricing(p, allFlash, now);
  // `isFlash` riêng: suất Giờ vàng thắng mà giá 0 không gạch được thì thẻ vẫn mang nhãn Giờ vàng.
  return pricing.isFlash || pricing.compareAt !== null;
}

export function isInStock(p: Pick<ProductCard, 'inStock'>): boolean {
  return p.inStock !== false;
}

/**
 * `watch` là chỉ mục sản phẩm → phân loại đang chờ (`restockWatchIndex`); không truyền (cờ tắt, chưa tải, lỗi) thì không có chip "Chờ hàng về".
 */
export function wishlistFilterView<T extends WishlistFilterItem>(
  items: readonly T[],
  requested: WishlistFilterKey,
  allFlash: readonly FlashPriceItem[] = [],
  now: number = serverNow(),
  watch: ReadonlyMap<string, readonly string[]> = NO_WATCH,
): WishlistFilterView<T> {
  const match: Record<WishlistFilterKey, (p: WishlistFilterItem) => boolean> = {
    all: () => true,
    sale: (p) => isOnSale(p, allFlash, now),
    inStock: isInStock,
    restock: (p) => !isInStock(p) && (watch.get(p.id)?.length ?? 0) > 0,
  };
  const counts = Object.fromEntries(ORDER.map((key) => [key, items.filter(match[key]).length])) as Record<WishlistFilterKey, number>;
  const active: WishlistFilterKey = requested === 'restock' && counts.restock === 0 ? 'all' : requested;
  const shown = items.filter(match[active]);
  return {
    active,
    groupAria: fillCopy('wishlist.filter.groupAria'),
    chips: ORDER.filter((key) => key !== 'restock' || counts.restock > 0).map((key) => ({
      key,
      label: fillCopy(`wishlist.filter.${key}`),
      count: counts[key],
      selected: key === active,
    })),
    items: shown,
    empty:
      items.length > 0 && shown.length === 0 && active !== 'all'
        ? { message: fillCopy(`wishlist.empty.${active}`), ctaLabel: fillCopy('wishlist.empty.cta') }
        : null,
  };
}

/** Sản phẩm → các phân loại khách đang chờ hàng về, giữ thứ tự đăng ký. Cờ tắt hay chưa có dữ liệu thì rỗng. */
export function restockWatchIndex(alerts: MyRestockAlerts | undefined): ReadonlyMap<string, readonly string[]> {
  if (!alerts?.enabled) return NO_WATCH;
  const out = new Map<string, string[]>();
  for (const a of alerts.items) {
    const ids = out.get(a.productId);
    if (ids) ids.push(a.variationId);
    else out.set(a.productId, [a.variationId]);
  }
  return out;
}

export type WishlistRestockView =
  /** Không có chuông: còn hàng (nút giỏ nhanh lo), tính năng tắt, chưa tải xong, hoặc thẻ không mang phân loại nào để đăng ký. */
  | { kind: 'none' }
  /** Hết hàng, chưa đăng ký: chạm chuông là đăng ký báo hàng về cho phân loại của thẻ. */
  | { kind: 'subscribe'; variationId: string }
  /** Đang chờ hàng về (nhãn "Đang chờ hàng về"): chạm chuông là huỷ mọi phân loại đang chờ của sản phẩm. */
  | { kind: 'waiting'; variationIds: readonly string[] };

/**
 * Chuông "Báo tôi khi có hàng" trên thẻ hết hàng của trang Yêu thích (Mini App và web cùng gọi). Thẻ không biết từng phân loại nên đăng ký
 * phân loại ghim (CTV) hoặc phân loại đại diện của thẻ, đúng phân loại trang chi tiết mở sẵn khi khách chạm thẻ; trang chi tiết vẫn chọn được
 * phân loại khác. Đang chờ thì chạm là huỷ hết các phân loại đang chờ của sản phẩm (kể cả phân loại đăng ký ở trang chi tiết), để nhãn tắt
 * ngay sau một chạm.
 */
export function wishlistRestockView(
  p: Pick<ProductCard, 'id' | 'inStock' | 'repVariationId' | 'pinnedVariationId'>,
  alerts: MyRestockAlerts | undefined,
  watch: ReadonlyMap<string, readonly string[]> = restockWatchIndex(alerts),
): WishlistRestockView {
  if (!alerts?.enabled || isInStock(p)) return { kind: 'none' };
  const waiting = watch.get(p.id);
  if (waiting && waiting.length > 0) return { kind: 'waiting', variationIds: waiting };
  const variationId = p.pinnedVariationId ?? p.repVariationId;
  return variationId ? { kind: 'subscribe', variationId } : { kind: 'none' };
}

/**
 * Danh sách đăng ký sau một lần chạm chuông, để vẽ ngay trước khi máy chủ trả lời (lỗi thì nơi gọi trả bản cũ). Đăng ký thêm một dòng cho
 * sản phẩm; huỷ bỏ mọi dòng của các phân loại vừa huỷ.
 */
export function applyRestockToggle(
  alerts: MyRestockAlerts,
  productId: string,
  view: Exclude<WishlistRestockView, { kind: 'none' }>,
  now: number = serverNow(),
): MyRestockAlerts {
  if (view.kind === 'waiting') return { ...alerts, items: alerts.items.filter((a) => !view.variationIds.includes(a.variationId)) };
  if (alerts.items.some((a) => a.variationId === view.variationId)) return alerts;
  const optimistic = { variationId: view.variationId, productId, productSlug: '', productName: '', variationName: '', stock: 0, createdAt: new Date(now).toISOString() };
  return { ...alerts, items: [...alerts.items, optimistic] };
}
