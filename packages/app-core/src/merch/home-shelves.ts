import { liveRoute, routeUsable } from './route-fallback';
import { applyShelfDedupe, shelf } from './shelves';

/** Phần tử của một kệ Trang chủ kèm khoá chống trùng: slug sản phẩm (Giờ vàng chỉ có `productSlug`, không có id sản phẩm). */
export interface ShelfEntry<T> {
  id: string;
  /** Khoá phụ chiếm cùng `id`: slug các món của một combo (xem `comboShelfEntry`). */
  also?: readonly string[];
  item: T;
}

/** Khoá chống trùng theo phân loại, có tiền tố để không bao giờ đụng slug sản phẩm hay id bộ. */
const VARIATION_PREFIX = 'variation:';
export const variationKey = (variationId: string): string => `${VARIATION_PREFIX}${variationId}`;

/**
 * Suất Giờ vàng khoá bằng slug (các kệ dưới chống trùng theo sản phẩm) và chiếm thêm phân loại của suất, để Mua lại chỉ bỏ ĐÚNG phân loại đang giảm giá:
 * khách đã mua Can 5L vẫn thấy Can 5L khi Can 1L đang Giờ vàng.
 */
export function flashShelfEntry<T extends { productSlug: string; variationId: string }>(item: T): ShelfEntry<T> {
  return { id: item.productSlug, also: [variationKey(item.variationId)], item };
}

/**
 * Món Mua lại khoá bằng phân loại (nên chỉ trùng Giờ vàng khi cùng phân loại) nhưng vẫn chiếm slug của sản phẩm cho combo, Bán chạy nhất và Gợi ý hôm nay,
 * những kệ chống trùng theo sản phẩm.
 */
export function purchasedShelfEntry<T extends { slug: string; variationId: string }>(item: T): ShelfEntry<T> {
  return { id: variationKey(item.variationId), also: [item.slug], item };
}

/** Tập rỗng dùng chung để tập loại trừ giữ danh tính khi kệ Giờ vàng ẩn. */
const NO_VARIATIONS: ReadonlySet<string> = new Set();

/**
 * Phân loại Mua lại phải bỏ vì đang Giờ vàng: mọi suất còn hạn (`live`) thuộc các sản phẩm kệ Giờ vàng đang vẽ (`shown`; mỗi sản phẩm một thẻ, nhưng mọi
 * phân loại của nó đang giảm giá). Không rộng hơn kệ: kệ ẩn (dưới mức tối thiểu) không loại gì, sản phẩm bị cắt sau `maxItems` cũng không bị loại (nếu loại,
 * nó biến khỏi cả Giờ vàng lẫn Mua lại).
 */
export function flashExcludedVariations<T extends { productSlug: string; variationId: string }>(live: readonly T[], shown: readonly T[]): ReadonlySet<string> {
  if (shown.length === 0) return NO_VARIATIONS;
  const shownSlugs = new Set(shown.map((f) => f.productSlug));
  return new Set(live.filter((f) => shownSlugs.has(f.productSlug)).map((f) => f.variationId));
}

/**
 * Hạng thật liền từ 1 (1..k)? Kệ Bán chạy nhất chống trùng nên có thể mất hạng 1 hay hụt giữa dãy (hạng đang ở Giờ vàng, Mua lại, combo): khi đó thẻ
 * không ghi số (chỉ "Bán chạy") để khách không tưởng kệ lỗi; hạng liền thì giữ số. `null` là món ghim (không có hạng, xem `bestSellerShelfItems`): bỏ qua khi xét.
 */
export function ranksAreSequential(ranks: readonly (number | null)[]): boolean {
  return ranks.filter((r): r is number => r !== null).every((r, i) => r === i + 1);
}

