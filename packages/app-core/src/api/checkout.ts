import type { CouponPreviewRequest, CouponPreviewsResponse, OrderDTO } from '@tubutree/shared-types';
import type { HttpClient } from '../http';
import type { LineFulfiller } from './cart';

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

export interface CheckoutQuote {
  subtotal: number;
  discount: number;
  /** Mã trong giỏ chưa được áp cho đơn này (không giảm, không tiêu lượt) — câu giải thích cho khách. */
  couponNotice?: string | null;
  comboDiscount: number;
  /** Ưu đãi hạng thành viên tự động (API cũ chưa trả). */
  tierDiscount?: number;
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

export type PlacedOrder = OrderDTO & { splitOrders?: SplitOrderDTO[] };

export const getAddresses = (http: HttpClient) => http.get<AddressDTO[]>('/me/addresses');
export const createAddress = (http: HttpClient, data: Omit<AddressDTO, 'id' | 'isDefault'>) =>
  http.post<AddressDTO>('/me/addresses', data);

export const checkoutQuote = (http: HttpClient, addressId: string, pointsToUse?: number, storefrontSlug?: string, itemIds?: string[]) =>
  http.post<CheckoutQuote>('/checkout/quote', { addressId, pointsToUse, storefrontSlug, itemIds });
/** Mức giảm từng mã trong ví cho lần đặt đang xem, đúng số checkout trừ (thiếu addressId thì chưa tính phí giao). */
export const getCouponPreviews = (http: HttpClient, params: CouponPreviewRequest) =>
  http.post<CouponPreviewsResponse>('/checkout/coupon-previews', params).then((r) => r.coupons);
export interface InvoiceRequest {
  taxCode: string;
  companyName: string;
  address: string;
  email: string;
}
export interface PlaceOrderBody {
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
  wasteRequestId?: string;
}
/** Đặt hàng kèm Idempotency-Key (AD-004) — retry sau timeout không tạo đơn đôi. */
export const placeOrder = (http: HttpClient, body: PlaceOrderBody, idempotencyKey: string) =>
  http.post<PlacedOrder>('/checkout/place-order', body, { headers: { 'Idempotency-Key': idempotencyKey } });
