import type { HttpClient } from '../http';
import { errorStatus } from './error-status';

/** Shape phân trang backend trả về (§12.1): { data, meta }. */
export interface PageResponse<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

export interface ProductCard {
  id: string;
  slug: string;
  brand: string;
  name: string;
  thumbnail: string | null;
  basePrice: number;
  salePrice: number | null;
  isFeatured: boolean;
  ratingAvg?: number;
  reviewCount?: number;
  sold?: number;
  inStock: boolean;
}

export interface VariationDetail {
  id: string;
  sku: string;
  name: string;
  attributes: Record<string, string>;
  retailPrice: number;
  salePrice: number | null;
  stock: number;
}

export interface ProductDetail {
  id: string;
  slug: string;
  brand: string;
  name: string;
  shortDesc: string | null;
  description: string;
  images: string[];
  thumbnail: string | null;
  basePrice: number;
  salePrice: number | null;
  certifications: string[];
  ingredients?: { name: string; percentage?: string; benefit?: string }[] | null;
  sold?: number;
  variations: VariationDetail[];
  /** Ai giao (D4): gian hàng tự giao có phí giao/ngưỡng miễn phí riêng. API cũ chưa trả → coi như Tubu giao. */
  fulfiller?: ProductFulfiller;
  /** Hàng của gian hàng đối tác (tự giao hoặc Tubu giao hộ): chỉ bán giá lẻ, không định kỳ/mua chung. API cũ chưa trả → hàng Tubu. */
  partnerOwned?: boolean;
}

export interface ProductFulfiller {
  /** UNAVAILABLE: gian hàng tạm nghỉ hoặc đã ngừng bán nên chưa nhận đơn (xem `reason`). */
  kind: 'TUBU' | 'MERCHANT' | 'UNAVAILABLE';
  name: string;
  shippingFee: number | null;
  freeShipFrom: number | null;
  reason?: 'STORE_PAUSED' | 'STORE_CLOSED';
}

export interface ProductSuggestion { slug: string; name: string; thumbnail: string | null; basePrice: number; }


// ── Catalog có bộ lọc (dự án 4b) ──
export type CatalogSort = 'best_seller' | 'newest' | 'price_asc' | 'price_desc';
export interface CatalogQuery {
  page: number;
  limit: number;
  q?: string;
  sort?: CatalogSort;
  /** Danh sách thương hiệu, nối bằng dấu phẩy (như `?brand=` từ Trang chủ). */
  brand?: string;
  category?: string;
  segment?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  minRating?: number;
}
export interface CatalogPage extends PageResponse<ProductCard> {
  /** API cũ (trước 4b) từ chối bộ lọc mới → đã tải lại KHÔNG kèm bộ lọc; UI báo nhẹ. */
  filtersIgnored: boolean;
}

export interface CategoryDTO {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  image: string | null;
  sortOrder: number;
  /** Số SP đang bán (API từ 4b). Thiếu = API cũ → miniapp dùng 4 phân khúc. */
  productCount?: number;
}

/**
 * Giá và trạng thái HIỆN HÀNH theo slug (dải "Đã xem gần đây" không lưu giá). Sản phẩm đã ẩn hoặc chưa duyệt không có trong kết
 * quả; tối đa 20 slug một lần.
 */
export const fetchProductsBySlugs = async (http: HttpClient, slugs: string[]): Promise<ProductCard[]> => {
  const unique = [...new Set(slugs)].slice(0, 20);
  if (unique.length === 0) return [];
  const res = await http.get<PageResponse<ProductCard>>('/products', { query: { slugs: unique.join(','), limit: unique.length } });
  return res.data;
};

