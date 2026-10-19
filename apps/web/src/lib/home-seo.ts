import type { Metadata } from 'next';
import { normalizeSearchQuery } from './catalog-filter';

const BRAND_TITLE_MAX = 60;
const BROWSE_PATH = '/san-pham';

interface BrowseSeoFilter {
  brand?: string;
  page?: number;
}

/** Tham số URL làm kết quả khác "danh sách gốc" (khách tự lọc/sắp xếp/tìm): trang lọc là bản trùng nên không lập chỉ mục. */
const NOINDEX_PARAMS = ['category', 'segment', 'minPrice', 'maxPrice', 'inStock', 'rating', 'sort'] as const;

export function browseNoindex(params: URLSearchParams): boolean {
  if (normalizeSearchQuery(params.get('q'))) return true;
  return NOINDEX_PARAMS.some((k) => params.has(k));
}

/**
 * Đường dẫn canonical của trang danh mục theo bộ lọc: trang 1 không lọc là "/san-pham", còn lại tự trỏ về chính nó
 * (không từ khoá tìm kiếm — trang tìm kiếm đã noindex). Dựng riêng: canonical không được mang tham số theo dõi (utm, ref, s).
 */
export function browseCanonicalPath({ brand, page }: BrowseSeoFilter): string {
  const params = new URLSearchParams();
  if (brand) params.set('brand', brand);
  if (page && page > 1) params.set('page', String(Math.floor(page)));
  const qs = params.toString();
  return qs ? `${BROWSE_PATH}?${qs}` : BROWSE_PATH;
}

/**
 * Metadata trang danh mục cho từng biến thể (nhãn, trang N): mỗi URL một tiêu đề + mô tả + canonical riêng, để công cụ
 * tìm kiếm không coi các trang phân trang là bản trùng nội dung. `brandKnown` = nhãn có trong danh mục thật; URL tự bịa
 * thì không cho lập chỉ mục.
 */
export function browseMetadata(filter: BrowseSeoFilter, brandKnown: boolean): Metadata {
  const brand = filter.brand?.slice(0, BRAND_TITLE_MAX).trim() || undefined;
  const page = filter.page && filter.page > 1 ? Math.floor(filter.page) : 1;
  const meta: Metadata = { alternates: { canonical: browseCanonicalPath({ brand: filter.brand, page }) } };

  if (filter.brand && !brandKnown) meta.robots = { index: false, follow: true };

  if (brand) {
    meta.title = `Sản phẩm ${brand}${page > 1 ? ` — Trang ${page}` : ''} | Tubu Tree`;
    meta.description = `Mua sản phẩm ${brand} chính hãng tại Tubu Tree${page > 1 ? ` (trang ${page})` : ''}: hàng sống xanh, an toàn, giao nhanh toàn quốc.`;
  } else if (page > 1) {
    meta.title = `Sản phẩm sống xanh — Trang ${page} | Tubu Tree`;
    meta.description = `Trang ${page} danh mục mỹ phẩm và đồ tiêu dùng thiên nhiên của Tubu Tree.`;
  } else {
    meta.title = 'Tất cả sản phẩm | Tubu Tree';
    meta.description = 'Danh mục mỹ phẩm và đồ tiêu dùng thiên nhiên của Tubu Tree: tìm kiếm, lọc theo giá, thương hiệu, đánh giá.';
  }
  return meta;
}
