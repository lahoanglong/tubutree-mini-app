/**
 * Hằng và hàm thuần của luồng sự kiện đơn gửi MSS (hợp đồng tubu-mss-order-events v1.2). File không import service: recorder,
 * worker, callback, notifications và spec cùng đọc từ đây.
 */

export const MSS_ORDER_EVENT_TYPES = ['order.created', 'order.payment_confirmed', 'order.shipping', 'order.delivered', 'order.cancelled'] as const;
export type MssOrderEventType = (typeof MSS_ORDER_EVENT_TYPES)[number];

export const MSS_OUTBOX_STATUSES = [
  'PENDING',
  'SENDING',
  'DELIVERED',
  'RESULT_SENT',
  'RESULT_SKIPPED',
  'RESULT_FAILED',
  'RESULT_UNKNOWN',
  'DEAD',
  'EXPIRED',
  'CANCELLED',
] as const;
export type MssOutboxStatus = (typeof MSS_OUTBOX_STATUSES)[number];

/** MSS đang giữ (hoặc sắp nhận) sự kiện: chưa có kết quả cuối, kênh ZNS của tin tương ứng phải chờ. */
export const MSS_HOLDING_STATUSES: readonly MssOutboxStatus[] = ['PENDING', 'SENDING', 'DELIVERED'];

/** Kết quả cuối mà khách chắc chắn hoặc có thể đã nhận tin Zalo: không gửi ZNS cho sự kiện này (tránh tin đôi). */
export const MSS_NO_ZNS_STATUSES: readonly MssOutboxStatus[] = ['RESULT_SENT', 'RESULT_UNKNOWN'];

/**
 * Lý do `skipped` mà khách đã/sẽ nhận một tin Zalo khác của cùng đơn (MSS gộp hoặc bỏ sự kiện cũ, mục 5.1 và 6 của hợp đồng):
 * đường lui chỉ còn trong app, không thêm ZNS cho sự kiện đã bị thay.
 */
export const MSS_COVERED_SKIP_REASONS: ReadonlySet<string> = new Set(['superseded', 'out_of_order', 'duplicate_type']);

export const MSS_SENDER = 'tubutree';

/** Hạn sống kể từ `occurredAt` (hợp đồng mục 5.2): tin báo trễ còn tệ hơn không báo. */
export const MSS_EVENT_TTL_MS: Record<MssOrderEventType, number> = {
  'order.created': 6 * 3_600_000,
  'order.payment_confirmed': 6 * 3_600_000,
  'order.shipping': 24 * 3_600_000,
  'order.delivered': 24 * 3_600_000,
  'order.cancelled': 24 * 3_600_000,
};

/** Lịch thử lại sau lần gọi lỗi thứ n (hợp đồng mục 5.2): tối đa 6 lần gọi. */
export const MSS_RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000, 7_200_000] as const;
export const MSS_MAX_ATTEMPTS = MSS_RETRY_DELAYS_MS.length + 1;
/** MSS báo không nhận (503) hoặc cầu dao ngắt kéo dài quá chừng này kể từ lúc trạng thái đổi: chuyển sự kiện sang đường lui (hợp đồng mục 12). */
export const MSS_UNAVAILABLE_GIVE_UP_MS = 30 * 60_000;
/** Dòng SENDING không ai ghi kết quả quá chừng này: tiến trình đã chết giữa lúc gửi, nhận lại được. */
export const MSS_CLAIM_STALE_MS = 2 * 60_000;
/** Đối soát `GET` cho dòng đã giao MSS quá chừng này mà chưa có callback (hợp đồng mục 4.3). */
export const MSS_RESULT_RECONCILE_AFTER_MS = 15 * 60_000;
/** Quá hạn sống chừng này mà MSS vẫn báo đang xếp hàng: coi như không rõ kết quả, chỉ trong app. */
export const MSS_RESULT_STUCK_GRACE_MS = 2 * 3_600_000;

export const MSS_ORDER_EVENTS_QUEUE = 'mss-order-events';
export const MSS_ORDER_EVENT_JOB = 'deliver';

/** Phiên bản câu chữ đồng ý (mục 7 hợp đồng, quyết định PO số 3) lưu kèm lựa chọn của khách làm bằng chứng. */
export const ORDER_ZALO_CONSENT_TEXT_VERSION = 'order-zalo-v1-2026-11-17';
export type OrderZaloConsentSource = 'checkout' | 'account_settings' | 'mss_opt_out';

export type MssCancelReason = 'CUSTOMER' | 'OUT_OF_STOCK' | 'PAYMENT_TIMEOUT' | 'OTHER';

/**
 * Loại sự kiện MSS mà một tin ZNS đơn hàng thay thế, đọc từ chính tin đó. "Đơn đã xác nhận" có dòng đã nhận tiền (`payment_note`, chỉ
 * orderConfirmedData đặt khi PAID) là tin thanh toán, không có là tin đặt đơn. Không lấy dòng của loại kia: loại kia có thể đã gửi xong
 * trong khi sự kiện của tin này bị bỏ qua, và tin ZNS sẽ bị nuốt. Hôm nay chỉ ORDER_CONFIRMED và ORDER_SHIPPING có kênh ZNS; hai mẫu sau
 * có mặt để admin đổi kênh sang ZNS cũng không thành tin đôi.
 */
