import { FREESHIP_UPSELL_WINDOW } from '@tubutree/shared-types';

/**
 * Thanh tiến độ Miễn phí giao hàng ở đầu Giỏ và dải gợi ý món bù đơn. Mini App và web cùng gọi các hàm này: số tiền còn thiếu,
 * phần trăm đã đạt và thứ tự món gợi ý không được lệch giữa hai nền tảng.
 */

/** Món gợi ý được phép đắt hơn số còn thiếu tối đa chừng này (vượt ngưỡng vừa đủ, không đẩy khách chi nhiều hơn cần). */
export const FREESHIP_ADDON_WINDOW = 25_000;
/** Cửa sổ của dải "Thêm 1 món nhỏ để đủ Miễn phí giao hàng" (cờ `commerce.freeship_booster_enabled`, nguồn `GET /upsell/freeship`): cùng số với máy chủ. */
export const FREESHIP_BOOSTER_WINDOW = FREESHIP_UPSELL_WINDOW;
export const FREESHIP_ADDON_MAX = 5;
/** Dưới sàn thì dải ẩn hẳn, không để tiêu đề trơ. */
export const FREESHIP_ADDON_MIN = 3;

export interface FreeshipProgress {
  /** Đã đạt ngưỡng: chuyển sang trạng thái chúc mừng. */
  reached: boolean;
  /** Số còn thiếu (đồng), 0 khi đã đạt. */
  remaining: number;
  /** 0–100; chỉ đạt 100 khi `reached`, chưa đạt thì tối đa 99 để thanh không "đầy" khi còn thiếu vài đồng. */
  pct: number;
}

/**
 * `base` là tiền hàng đang chọn (hoặc phần Tubu giao khi giỏ có hàng gian hàng tự giao). `serverReached` là cờ `freeship` của máy chủ,
 * chỉ đưa vào khi chắc chắn tin được (cả giỏ đang chọn, không dòng hết hàng): xem chú thích ở `cart.tsx`. Ngưỡng 0 hoặc âm = mọi đơn đều được miễn phí.
 */
export function freeshipProgress(opts: { base: number; threshold: number; serverReached?: boolean }): FreeshipProgress {
  const base = Math.max(0, Number.isFinite(opts.base) ? opts.base : 0);
  const threshold = Number.isFinite(opts.threshold) ? opts.threshold : 0;
  if (opts.serverReached || threshold <= 0 || base >= threshold) return { reached: true, remaining: 0, pct: 100 };
  return { reached: false, remaining: threshold - base, pct: Math.min(99, Math.floor((base / threshold) * 100)) };
}

export interface FreeshipAddonCandidate {
  slug: string;
  /** Phân loại sẽ vào giỏ khi bấm "+ Thêm" (phân loại đại diện của thẻ); thiếu thì món không gợi ý được. */
  variationId?: string | null;
  /** Giá khách trả cho món (đúng số thẻ đang hiện). */
  price: number;
  inStock: boolean;
}

/**
 * Món bù đơn: còn hàng, có phân loại để thêm, chưa có trong giỏ (theo slug hoặc phân loại), giá không vượt `remaining + window` (mặc định
 * `FREESHIP_ADDON_WINDOW`; dải mới truyền `FREESHIP_BOOSTER_WINDOW`). Thứ tự: món đóng được khoảng thiếu một mình (giá từ `remaining` tới `remaining + window`)
 * rồi các món rẻ hơn khoảng thiếu theo thứ tự nguồn. Món đóng khoảng xếp rẻ trước; `ranked` (nguồn đã xếp ở máy chủ, `GET /upsell/freeship`) thì giữ thứ tự nguồn.
 * Giá ở đây là giá thẻ app đang hiện (gồm Giờ vàng), nên món máy chủ trả vẫn được xét lại theo giá mới nhất và giỏ mới nhất.
 * Tối đa `FREESHIP_ADDON_MAX`; dưới `FREESHIP_ADDON_MIN` thì trả rỗng. Đã đạt ngưỡng (`remaining` ≤ 0) cũng rỗng.
 */
export function pickFreeshipAddons<T extends FreeshipAddonCandidate>(
  candidates: readonly T[] | null | undefined,
  opts: { remaining: number; inCartSlugs?: ReadonlySet<string>; inCartVariationIds?: ReadonlySet<string>; limit?: number; window?: number; ranked?: boolean },
): T[] {
  const { remaining } = opts;
  if (!(remaining > 0)) return [];
  const limit = Math.min(opts.limit ?? FREESHIP_ADDON_MAX, FREESHIP_ADDON_MAX);
  const window = opts.window ?? FREESHIP_ADDON_WINDOW;
  const seen = new Set<string>();
  const eligible: T[] = [];
  for (const c of candidates ?? []) {
    if (!c.inStock || !c.variationId || !(c.price > 0) || seen.has(c.slug)) continue;
    if (opts.inCartSlugs?.has(c.slug) || opts.inCartVariationIds?.has(c.variationId)) continue;
    if (c.price > remaining + window) continue;
    seen.add(c.slug);
    eligible.push(c);
  }
  const closers = eligible.filter((c) => c.price >= remaining);
  if (!opts.ranked) closers.sort((a, b) => a.price - b.price);
  const partial = eligible.filter((c) => c.price < remaining);
  const picked = [...closers, ...partial].slice(0, limit);
  return picked.length >= FREESHIP_ADDON_MIN ? picked : [];
}

/**
 * Mức mở khoá của dải đầu Giỏ: 0 khi chưa đạt Miễn phí giao hàng; đạt rồi thì 1 cộng số món của bậc Hộp Xanh đang có (dải Hộp Xanh chỉ hiện sau khi đạt
 * Miễn phí giao hàng, xem `cartProgressStrip`). Mức tăng nghĩa là khách vừa mở khoá thêm một phần thưởng.
 */
export function cartUnlockLevel(freeshipReached: boolean, greenBoxTierMinItems?: number | null): number {
  if (!freeshipReached) return 0;
  return 1 + (typeof greenBoxTierMinItems === 'number' && greenBoxTierMinItems > 0 ? greenBoxTierMinItems : 0);
}

/**
 * Có chạy hiệu ứng mừng không: chỉ khi mức vượt mức CAO NHẤT đã thấy trong lần mở giỏ này. Lần vẽ đầu (`highest` null) không mừng (giỏ mở ra đã đạt sẵn);
 * mức tụt rồi lên lại (bỏ chọn một món, giá phần chọn đang tải lại) cũng không mừng lần hai.
 */
export function shouldCelebrateUnlock(highest: number | null, level: number): boolean {
  return highest !== null && level > highest;
}

/** Độ dài hiệu ứng mừng (ms); CSS của hai app chạy trong khoảng này và tắt hẳn khi giảm chuyển động. */
export const UNLOCK_CELEBRATE_MS = 1_200;
