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
  /** Đơn chuyển khoản chưa trả đổi được sang trả tiền khi nhận (POST /checkout/guest/orders/:code/switch-to-cod). API cũ không trả. */
  codSwitchable?: boolean;
  /**
   * Hiện thẻ "Kết bạn Zalo Tubu Tree": tin đơn qua Zalo đang bật, khách đồng ý ở đơn này, đơn còn đang đi và MSS chưa gửi được tin nào của đơn
   * tới khách như bạn bè. API cũ không trả = không hiện.
   */
  zaloFriendCard?: boolean;
}

/**
 * Kết quả đổi đơn chuyển khoản chưa trả sang trả tiền khi nhận (POST /orders/:code/switch-to-cod của khách đăng nhập, POST
 * /checkout/guest/orders/:code/switch-to-cod của khách vãng lai). Không đổi được: 409, body `code` = `COD_SWITCH_REFUSED`, `reason` = `CodSwitchRefusalReason`.
 */
export interface CodSwitchResultDTO {
  code: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  total: number;
}

export type CodSwitchRefusalReason =
  | 'ALREADY_PAID'
  | 'CLOSED'
  | 'ALREADY_COD'
  | 'NOT_TRANSFER'
  | 'NOT_PENDING'
  | 'NOT_ELIGIBLE'
  | 'OVER_MAX'
  | 'PAYMENT_IN_PROGRESS';

/** Một dòng bỏ qua khi mua lại: sản phẩm ngừng bán/gỡ (`INACTIVE`) hay hết hàng (`OUT_OF_STOCK`). */
export interface GuestReorderSkippedDTO {
  productName: string;
  variationName: string | null;
  reason: 'INACTIVE' | 'OUT_OF_STOCK';
}

/**
 * GET /checkout/guest/orders/:code/reorder (header `x-order-key`), chỉ đơn đã giao hay đã huỷ: các món mua lại được để trình duyệt thêm vào giỏ
 * khách. Bỏ quà tặng 0đ, món ngừng bán và món hết hàng; số lượng đã kẹp theo tồn kho lúc hỏi. `slug` là slug hiện tại của sản phẩm.
 */
export interface GuestReorderDTO {
  lines: { variationId: string; slug: string; quantity: number; maxQty: number; productName: string; variationName: string | null }[];
  skipped: GuestReorderSkippedDTO[];
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

/**
 * `code` trong body lỗi của POST /checkout/guest/lookup:
 * - GUEST_ORDER_CLAIMED (403): mã + SĐT khớp nhưng đơn đã về một tài khoản Zalo, nên không trả bản xem hay khoá tạm; khách đăng nhập Zalo để xem.
 * - GUEST_LOOKUP_LIMIT (429): chạm trần tra cứu (theo mã, IP hoặc SĐT); `message` ghi số phút còn phải chờ.
 */
export const GUEST_ORDER_CLAIMED = 'GUEST_ORDER_CLAIMED';
export const GUEST_LOOKUP_LIMIT = 'GUEST_LOOKUP_LIMIT';
