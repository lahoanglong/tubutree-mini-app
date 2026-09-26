/**
 * Trạng thái vận đơn Gomdon trên Order.gomdonStatus.
 *
 * Cột này chứa MỘT trong hai loại giá trị:
 *  - mã số Gomdon gửi qua webhook ("1".."12", xem GOMDON_STATUS_TEXT), hoặc
 *  - trạng thái NỘI BỘ trước khi có vận đơn (GOMDON_STATE bên dưới).
 *
 * Quy tắc an toàn tiền/kho:
 *  - Chỉ tạo vận đơn khi đơn "thanh toán được" (COD, hoặc đã PAID) — isGomdonPayable().
 *  - CREATING là "claim" nguyên tử trước khi gọi API tạo đơn: thấy CREATING mà chưa có mã vận đơn
 *    thì KHÔNG gọi tạo lại (có thể Gomdon đã tạo — gọi lại là ra vận đơn trùng), chuyển sang
 *    NEEDS_MANUAL_CHECK để người kiểm tra trên Gomdon.
 *  - Webhook không bao giờ làm lùi trạng thái (gomdonRank + gomdonStatusAt).
 */
export const GOMDON_STATE = {
  /** Đơn trả trước (chuyển khoản/ZaloPay) chưa thanh toán — chờ thanh toán xong mới tạo vận đơn. */
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  /** Đang gọi API tạo vận đơn (claim nguyên tử). */
  CREATING: 'CREATING',
  /** Kết quả tạo vận đơn không rõ (timeout/5xx/thiếu mã…) — có thể đã tạo, cần kiểm tra tay trên Gomdon. */
  NEEDS_MANUAL_CHECK: 'NEEDS_MANUAL_CHECK',
  /** Gomdon từ chối chắc chắn sau hết lượt retry — chưa có vận đơn nào, kho tạo vận đơn tay. */
  FAILED: 'FAILED',
  /** Chưa cấu hình Gomdon (thiếu base URL/tài khoản) — kho tạo vận đơn tay. */
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  /**
   * Admin bấm "Đã xử lý tay": vận đơn thu gom đã được người xử lý ngoài hệ thống (tạo tay / hẹn riêng /
   * báo khách). Hệ thống KHÔNG tự tạo vận đơn nữa, đơn rời hàng đợi "Cần xử lý thu gom".
   */
  MANUAL_HANDLED: 'MANUAL_HANDLED',
} as const;

export type GomdonInternalState = (typeof GOMDON_STATE)[keyof typeof GOMDON_STATE];

/** Hãng vận chuyển của vận đơn Gomdon (ghi vào Order.shippingPartner). */
export const GOMDON_CARRIER = 'BestExpress';

/**
 * Trạng thái admin được đánh dấu "Đã xử lý tay": chưa/không có vận đơn tự động (FAILED /
 * NOT_CONFIGURED / NEEDS_MANUAL_CHECK) hoặc Gomdon báo huỷ / hoàn / hỏng / lấy-giao thất bại.
 * KHÔNG gồm vận đơn đang chạy bình thường (1, 3–5, 7), CREATING, AWAITING_PAYMENT.
 */
export const GOMDON_MANUAL_HANDLEABLE: readonly string[] = [
  GOMDON_STATE.FAILED,
  GOMDON_STATE.NOT_CONFIGURED,
  GOMDON_STATE.NEEDS_MANUAL_CHECK,
  '2',
  '6',
  '8',
  '9',
  '10',
  '11',
  '12',
];

/** Kết quả huỷ vận đơn Gomdon khi đơn bị huỷ (Order.gomdonCancelStatus). */
export const GOMDON_CANCEL = {
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
  /** Bưu tá đã lấy hàng — không huỷ được bằng API, cần CSKH xử lý. */
  TOO_LATE: 'TOO_LATE',
  /** Đơn không có vận đơn Gomdon nào để huỷ. */
  NOT_NEEDED: 'NOT_NEEDED',
} as const;

export const GOMDON_STATUS_TEXT: Record<number, string> = {
  1: 'Tạo đơn thành công',
  2: 'Đơn hủy',
  3: 'Đã lấy hàng',
  4: 'Đang vận chuyển đến bưu cục nhận',
  5: 'Đang đi giao hàng',
  6: 'Đang chuyển hoàn',
  7: 'Giao thành công',
  8: 'Đã hoàn hàng',
  9: 'Đơn hỏng, mất hàng',
  10: 'Đơn lấy hàng không thành công',
  11: 'Đơn giao hàng thất bại',
  12: 'Đơn hoàn hàng thất bại',
};

/** Bưu tá đã lấy hàng / đang giao → đơn local sang SHIPPING. */
export const GOMDON_IN_TRANSIT_STATUSES = new Set([3, 4, 5]);
export const GOMDON_DELIVERED_STATUS = 7;
/** Huỷ / lỗi / hoàn — chỉ ghi nhận + báo CSKH, KHÔNG tự hoàn tiền/huỷ đơn. */
export const GOMDON_PROBLEM_STATUSES = new Set([2, 6, 8, 9, 10, 11, 12]);

/**
 * Thứ bậc tiến trình để webhook không lùi trạng thái. Mốc cuối (2/7/8/9) không bị ghi đè.
 * 10 (lấy không thành công) đứng TRƯỚC 3 vì bưu tá có thể lấy lại thành công sau đó;
 * 11 (giao thất bại) cùng bậc với 5 vì có thể giao lại (so tiếp theo created_time).
 */
const RANK: Record<number, number> = {
  1: 10,
  10: 20,
  3: 30,
  4: 40,
  5: 50,
  11: 50,
  6: 60,
  12: 65,
  7: 90,
  8: 90,
  9: 90,
  2: 90,
};
const TERMINAL_RANK = 90;

/** Mã số Gomdon từ chuỗi gomdonStatus; trạng thái nội bộ/null → null. */
export function gomdonStatusNumber(status: string | null | undefined): number | null {
  if (status == null || !/^\d+$/.test(status)) return null;
  return Number(status);
}

/** Bậc tiến trình của một giá trị gomdonStatus (trạng thái nội bộ/null = 0). */
export function gomdonRank(status: string | null | undefined): number {
  const n = gomdonStatusNumber(status);
  return n == null ? 0 : (RANK[n] ?? 0);
}

export function isGomdonTerminal(status: string | null | undefined): boolean {
  return gomdonRank(status) >= TERMINAL_RANK;
}

/** Bưu tá đã cầm hàng (không huỷ được bằng API, khách không tự huỷ được nữa). */
export function isGomdonPickedUp(status: string | null | undefined): boolean {
  const n = gomdonStatusNumber(status);
  return n != null && n !== 1 && n !== 2 && n !== 10;
}

/** Đơn "thanh toán được" để giao: COD (thu khi giao) hoặc đã thanh toán. */
export function isGomdonPayable(order: { paymentMethod: string; paymentStatus: string }): boolean {
  return order.paymentMethod === 'COD' || order.paymentStatus === 'PAID';
}

export function gomdonStatusText(status: number): string {
  return GOMDON_STATUS_TEXT[status] ?? `Trạng thái ${status}`;
}
