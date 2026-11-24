import type { BestSellersPage } from '../api/browse';
import { fillBootCopy } from '../shop-copy-boot';
import { HUB_CATEGORY_MAX } from './hub';
import type { CategoryNode } from './category-tree';

/** Món mỗi trang của Bán chạy nhất (kế hoạch P13): hạng của trang N bắt đầu ở `(N-1)*20+1`. */
export const BEST_SELLERS_PAGE_LIMIT = 20;

/** Khoá của tab "Tất cả" (id danh mục là cuid nên không đụng). */
export const BEST_SELLERS_ALL_KEY = '__all__';

export interface BestSellerTab {
  key: string;
  label: string;
}

/**
 * Tab của trang Bán chạy nhất: "Tất cả" rồi danh mục tầng 1 còn hàng, theo thứ tự cây, tối đa 8. Cây rỗng như PROD hiện nay (hoặc chưa tải,
 * hoặc lỗi) thì chỉ còn "Tất cả": hàng tab vẫn vẽ để giữ chiều cao khi cây về sau. Con của gốc không thành tab (lọc cha đã gồm con).
 */
export function bestSellerTabs(tree: CategoryNode[] | undefined): BestSellerTab[] {
  const roots = (tree ?? [])
    .filter((n) => !n.parentId && (n.productCount === undefined || n.productCount > 0))
    .slice(0, HUB_CATEGORY_MAX)
    .map((n) => ({ key: n.id, label: n.name }));
  return [{ key: BEST_SELLERS_ALL_KEY, label: fillBootCopy('rank.tabAll') }, ...roots];
}

/**
 * Tab đang chọn và danh mục để lọc, từ `?category=` của URL. `tabs = null` là cây chưa tải: tin tham số để không tải danh sách hai lần
 * (một lần "Tất cả", một lần theo danh mục). Cây đã tải mà tham số không phải tab (link cũ, danh mục con, đã xoá) thì coi như "Tất cả".
 */
export function bestSellerScope(tabs: BestSellerTab[] | null, category: string | null | undefined): { tab: string; category: string | undefined } {
  const c = category || undefined;
  if (!c) return { tab: BEST_SELLERS_ALL_KEY, category: undefined };
  if (tabs === null || tabs.some((t) => t.key === c)) return { tab: c, category: c };
  return { tab: BEST_SELLERS_ALL_KEY, category: undefined };
}

/**
 * Tên của vùng danh sách theo tab đang chọn. Đang lọc một danh mục mà cây chưa về (`tabs = null`) thì chưa biết tên danh mục: dùng tên trang
 * thay vì "Tất cả", vì vùng này đang chỉ chứa món của danh mục đó. Cây đã về thì tên tab (id không có trong cây đã được `bestSellerScope` đưa về "Tất cả").
 */
export function bestSellerPanelLabel(tabs: BestSellerTab[] | null, tab: string, title: string = fillBootCopy('rank.title')): string {
  if (tab === BEST_SELLERS_ALL_KEY) return fillBootCopy('rank.tabAll');
  if (tabs === null) return title;
  return tabs.find((t) => t.key === tab)?.label ?? fillBootCopy('rank.tabAll');
}

/**
 * Dòng thước đo dưới tiêu đề. Chỉ ghi "30 ngày qua" khi mọi trang đã tải đều xếp theo 30 ngày: có trang nào lùi về tổng lượt bán (API cũ trả 400 cho
 * `best_seller_30d`) thì bảng đang trộn hoặc hoàn toàn theo tổng, và câu "30 ngày" sẽ sai. Thiếu dữ liệu hay thiếu `basis` (cache cũ) coi như 30 ngày.
 */
export function bestSellersBasisCopy(pages: readonly Partial<BestSellersPage>[] | undefined): string {
  return pages?.some((p) => p.basis === 'total') ? fillBootCopy('rank.basisAll') : fillBootCopy('rank.basis');
}

const isCuratedCard = (p: object): boolean => (p as { curated?: unknown }).curated === true;

