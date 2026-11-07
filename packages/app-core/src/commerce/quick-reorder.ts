import type { ProductCard } from '../api/catalog';
import type { PurchasedItem } from '../api/orders';
import { cardPricing, isFlashRunning, type FlashPriceItem } from '../flash-price';
import { rebuyPricing } from '../rebuy-pricing';
import { serverNow } from '../server-clock';

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
  now?: number;
  limit?: number;
}

const available = (p: PurchasedItem) => p.inStock !== false && p.stock > 0;

function fromPurchased(p: PurchasedItem, flash: readonly FlashPriceItem[], now: number): QuickReorderItem {
  // Hết suất Giờ vàng (`flashAllowance` = 0): giỏ tính giá thường, nên thẻ cũng không được ghi giá Giờ vàng.
  const live = p.flashAllowance === 0 ? [] : flash;
  const pricing = rebuyPricing(p, live, now);
  return {
    key: p.variationId,
    productId: p.productId,
    slug: p.slug,
    variationId: p.variationId,
    name: p.variationName ? `${p.productName} · ${p.variationName}` : p.productName,
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
  const pricing = cardPricing(c, flash, now);
  // Cùng luật với nút thêm nhanh của thẻ: món ghim thêm phân loại ghim, Giờ vàng thắng thì thêm phân loại của suất đó, còn lại là phân loại đại diện.
  const variationId = c.pinnedVariationId ?? pricing.flashVariationId ?? c.repVariationId;
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
    for (const p of bought) if (available(p)) push(fromPurchased(p, flash, now));
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
