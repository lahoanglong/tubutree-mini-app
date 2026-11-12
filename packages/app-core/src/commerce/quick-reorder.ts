import type { ProductCard } from '../api/catalog';
import type { PurchasedItem } from '../api/orders';
import { isFlashRunning, type FlashPriceItem } from '../flash-price';
import { rebuyPricing } from '../rebuy-pricing';
import { serverNow } from '../server-clock';
import { joinVariationLine, variationLabel } from '../variation-label';
import { addOneCardPricing } from './add-one-pricing';
import { variationLinePreview } from './flash-line';

/**
 * Dải "Mua lại món quen" ở Trang chủ: món khách đã nhận hàng (hoặc, khi chưa có đơn nào, món vừa xem) dưới dạng thẻ thêm một chạm.
 * Mini App và web cùng gọi hàm này: giá, thứ tự và món bị loại không được lệch giữa hai nền tảng.
 */

/** Trần số món của dải (kệ `home.purchased`) và sàn: dưới sàn dải ẩn hẳn, một món thì trang vẫn vẽ dòng Mua lại cũ. */
export const QUICK_REORDER_MAX = 6;
export const QUICK_REORDER_MIN = 2;

export interface QuickReorderItem {
  /** Khoá dòng: phân loại sẽ vào giỏ (một sản phẩm đã mua hai phân loại là hai thẻ). */
  key: string;
  productId: string;
  slug: string;
  variationId: string;
  /** Tên sản phẩm kèm phân loại khi biết ("Dầu gội · 500ml"). */
  name: string;
  thumbnail: string | null;
  /** Giá khách trả cho một đơn vị: Giờ vàng đang chạy thắng khi rẻ hơn giá bán. */
  price: number;
  compareAt: number | null;
  /** Phần trăm tiết kiệm so với giá gạch; 0 khi không giảm. */
  savePct: number;
  isFlash: boolean;
  /** Số lần đã đặt; 0 với món chỉ mới xem. */
  timesBought: number;
  source: 'purchased' | 'viewed';
}

export interface QuickReorderParams {
  /** Món đã mua, mới nhất trước (`GET /me/purchased-items`). */
  purchased?: readonly PurchasedItem[];
  /** Thẻ món vừa xem, mới nhất trước, giá đã hỏi theo slug; chỉ dùng khi khách chưa có món đã mua nào. */
  viewed?: readonly ProductCard[];
  /** Giờ vàng đang chạy (`/flash-sales/active`). */
  flash?: readonly FlashPriceItem[];
  /** Phân loại đã nằm ở kệ xếp trên (Giờ vàng): không lặp lại. */
  excludeVariationIds?: ReadonlySet<string>;
  /** Số đang có trong giỏ theo phân loại (`cartUnitsByVariation`): giỏ so suất Giờ vàng với cả dòng, nên thẻ chỉ ghi giá Giờ vàng khi thêm 1 nữa vẫn trong suất. Chưa tải giỏ: bỏ trống. */
  cartUnits?: ReadonlyMap<string, number>;
  now?: number;
  limit?: number;
}

/**
 * Món đủ điều kiện lên dải: còn hàng và có giá. Chống trùng của Trang chủ (`use-home-shelves`) lọc bằng đúng vị từ này trước khi chiếm món, để tập món dải vẽ
 * và tập món kệ giữ là một: lọc khác nhau thì có món bị chiếm mà không ai vẽ (biến khỏi mọi kệ), hoặc được vẽ mà không ai chiếm (lặp ở kệ dưới).
 */
export function quickReorderAvailable(p: PurchasedItem): boolean {
  return p.inStock !== false && p.stock > 0 && (p.salePrice ?? p.price) > 0;
}

/**
 * Món kệ `home.purchased` của Trang chủ chiếm và vẽ. Đủ `QUICK_REORDER_MIN` món dùng được thì dải "Mua lại món quen" chỉ vẽ món dùng được, nên kệ chỉ giữ chúng;
 * ít hơn thì dải ẩn và kệ cũ (một dòng / thẻ) vẽ đủ, kể cả món hết hàng (ghi "Tạm hết hàng"). Chống trùng của Trang chủ (`use-home-shelves`) và kệ (`PurchasedRail`)
 * cùng gọi hàm này để tập món bị chiếm và tập món được vẽ là một: lệch thì có món biến khỏi mọi kệ, hoặc lặp ở kệ dưới. Chưa cắt trần (kệ cắt `QUICK_REORDER_MAX`).
 */
