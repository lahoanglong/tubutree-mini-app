import { isAxiosError } from 'axios';
import { api } from './api';
import { homeProductSlot, takeMeBlock, takePublicBlock, takePurchasedItems } from './home-feed';
import type { OrderDTO, OrderItemDTO } from '@tubutree/shared-types';
import type { MyRefund, RefundBankInput, ReturnReasonCode } from '../utils/refund-rules';

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

export interface CartLine {
  id: string;
  variationId: string;
  /** API cũ chưa trả. */
  productId?: string;
  productName: string;
  variationName: string;
  slug: string;
  thumbnail: string | null;
  unitPrice: number;
  quantity: number;
  stock: number;
  weight?: number | null;
  total: number;
  /** Đang áp giá giờ vàng — dùng để cảnh báo khi giá/suất thay đổi trước khi đặt. */
  isFlash?: boolean;
  flashSaleItemId?: string | null;
  flashEndAt?: string | null;
  soldPct?: number | null;
  /** Có khi số lượng vượt suất giờ vàng khách còn mua được: dòng đang tính giá thường, đây là lý do. */
  flashLimitNotice?: string | null;
  /** Nơi giao dòng này (D4): kho Tubu, gian hàng đối tác tự giao, hoặc không giao được. API cũ chưa trả. */
  fulfiller?: LineFulfiller;
}

export interface LineFulfiller {
  kind: 'TUBU' | 'MERCHANT' | 'UNAVAILABLE';
  storefrontId: string | null;
  name: string;
  /** Chỉ có ở UNAVAILABLE: gian hàng tạm nghỉ nhận đơn, hoặc gian hàng đã ngừng bán (chủ bị khoá/hết quyền đối tác). */
  reason?: 'STORE_PAUSED' | 'STORE_CLOSED';
}
/** Một kiện của lần đặt: mỗi nơi giao thành một đơn riêng với phí giao và tổng riêng. */
export interface QuoteShipment {
  key: string;
  fulfiller: LineFulfiller;
  itemIds: string[];
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
}
/** Đơn cùng lần đặt bị tách theo nơi giao (kể cả chính đơn này). */
export interface SplitOrderDTO {
  id: string;
  code: string;
  total: number;
  /** Điểm Xanh đơn này sẽ tích (API cũ chưa trả). */
  pointsEarned?: number;
  status: string;
  fulfiller: 'TUBU' | 'MERCHANT';
  fulfillerName: string;
}

/** Dòng giỏ có SP đã ngừng bán/chưa duyệt — server không tính tiền, không đặt được. */
export interface UnavailableCartLine {
  id: string;
  variationId: string;
  productName: string;
  variationName: string;
  slug: string;
  thumbnail: string | null;
  quantity: number;
}

export interface CartSummary {
  items: CartLine[];
  /** API cũ chưa có trường này → coi như rỗng. */
  unavailableItems?: UnavailableCartLine[];
  couponCode: string | null;
  /** Mã đang giữ nhưng chưa áp cho giỏ hiện tại (vd hàng giờ vàng không tính vào điều kiện). */
  couponNotice?: string | null;
  subtotal: number;
  discount: number;
  freeship: boolean;
  /** Ngưỡng freeship từ SystemConfig — cho progress bar khích lệ. */
  freeshipThreshold: number;
  itemCount: number;
}

export interface CheckoutQuote {
  subtotal: number;
  discount: number;
  /** Mã trong giỏ chưa được áp cho đơn này (không giảm, không tiêu lượt) — câu giải thích cho khách. */
  couponNotice?: string | null;
  comboDiscount: number;
  pointsUsed: number;
  /** Phần của `pointsUsed` lấy từ lô quy đổi (không hết hạn). Optional: API cũ chưa trả. */
  pointsUsedConverted?: number;
  pointsDiscount: number;
  shippingFee: number;
  total: number;
  pointsEarned: number;
  pointsBalance: number;
  /** Số Điểm Xanh tối đa dùng được cho lần đặt này (chỉ trên hàng Tubu). API cũ chưa trả. */
  pointsMax?: number;
  /** Câu giải thích khi giỏ có hàng của gian hàng đối tác (Điểm Xanh không trả cho hàng đó); null = không có. */
  pointsPartnerNote?: string | null;
  /** Số điểm khách chọn bị kẹp vì hàng của gian hàng đối tác. */
  pointsNotice?: string | null;
  shipments?: QuoteShipment[];
  /** Phương thức không dùng được cho giỏ này → câu giải thích (ví dụ có hàng đối tác tự giao). */
  blockedPaymentMethods?: Record<string, string>;
}

