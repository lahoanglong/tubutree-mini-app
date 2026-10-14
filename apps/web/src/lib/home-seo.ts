import type { Metadata } from 'next';

const BRAND_TITLE_MAX = 60;

interface HomeSeoFilter {
  brand?: string;
  page?: number;
}

/**
 * Đường dẫn canonical của trang chủ theo bộ lọc: trang 1 không lọc là "/", còn lại tự trỏ về chính nó (không neo
 * #san-pham, không từ khoá tìm kiếm — trang tìm kiếm đã noindex). Dựng riêng chứ không dùng `homeHref`: canonical không
 * được mang đoạn neo.
 */
export function homeCanonicalPath({ brand, page }: HomeSeoFilter): string {
  const params = new URLSearchParams();
  if (brand) params.set('brand', brand);
  if (page && page > 1) params.set('page', String(Math.floor(page)));
  const qs = params.toString();
  return qs ? `/?${qs}` : '/';
}

/**
 * Metadata trang chủ cho từng biến thể danh mục (nhãn, trang N): mỗi URL một tiêu đề + mô tả + canonical riêng thay vì
 * dùng chung của layout, để công cụ tìm kiếm không coi các trang phân trang là bản trùng nội dung. Trang 1 không lọc giữ
 * nguyên tiêu đề mặc định. `brandKnown` = nhãn có trong danh mục thật; URL tự bịa thì không cho lập chỉ mục.
 */
export function homeMetadata(filter: HomeSeoFilter, brandKnown: boolean): Metadata {
  const brand = filter.brand?.slice(0, BRAND_TITLE_MAX).trim() || undefined;
  const page = filter.page && filter.page > 1 ? Math.floor(filter.page) : 1;
  const meta: Metadata = { alternates: { canonical: homeCanonicalPath({ brand: filter.brand, page }) } };

  if (filter.brand && !brandKnown) meta.robots = { index: false, follow: true };

  if (brand) {
    meta.title = `Sản phẩm ${brand}${page > 1 ? ` — Trang ${page}` : ''} | Tubu Tree`;
    meta.description = `Mua sản phẩm ${brand} chính hãng tại Tubu Tree${page > 1 ? ` (trang ${page})` : ''}: hàng sống xanh, an toàn, giao nhanh toàn quốc.`;
  } else if (page > 1) {
    meta.title = `Sản phẩm sống xanh — Trang ${page} | Tubu Tree`;
    meta.description = `Trang ${page} danh mục mỹ phẩm và đồ tiêu dùng thiên nhiên của Tubu Tree.`;
  }
  return meta;
}
