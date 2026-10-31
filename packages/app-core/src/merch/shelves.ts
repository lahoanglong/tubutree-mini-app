import { SECTION_BUDGET } from '../commerce/collection-view';
import { uniqueById } from '../unique-by-id';

/**
 * Sổ đăng ký kệ hàng: mỗi khối hàng ở mọi màn khai một dòng (ý định, bố cục, trần/sàn số món, hạng chống trùng, lối "Xem tất cả").
 * Màn mới thêm kệ thì khai ở đây; `shelves.spec.ts` chặn kệ thiếu ngân sách, lối xem tất cả không có route, hai kệ cùng ý định.
 */
export type ShelfScreen = 'home' | 'browse' | 'pdp' | 'shop' | 'offers' | 'flash';

export interface ShelfSpec {
  /** `<màn>.<tên>`: `flash` và `bestSellers` có ở hai màn mà `shelf(id)` chỉ nhận id, nên id mang tiền tố màn. */
  id: string;
  screen: ShelfScreen;
  intent: string;
  layout: 'rail' | 'grid' | 'line' | 'feed';
  maxItems: number;
  /** Dưới số này kệ ẩn hẳn (không để tiêu đề trơ). */
  minItems: number;
  /** Thứ tự chống trùng, nhỏ thắng; null = không tham gia chống trùng. */
  dedupeRank: number | null;
  seeAllRoute: string | null;
}

// dedupeRank: flash 1 > purchased 2 > combos 3 > bestSellers 4 > (5 để dành cho kệ "Mới về", chưa có) > suggest/related 6.
export const SHELVES: readonly ShelfSpec[] = [
  { id: 'home.flash', screen: 'home', intent: 'deal có hạn', layout: 'rail', maxItems: 8, minItems: 3, dedupeRank: 1, seeAllRoute: '/flash-sale' },
  { id: 'home.purchased', screen: 'home', intent: 'mua lại', layout: 'line', maxItems: 10, minItems: 1, dedupeRank: 2, seeAllRoute: '/orders' },
  { id: 'home.combos', screen: 'home', intent: 'mua nhiều tiết kiệm', layout: 'rail', maxItems: 4, minItems: 2, dedupeRank: 3, seeAllRoute: null },
  { id: 'home.bestSellers', screen: 'home', intent: 'xã hội chứng thực', layout: 'rail', maxItems: 10, minItems: 3, dedupeRank: 4, seeAllRoute: '/best-sellers' },
  { id: 'home.suggest', screen: 'home', intent: 'khám phá', layout: 'feed', maxItems: 100, minItems: 4, dedupeRank: 6, seeAllRoute: '/browse' },

  { id: 'browse.recent', screen: 'browse', intent: 'quay lại món đã xem', layout: 'rail', maxItems: 10, minItems: 1, dedupeRank: null, seeAllRoute: null },
  { id: 'browse.bestSellers', screen: 'browse', intent: 'xã hội chứng thực', layout: 'rail', maxItems: 10, minItems: 3, dedupeRank: 4, seeAllRoute: '/best-sellers' },

  { id: 'pdp.combos', screen: 'pdp', intent: 'mua nhiều tiết kiệm', layout: 'rail', maxItems: 2, minItems: 1, dedupeRank: null, seeAllRoute: null },
  { id: 'pdp.addons', screen: 'pdp', intent: 'mua kèm', layout: 'line', maxItems: 3, minItems: 1, dedupeRank: null, seeAllRoute: null },
  { id: 'pdp.boughtTogether', screen: 'pdp', intent: 'khách thường mua cùng', layout: 'rail', maxItems: 6, minItems: 3, dedupeRank: 4, seeAllRoute: null },
  { id: 'pdp.related', screen: 'pdp', intent: 'khám phá', layout: 'feed', maxItems: 20, minItems: 4, dedupeRank: 6, seeAllRoute: null },

  // Bố cục thật của khối shop theo `layout` của bộ sưu tập (`collectionView`); sàn 1 vì chủ shop tự chọn món, không ẩn khối ít món.
  { id: 'shop.section', screen: 'shop', intent: 'bộ sưu tập của shop', layout: 'rail', maxItems: SECTION_BUDGET.rail, minItems: 1, dedupeRank: null, seeAllRoute: null },

  { id: 'offers.flash', screen: 'offers', intent: 'deal có hạn', layout: 'rail', maxItems: 4, minItems: 1, dedupeRank: 1, seeAllRoute: '/flash-sale' },
];

const BY_ID = new Map(SHELVES.map((s) => [s.id, s]));

export function shelf(id: string): ShelfSpec {
  const spec = BY_ID.get(id);
  if (!spec) throw new Error(`shelves: không có kệ "${id}"`);
  return spec;
}

/**
 * Chống trùng món giữa các kệ trên một màn. Kệ hạng cao (số nhỏ) chiếm món trước, bất kể thứ tự trong mảng đầu vào; kệ sau bỏ món đã bị
 * chiếm và món lặp trong chính nó, rồi cắt `maxItems`. Kệ còn dưới `minItems` trả [] và KHÔNG chiếm món: kệ đã ẩn mà vẫn giữ món
 * thì khách không thấy món đó ở đâu cả. Kệ không có hạng chỉ bị cắt. Kết quả giữ thứ tự đầu vào; id lạ ném lỗi.
 */
export function applyShelfDedupe<T extends { id: string }>(shelves: { id: string; items: T[] }[]): { id: string; items: T[] }[] {
  const specs = shelves.map((s) => shelf(s.id));
  const claimOrder = specs
    .map((spec, i) => ({ rank: spec.dedupeRank, i }))
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.i - b.i);

  const claimed = new Set<string>();
  const out: { id: string; items: T[] }[] = new Array(shelves.length);
  for (const { rank, i } of claimOrder) {
    const spec = specs[i]!;
    const fresh = uniqueById(shelves[i]!.items).filter((x) => rank === null || !claimed.has(x.id));
    const kept = fresh.slice(0, spec.maxItems);
    const shown = kept.length < spec.minItems ? [] : kept;
    if (rank !== null) for (const x of shown) claimed.add(x.id);
    out[i] = { id: shelves[i]!.id, items: shown };
  }
  return out;
}
