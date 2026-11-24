import { startOfVnDay, vnDateKey, VN_OFFSET_MS } from '../../common/vn-time';

/**
 * Bản tin sáng 08:00 gửi chủ shop qua kênh email vận hành (DailyDigestService gom, `dailyDigestEmail` dựng thư). Chỉ số đếm, mã đơn, SKU,
 * tên hàng và cụm tìm đã lọc (không email/SĐT): không tên, SĐT hay địa chỉ khách.
 */
export const DIGEST_STUCK_HOURS = 48;
export const DIGEST_LOW_STOCK_MAX = 5;
export const DIGEST_ORDER_LIST_MAX = 5;
export const DIGEST_LOW_STOCK_LIST_MAX = 10;
export const DIGEST_ZERO_RESULT_TOP = 5;

/** Cùng định nghĩa với báo cáo Doanh thu của admin (admin-revenue.ts), tính theo ngày đặt đơn giờ VN. */
export interface DigestOrders {
  placed: number;
  /** Trong số đơn đặt hôm đó, bao nhiêu đơn nay đã huỷ hoặc trả. */
  cancelled: number;
  paidOrders: number;
  revenue: number;
  gmv: number;
}

/** Đơn chuyển khoản còn chờ tiền lúc gửi bản tin (không chỉ đơn đặt hôm qua). */
export interface DigestUnpaidTransfers {
  count: number;
  amount: number;
  oldest: Array<{ code: string; createdAt: string; total: number }>;
}

/** Đơn đã xác nhận hoặc đóng gói mà không đổi trạng thái quá `DIGEST_STUCK_HOURS` giờ (chưa giao cho vận chuyển). */
export interface DigestStuckOrders {
  count: number;
  oldest: Array<{ code: string; status: string; since: string }>;
}

/** Biến thể đang bán do kho Tubu giao (qua Pancake) có tồn bán được từ `DIGEST_LOW_STOCK_MAX` trở xuống, kể cả đã hết. */
export interface DigestLowStock {
  count: number;
  outOfStock: number;
  items: Array<{ sku: string; name: string; stock: number }>;
}

export interface DigestZeroResult {
  term: string;
  count: number;
}

/** `null` ở một mục = truy vấn mục đó lỗi; thư vẫn gửi với các mục còn lại và ghi rõ mục thiếu. */
export interface DailyDigest {
  /** Ngày VN được tóm tắt ('YYYY-MM-DD'), tức hôm qua so với lúc gửi. */
  day: string;
  generatedAt: string;
  orders: DigestOrders | null;
  unpaidTransfers: DigestUnpaidTransfers | null;
  stuckOrders: DigestStuckOrders | null;
  lowStock: DigestLowStock | null;
  zeroResults: DigestZeroResult[] | null;
  serverErrors: number | null;
}

export const DIGEST_SECTIONS = ['orders', 'unpaidTransfers', 'stuckOrders', 'lowStock', 'zeroResults', 'serverErrors'] as const;

/** Ngày VN hôm qua so với `now`. */
export function digestDayFor(now: Date): string {
  return vnDateKey(new Date(startOfVnDay(now).getTime() - 1));
}

/** [00:00, 24:00) giờ VN của ngày 'YYYY-MM-DD', theo UTC. */
export function digestDayRange(day: string): { start: Date; end: Date } {
  const start = new Date(Date.parse(`${day}T00:00:00Z`) - VN_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

/** 'YYYY-MM-DD' thành '23/11/2026'. */
export function digestDayLabel(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}
