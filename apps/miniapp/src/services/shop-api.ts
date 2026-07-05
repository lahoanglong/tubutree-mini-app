import { api } from './api';
import type { OrderDTO } from '@tubutree/shared-types';

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
export interface PublicConfig {
  freeshipThreshold: number;
}
export const getPublicConfig = () =>
  api.get<PublicConfig>('/config/public').then((r) => r.data);
export const fetchProducts = (params: Record<string, string | number> = {}) =>
  api.get<PageResponse<ProductCard>>('/products', { params }).then((r) => r.data);
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
export const addToCart = (variationId: string, quantity: number) =>
  api.post<CartSummary>('/cart/items', { variationId, quantity }).then((r) => r.data);
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
export const createReview = (
  slug: string,
  data: { rating: number; comment?: string; images?: string[]; videoUrl?: string },
) => api.post<ReviewItem>(`/products/${slug}/reviews`, data).then((r) => r.data);

// Orders
export const fetchOrders = (status?: string) =>
  api.get<PageResponse<OrderDTO>>('/orders', { params: status ? { status } : {} }).then((r) => r.data);
export const fetchOrder = (code: string) =>
  api.get<OrderDTO>(`/orders/${code}`).then((r) => r.data);
export const cancelOrder = (code: string) =>
  api.post<OrderDTO>(`/orders/${code}/cancel`).then((r) => r.data);
export const repurchaseOrder = (code: string) =>
  api.post<CartSummary>(`/orders/${code}/repurchase`).then((r) => r.data);
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