export function mssEventTypeForZns(templateCode: string, data: Record<string, string>): MssOrderEventType | null {
  switch (templateCode) {
    case 'ORDER_CONFIRMED':
      return data.payment_note ? 'order.payment_confirmed' : 'order.created';
    case 'ORDER_SHIPPING':
      return 'order.shipping';
    case 'ORDER_DELIVERED':
      return 'order.delivered';
    case 'ORDER_CANCELLED':
      return 'order.cancelled';
    default:
      return null;
  }
}

/** Quá hạn sống của sự kiện chừng này thì đường lui không gửi ZNS đã hoãn nữa (tin trễ còn tệ hơn không báo), chỉ còn tin trong app. */
export const MSS_FALLBACK_ZNS_GRACE_MS = 15 * 60_000;

/** Token NotificationsService tiêm (@Optional): không có thì kênh ZNS đi đúng đường cũ. */
export const MSS_ZNS_HOLD = Symbol('MSS_ZNS_HOLD');

export interface MssZnsHoldPort {
  /**
   * Hỏi trước khi gửi ZNS của tin đơn hàng. true = KHÔNG gửi ZNS lần này: MSS đang giữ sự kiện (tin ZNS được cất vào dòng outbox,
   * đường lui gửi nếu MSS không gửi được), MSS đã gửi, hoặc sự kiện chỉ còn đường lui trong app. false = gửi ZNS như cũ.
   */
  holdZns(userId: string, templateCode: string, data: Record<string, string>, znsTemplateId: string): Promise<boolean>;
}

export function isMssOrderEventType(v: unknown): v is MssOrderEventType {
  return typeof v === 'string' && (MSS_ORDER_EVENT_TYPES as readonly string[]).includes(v);
}

/** Thời điểm thử lại sau lần gọi lỗi thứ `attempts` (1-based), nhiễu ±20%, không sớm hơn `Retry-After`. null = hết lượt. */
export function nextRetryAt(attempts: number, now: number, retryAfterSec?: number, random: () => number = Math.random): Date | null {
  if (attempts >= MSS_MAX_ATTEMPTS) return null;
  const base = MSS_RETRY_DELAYS_MS[Math.max(0, attempts - 1)] ?? MSS_RETRY_DELAYS_MS[MSS_RETRY_DELAYS_MS.length - 1]!;
  const jittered = Math.round(base * (0.8 + 0.4 * random()));
  const floor = retryAfterSec !== undefined && Number.isFinite(retryAfterSec) ? Math.max(0, retryAfterSec) * 1000 : 0;
  return new Date(now + Math.max(jittered, floor));
}

/** Băm ổn định theo khách cho `mss.order_events_rollout_pct`: cùng khách luôn cùng nhóm, tăng tỉ lệ chỉ thêm khách. */
export function rolloutBucket(userId: string): number {
  let h = 2166136261;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100;
}

export function inRollout(userId: string, pct: number): boolean {
  if (pct >= 100) return true;
  if (pct <= 0) return false;
  return rolloutBucket(userId) < pct;
}

/** SĐT dạng nội địa `0xxxxxxxxx` (9 số sau số 0), hoặc null khi không đọc được. */
export function normalizeVnPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[\s.()-]/g, '');
  let local: string;
  if (/^\+84\d{9}$/.test(digits)) local = `0${digits.slice(3)}`;
  else if (/^84\d{9}$/.test(digits)) local = `0${digits.slice(2)}`;
  else if (/^0\d{9}$/.test(digits)) local = digits;
  else return null;
  return /^0[35789]\d{8}$/.test(local) ? local : null;
}

export type MssResultStatus = 'sent' | 'skipped' | 'failed' | 'unknown';

/** Kết quả cuối MSS báo (callback hoặc `GET`) → trạng thái outbox. */
export function resultStatusOf(status: MssResultStatus): MssOutboxStatus {
  switch (status) {
    case 'sent':
      return 'RESULT_SENT';
    case 'skipped':
      return 'RESULT_SKIPPED';
    case 'failed':
      return 'RESULT_FAILED';
    default:
      return 'RESULT_UNKNOWN';
  }
}

export type MssFallbackDecision = 'ZNS' | 'IN_APP_ONLY' | 'NONE';

/**
 * Đường lui theo trạng thái cuối (hợp đồng mục 12): `sent` không cần; `unknown` và `409` (MSS có thể đã gửi bản khác) chỉ trong app;
 * bị thay bởi sự kiện khác của cùng đơn chỉ trong app; còn lại gửi ZNS nếu có tin ZNS đang chờ.
 */
export function fallbackDecision(status: MssOutboxStatus, reason: string | null, hasHeldZns: boolean): MssFallbackDecision {
  if (status === 'RESULT_SENT') return 'NONE';
  if (status === 'RESULT_UNKNOWN') return 'IN_APP_ONLY';
  if (status === 'DEAD' && reason === 'event_id_reused') return 'IN_APP_ONLY';
  if (status === 'RESULT_SKIPPED' && reason && MSS_COVERED_SKIP_REASONS.has(reason)) return 'IN_APP_ONLY';
  if (status === 'RESULT_SKIPPED' || status === 'RESULT_FAILED' || status === 'DEAD' || status === 'EXPIRED' || status === 'CANCELLED') {
    return hasHeldZns ? 'ZNS' : 'IN_APP_ONLY';
  }
  return 'NONE';
}

/** Trạng thái cuối cần chạy đường lui (một lần, cột fallbackAt). */
export const MSS_FALLBACK_STATUSES: readonly MssOutboxStatus[] = ['RESULT_SKIPPED', 'RESULT_FAILED', 'RESULT_UNKNOWN', 'DEAD', 'EXPIRED', 'CANCELLED'];
