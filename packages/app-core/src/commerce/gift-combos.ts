import type { GiftLanding } from '../api/bundle';
import { fillCopy } from '../shop-copy';
import { comboView, type ComboView } from './bundle-view';
import { vnd } from './money';

/**
 * Trang Bộ quà tặng & combo khởi đầu (web `/bo-qua-tang`, Mini App `/gift-combos`). Mọi con số đến từ `GET /bundles/gift-landing`: giá combo từ
 * giá thật của món (giỏ vẫn tính lại), mốc Miễn phí giao hàng và mốc quà dùng thử từ cấu hình máy chủ. Hai app chỉ vẽ.
 */

/** Trần số combo của trang, khớp `HOME_COMBOS_MAX` ở API. */
export const GIFT_COMBOS_MAX = 8;

/**
 * Combo vẽ được (`comboView`): bỏ bộ hết hạn theo giờ máy chủ, không giảm, thiếu phân loại. `liveAt` như `comboView` (mặc định `now`); trang web
 * truyền `now` là giờ dựng HTML ở lượt hydrate đầu để khớp HTML máy chủ và JSON-LD.
 */
export function giftCombosViews(landing: GiftLanding | null | undefined, now: number, liveAt: number = now): ComboView[] {
  if (!landing) return [];
  return landing.combos.flatMap((b) => comboView(b, now, liveAt) ?? []).slice(0, GIFT_COMBOS_MAX);
}

export interface GiftCombosCallout {
  kind: 'freeship' | 'gift';
  text: string;
}

const money = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** Hai mốc kèm đơn: Miễn phí giao hàng rồi quà dùng thử 0đ. Mốc thiếu hay hỏng thì bỏ dòng đó, không hứa thứ máy chủ không cho. */
export function giftCombosCallouts(landing: Pick<GiftLanding, 'freeshipThreshold' | 'giftTrialMinOrder'> | null | undefined): GiftCombosCallout[] {
  const out: GiftCombosCallout[] = [];
  if (money(landing?.freeshipThreshold)) out.push({ kind: 'freeship', text: fillCopy('giftCombos.freeship', { amount: vnd(landing.freeshipThreshold) }) });
  if (money(landing?.giftTrialMinOrder)) out.push({ kind: 'gift', text: fillCopy('giftCombos.gift', { amount: vnd(landing.giftTrialMinOrder) }) });
  return out;
}

/** Món của các combo đang vẽ, mỗi slug một lần theo thứ tự trên trang: danh sách `ItemList` của JSON-LD trỏ tới trang sản phẩm thật. */
export function giftCombosProducts(views: readonly ComboView[]): { slug: string; name: string }[] {
  const seen = new Set<string>();
  const out: { slug: string; name: string }[] = [];
  for (const v of views) {
    for (const it of v.items) {
      if (!it.slug || seen.has(it.slug)) continue;
      seen.add(it.slug);
      out.push({ slug: it.slug, name: it.name });
    }
  }
  return out;
}
