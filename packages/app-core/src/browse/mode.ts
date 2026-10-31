/** Số sản phẩm mỗi trang Danh mục: chia hết cho 2 (Mini), 4 và 5 cột (web) để hàng cuối không lẻ. */
export const BROWSE_PAGE_LIMIT = 20;

export interface BrowseModeInput {
  q: string;
  category?: string;
  segment?: string;
  sort?: string;
  /** Nút "Xem tất cả sản phẩm": danh sách không lọc. */
  all?: boolean;
  brands: string[];
  minPrice?: number;
  maxPrice?: number;
  inStock: boolean;
  minRating?: number;
}

export type BrowseMode = 'hub' | 'list';

/**
 * Gốc không tham số là hub (không lưới sản phẩm); bất kỳ tham số nào làm kết quả khác "mọi sản phẩm" hoặc khách chủ động mở danh
 * sách (`all`, `sort`) thì là danh sách. Tham số lạ (utm, ref) không nằm trong đầu vào nên không đổi chế độ.
 */
export function browseMode(s: BrowseModeInput): BrowseMode {
  const filtered =
    s.q !== '' ||
    s.category !== undefined ||
    s.segment !== undefined ||
    s.sort !== undefined ||
    s.all === true ||
    s.brands.length > 0 ||
    s.minPrice !== undefined ||
    s.maxPrice !== undefined ||
    s.inStock ||
    s.minRating !== undefined;
  return filtered ? 'list' : 'hub';
}