export const fetchProducts = async (http: HttpClient, params: Record<string, string | number> = {}): Promise<PageResponse<ProductCard>> => {
  const brandParam = params.brand ? String(params.brand) : '';
  const brandList = brandParam ? brandParam.split(',').map((b) => b.trim()).filter(Boolean) : [];

  if (brandList.length <= 1) {
    return http.get<PageResponse<ProductCard>>('/products', { query: params });
  }

  const primaryRes = await http.get<PageResponse<ProductCard>>('/products', { query: params });
  if (primaryRes.data && primaryRes.data.length > 0) {
    return primaryRes;
  }

  const page = Number(params.page ?? 1);
  const limit = Number(params.limit ?? 30);
  // Bug 2 fix: truoc day moi brand nhan CUNG params (gom ca page/limit goc) roi tu phan trang
  // rieng, nen tu "trang 2" tro di moi brand tra ve "trang 2 cua rieng no" truoc khi gop lai ->
  // offset sai. Luon goi tung brand tu page=1 voi limit du lon (tinh theo trang+so brand dang
  // yeu cau) de co du du lieu tho, roi TU cat theo offset dung tren tap da gop TOAN BO ben duoi.
  const perBrandLimit = page * limit * brandList.length;

  const responses: PageResponse<ProductCard>[] = await Promise.all(
    brandList.map((b) =>
      http
        .get<PageResponse<ProductCard>>('/products', { query: { ...params, brand: b, page: 1, limit: perBrandLimit } })
        .catch((): PageResponse<ProductCard> => ({ data: [], meta: { page: 1, limit: perBrandLimit, total: 0 } })),
    ),
  );

  const combinedMap = new Map<string, ProductCard>();
  let combinedTotal = 0;

  for (const resp of responses) {
    combinedTotal += resp.meta.total;
    for (const item of resp.data) {
      if (!combinedMap.has(item.id)) {
        combinedMap.set(item.id, item);
      }
    }
  }

  const combinedList = Array.from(combinedMap.values());
  const startIndex = (page - 1) * limit;
  const pagedList = combinedList.slice(startIndex, startIndex + limit);

  return {
    data: pagedList,
    meta: {
      page,
      limit,
      total: combinedList.length > 0 ? combinedList.length : combinedTotal,
    },
  };
};
export const fetchProduct = (http: HttpClient, slug: string) => http.get<ProductDetail>(`/products/${encodeURIComponent(slug)}`);
/** `slug` có khi nhãn đã công khai trang /brand/:slug; API cũ chưa trả thì thiếu. */
export interface BrandCount {
  brand: string;
  count: number;
  slug?: string | null;
}
export const fetchBrands = (http: HttpClient) => http.get<BrandCount[]>('/brands');
export const fetchRelated = (http: HttpClient, slug: string) => http.get<ProductCard[]>(`/products/${slug}/related`);
/** Feed "Dành cho bạn" — gợi ý cá nhân hoá (cần đăng nhập). */
export const fetchForYou = (http: HttpClient) => http.get<ProductCard[]>('/products/for-you');
export const fetchBoughtTogether = (http: HttpClient, slug: string) =>
  http.get<ProductCard[]>(`/products/${slug}/bought-together`);
export const suggestProducts = (http: HttpClient, q: string) =>
  http.get<ProductSuggestion[]>('/search/suggest', { query: { q } });
export const fetchCategories = (http: HttpClient) => http.get<CategoryDTO[]>('/categories');

/** Tham số mà API trước 4b không biết — ValidationPipe `forbidNonWhitelisted` trả 400 nếu gửi. */
const EXTENDED_CATALOG_PARAMS = ['minPrice', 'maxPrice', 'inStock', 'minRating'] as const;

/** Chỉ gửi tham số có giá trị — API cũ không bị 400 vì những bộ lọc khách không dùng. */
export function catalogParams(query: CatalogQuery): Record<string, string | number> {
  const params: Record<string, string | number> = { page: query.page, limit: query.limit };
  const q = query.q?.trim();
  if (q) params.q = q;
  if (query.sort) params.sort = query.sort;
  if (query.brand) params.brand = query.brand;
  if (query.category) params.category = query.category;
  if (query.segment) params.segment = query.segment;
  if (query.minPrice != null) params.minPrice = query.minPrice;
  if (query.maxPrice != null) params.maxPrice = query.maxPrice;
  if (query.inStock) params.inStock = 'true';
  if (query.minRating != null) params.minRating = query.minRating;
  return params;
}


/**
 * `GET /products` có bộ lọc. Lùi êm khi bản mới gặp API cũ (deploy sai thứ tự): 400 KHI có
 * tham số mới → tải lại không kèm chúng, đánh dấu `filtersIgnored`. Lỗi khác (hoặc 400 mà không có
 * tham số mới) vẫn ném ra để trang hiện ErrorState như thường.
 */
export async function fetchCatalog(http: HttpClient, query: CatalogQuery): Promise<CatalogPage> {
  const params = catalogParams(query);
  const extended = EXTENDED_CATALOG_PARAMS.some((k) => k in params);
  try {
    return { ...(await fetchProducts(http, params)), filtersIgnored: false };
  } catch (err) {
    if (!extended || errorStatus(err) !== 400) throw err;
    const legacy = { ...params };
    for (const k of EXTENDED_CATALOG_PARAMS) delete legacy[k];
    return { ...(await fetchProducts(http, legacy)), filtersIgnored: true };
  }
}
