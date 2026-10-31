import { fillCopy } from '../shop-copy';
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
  return [{ key: BEST_SELLERS_ALL_KEY, label: fillCopy('rank.tabAll') }, ...roots];
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

/** Hạng của thẻ đầu khi danh sách bắt đầu từ `startPage` (web mở thẳng `?page=N`); số trang hỏng thì về hạng 1. */
export function bestSellersRankFrom(startPage: number): number {
  return Number.isFinite(startPage) && startPage >= 1 ? (Math.floor(startPage) - 1) * BEST_SELLERS_PAGE_LIMIT + 1 : 1;
}
