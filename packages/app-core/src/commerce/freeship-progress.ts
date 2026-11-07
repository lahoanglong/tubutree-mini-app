/**
 * Thanh tiến độ Miễn phí giao hàng ở đầu Giỏ và dải gợi ý món bù đơn. Mini App và web cùng gọi các hàm này: số tiền còn thiếu,
 * phần trăm đã đạt và thứ tự món gợi ý không được lệch giữa hai nền tảng.
 */

/** Món gợi ý được phép đắt hơn số còn thiếu tối đa chừng này (vượt ngưỡng vừa đủ, không đẩy khách chi nhiều hơn cần). */
export const FREESHIP_ADDON_WINDOW = 25_000;
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
 * Món bù đơn: còn hàng, có phân loại để thêm, chưa có trong giỏ (theo slug hoặc phân loại), giá không vượt `remaining + FREESHIP_ADDON_WINDOW`.
 * Thứ tự: món đóng được khoảng thiếu một mình (giá từ `remaining` tới `remaining + 25.000`, rẻ trước) rồi các món rẻ hơn khoảng thiếu theo thứ tự nguồn
 * (Bán chạy nhất). Tối đa `FREESHIP_ADDON_MAX`; dưới `FREESHIP_ADDON_MIN` thì trả rỗng. Đã đạt ngưỡng (`remaining` ≤ 0) cũng rỗng.
 */
export function pickFreeshipAddons<T extends FreeshipAddonCandidate>(
  candidates: readonly T[] | null | undefined,
  opts: { remaining: number; inCartSlugs?: ReadonlySet<string>; inCartVariationIds?: ReadonlySet<string>; limit?: number },
): T[] {
  const { remaining } = opts;
  if (!(remaining > 0)) return [];
  const limit = Math.min(opts.limit ?? FREESHIP_ADDON_MAX, FREESHIP_ADDON_MAX);
  const seen = new Set<string>();
  const eligible: T[] = [];
  for (const c of candidates ?? []) {
    if (!c.inStock || !c.variationId || !(c.price > 0) || seen.has(c.slug)) continue;
    if (opts.inCartSlugs?.has(c.slug) || opts.inCartVariationIds?.has(c.variationId)) continue;
    if (c.price > remaining + FREESHIP_ADDON_WINDOW) continue;
    seen.add(c.slug);
    eligible.push(c);
  }
  const closers = eligible.filter((c) => c.price >= remaining).sort((a, b) => a.price - b.price);
  const partial = eligible.filter((c) => c.price < remaining);
  const picked = [...closers, ...partial].slice(0, limit);
  return picked.length >= FREESHIP_ADDON_MIN ? picked : [];
}
