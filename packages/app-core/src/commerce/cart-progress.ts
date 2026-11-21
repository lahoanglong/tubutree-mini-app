import type { GiftTrialSummaryDTO } from '@tubutree/shared-types';
import { fillTemplate } from '../copy-template';
import { fillCopy } from '../shop-copy';
import { freeshipProgress } from './freeship-progress';
import { vnd } from './money';

/**
 * Thanh hai mốc ở đầu Giỏ (Miễn phí giao hàng rồi Quà dùng thử) và phép so túi/can Refill với chai ở trang chi tiết, dùng chung Mini App
 * và web (THUẦN). Hai mốc luôn đọc từ dữ liệu máy chủ (`freeshipThreshold` của giỏ, `giftTrial.minOrder`), không ghi cứng.
 *
 * Chữ riêng của module ở đây (như `REFILL_SAVING_COPY`), không ở `shop-copy.ts`: chỉ Giỏ và trang chi tiết nạp module này, nên chữ không
 * vào gói khởi động của Trang chủ.
 */
export const CART_PROGRESS_COPY = {
  freeshipMark: '{amount} Miễn phí giao hàng',
  giftMark: '{amount} Quà dùng thử',
  barAria: 'Đã đạt {pct}% chặng tới Quà dùng thử, mốc Miễn phí giao hàng ở {mark}',
} as const;

export type CartProgressCopyKey = keyof typeof CART_PROGRESS_COPY;

/** Trần độ dài sau khi điền số: nhãn mốc phải nằm một dòng dưới thanh ở khổ 375 (hai nhãn cạnh nhau). */
export const CART_PROGRESS_COPY_MAX: Record<CartProgressCopyKey, number> = {
  freeshipMark: 32,
  giftMark: 26,
  barAria: 90,
};

export function cartProgressCopy(key: CartProgressCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(CART_PROGRESS_COPY[key], vars, key);
}

export type CartMilestoneKind = 'freeship' | 'gift';

export interface CartThresholdMilestone {
  kind: CartMilestoneKind;
  /** Mốc (đồng). */
  threshold: number;
  reached: boolean;
  /** Số còn thiếu (đồng), 0 khi đã đạt. */
  remaining: number;
  /** Vị trí vạch mốc trên thanh (0–100, một chữ số lẻ, làm tròn xuống để vạch không đứng trước chỗ thật). Mốc cuối luôn 100. */
  at: number;
  /** "199.000đ Miễn phí giao hàng". */
  label: string;
}

export interface CartThresholdProgress {
  /** Độ đầy của cả thanh (0–100) tính tới mốc cuối; chỉ 100 khi đạt hết, chưa đạt thì tối đa 99. */
  pct: number;
  freeship: CartThresholdMilestone;
  /** Null khi không có mốc quà (một mốc như `freeshipProgress`). */
  gift: CartThresholdMilestone | null;
  /** Mốc kế tiếp chưa đạt; null khi đã đạt hết. */
  next: CartMilestoneKind | null;
  /** Đạt hết: khối co về dòng chúc mừng, không còn thanh. */
  done: boolean;
  /**
   * Dòng đầu khối. Chưa Miễn phí giao hàng: "Mua thêm {số} để được Miễn phí giao hàng". Đạt rồi: câu chúc mừng, KHÔNG nói số còn thiếu tới
   * quà, vì dải mua thêm (`aovUpsellGoal`) hoặc ô quà khoá đã nói số đó và một màn không nói một tin hai lần.
   */
  headline: string;
  /** Nhãn đọc của thanh. */
  barAria: string;
}

