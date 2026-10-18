import type { HttpClient, RequestOptions } from '../http';

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
  /** Giảm giá combo của gian hàng đang ghi công (đã trừ trước khi tính mã); API cũ chưa trả → coi như 0. */
  comboDiscount?: number;
  /** Mức giảm của mã, tính trên phần hàng sau combo (cùng số báo giá checkout trừ). */
  discount: number;
  /** Ưu đãi hạng thành viên, tính sau combo và mã (cùng số báo giá checkout trừ); API cũ chưa trả → coi như 0. */
  tierDiscount?: number;
  freeship: boolean;
  /** Ngưỡng freeship từ SystemConfig — cho progress bar khích lệ. */
  freeshipThreshold: number;
  itemCount: number;
}

export type AddToCartSource = 'pdp' | 'buy_now' | 'repurchase' | 'wishlist' | 'ctv_sheet' | 'reorder_notification';

/**
 * Gian hàng CTV đang ghi công (cùng slug màn thanh toán gửi cho báo giá): máy chủ trừ combo của gian hàng đó trong giỏ, để số giảm
 * và tiền hàng ở trang giỏ đúng số thanh toán sẽ trừ. Mọi đường trả giỏ đều gửi để giỏ trong cache không đổi số giữa các thao tác.
 * Nơi gọi tự đọc gian hàng từ ngữ cảnh của mình và truyền vào `storefrontSlug` (null/thiếu = không gian hàng).
 */
function cartOpts(storefrontSlug: string | null | undefined): RequestOptions | undefined {
  return storefrontSlug ? { query: { storefrontSlug } } : undefined;
}
export const getCart = (http: HttpClient, storefrontSlug?: string | null) => http.get<CartSummary>('/cart', cartOpts(storefrontSlug));
/** Giá của MỘT PHẦN giỏ (các dòng đang chọn): combo, mã và hạng tính trên đúng phần đó, cùng số báo giá thanh toán trừ. Chỉ đọc. */
export const getCartSelection = (http: HttpClient, itemIds: string[], storefrontSlug?: string | null) =>
  http.get<CartSummary>('/cart', { query: { ...cartOpts(storefrontSlug)?.query, itemIds: itemIds.join(',') } });
export const addToCart = (http: HttpClient, variationId: string, quantity: number, addSource?: AddToCartSource, storefrontSlug?: string | null) =>
  http.post<CartSummary>('/cart/items', { variationId, quantity, ...(addSource ? { addSource } : {}) }, cartOpts(storefrontSlug));
export const updateCartItem = (http: HttpClient, id: string, quantity: number, storefrontSlug?: string | null) =>
  http.patch<CartSummary>(`/cart/items/${id}`, { quantity }, cartOpts(storefrontSlug));
export const removeCartItem = (http: HttpClient, id: string, storefrontSlug?: string | null) =>
  http.delete<CartSummary>(`/cart/items/${id}`, cartOpts(storefrontSlug));
export const applyCoupon = (http: HttpClient, code: string, storefrontSlug?: string | null) =>
  http.post<CartSummary>('/cart/coupon', { code }, cartOpts(storefrontSlug));
export const removeCoupon = (http: HttpClient, storefrontSlug?: string | null) =>
  http.delete<CartSummary>('/cart/coupon', cartOpts(storefrontSlug));
