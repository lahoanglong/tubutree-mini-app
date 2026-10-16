import type {
  InvoiceStatus,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
} from './enums';

export interface OrderItemDTO {
  id: string;
  variationId: string;
  productName: string;
  /** Slug SP lúc mua — để mở trang sản phẩm từ đơn (đánh giá / mua lại). Null với đơn cũ. */
  productSlug: string | null;
  variationName: string;
  unitPrice: number;
  quantity: number;
  total: number;
  /** Số đơn vị của dòng này CHƯA có hàng thật để giữ chỗ — chỉ > 0 cho đơn ĐẠI LÝ đặt vượt tồn
   * (dealer.service.ts placeOrder cho đặt trước thay vì từ chối). Luôn 0 với đơn khác. */
  backorderedQty: number;
  /** Chỉ GET /orders/:code: đánh giá khách đã viết cho sản phẩm của dòng này ở chính đơn này (mỗi lần mua một đánh giá). */
  reviewId?: string | null;
  /** Chỉ GET /orders/:code: dòng này còn viết đánh giá mới được (đơn đã nhận, mua lẻ cho chính mình, chưa đánh giá). */
  reviewable?: boolean;
}

export interface ShippingAddressSnapshot {
  recipient: string;
  phone: string;
  province: string;
  district: string;
  ward: string;
  street: string;
  provinceCode: string;
  districtCode: string;
  wardCode: string;
}

export interface InvoiceRequest {
  taxCode: string;
  companyName: string;
  address: string;
  email: string;
}

/** Một mốc hành trình vận chuyển (chuẩn hoá từ webhook Pancake). */
export interface ShippingEvent {
  at: string;
  status?: string | null;
  carrier?: string | null;
  code?: string | null;
  note?: string | null;
}

export interface OrderDTO {
  id: string;
  code: string;
  type: OrderType;
  status: OrderStatus;
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  pointsEarned: number;
  pointsUsed: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  shippingAddress: ShippingAddressSnapshot;
  shippingPartner?: string | null;
  shippingCode?: string | null;
  shippingStatus?: string | null;
  trackingLink?: string | null;
  shippingHistory?: ShippingEvent[] | null;
  invoiceStatus?: InvoiceStatus | null;
  invoiceUrl?: string | null;
  note?: string | null;
  /** Khách chọn "gửi lại vật liệu tái chế" (vận đơn đổi hàng Gomdon/BestExpress). */
  hasRecyclingPickup?: boolean;
  recyclingNote?: string | null;
  gomdonOrderId?: string | null;
  /** Mã vận đơn BestExpress (hiển thị cho khách/kho). */
  gomdonPartnerCode?: string | null;
  /**
   * Mã trạng thái Gomdon "1".."12" (1 tạo đơn, 2 huỷ, 3 đã lấy hàng, 4-5 đang giao, 6 chuyển hoàn,
   * 7 giao thành công, 8 đã hoàn, 9 hỏng/mất, 10 lấy không thành công, 11 giao thất bại, 12 hoàn thất bại)
   * HOẶC trạng thái nội bộ trước khi có vận đơn: AWAITING_PAYMENT | CREATING | NEEDS_MANUAL_CHECK |
   * FAILED | NOT_CONFIGURED. null = chưa xử lý.
   */
  gomdonStatus?: string | null;
  /** Kết quả huỷ vận đơn Gomdon khi đơn bị huỷ: CANCELLED | FAILED | TOO_LATE | NOT_NEEDED. */
  gomdonCancelStatus?: string | null;
  /** Thời điểm đơn chuyển DELIVERED — mốc tính hạn đổi/trả (ISO). */
  deliveredAt?: string | null;
  /** Hạn thanh toán của đơn trả trước đang chờ tiền (ISO) — quá hạn đơn tự huỷ. Null với đơn khác. */
  paymentDeadline?: string | null;
  /**
   * Khách đang xem tự huỷ được đơn này không — API tính bằng đúng luật huỷ của khách (gồm cả mốc bàn giao vận chuyển: đã
   * có mã vận đơn hãng, bưu tá đã lấy hàng). API cũ chưa trả.
   */
  canCancel?: boolean;
  /**
   * Đơn chờ thanh toán mà hàng đã bàn giao vận chuyển (hệ thống thôi tự huỷ): Tubu xử lý với khách. App/web không ghi hạn thanh
   * toán, không bày nút trả tiền/huỷ, chỉ một câu "Tubu đang xử lý đơn này". API cũ chưa trả.
   */
  manualHandling?: boolean;
  items: OrderItemDTO[];
  createdAt: string;
  updatedAt: string;
}

/** Mức giảm một mã trong ví cho lần đặt đang xem — POST /checkout/coupon-previews. API cũ không có endpoint này. */
export interface CouponPreviewDTO {
  code: string;
  /** Áp mã này thì checkout có giảm (tiền hàng hoặc phí giao). */
  eligible: boolean;
  /** Vì sao không giảm được (tiếng Việt, đúng câu checkout sẽ báo). */
  reason?: string;
  /** Số tiền hàng mã giảm cho lần đặt này (đúng số checkout trừ). */
  discount: number;
  /** Phí giao mã freeship miễn được; chỉ có khi gửi kèm `addressId` (thanh toán). */
  freeshipSaving?: number;
}

/** Tham số xem trước: cùng tham số báo giá. Thiếu `addressId` (trang giỏ) thì không tính phí giao. */
export interface CouponPreviewRequest {
  addressId?: string;
  storefrontSlug?: string;
  itemIds?: string[];
}

export interface CouponPreviewsResponse {
  coupons: CouponPreviewDTO[];
}