export interface CartThresholdOptions {
  freeshipThreshold: number;
  /** Mốc quà (`cartGiftThreshold`); thiếu, không hữu hạn hay không cao hơn mốc giao hàng thì thanh một mốc. */
  giftThreshold?: number | null;
  /** Cờ `freeship` của máy chủ, chỉ truyền khi tin được (xem `freeshipProgress`). */
  serverFreeship?: boolean;
  /** Giỏ có hàng gian hàng tự giao: câu nói rõ chỉ tính phần hàng Tubu Tree giao. */
  tubuOnly?: boolean;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Tiến độ hai mốc của Giỏ (THUẦN). `subtotal` là tiền hàng đang chọn tính mốc (phần Tubu Tree giao, không gồm dòng hết hàng), cùng số
 * với `freeshipProgress` và với `giftTrialBase` của máy chủ. Không có mốc quà thì mọi số trùng `freeshipProgress`.
 */
export function computeCartThresholdProgress(subtotal: number, opts: CartThresholdOptions): CartThresholdProgress {
  const base = Math.max(0, finite(subtotal) ? subtotal : 0);
  const ship = freeshipProgress({ base, threshold: opts.freeshipThreshold, serverReached: opts.serverFreeship });
  const shipThreshold = finite(opts.freeshipThreshold) ? Math.max(0, opts.freeshipThreshold) : 0;
  const giftThreshold = shipThreshold > 0 && finite(opts.giftThreshold) && opts.giftThreshold > shipThreshold ? opts.giftThreshold : null;
  const tubu = opts.tubuOnly === true;
  const headline = ship.reached
    ? fillCopy(tubu ? 'freeship.reachedTubu' : 'freeship.reached')
    : fillCopy(tubu ? 'freeship.progressTubu' : 'freeship.progress', { price: vnd(ship.remaining) });
  const freeship: CartThresholdMilestone = {
    kind: 'freeship',
    threshold: shipThreshold,
    reached: ship.reached,
    remaining: ship.remaining,
    at: giftThreshold === null ? 100 : Math.floor((shipThreshold / giftThreshold) * 1000) / 10,
    label: cartProgressCopy('freeshipMark', { amount: vnd(shipThreshold) }),
  };
  if (giftThreshold === null) {
    return { pct: ship.pct, freeship, gift: null, next: ship.reached ? null : 'freeship', done: ship.reached, headline, barAria: fillCopy('freeship.barAria', { pct: ship.pct }) };
  }
  const giftReached = base >= giftThreshold;
  const pct = giftReached ? 100 : Math.min(99, Math.floor((base / giftThreshold) * 100));
  const gift: CartThresholdMilestone = {
    kind: 'gift',
    threshold: giftThreshold,
    reached: giftReached,
    remaining: giftReached ? 0 : giftThreshold - base,
    at: 100,
    label: cartProgressCopy('giftMark', { amount: vnd(giftThreshold) }),
  };
  const next: CartMilestoneKind | null = !ship.reached ? 'freeship' : giftReached ? null : 'gift';
  return {
    pct,
    freeship,
    gift,
    next,
    done: next === null,
    headline,
    barAria: cartProgressCopy('barAria', { pct, mark: vnd(shipThreshold) }),
  };
}

/**
 * Mốc quà cho thanh hai mốc: `minOrder` của khối quà máy chủ trả cho đúng phần đang chọn. Null khi không có khối quà (cờ tắt, giá phần chọn
 * chưa về), không còn quà nào, hay khách đã chọn không nhận quà: khi đó thanh chỉ còn mốc Miễn phí giao hàng.
 */
export function cartGiftThreshold(giftTrial: GiftTrialSummaryDTO | null | undefined): number | null {
  if (!giftTrial || giftTrial.declined || giftTrial.options.length === 0) return null;
  return finite(giftTrial.minOrder) && giftTrial.minOrder > 0 ? giftTrial.minOrder : null;
}

export interface RefillValueComparison {
  /** Số đồng khách đỡ tốn khi mua gói Refill thay cho số chai cùng lượng (làm tròn xuống). */
  savedVnd: number;
  /** Phần trăm rẻ hơn mỗi ml (làm tròn xuống, từ 1%). */
  savedPct: number;
  /** Số chai trọn lượng mà gói Refill thay được (phần nguyên, từ 1). */
  bottlesReplaced: number;
}

/**
 * So gói Refill với chai trên cùng lượng (THUẦN). Lượng là số cùng một chiều do nơi gọi đọc từ tên (ml với ml, g với g; xem `parseNetAmount`),
 * không đoán. Null khi một trong bốn số không phải số dương hữu hạn, gói nhỏ hơn một chai (không so với nửa chai không ai mua được), hay gói Refill
 * không rẻ hơn chai mỗi ml ít nhất 1%: khi đó không nêu số tiết kiệm hay số chai thay.
 */
export function computeRefillValueComparison(
  bottlePrice: number,
  bottleVolumeMl: number,
  refillPrice: number,
  refillVolumeMl: number,
): RefillValueComparison | null {
  const ok = (n: number) => finite(n) && n > 0;
  if (!ok(bottlePrice) || !ok(bottleVolumeMl) || !ok(refillPrice) || !ok(refillVolumeMl)) return null;
  const bottlesReplaced = Math.floor(refillVolumeMl / bottleVolumeMl + 1e-9);
  if (bottlesReplaced < 1) return null;
  const sameVolumeInBottles = (bottlePrice * refillVolumeMl) / bottleVolumeMl;
  const savedPct = Math.floor((1 - refillPrice / sameVolumeInBottles) * 100 + 1e-9);
  if (savedPct < 1) return null;
  return {
    savedVnd: Math.floor(sameVolumeInBottles - refillPrice + 1e-6),
    savedPct,
    bottlesReplaced,
  };
}
