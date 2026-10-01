import type { CatalogQuery, CatalogSort } from '../services/shop-api';
import type { FilterType } from '../services/discovery-events';
import { vi } from '../i18n/vi';
import { formatVndShort } from './format';

/**
 * Trạng thái Browse sống trong URL (spec 5b.2, plan 4b Ruling 7) — quay lại từ trang sản phẩm thì
 * giữ nguyên. Tham số: q, sort, category, segment, brand (phẩy), minPrice, maxPrice, inStock=1, rating.
 */
export interface SearchState {
  q: string;
  sort?: CatalogSort;
  category?: string;
  segment?: string;
  brands: string[];
  minPrice?: number;
  maxPrice?: number;
  inStock: boolean;
  minRating?: number;
}

/** Phần trạng thái mà FilterSheet chỉnh (nháp tới khi bấm "Xem n sản phẩm"). */
export interface FilterDraft {
  brands: string[];
  minPrice?: number;
  maxPrice?: number;
  inStock: boolean;
  minRating?: number;
}

export interface PriceRange {
  key: string;
  min?: number;
  max?: number;
}

export const EMPTY_SEARCH_STATE: SearchState = { q: '', brands: [], inStock: false };

/** "Xoá tìm kiếm & bộ lọc" — giữ cách sắp xếp khách đã chọn. */
export const CLEAR_SEARCH_PATCH: Partial<SearchState> = {
  q: '', category: undefined, segment: undefined, brands: [], minPrice: undefined, maxPrice: undefined, inStock: false, minRating: undefined,
};

export const CATALOG_SORTS: readonly CatalogSort[] = ['best_seller', 'newest', 'price_asc', 'price_desc'];

export const PRICE_RANGES: readonly PriceRange[] = [
  { key: 'lt100k', max: 100_000 },
  { key: '100k-200k', min: 100_000, max: 200_000 },
  { key: '200k-500k', min: 200_000, max: 500_000 },
  { key: 'gte500k', min: 500_000 },
];

export const MIN_RATING_OPTION = 4;

/**
 * Các khoá URL mà `parseSearchState`/`serializeSearchState` sở hữu. Mọi khoá khác (utm, ref…) là
 * "tham số lạ": `useSearchState` giữ nguyên khi ghi lại URL (trừ `focus`, tham số dùng một lần).
 */
export const SEARCH_PARAM_KEYS: readonly string[] = ['q', 'category', 'segment', 'brand', 'minPrice', 'maxPrice', 'inStock', 'rating', 'sort'];

function intParam(v: string | null): number | undefined {
  if (v == null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

export function parseSearchState(params: URLSearchParams): SearchState {
  const sort = params.get('sort');
  const rating = intParam(params.get('rating'));
  return {
    q: (params.get('q') ?? '').trim(),
    sort: sort && (CATALOG_SORTS as readonly string[]).includes(sort) ? (sort as CatalogSort) : undefined,
    category: params.get('category') || undefined,
    segment: params.get('segment') || undefined,
    brands: [...new Set((params.get('brand') ?? '').split(',').map((s) => s.trim()).filter(Boolean))],
    minPrice: intParam(params.get('minPrice')),
    maxPrice: intParam(params.get('maxPrice')),
    inStock: params.get('inStock') === '1',
    minRating: rating != null && rating >= 1 && rating <= 5 ? rating : undefined,
  };
}

/** Thứ tự cố định + bỏ giá trị mặc định → một trạng thái chỉ có một URL (khoá cache + vị trí cuộn). */
export function serializeSearchState(s: SearchState): URLSearchParams {
  const p = new URLSearchParams();
  const q = s.q.trim();
  if (q) p.set('q', q);
  if (s.category) p.set('category', s.category);
  if (s.segment) p.set('segment', s.segment);
  if (s.brands.length > 0) p.set('brand', s.brands.join(','));
  if (s.minPrice != null) p.set('minPrice', String(s.minPrice));
  if (s.maxPrice != null) p.set('maxPrice', String(s.maxPrice));
  if (s.inStock) p.set('inStock', '1');
  if (s.minRating != null) p.set('rating', String(s.minRating));
  if (s.sort) p.set('sort', s.sort);
  return p;
}

export function toCatalogQuery(s: SearchState, page: number, limit: number): CatalogQuery {
  return {
    page,
    limit,
    q: s.q || undefined,
    sort: s.sort,
    category: s.category,
    segment: s.segment,
    brand: s.brands.length > 0 ? s.brands.join(',') : undefined,
    minPrice: s.minPrice,
    maxPrice: s.maxPrice,
    inStock: s.inStock || undefined,
    minRating: s.minRating,
  };
}

export function draftFromState(s: SearchState): FilterDraft {
  return { brands: [...s.brands], minPrice: s.minPrice, maxPrice: s.maxPrice, inStock: s.inStock, minRating: s.minRating };
}

/** Số LOẠI bộ lọc đang bật (badge nút "Bộ lọc"). */
export function activeFilterCount(s: Pick<SearchState, 'brands' | 'minPrice' | 'maxPrice' | 'inStock' | 'minRating'>): number {
  return (
    (s.minPrice != null || s.maxPrice != null ? 1 : 0) +
    (s.inStock ? 1 : 0) +
    (s.brands.length > 0 ? 1 : 0) +
    (s.minRating != null ? 1 : 0)
  );
}

/** Trang Danh mục "gốc": chưa tìm, chưa chọn danh mục/phân khúc, chưa lọc (sắp xếp không tính). */
export function isBrowseRoot(s: SearchState): boolean {
  return !s.q && !s.category && !s.segment && activeFilterCount(s) === 0;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function changedFilterTypes(before: SearchState, after: FilterDraft): FilterType[] {
  const types: FilterType[] = [];
  if (before.minPrice !== after.minPrice || before.maxPrice !== after.maxPrice) types.push('price');
  if (before.inStock !== after.inStock) types.push('in_stock');
  if (!sameSet(before.brands, after.brands)) types.push('brand');
  if (before.minRating !== after.minRating) types.push('rating');
  return types;
}

export function priceRangeLabel(min?: number, max?: number): string {
  if (min != null && max != null) return vi.browse.price.between(formatVndShort(min), formatVndShort(max));
  if (max != null) return vi.browse.price.under(formatVndShort(max));
  return vi.browse.price.from(formatVndShort(min ?? 0));
}

export interface ActiveFilterChip {
  key: string;
  label: string;
  patch: Partial<SearchState>;
}

/** Chip "đang lọc" gỡ được từng cái. Danh mục chưa có tên (danh sách chưa tải) thì chưa hiện. */
export function activeFilterChips(s: SearchState, names: { categoryName?: string; segmentName?: string }): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];
  if (s.category && names.categoryName) chips.push({ key: 'category', label: names.categoryName, patch: { category: undefined } });
  if (s.segment) chips.push({ key: 'segment', label: names.segmentName ?? s.segment, patch: { segment: undefined } });
  for (const b of s.brands) chips.push({ key: `brand:${b}`, label: b, patch: { brands: s.brands.filter((x) => x !== b) } });
  if (s.minPrice != null || s.maxPrice != null) {
    chips.push({ key: 'price', label: priceRangeLabel(s.minPrice, s.maxPrice), patch: { minPrice: undefined, maxPrice: undefined } });
  }
  if (s.inStock) chips.push({ key: 'inStock', label: vi.browse.inStockChip, patch: { inStock: false } });
  if (s.minRating != null) chips.push({ key: 'rating', label: vi.browse.rating4Chip, patch: { minRating: undefined } });
  return chips;
}
