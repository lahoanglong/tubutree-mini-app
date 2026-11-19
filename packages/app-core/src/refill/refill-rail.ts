import type { QuickReorderItem } from '../commerce/quick-reorder';
import { parseNetAmount } from '../commerce/unit-price';
import { vnd } from '../commerce/money';
import { fillCopy } from '../shop-copy';
import type { RefillOfferDTO, RefillPairsDTO } from './refill-api';

/** Ô của dải "Mua lại món quen" đã đổi sang gói Refill; `bottle` là ô chai gốc (để mở "Mua lại đúng món cũ" và để báo sự kiện). */
export type RefillQuickItem = QuickReorderItem & { bottle?: QuickReorderItem };

/**
 * Phần trăm gói Refill rẻ hơn chai tính trên cùng lượng (mỗi 100ml/100g), làm tròn xuống để không nói quá; null khi một bên không đọc
 * được lượng, khác chiều (ml với g), hay rẻ hơn dưới 1%.
 */
export function refillUnitSaving(bottle: Pick<QuickReorderItem, 'name' | 'price'>, offer: Pick<RefillOfferDTO, 'name' | 'sizeLabel' | 'price'>): { pct: number; per: string } | null {
  const b = parseNetAmount(bottle.name, '');
  const r = parseNetAmount(offer.sizeLabel ?? '', offer.name);
  if (!b || !r || b.unit !== r.unit || !(bottle.price > 0) || !(offer.price > 0)) return null;
  const pct = Math.floor((1 - offer.price / r.qty / (bottle.price / b.qty)) * 100 + 1e-9);
  return pct >= 1 ? { pct, per: b.unit === 'ml' || b.unit === 'g' ? `100${b.unit}` : b.unit } : null;
}

/**
 * Ô chai khách đã có (máy chủ đã lọc theo đơn đã giao) thay bằng gói Refill còn hàng, giá đầy đủ của gói (THUẦN). Ô đổi luôn mang nhãn
 * "Đổi sang túi Refill <dung tích>" trên ảnh, nút "+ Thêm Refill" và câu đọc nêu chai cũ, giá và mức rẻ hơn mỗi 100ml: khách thấy rõ
 * món sẽ vào giỏ trước khi chạm (kể cả "Thêm lại tất cả", vốn chỉ thêm đúng các ô đang hiện). Gói refill đã là một ô khác của dải, hoặc
 * đã thay cho một chai khác, thì giữ ô chai như cũ: một món không xuất hiện hai lần. Không có cặp thì trả nguyên dải.
 */
export function refillQuickItems(items: readonly QuickReorderItem[], pairs: RefillPairsDTO | null | undefined): RefillQuickItem[] {
  if (!pairs) return [...items];
  const taken = new Set(items.map((i) => i.productId));
  return items.map((item) => {
    const o = pairs[item.productId];
    if (!o || !o.inStock || taken.has(o.productId)) return item;
    taken.add(o.productId);
    const size = o.sizeLabel ? ` ${o.sizeLabel}` : '';
    const saving = refillUnitSaving(item, o);
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
      badge: fillCopy('refill.railBadge', { size }),
      addLabel: fillCopy('refill.railAdd'),
      addAria: fillCopy('refill.railAddAria', {
        size,
        bottle: item.name,
        price: vnd(o.price),
        save: saving ? fillCopy('refill.railSave', { pct: saving.pct, per: saving.per }) : '',
      }),
      bottle: item,
    };
  });
}