export function quickReorderShelfItems<T extends PurchasedItem>(items: readonly T[]): T[] {
  const usable = items.filter(quickReorderAvailable);
  return usable.length >= QUICK_REORDER_MIN ? usable : [...items];
}

function fromPurchased(p: PurchasedItem, flash: readonly FlashPriceItem[], now: number, inCart: number): QuickReorderItem {
  // Giá Giờ vàng chỉ khi suất còn chạy VÀ thêm 1 nữa vẫn trong suất khách còn mua được (API: `flashAllowance`; danh sách Giờ vàng: giới hạn mỗi khách, suất còn lại của đợt).
  // Vượt thì giỏ tính cả dòng giá thường (cả phần đã có trong giỏ), nên thẻ cũng ghi giá thường.
  const running = flash.filter((f) => f.variationId === p.variationId);
  const apiBlocked = p.flashAllowance != null && 1 + inCart > p.flashAllowance;
  const overLimit = variationLinePreview({ id: p.variationId, retailPrice: p.price, salePrice: p.salePrice }, running, 1, inCart).overLimit;
  const pricing = rebuyPricing(p, apiBlocked || overLimit ? [] : running, now);
  return {
    key: p.variationId,
    productId: p.productId,
    slug: p.slug,
    variationId: p.variationId,
    name: joinVariationLine(p.productName, variationLabel(p.variationName)),
    thumbnail: p.thumbnail,
    price: pricing.price,
    compareAt: pricing.compareAt,
    savePct: pricing.salePct,
    isFlash: pricing.isFlash,
    timesBought: p.timesBought,
    source: 'purchased',
  };
}

function fromViewed(c: ProductCard, flash: readonly FlashPriceItem[], now: number): QuickReorderItem | null {
  const pricing = addOneCardPricing(c, flash, now);
  // Cùng luật với nút thêm nhanh của thẻ: món ghim thêm phân loại ghim, Giờ vàng thắng thì thêm phân loại của suất đó, còn lại là phân loại đại diện.
  const variationId = pricing.variationId;
  if (!variationId || !c.inStock) return null;
  return {
    key: variationId,
    productId: c.id,
    slug: c.slug,
    variationId,
    name: c.name,
    thumbnail: c.thumbnail,
    price: pricing.price,
    compareAt: pricing.compareAt,
    savePct: pricing.salePct,
    isFlash: pricing.isFlash,
    timesBought: 0,
    source: 'viewed',
  };
}

/**
 * Tối đa `limit` (mặc định 6) món còn hàng để thêm lại một chạm. Thứ tự là thứ tự nguồn (mới nhất trước). Món đã mua có trước: chỉ khi khách chưa có món đã mua nào
 * (kể cả toàn món hết hàng thì vẫn là khách cũ, dải ẩn chứ không đổi sang món vừa xem) mới dùng món vừa xem. Loại món hết hàng, món không có phân loại để thêm,
 * phân loại trong `excludeVariationIds` và phân loại lặp. Dưới `QUICK_REORDER_MIN` món thì trả rỗng.
 */
export function buildQuickReorderItems(params: QuickReorderParams): QuickReorderItem[] {
  const now = params.now ?? serverNow();
  const flash = (params.flash ?? []).filter((f) => isFlashRunning(f, now));
  const limit = Math.max(0, Math.min(params.limit ?? QUICK_REORDER_MAX, QUICK_REORDER_MAX));
  const seen = new Set<string>(params.excludeVariationIds ?? []);
  const out: QuickReorderItem[] = [];
  const push = (item: QuickReorderItem | null) => {
    if (!item || seen.has(item.variationId) || !(item.price > 0)) return;
    seen.add(item.variationId);
    out.push(item);
  };
  const bought = params.purchased ?? [];
  if (bought.length > 0) {
    for (const p of bought) if (quickReorderAvailable(p)) push(fromPurchased(p, flash, now, params.cartUnits?.get(p.variationId) ?? 0));
  } else {
    for (const c of params.viewed ?? []) push(fromViewed(c, flash, now));
  }
  const picked = out.slice(0, limit);
  return picked.length >= QUICK_REORDER_MIN ? picked : [];
}

/** Dòng giỏ của "Thêm lại tất cả": mỗi món một đơn vị. */
export function quickReorderLines(items: readonly QuickReorderItem[]): { variationId: string; quantity: number }[] {
  return items.map((i) => ({ variationId: i.variationId, quantity: 1 }));
}

/** Tổng tiền khách trả khi thêm lại cả dải (mỗi món một đơn vị, giá đang hiện). */
export function quickReorderTotal(items: readonly QuickReorderItem[]): number {
  return items.reduce((sum, i) => sum + i.price, 0);
}
