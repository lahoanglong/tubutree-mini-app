import type { CatalogQuery, CatalogSort } from '@tubutree/app-core/api/catalog';
import { BROWSE_PAGE_LIMIT, browseMode } from '@tubutree/app-core/browse/mode';
import { browseText, formatVndShort } from './browse-text';

export type FilterType = 'price' | 'in_stock' | 'brand' | 'rating';

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
  /** Nút "Xem tất cả sản phẩm": danh sách không lọc. Vắng thì gốc không tham số là hub. */
  all?: boolean;
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

/** Độ dài tối đa của từ khoá tìm trong URL (API không giới hạn; chặn link dài bất thường). */
export const MAX_QUERY_LENGTH = 100;

/**
 * Các khoá URL mà `parseSearchState`/`serializeSearchState` sở hữu. Mọi khoá khác (utm, ref…) là
 * "tham số lạ": `useSearchState` giữ nguyên khi ghi lại URL (trừ `focus`, tham số dùng một lần).
 */
export const SEARCH_PARAM_KEYS: readonly string[] = ['q', 'category', 'segment', 'brand', 'minPrice', 'maxPrice', 'inStock', 'rating', 'sort', 'all'];

function intParam(v: string | null): number | undefined {
  if (v == null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

export function parseSearchState(params: URLSearchParams): SearchState {
  const sort = params.get('sort');
  const rating = intParam(params.get('rating'));
  return {
    q: (params.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH).trimEnd(),
    sort: sort && (CATALOG_SORTS as readonly string[]).includes(sort) ? (sort as CatalogSort) : undefined,
    category: params.get('category') || undefined,
    segment: params.get('segment') || undefined,
    brands: [...new Set((params.get('brand') ?? '').split(',').map((s) => s.trim()).filter(Boolean))],
    minPrice: intParam(params.get('minPrice')),
    maxPrice: intParam(params.get('maxPrice')),
    inStock: params.get('inStock') === '1',
    minRating: rating != null && rating >= 1 && rating <= 5 ? rating : undefined,
    all: params.get('all') === '1' ? true : undefined,
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
  // `all` chỉ có nghĩa khi không còn gì khác đưa trang vào chế độ danh sách: một trạng thái một URL.
  if (s.all && browseMode({ ...s, all: false }) === 'hub') p.set('all', '1');
  return p;
}

/** Trang danh mục trên web: cùng bộ tham số với Mini App, đặt dưới /san-pham. */
export const BROWSE_PATH = '/san-pham';
/** Số sản phẩm mỗi trang Danh mục (20, như Mini App). Đặt ở module không 'use client': trang máy chủ import từ file client chỉ nhận một hàm giữ chỗ, không phải số. */
export const PAGE_LIMIT = BROWSE_PAGE_LIMIT;

export function browseHref(s: SearchState): string {
  const qs = serializeSearchState(s).toString();
  return qs ? `${BROWSE_PATH}?${qs}` : BROWSE_PATH;
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

/**
 * Hub (không lưới sản phẩm) hay danh sách; tham số lạ (utm, ref) không đổi chế độ. Từ trang 2 trở đi luôn là danh sách: `?page=2` ở gốc
 * là liên kết phân trang của danh sách, không phải hub.
 */
export function isBrowseHub(s: SearchState, page = 1): boolean {
  return browseMode({ ...s, all: s.all || page > 1 }) === 'hub';
}

/**
 * Mọi thay đổi khi đã ở danh sách đi qua đây: gỡ chip cuối, về "Gợi ý" hay xoá bộ lọc không được đẩy khách về hub, họ đang xem
 * danh sách nên ở lại danh sách "tất cả". `serializeSearchState` bỏ `all` khi còn bộ lọc/sort khác.
 */
export function withListMode(patch: Partial<SearchState>): Partial<SearchState> {
  return { ...patch, all: true };
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
  if (min != null && max != null) return browseText.price.between(formatVndShort(min), formatVndShort(max));
  if (max != null) return browseText.price.under(formatVndShort(max));
  return browseText.price.from(formatVndShort(min ?? 0));
}

export interface ActiveFilterChip {
  key: string;
  label: string;
  patch: Partial<SearchState>;
}

/** Phạm vi đã là tiêu đề của danh sách (hiện đúng một lần), nên không lặp thành chip ngay dưới thanh sắp xếp. */
export type TitleScope = 'category' | 'segment' | 'brand';

/**
 * Chip "đang lọc" gỡ được từng cái. Danh mục chưa có tên (danh sách chưa tải) thì chưa hiện; caller truyền nhãn dự phòng khi cây đã
 * tải mà không có danh mục đó (link cũ, danh mục đã xoá) để bộ lọc vẫn nhìn thấy và gỡ được. `titleScope`: CHỈ phạm vi đang làm tiêu đề
 * mới bị bỏ chip; các phạm vi còn lại (vd `?category=` kèm `?brand=`) vẫn là chip.
 */
export function activeFilterChips(
  s: SearchState,
  names: { categoryName?: string; segmentName?: string },
  opts: { titleScope?: TitleScope | null } = {},
): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];
  if (opts.titleScope !== 'category' && s.category && names.categoryName) chips.push({ key: 'category', label: names.categoryName, patch: { category: undefined } });
  if (opts.titleScope !== 'segment' && s.segment) chips.push({ key: 'segment', label: names.segmentName ?? s.segment, patch: { segment: undefined } });
  const brandIsTitle = opts.titleScope === 'brand' && s.brands.length === 1;
  if (!brandIsTitle) for (const b of s.brands) chips.push({ key: `brand:${b}`, label: b, patch: { brands: s.brands.filter((x) => x !== b) } });
  if (s.minPrice != null || s.maxPrice != null) {
    chips.push({ key: 'price', label: priceRangeLabel(s.minPrice, s.maxPrice), patch: { minPrice: undefined, maxPrice: undefined } });
  }
  if (s.inStock) chips.push({ key: 'inStock', label: browseText.inStockChip, patch: { inStock: false } });
  if (s.minRating != null) chips.push({ key: 'rating', label: browseText.rating4Chip, patch: { minRating: undefined } });
  return chips;
}