export interface AddressDTO {
  id: string;
  recipient: string;
  phone: string;
  province: string;
  district: string;
  ward: string;
  street: string;
  provinceCode: string;
  districtCode: string;
  wardCode: string;
  isDefault: boolean;
}

// Catalog (public)
export interface ShippingEta {
  minDays: number;
  maxDays: number;
}
export interface PublicConfig {
  freeshipThreshold: number;
  /** Tỉ lệ giảm khi đặt định kỳ, dạng phân số (0.12 = 12%). */
  subscribeDiscountPct: number;
  /** Hệ số khi CTV nhận hoa hồng về Ví Tubu (×1.5). */
  affiliateWalletMultiplier: number;
  /** Mốc tối thiểu rút hoa hồng về ngân hàng. */
  affiliateMinWithdrawBank: number;
  /** Thuế TNCN khấu trừ khi rút hoa hồng: `pct` (phân số) áp cho lần rút từ `threshold`; thiếu khi API cũ. */
  affiliatePitWithhold?: { pct: number; threshold: number };
  /** Số ngày giữ trước khi hoàn tiền sàn ngoài về Ví. */
  cashbackHoldDays: number;
  /**
   * Hiện lựa chọn "Gửi lại vật liệu tái chế" ở checkout — true chỉ khi Gomdon đã cấu hình VÀ admin
   * bật. Optional: API bản cũ không trả field này → coi như tắt.
   */
  recyclingEnabled?: boolean;
  /** Khoảng ngày giao dự kiến — null/thiếu khi chủ shop chưa cấu hình (hoặc API cũ) → ẩn. */
  shippingEta?: ShippingEta | null;
  /** Mức giảm (% nguyên) và quy mô nhóm mua chung — thiếu khi API cũ → UI không hứa con số. */
  groupBuy?: { discountPct: number; targetSize: number };
  /** Số ngày được gửi yêu cầu đổi/trả kể từ khi giao (returns.window_days). */
  returnWindowDays?: number;
  /** Kênh hỗ trợ khách; từng trường null khi admin để trống. */
  support?: { hotline: string | null; email: string | null; zaloOaName: string | null };
}
export const getPublicConfig = () =>
  api.get<PublicConfig>('/config/public').then((r) => r.data);
/**
 * Giá và trạng thái HIỆN HÀNH theo slug (dải "Đã xem gần đây" không lưu giá). Sản phẩm đã ẩn hoặc chưa duyệt không có trong kết
 * quả; tối đa 20 slug một lần.
 */
