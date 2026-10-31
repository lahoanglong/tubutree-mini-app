import type { CatalogSort } from '../api/catalog';
import { fillCopy } from '../shop-copy';

/** Tab của thanh sắp xếp: một tab giá gộp hai chiều (chạm lại thì đảo). */
export type SortTab = 'default' | 'best_seller' | 'newest' | 'price';

export function sortTab(sort?: CatalogSort): SortTab {
  if (sort === 'price_asc' || sort === 'price_desc') return 'price';
  if (sort === 'best_seller' || sort === 'best_seller_30d') return 'best_seller';
  if (sort === 'newest') return 'newest';
  return 'default';
}

/** Sắp xếp mới khi chạm `tab`: tab giá đảo chiều khi đã ở giá; Phổ biến bỏ `sort` (thứ tự mặc định của API). */
export function sortForTab(current: CatalogSort | undefined, tab: SortTab): CatalogSort | undefined {
  if (tab === 'price') return current === 'price_asc' ? 'price_desc' : 'price_asc';
  if (tab === 'default') return undefined;
  return tab;
}

export interface BrowseSortOption {
  value: SortTab;
  label: string;
  spoken?: string;
}

/**
 * Nhãn thanh sắp xếp. Tab đầu là "Liên quan" khi đang tìm (thứ tự mặc định lúc đó theo độ khớp). Tab giá nói rõ chiều đang xếp
 * (ux-copy UC-05: "Giá giảm" dễ đọc thành "đang giảm giá").
 */
export function browseSortOptions(sort: CatalogSort | undefined, hasQuery: boolean): BrowseSortOption[] {
  const price =
    sort === 'price_asc'
      ? { label: fillCopy('sort.priceAsc'), spoken: fillCopy('sort.priceAscSpoken') }
      : sort === 'price_desc'
        ? { label: fillCopy('sort.priceDesc'), spoken: fillCopy('sort.priceDescSpoken') }
        : { label: fillCopy('sort.price'), spoken: fillCopy('sort.priceSpoken') };
  return [
    { value: 'default', label: fillCopy(hasQuery ? 'sort.relevant' : 'sort.default') },
    { value: 'best_seller', label: fillCopy('sort.bestSeller') },
    { value: 'newest', label: fillCopy('sort.newest') },
    { value: 'price', ...price },
  ];
}
