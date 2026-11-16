import type { HttpClient } from '../http';

/** Một cột của bảng "So với món tương tự" (`GET /products/:slug/compare`). Giá, dung tích, giá trên đơn vị lấy từ CÙNG một phân loại (phân loại còn hàng giá thấp nhất, như giá của thẻ). */
export interface CompareItem {
  productId: string;
  slug: string;
  name: string;
  brand: string;
  thumbnail: string | null;
  /** Giá đang bán của phân loại dùng để so (chưa tính Giờ vàng). */
  price: number;
  /** Tên phân loại dùng để so ("3.8L"); rỗng khi sản phẩm một phân loại không tên. */
  variationName: string;
  /** Dung tích/khối lượng đã chuẩn hoá để hiện ("3,8L", "500ml", "1kg"); null khi không tách được từ tên. */
  size: string | null;
  /** Giá trên 100ml hoặc 100g, máy chủ tính và làm tròn đồng; null khi không tách được đơn vị hoặc khác loại đơn vị với món đang xem. */
  unitPrice: { per: '100ml' | '100g'; value: number } | null;
  /** Tối đa 2 tên thành phần đầu (đã có trong dữ liệu sản phẩm). */
  keyIngredients: string[];
}

export interface ProductCompare {
  current: CompareItem;
  /** 0–2 món cùng phân khúc và cùng nhóm tên, còn hàng. Rỗng thì khối ẩn. */
  others: CompareItem[];
}

/**
 * Công khai, cache được nên `anonymous`. Cờ `catalog.pdp_compare_enabled` tắt thì máy chủ trả 404: hai app coi lỗi nào cũng là "không có bảng" và ẩn khối, không báo lỗi.
 */
export const fetchProductCompare = (http: HttpClient, slug: string) =>
  http.get<ProductCompare>(`/products/${encodeURIComponent(slug)}/compare`, { anonymous: true });