export const fetchProductsBySlugs = async (slugs: string[]): Promise<ProductCard[]> => {
  const unique = [...new Set(slugs)].slice(0, 20);
  if (unique.length === 0) return [];
  const res = await api.get<PageResponse<ProductCard>>('/products', { params: { slugs: unique.join(','), limit: unique.length } });
  return res.data.data;
};
export const fetchProducts = async (params: Record<string, string | number> = {}): Promise<PageResponse<ProductCard>> => {
  const homeSlot = homeProductSlot(params);
  if (homeSlot) {
    const fromFeed = await takePublicBlock(homeSlot);
    if (fromFeed) return fromFeed;
  }
  const brandParam = params.brand ? String(params.brand) : '';
  const brandList = brandParam ? brandParam.split(',').map((b) => b.trim()).filter(Boolean) : [];

  if (brandList.length <= 1) {
    return api.get<PageResponse<ProductCard>>('/products', { params }).then((r) => r.data);
  }

  const primaryRes = await api.get<PageResponse<ProductCard>>('/products', { params }).then((r) => r.data);
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
      api
        .get<PageResponse<ProductCard>>('/products', { params: { ...params, brand: b, page: 1, limit: perBrandLimit } })
        .then((r) => r.data)
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
export const fetchProduct = (slug: string) =>
  api.get<ProductDetail>(`/products/${slug}`).then((r) => r.data);
export const fetchBrands = async () =>
  (await takePublicBlock('brands')) ?? api.get<{ brand: string; count: number }[]>('/brands').then((r) => r.data);
export const fetchRelated = (slug: string) =>
  api.get<ProductCard[]>(`/products/${slug}/related`).then((r) => r.data);
/** Feed "Dành cho bạn" — gợi ý cá nhân hoá (cần đăng nhập, xem home.tsx). */
export const fetchForYou = async () =>
  (await takeMeBlock('forYou')) ?? api.get<ProductCard[]>('/products/for-you').then((r) => r.data);
export const fetchBoughtTogether = (slug: string) =>
  api.get<ProductCard[]>(`/products/${slug}/bought-together`).then((r) => r.data);

export interface ProductSuggestion { slug: string; name: string; thumbnail: string | null; basePrice: number; }
export const suggestProducts = (q: string) =>
  api.get<ProductSuggestion[]>('/search/suggest', { params: { q } }).then((r) => r.data);

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
 * `GET /products` có bộ lọc. Lùi êm khi miniapp mới gặp API cũ (deploy sai thứ tự): 400 KHI có
 * tham số mới → tải lại không kèm chúng, đánh dấu `filtersIgnored`. Lỗi khác (hoặc 400 mà không có
 * tham số mới) vẫn ném ra để trang hiện ErrorState như thường.
 */
export async function fetchCatalog(query: CatalogQuery): Promise<CatalogPage> {
  const params = catalogParams(query);
  const extended = EXTENDED_CATALOG_PARAMS.some((k) => k in params);
  try {
    return { ...(await fetchProducts(params)), filtersIgnored: false };
  } catch (err) {
    if (!extended || !isAxiosError(err) || err.response?.status !== 400) throw err;
    const legacy = { ...params };
    for (const k of EXTENDED_CATALOG_PARAMS) delete legacy[k];
    return { ...(await fetchProducts(legacy)), filtersIgnored: true };
  }
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
export const fetchCategories = async () =>
  (await takePublicBlock('categories')) ?? api.get<CategoryDTO[]>('/categories').then((r) => r.data);

// Flash sale (public)
export interface FlashSaleActiveItem {
  itemId: string;
  variationId: string;
  productSlug: string;
  productName: string;
  thumbnail: string | null;
  flashPrice: number;
  retailPrice: number;
  salePrice?: number | null;
  soldCount: number;
  quota: number;
  endAt: string;
}
export const fetchActiveFlashSales = async () =>
  (await takePublicBlock('flashActive')) ?? api.get<FlashSaleActiveItem[]>('/flash-sales/active').then((r) => r.data);

export interface UpcomingFlashItem {
  itemId: string;
  variationId: string;
  productSlug: string;
  productName: string;
  thumbnail: string | null;
  flashPrice: number;
  retailPrice: number;
  salePrice?: number | null;
  startAt: string;
  reminded: boolean;
}
export const fetchUpcomingFlashSales = async () =>
  (await takeMeBlock('flashUpcoming')) ?? api.get<UpcomingFlashItem[]>('/flash-sales/upcoming').then((r) => r.data);
export const setFlashReminder = (itemId: string) =>
  api.post(`/flash-sales/items/${itemId}/remind`).then((r) => r.data);
export const cancelFlashReminder = (itemId: string) =>
  api.delete(`/flash-sales/items/${itemId}/remind`).then((r) => r.data);

// Cart
export const getCart = () => api.get<CartSummary>('/cart').then((r) => r.data);
export type AddToCartSource = 'pdp' | 'buy_now' | 'repurchase' | 'wishlist' | 'ctv_sheet' | 'reorder_notification';
export const addToCart = (variationId: string, quantity: number, addSource?: AddToCartSource) =>
  api
    .post<CartSummary>('/cart/items', { variationId, quantity, ...(addSource ? { addSource } : {}) })
    .then((r) => r.data);
export const updateCartItem = (id: string, quantity: number) =>
  api.patch<CartSummary>(`/cart/items/${id}`, { quantity }).then((r) => r.data);
export const removeCartItem = (id: string) =>
  api.delete<CartSummary>(`/cart/items/${id}`).then((r) => r.data);
export const applyCoupon = (code: string) =>
  api.post<CartSummary>('/cart/coupon', { code }).then((r) => r.data);
export const removeCoupon = () => api.delete<CartSummary>('/cart/coupon').then((r) => r.data);

// Addresses
export const getAddresses = () => api.get<AddressDTO[]>('/me/addresses').then((r) => r.data);
export const createAddress = (data: Omit<AddressDTO, 'id' | 'isDefault'>) =>
  api.post<AddressDTO>('/me/addresses', data).then((r) => r.data);

// Checkout
export const checkoutQuote = (addressId: string, pointsToUse?: number, storefrontSlug?: string, itemIds?: string[]) =>
  api.post<CheckoutQuote>('/checkout/quote', { addressId, pointsToUse, storefrontSlug, itemIds }).then((r) => r.data);
/** Đặt hàng kèm Idempotency-Key (AD-004) — retry sau timeout không tạo đơn đôi. */
export interface InvoiceRequest {
  taxCode: string;
  companyName: string;
  address: string;
  email: string;
}
export const placeOrder = (
  body: {
    addressId: string;
    paymentMethod: string;
    pointsToUse?: number;
    /** Khách đã thấy đơn 0đ (FE ẩn chọn phương thức): BE từ chối nếu lúc đặt tổng > 0. */
    quotedZeroTotal?: boolean;
    /** Tổng khách đang thấy (từ báo giá): lúc đặt mà tổng cao hơn thì BE trả TOTAL_CHANGED. */
    expectedTotal?: number;
    note?: string;
    invoiceRequest?: InvoiceRequest;
    referralCode?: string;
    storefrontSlug?: string;
    itemIds?: string[];
    hasRecyclingPickup?: boolean;
    recyclingNote?: string;
  },
  idempotencyKey: string,
) =>
  api
    .post<PlacedOrder>('/checkout/place-order', body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    .then((r) => r.data);

// Reviews
export interface ReviewItem {
  id: string;
  rating: number;
  comment: string | null;
  images: string[];
  videoUrl: string | null;
  createdAt: string;
  author: string;
  avatar: string | null;
  verifiedPurchase?: boolean;
}
export interface ReviewSummary {
  average: number;
  count: number;
  videoCount?: number;
  distribution?: Record<string, number>;
  items: ReviewItem[];
}
export const fetchReviews = (slug: string) =>
  api.get<ReviewSummary>(`/products/${slug}/reviews`).then((r) => r.data);

/** Đánh giá hiện có của chính người dùng cho sản phẩm (Q-30: mua lại thì sửa đánh giá này). */
export interface MyReview {
  id: string;
  rating: number;
  comment: string | null;
  images: string[];
  videoUrl: string | null;
}
/**
 * Hỏi TRƯỚC khi mở ô soạn đánh giá — tránh để khách chưa mua upload ảnh/video rồi mới bị từ chối.
 * `rewardAvailable` (optional, API cũ không trả): false khi khách đã nhận thưởng sản phẩm này hoặc đang có đánh giá;
 * chỉ để ẩn câu gợi ý điểm, máy chủ vẫn quyết định thưởng lúc tạo.
 */
export const canReviewProduct = (slug: string) =>
  api
    .get<{
      canReview: boolean;
      reason: 'NOT_PURCHASED' | null;
      myReview?: MyReview | null;
      rewardAvailable?: boolean;
      purchaseCount?: number;
    }>(
      `/products/${slug}/reviews/can-review`,
    )
    .then((r) => r.data);
/**
 * POST /products/:slug/reviews trả nguyên dòng Review (không có author/avatar như mục của danh sách công khai) kèm
 * `updated`. Hai trường dưới là optional để chịu được API cũ chưa trả.
 * - `updated`: true khi đã có đánh giá và lần gọi này SỬA nó (không cộng Điểm Xanh), false khi tạo mới.
 * - `pointsEarned`: cột của dòng Review. 5/10/15 khi được thưởng; 0 khi khách còn giữ phần thưởng cũ của sản phẩm này
 *   (xoá rồi tạo lại). Khi `updated` là true nó là phần thưởng của lần tạo gốc, không phải của lần gọi này.
 */
export type CreatedReview = Pick<ReviewItem, 'id' | 'rating' | 'comment' | 'images' | 'videoUrl' | 'createdAt'> & {
  pointsEarned?: number;
  updated?: boolean;
};
export const createReview = (
  slug: string,
  data: { rating: number; comment?: string; images?: string[]; videoUrl?: string },
) => api.post<CreatedReview>(`/products/${slug}/reviews`, data).then((r) => r.data);

// Orders
/** Ảnh/tồn kho từng dòng do API join theo variationId (dự án 4a). Optional: API cũ không trả. */
export interface OrderItemMedia {
  thumbnail?: string | null;
  stock?: number;
  available?: boolean;
  currentPrice?: number | null;
}
export type OrderItemView = OrderItemDTO & OrderItemMedia;
export type OrderView = Omit<OrderDTO, 'items'> & {
  items: OrderItemView[];
  /** Mã giảm giá đã dùng và các phần của `discount` (API cũ chưa trả; đơn cũ để 0). */
  couponCode?: string | null;
  couponDiscount?: number;
  comboDiscount?: number;
  tierDiscount?: number;
  pointsDiscount?: number;
  /** Ai giao đơn này (D4). API cũ chưa trả. */
  fulfilment?: { kind: 'TUBU' | 'MERCHANT'; name: string; phone: string | null };
  /** Các đơn khác cùng lần đặt (đơn bị tách theo nơi giao). */
  siblings?: { code: string; status: string; total: number; fulfillerName: string }[];
};
/** Response place-order: đơn chính, kèm danh sách đơn con khi lần đặt bị tách theo nơi giao. */
export type PlacedOrder = OrderDTO & { splitOrders?: SplitOrderDTO[] };

export type OrderStatusGroup = 'processing' | 'closed';
export interface OrderListFilter {
  status?: string;
  group?: OrderStatusGroup;
}

// Bug 1 fix: truoc day khong truyen page/limit -> BE mac dinh page=1 limit=20, khach co >20 don
// khong bao gio xem duoc don cu hon qua app. Nhan them page/limit de orders.tsx phan trang duoc.
export const fetchOrders = async (filter: OrderListFilter = {}, page = 1, limit = 20) => {
  // Dải "đang giao" ở Trang chủ (1 đơn SHIPPING mới nhất) đã có sẵn trong /home/me.
  if (filter.status === 'SHIPPING' && page === 1 && limit === 1) {
    const fromFeed = await takeMeBlock('shippingOrders');
    if (fromFeed) return fromFeed;
  }
  return api
    .get<PageResponse<OrderView>>('/orders', {
      params: {
        ...(filter.status ? { status: filter.status } : filter.group ? { group: filter.group } : {}),
        page,
        limit,
      },
    })
    .then((r) => r.data);
};
export const fetchOrder = (code: string) =>
  api.get<OrderView>(`/orders/${code}`).then((r) => r.data);
/** Badge tab Đơn hàng. Dữ liệu lạ (vd mock/route khác trả nhầm) → 0 thay vì NaN. */
export const fetchActiveOrderCount = async () => {
  const body = (await takeMeBlock('activeOrderCount')) ?? (await api.get<{ count?: unknown }>('/orders/active-count').then((r) => r.data));
  return typeof body?.count === 'number' ? body.count : 0;
};

export interface PurchasedItem {
  variationId: string;
  productId: string;
  slug: string;
  productName: string;
  variationName: string;
  brand: string;
  thumbnail: string | null;
  price: number;
  salePrice: number | null;
  stock: number;
  inStock: boolean;
  timesBought: number;
  lastPurchasedAt: string;
}
export interface PurchasedItemsPage {
  items: PurchasedItem[];
  nextCursor: string | null;
}
export const fetchPurchasedItems = async (params: { cursor?: string; limit?: number; variationId?: string } = {}) =>
  (await takePurchasedItems(params)) ?? api.get<PurchasedItemsPage>('/me/purchased-items', { params }).then((r) => r.data);

/** Nơi nhận tiền hoàn (D2). Không gửi = Ví Tubu (như bản cũ). */
export type RefundDestinationBody =
  | { refundMethod: 'WALLET' }
  | { refundMethod: 'BANK'; bankName: string; accountNumber: string; accountName: string };

export const cancelOrder = (code: string, destination?: RefundDestinationBody) =>
  api.post<OrderDTO>(`/orders/${code}/cancel`, destination ?? {}).then((r) => r.data);
export type RepurchaseAddSource = 'repurchase' | 'reorder_notification';
export type RepurchaseSkipReason = 'OUT_OF_STOCK' | 'INACTIVE' | 'NOT_APPROVED' | 'EXCEEDS_STOCK';
export interface RepurchaseLineResult {
  orderItemId: string;
  status: 'added' | 'partial' | 'skipped';
  reason?: RepurchaseSkipReason;
  addedQuantity: number;
}
export interface RepurchaseResponse {
  cart: CartSummary;
  results: RepurchaseLineResult[];
  /** Response không có kết quả từng dòng (API trước dự án 4a trả giỏ trơn). */
  legacy: boolean;
}
/**
 * API v2 trả `{ ...giỏ, cart, results }`: giỏ ở top-level (để bản miniapp cũ vẫn đọc được) và khoá `cart`
 * tường minh. Ưu tiên khoá `cart`; nếu thiếu thì dùng phần top-level — luôn bỏ `results`/`cart` lồng ra khỏi giỏ.
 */
export function normalizeRepurchaseResponse(
  raw: CartSummary & { cart?: CartSummary; results?: RepurchaseLineResult[] },
): RepurchaseResponse {
  const { results, cart: nested, ...top } = raw;
  const cart: CartSummary = nested ?? top;
  return Array.isArray(results) ? { cart, results, legacy: false } : { cart, results: [], legacy: true };
}
export const repurchaseOrder = (
  code: string,
  body: { items?: { orderItemId: string; quantity: number }[]; addSource?: RepurchaseAddSource } = {},
) =>
  api
    .post<CartSummary & { cart?: CartSummary; results?: RepurchaseLineResult[] }>(`/orders/${code}/repurchase`, body)
    .then((r) => normalizeRepurchaseResponse(r.data));
export interface ReturnRequestBody {
  reasonCode: ReturnReasonCode;
  reason?: string;
  images?: string[];
  items: { orderItemId: string; quantity: number }[];
}
export const requestReturn = (code: string, body: ReturnRequestBody & Partial<RefundDestinationBody>) =>
  api.post<ReturnRequestDTO>(`/orders/${code}/return-request`, body).then((r) => r.data);
/** Số tiền dự kiến hoàn cho các dòng khách đang chọn (cùng cách tính lúc Tubu duyệt). */
export interface ReturnEstimateDTO {
  isFull: boolean;
  goods: number;
  shipping: number;
  refund: number;
  moneyRefundable: boolean;
  pointsUsedBack: number;
  lines: { orderItemId: string; quantity: number; refundAmount: number }[];
}
export const estimateReturn = (code: string, body: { reasonCode?: ReturnReasonCode; items: { orderItemId: string; quantity: number }[] }) =>
  api.post<ReturnEstimateDTO>(`/orders/${code}/return-estimate`, body).then((r) => r.data);
export interface ReturnRequestDTO {
  id: string;
  orderId: string;
  reason: string;
  reasonCode?: string | null;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  adminNote: string | null;
  refundMethod?: 'WALLET' | 'BANK';
  bankName?: string | null;
  bankAccountNo?: string | null;
  /** Tiền hàng + phí ship hoàn khi duyệt (null khi chưa duyệt). */
  refundAmount?: number | null;
  shippingRefund?: number;
  pointsRefunded?: number;
  fullReturn?: boolean;
  receivedAt?: string | null;
  items?: { orderItemId: string; quantity: number; refundAmount: number }[];
  createdAt: string;
}
export const fetchMyReturns = () =>
  api.get<ReturnRequestDTO[]>('/orders/me/returns').then((r) => r.data);

/** Các khoản hoàn tiền của khách (chuyển khoản chờ xử lý, tiền về muộn) cho một đơn. */
export const fetchMyRefunds = (orderId: string) =>
  api.get<MyRefund[]>('/orders/me/refunds', { params: { orderId } }).then((r) => r.data);
/** Tài khoản ngân hàng khách dùng gần nhất — điền sẵn khi chọn hoàn về ngân hàng. */
export const fetchRefundBank = () =>
  api.get<{ bank: RefundBankInput | null }>('/orders/me/refund-bank').then((r) => r.data.bank);
export const chooseRefundDestination = (refundId: string, body: RefundDestinationBody) =>
  api.post<MyRefund>(`/orders/me/refunds/${refundId}/destination`, body).then((r) => r.data);
