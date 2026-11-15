import type {
  CheckoutPickupFields,
  CheckoutPickupQuote,
  CouponPreviewRequest,
  CouponPreviewsResponse,
  InlinePickupInput,
  OrderDTO,
  PickupOptionsResponse,
  QuotePendingGiftDTO,
  ShippingFeeWaivedReason,
} from '@tubutree/shared-types';
import type { HttpClient } from '../http';
import type { LineFulfiller } from './cart';

export type {
  CheckoutPickupFields,
  CheckoutPickupMode,
  CheckoutPickupQuote,
  InlinePickupInput,
  InlinePickupLine,
  PendingGiftRedemptionDTO,
  PickupBlockedReason,
  PickupOptionItem,
  PickupOptionsExistingRequest,
  PickupOptionsResponse,
  QuotePendingGiftDTO,
  ShippingFeeWaivedReason,
} from '@tubutree/shared-types';
export { RECYCLE_PICKUP } from '@tubutree/shared-types';

/** Một kiện của lần đặt: mỗi nơi giao thành một đơn riêng với phí giao và tổng riêng. */
export interface QuoteShipment {
  key: string;
  fulfiller: LineFulfiller;
  itemIds: string[];
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  /** Số tiền phí giao kiện này được miễn nhờ thu rác kèm đơn (0 = không miễn). API cũ chưa trả. */
  shippingFeeWaived?: number;
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
  /** Số tiền hàng còn thiếu để mã đạt đơn tối thiểu của lần đặt này (máy chủ tính trên phần hàng nó xét); không có khi mã chưa áp vì lý do khác. API cũ chưa trả. */
  couponShortfall?: number | null;
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
  /** Tổng phí giao được miễn nhờ thu rác kèm đơn; API cũ chưa trả → coi như 0. */
  shippingFeeWaived?: number;
  /** `RECYCLE_PICKUP` khi có phí giao được miễn vì thu rác kèm đơn; null/thiếu = không. */
  shippingFeeWaivedReason?: ShippingFeeWaivedReason | null;
  /** Phần thu rác kèm đơn; null khi giỏ không có kiện Tubu hoặc cổng đóng và khách không chọn. API cũ chưa trả. */
  pickup?: CheckoutPickupQuote | null;
  /** Quà hiện vật 0đ chờ gắn đơn; `included` = sẽ đi cùng đơn này. API cũ chưa trả → coi như rỗng. */
  pendingGiftRedemptions?: QuotePendingGiftDTO[];
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

/** Chỉ đưa vào thân yêu cầu các trường thu rác khách thực sự chọn: app không chọn thì thân y hệt bản cũ. */
const pickupBody = (pickup?: CheckoutPickupFields): CheckoutPickupFields => {
  const out: CheckoutPickupFields = {};
  if (pickup?.wasteRequestId !== undefined) out.wasteRequestId = pickup.wasteRequestId;
  if (pickup?.inlinePickup !== undefined) out.inlinePickup = pickup.inlinePickup;
  if (pickup?.returnWeightGrams !== undefined) out.returnWeightGrams = pickup.returnWeightGrams;
  if (pickup?.excludeGiftRedemptionIds !== undefined) out.excludeGiftRedemptionIds = pickup.excludeGiftRedemptionIds;
  return out;
};

export const checkoutQuote = (
  http: HttpClient,
  addressId: string,
  pointsToUse?: number,
  storefrontSlug?: string,
  itemIds?: string[],
  pickup?: CheckoutPickupFields,
) => http.post<CheckoutQuote>('/checkout/quote', { addressId, pointsToUse, storefrontSlug, itemIds, ...pickupBody(pickup) });
/** Dữ liệu dựng ngăn chọn món rác ngay trên thanh toán (món chọn được theo địa chỉ, ngưỡng điểm, trần cân nặng gói gửi lại, phiếu thu kèm đang chờ). */
export const getCheckoutPickupOptions = (http: HttpClient, params: { addressId: string; itemIds?: string[] }) =>
  http.get<PickupOptionsResponse>('/checkout/pickup-options', {
    query: { addressId: params.addressId, ...(params.itemIds && params.itemIds.length > 0 ? { itemIds: params.itemIds.join(',') } : {}) },
  });
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
  /** Phiếu thu kèm rác có sẵn (PICKUP, OPEN). Loại trừ với `inlinePickup`. */
  wasteRequestId?: string;
  /** Món rác chọn ngay trên thanh toán; phiếu chỉ được tạo khi đặt đơn. Loại trừ với `wasteRequestId`. */
  inlinePickup?: InlinePickupInput;
  /** Cân nặng gói rác gửi lại (gram): nguyên, từ 500 tới `pickup.maxReturnWeightGrams` của báo giá. */
  returnWeightGrams?: number;
  /** Quà hiện vật khách bỏ ra khỏi đơn này; quà ở lại ví cho đơn sau. */
  excludeGiftRedemptionIds?: string[];
}
/** Đặt hàng kèm Idempotency-Key (AD-004) — retry sau timeout không tạo đơn đôi. */
export const placeOrder = (http: HttpClient, body: PlaceOrderBody, idempotencyKey: string) =>
  http.post<PlacedOrder>('/checkout/place-order', body, { headers: { 'Idempotency-Key': idempotencyKey } });
