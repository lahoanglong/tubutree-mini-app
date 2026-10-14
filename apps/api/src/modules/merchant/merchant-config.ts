/**
 * Mặc định trong mã của các khoá SystemConfig `merchant.*` (đối tác tự giao — docs/2026-10-14-merchant-fulfilment-design.md).
 * Seed và migration ghi đúng các số này; code đọc qua SystemConfigService.get(key, mặc định).
 */
export const DEFAULT_MERCHANT_SHIPPING_FEE = 30_000;
/** Phí sàn trên tiền hàng đơn đối tác tự giao (phân số). */
export const DEFAULT_MERCHANT_COMMISSION_PCT = 0.15;
/** Số ngày sau khi giao mới đối soát — trùng hạn đổi/trả mặc định. */
export const DEFAULT_MERCHANT_SETTLEMENT_HOLD_DAYS = 7;
/** Phiếu đối soát âm: đối tác nộp lại Tubu trong chừng này ngày kể từ ngày lập phiếu. */
export const DEFAULT_MERCHANT_NEGATIVE_PAYOUT_DUE_DAYS = 7;
/** Đối tác phải bấm "Xác nhận" trong chừng này giờ kể từ khi đơn vào hàng chờ. */
export const DEFAULT_MERCHANT_CONFIRM_SLA_HOURS = 24;
/** Đối tác phải giao cho đơn vị vận chuyển trong chừng này giờ kể từ khi đơn vào hàng chờ. */
export const DEFAULT_MERCHANT_SHIP_SLA_HOURS = 48;
/** Đơn đang giao quá chừng này ngày chưa "Đã giao" thì admin cần hỏi đối tác. */
export const DEFAULT_MERCHANT_DELIVER_SLA_DAYS = 7;
/** Subdomain/tên miền gian hàng vừa nhả chỉ gian hàng khác dùng lại sau chừng này ngày (SELLER-5). */
export const DEFAULT_IDENTIFIER_COOLDOWN_DAYS = 90;
/** Vai trò vào được Cổng người bán (MerchantController). Chủ gian hàng đối tác ngoài các vai trò này không xử lý được đơn tự giao. */
export const MERCHANT_PORTAL_ROLES = ['DEALER', 'AFFILIATE', 'ADMIN'] as const;
/** Khoá dòng đảo của một lần trả một phần (D3) trên phiếu đối soát: `RETURN:<id yêu cầu trả>`. */
export const RETURN_REF_PREFIX = 'RETURN:';

/** Hàng "Tubu giao hộ" chỉ tự vào bảng kê với đơn đặt từ mốc này (chuỗi ISO 8601). */
export const CONSIGNMENT_SETTLE_FROM_KEY = 'merchant.consignment_settle_from';

const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-](\d{2}):(\d{2}))?)?$/;

/**
 * Mốc bắt đầu đối soát giao hộ từ giá trị lưu: chuỗi ISO 8601 ("2026-10-14T00:00:00Z", "2026-10-14T07:00:00+07:00",
 * "2026-10-14"); không ghi múi giờ thì hiểu là UTC. Ngày giờ không có thật (2026-13-01, 2026-02-30) hoặc sai dạng → null.
 */
export function parseConsignmentSettleFrom(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const m = ISO_INSTANT.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6]].map((x) => Number(x ?? 0)) as [
    number, number, number, number, number, number,
  ];
  const zone = m[8];
  const zoneH = Number(m[9] ?? 0);
  const zoneM = Number(m[10] ?? 0);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59 || zoneH > 14 || zoneM > 59) {
    return null;
  }
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  const offsetMinutes = !zone || zone === 'Z' ? 0 : (zone.startsWith('-') ? -1 : 1) * (zoneH * 60 + zoneM);
  const ms = Number((m[7] ?? '0').padEnd(3, '0'));
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms) - offsetMinutes * 60_000);
}
