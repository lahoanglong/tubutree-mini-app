/**
 * Mặc định trong mã của các khoá SystemConfig `merchant.*` (đối tác tự giao — docs/2026-10-14-merchant-fulfilment-design.md).
 * Seed và migration ghi đúng các số này; code đọc qua SystemConfigService.get(key, mặc định).
 */
export const DEFAULT_MERCHANT_SHIPPING_FEE = 30_000;
/** Phí sàn trên tiền hàng đơn đối tác tự giao (phân số). */
export const DEFAULT_MERCHANT_COMMISSION_PCT = 0.15;
/** Số ngày sau khi giao mới đối soát — trùng hạn đổi/trả mặc định. */
export const DEFAULT_MERCHANT_SETTLEMENT_HOLD_DAYS = 7;
/** Đối tác phải bấm "Xác nhận" trong chừng này giờ kể từ khi đơn vào hàng chờ. */
export const DEFAULT_MERCHANT_CONFIRM_SLA_HOURS = 24;
/** Đối tác phải giao cho đơn vị vận chuyển trong chừng này giờ kể từ khi đơn vào hàng chờ. */
export const DEFAULT_MERCHANT_SHIP_SLA_HOURS = 48;
/** Đơn đang giao quá chừng này ngày chưa "Đã giao" thì admin cần hỏi đối tác. */
export const DEFAULT_MERCHANT_DELIVER_SLA_DAYS = 7;
/** Subdomain/tên miền gian hàng vừa nhả chỉ gian hàng khác dùng lại sau chừng này ngày (SELLER-5). */
export const DEFAULT_IDENTIFIER_COOLDOWN_DAYS = 90;
