import { FREESHIP_UPSELL_LIMIT, FREESHIP_UPSELL_WINDOW } from '@tubutree/shared-types';

/**
 * Cờ dải "Thêm 1 món nhỏ để đủ Miễn phí giao hàng" ở đầu Giỏ. Tắt (mặc định, migration 20261118150000): `GET /upsell/freeship` trả 404 và hai app
 * giữ dải gợi ý cũ lấy từ kệ Bán chạy nhất. File này không import service nào để `public-config.ts` đọc được khoá mà không kéo theo CatalogService.
 */
export const FREESHIP_BOOSTER_ENABLED_KEY = 'commerce.freeship_booster_enabled';

/** Một món trong kho ứng viên: giá khách thấy trên thẻ (gồm Giờ vàng), số bán 30 ngày và tổng đã bán (gồm số nhập tay từ sàn ngoài). */
export interface FreeshipUpsellRow {
  id: string;
  slug: string;
  price: number;
  soldApp30d: number;
  sold: number;
}

/** Bán chạy 30 ngày trước, hoà thì tổng đã bán, rồi rẻ hơn trước, cuối cùng id tăng dần để hai lần gọi cùng thứ tự. */
const byConversion = (a: FreeshipUpsellRow, b: FreeshipUpsellRow) =>
  b.soldApp30d - a.soldApp30d || b.sold - a.sold || a.price - b.price || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Thứ tự gợi ý bù đơn cho khoảng thiếu `gap` (đồng, > 0). Trước hết là món đóng được khoảng thiếu một mình (giá từ `gap` tới `gap + 45.000`), xếp bán chạy
 * nhất trước; sau đó, để dải vẫn đủ món khi ít món vừa khoảng, là các món bán chạy rẻ hơn khoảng thiếu. Món đắt hơn `gap + 45.000` không bao giờ vào:
 * dải chỉ đẩy khách vượt mốc vừa đủ. Món trùng slug (cùng sản phẩm) chỉ lấy một lần. Trả id theo thứ tự, tối đa `limit`.
 */
export function rankFreeshipUpsell(
  rows: readonly FreeshipUpsellRow[],
  opts: { gap: number; exclude?: ReadonlySet<string>; limit?: number },
): string[] {
  const { gap } = opts;
  if (!(gap > 0)) return [];
  const limit = Math.max(0, Math.min(opts.limit ?? FREESHIP_UPSELL_LIMIT, FREESHIP_UPSELL_LIMIT));
  const max = gap + FREESHIP_UPSELL_WINDOW;
  const seen = new Set<string>();
  const closers: FreeshipUpsellRow[] = [];
  const fillers: FreeshipUpsellRow[] = [];
  for (const r of rows) {
    if (!(r.price > 0) || r.price > max || seen.has(r.slug) || opts.exclude?.has(r.slug)) continue;
    seen.add(r.slug);
    (r.price >= gap ? closers : fillers).push(r);
  }
  return [...closers.sort(byConversion), ...fillers.sort(byConversion)].slice(0, limit).map((r) => r.id);
}

/** `?exclude=a,b` thành tập slug (bỏ khoảng trắng và phần rỗng). */
export function parseExcludeSlugs(raw: string | undefined): Set<string> {
  return new Set((raw ?? '').split(',').map((s) => s.trim()).filter(Boolean));
}