/**
 * Bảng Bán chạy nhất đang là kệ "Tubu chọn cho bạn": khi chưa đủ số bán thật, API đặt các món admin ghim (kệ `best_sellers`) lên đầu trang 1 và đánh dấu
 * `curated: true` trên từng thẻ đó; phần sau là bảng xếp hạng thường. Dấu nằm trên thẻ (không ở trang) để mọi đường dữ liệu giữ được nó, kể cả nơi chỉ giữ
 * mảng thẻ (kệ Danh mục) hay đã đảo thứ tự (ảnh trước). API cũ không gửi dấu thì không bao giờ là kệ chọn tay.
 */
export function isCuratedShelf(items: readonly object[] | undefined): boolean {
  return Boolean(items?.some(isCuratedCard));
}

/**
 * Thẻ vẽ ở kệ/trang Bán chạy nhất: kệ chọn tay thì chỉ các món ghim (giữ thứ tự), dưới `minItems` món ghim thì không vẽ gì (như kệ thiếu món hôm nay);
 * không phải kệ chọn tay thì nguyên danh sách.
 */
export function curatedShelfItems<T extends object>(items: readonly T[], minItems = 1): T[] {
  if (!isCuratedShelf(items)) return [...items];
  const picks = items.filter(isCuratedCard);
  return picks.length >= minItems ? picks : [];
}

/** Cơ sở của bảng đang hiện: `days30`/`total` như `BestSellersBasis`, thêm `curated` cho kệ chọn tay. */
export type BestSellersHeadingBasis = 'days30' | 'total' | 'curated';

export interface BestSellersHeading {
  basis: BestSellersHeadingBasis;
  title: string;
  /** Dòng thước đo dưới tiêu đề; kệ chọn tay không có số bán nên không có dòng này. */
  subtitle: string | undefined;
  /** Vẽ số hạng (#1, #2…) hay không: kệ chọn tay không phải bảng xếp hạng. */
  ranked: boolean;
}

/**
 * Tiêu đề, dòng thước đo và có xếp hạng hay không của mọi nơi vẽ Bán chạy nhất (kệ Trang chủ, kệ Danh mục, trang Bán chạy nhất; web và Mini).
 * `items` là các thẻ đang hiện; `pages` là các trang đã tải (có `basis`) khi nơi gọi có, để chọn đúng câu thước đo như `bestSellersBasisCopy`.
 */
export function bestSellersHeading(items: readonly object[] | undefined, pages?: readonly Partial<BestSellersPage>[]): BestSellersHeading {
  if (isCuratedShelf(items)) return { basis: 'curated', title: fillBootCopy('rank.curatedTitle'), subtitle: undefined, ranked: false };
  const total = pages?.some((p) => p.basis === 'total') ?? false;
  return { basis: total ? 'total' : 'days30', title: fillBootCopy('rank.title'), subtitle: bestSellersBasisCopy(pages), ranked: true };
}

/** Hạng của thẻ đầu khi danh sách bắt đầu từ `startPage` (web mở thẳng `?page=N`); số trang hỏng thì về hạng 1. */
export function bestSellersRankFrom(startPage: number): number {
  return Number.isFinite(startPage) && startPage >= 1 ? (Math.floor(startPage) - 1) * BEST_SELLERS_PAGE_LIMIT + 1 : 1;
}

const PAGE_PATH = { mini: '/best-sellers', web: '/ban-chay' } as const;

/**
 * Địa chỉ trang Bán chạy nhất theo nền, giữ danh mục và số trang (trang 1 không ghi `page`). Là địa chỉ của chính trang này nên nằm
 * cạnh nó thay vì đi qua `liveRoute` (lối vào từ nơi khác); `route-map.json` vẫn là nguồn khai route.
 */
export function bestSellersHref(platform: 'mini' | 'web', { category, page }: { category?: string; page?: number } = {}): string {
  const qs = new URLSearchParams();
  if (category) qs.set('category', category);
  if (page !== undefined && Number.isFinite(page) && page > 1) qs.set('page', String(Math.floor(page)));
  const s = qs.toString();
  return s ? `${PAGE_PATH[platform]}?${s}` : PAGE_PATH[platform];
}