/**
 * Combo xếp theo id bộ nhưng chiếm cả slug các món của nó: Bán chạy nhất và lưới Gợi ý hôm nay bỏ món đã nằm trong combo. Combo chỉ chiếm xuống dưới,
 * không bị Giờ vàng hay Mua lại loại (xem `applyShelfDedupe`).
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
 * Giờ vàng và Mua lại so với nhau theo PHÂN LOẠI (`flashShelfEntry`, `purchasedShelfEntry`); mọi kệ còn lại chống trùng theo slug.
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
  // `seen` chỉ gồm slug: Gợi ý hôm nay chống trùng theo sản phẩm, khoá phân loại chỉ dùng giữa Giờ vàng và Mua lại.
  const seen = new Set<string>();
  for (let i = 0; i < out.length; i++)
    for (const x of items(i)) for (const k of [x.id, ...(x.also ?? [])]) if (!k.startsWith(VARIATION_PREFIX)) seen.add(k);
  return {
    flash: items(0).map((x) => x.item as F),
    purchased: items(1).map((x) => x.item as P),
    combos: items(2).map((x) => x.item as C),
    bestSellers: items(3).map((x) => x.item as B),
    seen,
  };
}

/**
 * Xếp còn hàng trước, rồi trong mỗi phần món CÓ ẢNH trước món chưa có ảnh; giữ nguyên thứ tự tương đối trong mỗi nhóm (ổn định). Thứ tự bốn nhóm: còn hàng có ảnh,
 * còn hàng chưa ảnh, hết hàng có ảnh, hết hàng chưa ảnh: ô ảnh thay thế (lá) giữa màn đầu làm kệ trông hỏng nên món có ảnh lên trước, nhưng món hết hàng có ảnh
 * không bao giờ vượt món còn hàng. Hạng thật của từng món phải được gắn TRƯỚC khi gọi hàm này (xem `ranksAreSequential`: hạng hụt thì thẻ chỉ ghi "Bán chạy").
 */
export function merchFirst<T>(items: readonly T[], inStock: (item: T) => boolean, hasImage: (item: T) => boolean): T[] {
  const groups: [T[], T[], T[], T[]] = [[], [], [], []];
  for (const it of items) groups[(inStock(it) ? 0 : 2) + (hasImage(it) ? 0 : 1)]!.push(it);
  return groups.flat();
}

/** Một món của kệ Bán chạy nhất kèm hạng: `rank` null là món admin ghim (kệ `best_sellers`), không phải thứ hạng lượt bán nên thẻ không ghi số. */
export interface RankedShelfItem<T> {
  product: T;
  rank: number | null;
}

/**
 * Món và hạng của kệ Bán chạy nhất theo trang 1 máy chủ trả (`pinnedIds` là khối món ghim ở đầu): món ghim đứng đầu theo thứ tự ghim, không mang hạng; món còn lại
 * đánh 1..n liền nhau (không đếm món ghim) theo thứ tự còn hàng trước, rồi món có ảnh lên trước trong từng phần (`merchFirst`). Máy chủ đã xếp còn hàng trước nên
 * bước này chỉ đổi thứ tự khi API cũ trả món hết hàng xen giữa: đánh số sau bước đó để món hết hàng bị đẩy xuống không làm hụt hạng (hụt thì cả kệ mất số). Không có
 * `pinnedIds` (API cũ, chưa ghim) thì mọi món mang hạng.
 */
export function bestSellerShelfItems<T extends { id: string; inStock: boolean; thumbnail: string | null }>(
  items: readonly T[],
  pinnedIds?: readonly string[],
): RankedShelfItem<T>[] {
  const pinned = new Set(pinnedIds ?? []);
  const rest = items.filter((p) => !pinned.has(p.id));
  const ranked = [...rest.filter((p) => p.inStock), ...rest.filter((p) => !p.inStock)].map((product, i) => ({ product, rank: i + 1 }));
  return [
    ...items.filter((p) => pinned.has(p.id)).map((product) => ({ product, rank: null })),
    ...merchFirst(ranked, (x) => x.product.inStock, (x) => Boolean(x.product.thumbnail?.trim())),
  ];
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
