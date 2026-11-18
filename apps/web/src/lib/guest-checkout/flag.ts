/**
 * Phần của GET /config/public mà thanh toán không đăng nhập đọc. `/thanh-toan` và giỏ khách mỗi nơi giữ một kiểu PublicConfig riêng
 * (lib/shop-client, app-core) nên ở đây chỉ khai đúng hai trường cần.
 */
export interface GuestCheckoutConfig {
  webGuestCheckoutEnabled?: unknown;
  newCustomer?: { welcomeVoucher?: { amount?: unknown } | null } | null;
}

/** Chỉ đúng boolean `true` từ máy chủ mới bật; API cũ không trả trường thì tắt. */
export function guestCheckoutOn(cfg: unknown): boolean {
  return (cfg as GuestCheckoutConfig | null | undefined)?.webGuestCheckoutEnabled === true;
}

/** Số tiền quà đơn đầu cho dòng mời đăng nhập; thiếu hay sai kiểu thì null (ẩn dòng). */
export function welcomeAmountOf(cfg: unknown): number | null {
  const amount = (cfg as GuestCheckoutConfig | null | undefined)?.newCustomer?.welcomeVoucher?.amount;
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0 ? amount : null;
}
