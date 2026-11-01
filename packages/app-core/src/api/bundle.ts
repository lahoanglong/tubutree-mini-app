import type { HttpClient } from '../http';
import type { ProductCard } from './catalog';

export type BundleKind = 'BUNDLE_PCT' | 'ADDON';

export interface BundleItemDTO {
  productId: string;
  /** Phân loại sẽ vào giỏ (ghim, hoặc đại diện của thẻ; món mua kèm luôn ghim); null khi sản phẩm không còn phân loại bán được. */
  variationId: string | null;
  /** Số đơn vị mỗi đơn được hưởng ưu đãi của bộ. */
  maxQty: number;
  /** Chỉ ADDON: giá mua kèm mỗi đơn vị. */
  addonPrice: number | null;
  /** false: phân loại hết hàng, bộ không mua được. */
  inStock: boolean;
  /** Thẻ công khai; giá là giá của `variationId`. */
  product: ProductCard;
}

export interface BundleDTO {
  id: string;
  kind: BundleKind;
  title: string;
  /** BUNDLE_PCT: % giảm mỗi món (đã kẹp trần cấu hình); ADDON: null. */
  pct: number | null;
  /** Giờ hết hạn (ISO); máy khách ẩn bộ đã quá giờ theo giờ máy chủ. */
  endAt: string;
  anchorProductId: string | null;
  items: BundleItemDTO[];
}

/** `GET /products/:slug/bundles`: combo (≤2) có sản phẩm này và bộ mua kèm (≤3) mà sản phẩm này là sản phẩm chính. */
export interface ProductBundles {
  combos: BundleDTO[];
  addons: BundleDTO[];
  /** true khi có bộ Mua kèm đang chạy nhưng sản phẩm chính hết hàng (nên `addons` rỗng): khách đang xem thì khối ghi "Tạm hết hàng", không phải "Đã kết thúc". */
  addonsSoldOut?: boolean;
}

/** Số combo của kệ Trang chủ (`maxItems` của `home.combos`); khối `combos` của `GET /home` cắt đúng số này nên chỉ request cùng `limit` mới dùng khối gộp. */
export const HOME_COMBOS_LIMIT = 4;

// Công khai và cache được: `anonymous` để khách đã đăng nhập không bị preflight CORS/refresh token vì dữ liệu không theo người.
export const fetchProductBundles = (http: HttpClient, slug: string) =>
  http.get<ProductBundles>(`/products/${encodeURIComponent(slug)}/bundles`, { anonymous: true });

/** `GET /bundles/combos`: combo đang chạy mà mọi món còn hàng (Trang chủ). */
export const fetchHomeCombos = (http: HttpClient, limit?: number) =>
  http.get<BundleDTO[]>('/bundles/combos', { query: limit ? { limit } : {}, anonymous: true });
