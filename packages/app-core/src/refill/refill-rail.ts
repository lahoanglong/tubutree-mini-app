import type { QuickReorderItem } from '../commerce/quick-reorder';
import type { RefillPairsDTO } from './refill-api';

/** Ô của dải "Mua lại món quen" đã đổi sang gói Refill; `bottle` là ô chai gốc (để mở "Mua lại đúng món cũ" và để báo sự kiện). */
export type RefillQuickItem = QuickReorderItem & { bottle?: QuickReorderItem };

/**
 * Ô chai khách đã có (máy chủ đã lọc theo đơn đã giao) thay bằng gói Refill còn hàng, giá đầy đủ của gói (THUẦN). Gói refill đã là một ô
 * khác của dải, hoặc đã thay cho một chai khác, thì giữ ô chai như cũ: một món không xuất hiện hai lần. Không có cặp thì trả nguyên dải.
 */
export function refillQuickItems(items: readonly QuickReorderItem[], pairs: RefillPairsDTO | null | undefined): RefillQuickItem[] {
  if (!pairs) return [...items];
  const taken = new Set(items.map((i) => i.productId));
  return items.map((item) => {
    const o = pairs[item.productId];
    if (!o || !o.inStock || taken.has(o.productId)) return item;
    taken.add(o.productId);
    return {
      ...item,
      key: `refill:${item.key}`,
      productId: o.productId,
      slug: o.slug,
      variationId: o.variationId,
      name: o.name,
      thumbnail: o.thumbnail,
      price: o.price,
      compareAt: o.compareAt,
      savePct: 0,
      isFlash: false,
      timesBought: 0,
      bottle: item,
    };
  });
}
