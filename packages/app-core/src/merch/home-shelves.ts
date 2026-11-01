import { liveRoute, routeUsable } from './route-fallback';
import { applyShelfDedupe, shelf } from './shelves';

/** Phần tử của một kệ Trang chủ kèm khoá chống trùng: slug sản phẩm (Giờ vàng chỉ có `productSlug`, không có id sản phẩm). */
export interface ShelfEntry<T> {
  id: string;
  /** Khoá phụ chiếm cùng `id`: slug các món của một combo (xem `comboShelfEntry`). */
  also?: readonly string[];
  item: T;
}

/**
 * Combo xếp theo id bộ nhưng chiếm cả slug các món của nó: Bán chạy nhất và lưới Gợi ý hôm nay bỏ món đã nằm trong combo, còn combo chứa món của
 * kệ hạng cao hơn (Giờ vàng, Mua lại) thì bị bỏ cả bộ.
 */
export function comboShelfEntry<V extends { id: string; items: readonly { slug: string }[] }>(view: V): ShelfEntry<V> {
  return { id: view.id, also: view.items.map((i) => i.slug), item: view };
}

/**
 * Mini App chờ combo về tối đa ngần này trước khi cho Bán chạy nhất vẽ: hai khối cùng đến từ request gộp `/home`, nhưng nếu Bán chạy nhất vẽ trước
 * thì món của combo hiện rồi biến mất. Quá hạn (combo chậm hay lỗi) thì vẽ tiếp, đừng để một khối phụ giữ khối chính mãi.
 */
export const COMBO_HOLD_MS = 1500;

export interface HomeShelvesInput<F, P, C, B> {
  flash: ShelfEntry<F>[];
  purchased: ShelfEntry<P>[];
  combos: ShelfEntry<C>[];
  bestSellers: ShelfEntry<B>[];
}

export interface HomeShelvesResult<F, P, C, B> {
  flash: F[];
  purchased: P[];
  combos: C[];
  bestSellers: B[];
  /** Khoá mọi món còn hiện ở các kệ trên: lưới Gợi ý hôm nay (hạng 6) loại những món này. */
  seen: ReadonlySet<string>;
}

/**
 * Chống trùng bốn kệ hàng của Trang chủ qua `SHELVES` (Giờ vàng > Mua lại > combos > Bán chạy nhất): kệ hạng cao giữ món, kệ sau bỏ món
 * đã bị chiếm rồi cắt `maxItems`; kệ dưới `minItems` ẩn và KHÔNG chiếm món. Một sản phẩm có hai phân loại cùng Giờ vàng chỉ một thẻ.
 * `seen` gồm cả món của combo còn hiện (`also`), nên Gợi ý hôm nay cũng bỏ chúng.
 */
export function composeHomeShelves<F, P, C, B>(input: HomeShelvesInput<F, P, C, B>): HomeShelvesResult<F, P, C, B> {
  const out = applyShelfDedupe<ShelfEntry<unknown>>([
    { id: 'home.flash', items: input.flash },
    { id: 'home.purchased', items: input.purchased },
    { id: 'home.combos', items: input.combos },
    { id: 'home.bestSellers', items: input.bestSellers },
  ]);
  const items = (i: number) => out[i]!.items;
  const seen = new Set<string>();
  for (let i = 0; i < out.length; i++)
    for (const x of items(i)) {
      seen.add(x.id);
      for (const k of x.also ?? []) seen.add(k);
    }
  return {
    flash: items(0).map((x) => x.item as F),
    purchased: items(1).map((x) => x.item as P),
    combos: items(2).map((x) => x.item as C),
    bestSellers: items(3).map((x) => x.item as B),
    seen,
  };
}

/** Route nhận `?category=`: lối xem tất cả của kệ đang lọc theo danh mục giữ phạm vi đó, để hạng trên kệ và ở trang đích cùng một thước đo. */
const CATEGORY_AWARE = new Set(['/best-sellers']);

/**
 * Lối "Xem tất cả" của kệ theo nền đang chạy; kệ không khai lối, hoặc lối chưa có trang đúng nghĩa (`routeUsable`), thì null.
 * `scope.category` chỉ gắn vào route nhận danh mục (Bán chạy nhất); kệ không lọc thì không truyền.
 */
export function seeAllHref(shelfId: string, platform: 'mini' | 'web' = 'mini', scope?: { category?: string | null }): string | null {
  const route = shelf(shelfId).seeAllRoute;
  if (!route || !routeUsable(route)) return null;
  const href = liveRoute(route, platform);
  return scope?.category && CATEGORY_AWARE.has(route) ? `${href}?${new URLSearchParams({ category: scope.category })}` : href;
}
