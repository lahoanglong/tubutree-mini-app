import { api } from './api';
import type { OrderDTO, OrderItemDTO } from '@tubutree/shared-types';

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
}

export interface CartLine {
  id: string;
  variationId: string;
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
}

export interface CartSummary {
  items: CartLine[];
  couponCode: string | null;
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
  comboDiscount: number;
  pointsUsed: number;
  pointsDiscount: number;
  shippingFee: number;
  total: number;
  pointsEarned: number;
  pointsBalance: number;
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
  /** Số ngày giữ trước khi hoàn tiền sàn ngoài về Ví. */
  cashbackHoldDays: number;
  /**
   * Hiện lựa chọn "Gửi lại vật liệu tái chế" ở checkout — true chỉ khi Gomdon đã cấu hình VÀ admin
   * bật. Optional: API bản cũ không trả field này → coi như tắt.
   */
  recyclingEnabled?: boolean;
  /** Khoảng ngày giao dự kiến — null/thiếu khi chủ shop chưa cấu hình (hoặc API cũ) → ẩn. */
  shippingEta?: ShippingEta | null;
}
export const getPublicConfig = () =>
  api.get<PublicConfig>('/config/public').then((r) => r.data);
export const fetchProducts = async (params: Record<string, string | number> = {}): Promise<PageResponse<ProductCard>> => {
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
export const fetchBrands = () =>
  api.get<{ brand: string; count: number }[]>('/brands').then((r) => r.data);
export const fetchRelated = (slug: string) =>
  api.get<ProductCard[]>(`/products/${slug}/related`).then((r) => r.data);
/** Feed "Dành cho bạn" — gợi ý cá nhân hoá (cần đăng nhập, xem home.tsx). */
export const fetchForYou = () =>
  api.get<ProductCard[]>('/products/for-you').then((r) => r.data);
export const fetchBoughtTogether = (slug: string) =>
  api.get<ProductCard[]>(`/products/${slug}/bought-together`).then((r) => r.data);

export interface ProductSuggestion { slug: string; name: string; thumbnail: string | null; basePrice: number; }
export const suggestProducts = (q: string) =>
  api.get<ProductSuggestion[]>('/search/suggest', { params: { q } }).then((r) => r.data);

// Flash sale (public)
export interface FlashSaleActiveItem {
  itemId: string;
  variationId: string;
  productSlug: string;
  productName: string;
  thumbnail: string | null;
  flashPrice: number;
  retailPrice: number;
  soldCount: number;
  quota: number;
  endAt: string;
}
export const fetchActiveFlashSales = () =>
  api.get<FlashSaleActiveItem[]>('/flash-sales/active').then((r) => r.data);

export interface UpcomingFlashItem {
  itemId: string;
  variationId: string;
  productSlug: string;
  productName: string;
  thumbnail: string | null;
  flashPrice: number;
  retailPrice: number;
  startAt: string;
  reminded: boolean;
}
export const fetchUpcomingFlashSales = () =>
  api.get<UpcomingFlashItem[]>('/flash-sales/upcoming').then((r) => r.data);
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
    .post<OrderDTO>('/checkout/place-order', body, {
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

/** Hỏi TRƯỚC khi mở ô soạn đánh giá — tránh để khách chưa mua upload ảnh/video rồi mới bị từ chối. */
export const canReviewProduct = (slug: string) =>
  api
    .get<{ canReview: boolean; reason: 'NOT_PURCHASED' | 'ALREADY_REVIEWED' | null }>(
      `/products/${slug}/reviews/can-review`,
    )
    .then((r) => r.data);
export const createReview = (
  slug: string,
  data: { rating: number; comment?: string; images?: string[]; videoUrl?: string },
) => api.post<ReviewItem>(`/products/${slug}/reviews`, data).then((r) => r.data);

// Orders
/** Ảnh/tồn kho từng dòng do API join theo variationId (dự án 4a). Optional: API cũ không trả. */
export interface OrderItemMedia {
  thumbnail?: string | null;
  stock?: number;
  available?: boolean;
  currentPrice?: number | null;
}
export type OrderItemView = OrderItemDTO & OrderItemMedia;
export type OrderView = Omit<OrderDTO, 'items'> & { items: OrderItemView[] };

export type OrderStatusGroup = 'processing' | 'closed';
export interface OrderListFilter {
  status?: string;
  group?: OrderStatusGroup;
}

// Bug 1 fix: truoc day khong truyen page/limit -> BE mac dinh page=1 limit=20, khach co >20 don
// khong bao gio xem duoc don cu hon qua app. Nhan them page/limit de orders.tsx phan trang duoc.
export const fetchOrders = (filter: OrderListFilter = {}, page = 1, limit = 20) =>
  api
    .get<PageResponse<OrderView>>('/orders', {
      params: {
        ...(filter.status ? { status: filter.status } : filter.group ? { group: filter.group } : {}),
        page,
        limit,
      },
    })
    .then((r) => r.data);
export const fetchOrder = (code: string) =>
  api.get<OrderView>(`/orders/${code}`).then((r) => r.data);
/** Badge tab Đơn hàng. Dữ liệu lạ (vd mock/route khác trả nhầm) → 0 thay vì NaN. */
export const fetchActiveOrderCount = () =>
  api.get<{ count?: unknown }>('/orders/active-count').then((r) => (typeof r.data?.count === 'number' ? r.data.count : 0));

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
export const fetchPurchasedItems = (params: { cursor?: string; limit?: number; variationId?: string } = {}) =>
  api.get<PurchasedItemsPage>('/me/purchased-items', { params }).then((r) => r.data);

export const cancelOrder = (code: string) =>
  api.post<OrderDTO>(`/orders/${code}/cancel`).then((r) => r.data);
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
  /** API cũ (trước dự án 4a) trả giỏ trơn, không có results. */
  legacy: boolean;
}
/** API v2 trả giỏ ở top-level + `results` (để bản miniapp cũ vẫn đọc được giỏ) — tách lại ở đây. */
export function normalizeRepurchaseResponse(raw: CartSummary & { results?: RepurchaseLineResult[] }): RepurchaseResponse {
  const { results, ...cart } = raw;
  return Array.isArray(results) ? { cart, results, legacy: false } : { cart, results: [], legacy: true };
}
export const repurchaseOrder = (
  code: string,
  body: { items?: { orderItemId: string; quantity: number }[]; addSource?: RepurchaseAddSource } = {},
) =>
  api
    .post<CartSummary & { results?: RepurchaseLineResult[] }>(`/orders/${code}/repurchase`, body)
    .then((r) => normalizeRepurchaseResponse(r.data));
export const requestReturn = (code: string, reason: string, images?: string[]) =>
  api.post(`/orders/${code}/return-request`, { reason, images }).then((r) => r.data);
export interface ReturnRequestDTO {
  id: string;
  orderId: string;
  reason: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  adminNote: string | null;
  createdAt: string;
}
export const fetchMyReturns = () =>
  api.get<ReturnRequestDTO[]>('/orders/me/returns').then((r) => r.data);
