import type { GiftComboDTO, GiftLanding } from '../api/bundle';
import type { GiftTrialSummaryDTO } from '@tubutree/shared-types';
import { fillTemplate } from '../copy-template';
import { fillCopy } from '../shop-copy';
import { comboView, type ComboView } from './bundle-view';
import { cartGiftThreshold, computeCartThresholdProgress } from './cart-progress';
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
  return landing.combos.flatMap((b) => withServerSaving(comboView(b, now, liveAt), b.saving)).slice(0, GIFT_COMBOS_MAX);
}

/**
 * Giá cả bộ theo số máy chủ (`GiftComboDTO.saving`, cùng hàm giỏ trừ) thay cho phép tính ở máy khách, nên "Tiết kiệm Xđ" của thẻ bằng đúng số giỏ
 * trừ. Máy chủ báo 0 thì bỏ bộ (không quảng cáo "mua cả bộ" mà giỏ không giảm). Số bị kẹp thấp hơn mức % (trần tiền của bộ nhân viên tạo) thì nhãn
 * "Combo -n%" đổi theo mức thật, làm tròn xuống, và bộ mang `clamped` (không chia được giá từng món). API cũ (thiếu số hay số hỏng) thì giữ phép
 * tính ở máy khách.
 */
function withServerSaving(v: ComboView | null, saving: GiftComboDTO['saving']): ComboView[] {
  if (!v) return [];
  if (typeof saving !== 'number' || !Number.isInteger(saving)) return [v];
  if (saving <= 0) return [];
  const save = Math.min(saving, v.total);
  const clientSave = v.total - v.comboTotal;
  const pct = save < clientSave && v.total > 0 ? Math.floor((save * 100) / v.total) : v.pct;
  return [{ ...v, pct, comboTotal: v.total - save, ...(save !== clientSave ? { clamped: true as const } : {}) }];
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

/**
 * Chữ riêng của trang Bộ quà tặng (như `CART_PROGRESS_COPY`): chỉ trang này nạp module, nên không vào gói khởi động. `gift-combos.spec.ts` chạy
 * thuật ngữ cấm và `GIFT_COMBOS_COPY_MAX` trên từng khoá.
 */
export const GIFT_COMBOS_COPY = {
  cueAllReached: '🎉 Đơn đã được Miễn phí giao hàng và đủ mốc quà dùng thử 0đ',
} as const;

export type GiftCombosCopyKey = keyof typeof GIFT_COMBOS_COPY;

/** Số ký tự tối đa khi điền giá trị xấu nhất: câu nằm gọn hai dòng dưới thẻ combo ở khổ 375. */
export const GIFT_COMBOS_COPY_MAX: Record<GiftCombosCopyKey, number> = {
  cueAllReached: 64,
};

export function giftCombosCopy(key: GiftCombosCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(GIFT_COMBOS_COPY[key], vars, key);
}

export interface GiftCombosCue {
  /** Mốc kế tiếp còn thiếu (`freeship`, `gift`), hay `done` khi giỏ đã đạt mọi mốc. */
  kind: 'freeship' | 'gift' | 'done';
  text: string;
}

/** Phần giỏ `comboAddedCue` đọc: dạng tối thiểu để giỏ của app-core và kiểu giỏ riêng của Mini App cùng truyền vào được. */
export interface CueCart {
  items: readonly { stock: number; total: number; fulfiller?: { kind: string } | null }[];
  freeship: boolean;
  freeshipThreshold: number;
  giftTrial?: GiftTrialSummaryDTO | null;
}

/**
 * Câu mốc ngay sau "Thêm cả combo" (THUẦN), đọc từ giỏ máy chủ trả về sau lệnh thêm: còn thiếu bao nhiêu tới Miễn phí giao hàng, rồi tới quà dùng thử
 * 0đ. Cùng cách tính với dải mốc đầu Giỏ khi chọn cả giỏ (`computeCartThresholdProgress`): bỏ dòng hết hàng, giỏ có hàng gian hàng tự giao thì chỉ tính
 * phần Tubu Tree giao, cờ `freeship` của máy chủ chỉ tin khi không có hai trường hợp đó. Giỏ hỏng hay thiếu ngưỡng thì null (không nói gì).
 */
export function comboAddedCue(cart: CueCart | null | undefined): GiftCombosCue | null {
  if (!cart || !Array.isArray(cart.items) || typeof cart.freeshipThreshold !== 'number' || !Number.isFinite(cart.freeshipThreshold)) return null;
  const hasMerchant = cart.items.some((l) => l.fulfiller?.kind === 'MERCHANT');
  const buyable = cart.items.filter((l) => l.stock > 0);
  const base = buyable.reduce((s, l) => s + (!hasMerchant || (l.fulfiller?.kind ?? 'TUBU') === 'TUBU' ? l.total : 0), 0);
  const serverFreeship = !hasMerchant && cart.freeship === true && buyable.length === cart.items.length;
  const p = computeCartThresholdProgress(base, { freeshipThreshold: cart.freeshipThreshold, giftThreshold: cartGiftThreshold(cart.giftTrial), serverFreeship, tubuOnly: hasMerchant });
  if (p.next === 'freeship') return { kind: 'freeship', text: p.headline };
  if (p.next === 'gift' && p.gift) return { kind: 'gift', text: fillCopy('giftTrial.locked', { amount: vnd(p.gift.remaining) }) };
  // Câu chung hai mốc nói "Đơn": giỏ có hàng gian hàng tự giao thì phần đó không được miễn phí giao, nên dùng câu riêng phần Tubu Tree giao.
  return { kind: 'done', text: p.gift && !hasMerchant ? giftCombosCopy('cueAllReached') : p.headline };
}
