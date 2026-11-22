/**
 * Đơn đặt không đăng nhập trên web (cờ `web.guest_checkout_enabled`): trang theo dõi `/don/<mã>#k=<khoá>` và trang tra cứu `/don`.
 * Bản xem đã che: không tên người nhận, không số nhà, SĐT che 4 số giữa, chỉ phường/xã và tỉnh.
 */

export interface GuestOrderTrackItemDTO {
  productName: string;
  variationName: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  isGift: boolean;
}

/** GET /checkout/guest/orders/:code (header `x-order-key`). */
export interface GuestOrderTrackDTO {
  code: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  createdAt: string;
  deliveredAt: string | null;
  statusTimes: Record<string, string>;
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  items: GuestOrderTrackItemDTO[];
  /** 0912345678 → 091****678. */
  phoneMasked: string;
  area: { ward: string; province: string };
  siblings: { code: string; status: string; total: number }[];
  /** Đơn đã xong (giao, huỷ, hoàn): mốc đường dẫn theo dõi hết hạn. Đơn đang chạy: null. */
  expiresAt: string | null;
}

/**
 * POST /checkout/guest/lookup: tra đơn bằng mã đơn + SĐT đặt hàng. Khớp thì trả bản xem đã che và một khoá theo dõi tạm (cùng khuôn 43 ký tự
 * với khoá của trình duyệt, sống `linkExpiresAt`) để mở `/don/<mã>#k=<khoá>`. Sai mã hay sai SĐT: cùng một 404.
 */
export interface GuestOrderLookupDTO {
  order: GuestOrderTrackDTO;
  trackingKey: string;
  /** `/don/<mã>#k=<khoá>`. */
  trackPath: string;
  /** Đơn chuyển khoản đang chờ tiền: `/thanh-toan/chuyen-khoan/<mã>#k=<khoá>` mở lại mã QR. Còn lại: null. */
  bankPath: string | null;
  linkExpiresAt: string;
}
