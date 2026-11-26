/**
 * Hằng và hàm thuần của luồng sự kiện đơn gửi MSS (hợp đồng tubu-mss-order-events v1.2). File không import service: recorder,
 * worker, callback, notifications và spec cùng đọc từ đây.
 */
import type { Prisma } from '@prisma/client';

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

/**
 * Dòng `order.created` khớp điều kiện này: MSS đang giữ sự kiện, hoặc đã gửi như bạn bè / hội thoại đang mở, nên luồng nhắc chuyển khoản
 * của MSS lo phần nhắc và Tubu không gửi tin nhắc riêng. Tin người lạ (`RESULT_SENT` + `resultReason = 'stranger'`) KHÔNG tính: MSS không
 * nhắc chuyển khoản cho người lạ (MSS w37 `resolveRecipient`), nên Tubu vẫn nhắc. RESULT_FAILED, RESULT_UNKNOWN hay chưa có dòng thì Tubu
 * nhắc như thường.
 */
export const MSS_CREATED_COVERS_PAYMENT_REMINDER_WHERE: Prisma.MssOrderEventOutboxWhereInput = {
  eventType: 'order.created',
  // Chỉ tin tới chính người mua mới thay được tin nhắc (dòng người nhận hiện chỉ có ở tin giao hàng; lọc để luật không đổi nếu điều đó đổi).
  recipientRole: 'buyer',
  OR: [{ status: { in: [...MSS_HOLDING_STATUSES] } }, { status: 'RESULT_SENT', resultReason: null }],
};

/**
 * Kết quả cuối mà khách chắc chắn hoặc có thể đã nhận tin Zalo: không gửi ZNS cho sự kiện này (tránh tin đôi). Cũng là luật email cấp
 * đơn: một dòng người mua ở trạng thái này chặn email xác nhận cho cả đơn (`OrderConfirmEmailService.run`, `emailRescueOnce`).
 */
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
/**
 * `gate_closed` chỉ có ở `orders.orderZaloConsentSource`: lúc đặt cờ order_events coi như tắt (admin tắt, thiếu biến MSS_*, hoặc cổng chưa
 * nạp kịp sau khởi động) nên không hỏi khách (`orderZaloConsent` để null). Ops nhờ nó tách "cờ tắt" khỏi "khách không đồng ý" (`false`).
 * Cờ bật mà MSS mất năng lực thì vẫn hỏi và chụp đồng ý (nguồn null), xem thẻ MSS ở Sức khoẻ hệ thống. Khách bật muộn ở chi tiết đơn thì
 * ghi đè bằng `order_detail`.
 */
export type OrderZaloConsentSource = 'checkout' | 'account_settings' | 'mss_opt_out' | 'order_detail' | 'gate_closed';

/** Đơn còn hành trình để báo: chưa giao, chưa huỷ, chưa trả. */
export const ORDER_ZALO_ACTIVE_STATUSES: readonly string[] = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING'];

export type LateConsentBlock =
  | 'gate_closed'
  | 'rollout'
  | 'not_active'
  | 'already'
  | 'platform_null'
  | 'placed_for_customer'
  | 'dealer_order'
  | 'no_phone';

/** Chỉ hai sự kiện này có bản gửi người nhận (PO A1): tin giao hàng, không kèm giá. */
export const MSS_RECIPIENT_EVENT_TYPES: readonly MssOrderEventType[] = ['order.shipping', 'order.delivered'];

/** Hợp đồng v1.2 `recipient.phone_source`: số đã xác minh của tài khoản, hoặc số khách tự gõ lúc đặt hàng (chưa xác minh). */
export type MssPhoneSource = 'account_verified' | 'checkout_contact';

/** SĐT nhận hàng trong ảnh chụp địa chỉ của đơn (chuỗi thô, chưa chuẩn hoá); null khi địa chỉ hỏng hoặc thiếu số. */
export function shippingPhoneOf(address: unknown): string | null {
  if (!address || typeof address !== 'object' || Array.isArray(address)) return null;
  const phone = (address as Record<string, unknown>).phone;
  return typeof phone === 'string' ? phone : null;
}

/** Số người mua đọc từ đâu: số tài khoản, SĐT khách vãng lai gõ, hay SĐT trong địa chỉ giao (khách tự sửa được trước khi đóng gói). */
export type BuyerPhoneVia = 'account' | 'guest' | 'shipping';

export interface BuyerPhone {
  phone: string;
  source: MssPhoneSource;
  via: BuyerPhoneVia;
}

/**
 * Số người mua nhận tin hành trình (PO A2). Số tài khoản đã xác minh thì nguồn `account_verified`; chưa xác minh thì số đầu tiên đọc được
 * trong số tài khoản, SĐT khách vãng lai gõ (`orders.guestPhone`), SĐT trong địa chỉ giao, nguồn `checkout_contact` (MSS ẩn tên ở lời mời).
 */
export function buyerPhoneOf(input: {
  user: { phone: string | null; phoneVerifiedAt: Date | null };
  guestPhone?: string | null;
  shippingAddress?: unknown;
}): BuyerPhone | null {
  const own = normalizeVnPhone(input.user.phone);
  if (own) return { phone: own, source: input.user.phoneVerifiedAt ? 'account_verified' : 'checkout_contact', via: 'account' };
  const guest = normalizeVnPhone(input.guestPhone);
  if (guest) return { phone: guest, source: 'checkout_contact', via: 'guest' };
  const shipping = normalizeVnPhone(shippingPhoneOf(input.shippingAddress));
  return shipping ? { phone: shipping, source: 'checkout_contact', via: 'shipping' } : null;
}

/** `recipient.phone` (đã chuẩn hoá) trong thân JSON của một dòng outbox; null khi thân hỏng hoặc thiếu số. */
export function outboxRecipientPhone(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const recipient = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).recipient : null;
  const phone = recipient && typeof recipient === 'object' && !Array.isArray(recipient) ? (recipient as Record<string, unknown>).phone : null;
  return typeof phone === 'string' ? normalizeVnPhone(phone) : null;
}

/** Số người nhận cho tin giao hàng không kèm giá: khách đã bật lúc đặt và số nhận hàng đọc được, khác số người mua. Không thì null. */
export function recipientPhoneFor(order: { notifyRecipientZalo: boolean; shippingAddress: unknown }, buyerPhone: string): string | null {
  if (!order.notifyRecipientZalo) return null;
  const to = normalizeVnPhone(shippingPhoneOf(order.shippingAddress));
  return to && to !== buyerPhone ? to : null;
}

type LateConsentGate = { enabled: boolean; open: boolean; rolloutPct: number } | null | undefined;
type LateConsentOrder = {
  userId: string;
  status: string;
  type: string;
  platform: string | null;
  placedForCustomer: boolean;
  orderZaloConsent: boolean | null;
  shippingAddress: unknown;
  guestPhone?: string | null;
};

/** Các lý do chặn không cần đọc người dùng (cổng, rollout, đơn đã đóng, đã đồng ý, nền tảng, CTV, đại lý). */
export function lateConsentOrderBlock(gate: LateConsentGate, order: LateConsentOrder): LateConsentBlock | null {
  if (!gate?.enabled || !gate.open) return 'gate_closed';
  if (!inRollout(order.userId, gate.rolloutPct)) return 'rollout';
  if (!ORDER_ZALO_ACTIVE_STATUSES.includes(order.status)) return 'not_active';
  if (order.orderZaloConsent === true) return 'already';
  if (order.platform !== 'web' && order.platform !== 'miniapp') return 'platform_null';
  if (order.placedForCustomer) return 'placed_for_customer';
  if (order.type !== 'RETAIL') return 'dealer_order';
  return null;
}

/**
 * Bật tin hành trình qua Zalo cho một đơn đang đi, từ chi tiết đơn. Cùng điều kiện mà `MssOrderEventRecorder.record` dùng để bỏ qua
 * sự kiện, để nút không hứa tin mà máy chủ sẽ không gửi. Trả lý do chặn, hoặc null khi bật được. `already` = đơn đã có đồng ý.
 */
export function lateConsentBlock(input: { gate: LateConsentGate; order: LateConsentOrder; user: { phone: string | null; phoneVerifiedAt: Date | null } }): LateConsentBlock | null {
  const { gate, order, user } = input;
  return lateConsentOrderBlock(gate, order) ?? (buyerPhoneOf({ user, guestPhone: order.guestPhone, shippingAddress: order.shippingAddress }) ? null : 'no_phone');
}

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

/** `reason` của kết quả `sent`/`unknown` khi MSS nhắn khách chưa kết bạn (tin người lạ, không link, không bill). Vẫn là `RESULT_SENT`: không đường lui. */
export const MSS_SENT_VIA_STRANGER = 'stranger';

/** Sự kiện có email xác nhận đơn dự phòng (PO A3): chỉ tin đặt đơn và tin đã nhận tiền, tối đa một email mỗi đơn. */
export const MSS_EMAIL_EVENT_TYPES: ReadonlySet<string> = new Set<MssOrderEventType>(['order.created', 'order.payment_confirmed']);

/** Mã 4xx mà MSS có thể đã nhận sự kiện ở một lượt trước (hết giờ chờ, trùng, quá tải): không phải "từ chối hẳn". Bản SQL dùng chung mảng này. */
export const MSS_HTTP_4XX_MAYBE_ACCEPTED: readonly number[] = [408, 409, 429];

/**
 * Lượt gửi cuối nhận 4xx (trừ 408/409/429): MSS đã đọc thân và từ chối, các lượt trước cùng thân cùng `event_id` cũng bị từ chối.
 * 5xx, 429, 408, hết giờ chờ, lỗi mạng: một lượt trước có thể đã tới MSS và tin đã đi, nên không coi là "chắc chắn không nhận".
 * Bản SQL của luật này nằm trong câu quét email ở `mss-order-events.reconcile.ts` (race spec P1 giữ hai bản khớp nhau).
 */
export function mssDefinitelyRejected(http: number | null): boolean {
  return http !== null && http >= 400 && http < 500 && !MSS_HTTP_4XX_MAYBE_ACCEPTED.includes(http);
}

/**
 * Kết quả cuối mà khách chắc chắn chưa nhận tin Zalo nào cho sự kiện: email dự phòng được gửi. Không bao giờ cho `RESULT_SENT` (kể cả
 * tin người lạ), `RESULT_UNKNOWN` (MSS có thể đã gửi), `CANCELLED` (khách rút đồng ý hoặc đơn đóng), sự kiện bị thay (`superseded`…) hay 409.
 * `DEAD` / `EXPIRED` chỉ khi chắc MSS không giữ sự kiện: MSS báo mất (`mss_lost`), hoặc lượt gửi cuối bị MSS từ chối hẳn
 * (`mssDefinitelyRejected`). Lượt cuối 5xx/429/408, hết giờ chờ, lỗi mạng hay cầu dao ngắt thì một lượt POST trước có thể đã tới MSS và
 * tin đã đi: không email (thà thiếu email còn hơn Zalo + email). `DEAD` không có mã HTTP (nhận việc hỏng, thân lỗi) vẫn email.
 * Đổi luật này thì sửa cả bản SQL ở `MssOrderEventReconcileService.emailRescueOnce`.
 * Luật cấp đơn (chạy sau luật từng dòng này): đơn có bất kỳ dòng người mua nào ở `MSS_NO_ZNS_STATUSES` (đã gửi hoặc `RESULT_UNKNOWN`)
 * thì không email cho mọi sự kiện của đơn. Đổi luật cấp đơn thì sửa cả 2 chỗ: `OrderConfirmEmailService.run` (findFirst anh em) và câu
 * `NOT EXISTS` trong `emailRescueOnce`.
 */
export function mssEmailEligible(status: MssOutboxStatus, reason: string | null, lastHttpStatus: number | null): boolean {
  if (status === 'RESULT_SKIPPED') return !(reason && MSS_COVERED_SKIP_REASONS.has(reason));
  if (status === 'DEAD') return reason !== 'event_id_reused' && (lastHttpStatus === null || mssDefinitelyRejected(lastHttpStatus));
  if (status === 'EXPIRED') return reason === 'mss_lost' || mssDefinitelyRejected(lastHttpStatus);
  return status === 'RESULT_FAILED';
}

/** Trạng thái cuối cần chạy đường lui (một lần, cột fallbackAt). */
export const MSS_FALLBACK_STATUSES: readonly MssOutboxStatus[] = ['RESULT_SKIPPED', 'RESULT_FAILED', 'RESULT_UNKNOWN', 'DEAD', 'EXPIRED', 'CANCELLED'];

export interface BuyerOrderNotice {
  event: MssOrderEventType;
  channel: 'ZALO' | 'ZNS';
  at: string;
}

/**
 * Tin đã tới khách ngoài ứng dụng, cho dòng phụ "Đã báo qua Zalo/ZNS" ở chi tiết đơn của chính khách: MSS báo gửi xong (`RESULT_SENT`), hoặc đường
 * lui đã gửi ZNS (`fallbackChannel = ZNS`). Chỉ ba trường; không trả trạng thái nội bộ, lý do lỗi, mã sự kiện hay thân tin.
 */
export function buyerOrderNotices(
  rows: readonly { eventType: string; status: string; resultAt: Date | null; deliveredAt: Date | null; occurredAt: Date; fallbackChannel: string | null; fallbackAt: Date | null }[],
): BuyerOrderNotice[] {
  const out: BuyerOrderNotice[] = [];
  for (const r of rows) {
    if (!(MSS_ORDER_EVENT_TYPES as readonly string[]).includes(r.eventType)) continue;
    const event = r.eventType as MssOrderEventType;
    if (r.status === 'RESULT_SENT') out.push({ event, channel: 'ZALO', at: (r.resultAt ?? r.deliveredAt ?? r.occurredAt).toISOString() });
    else if (r.fallbackChannel === 'ZNS' && r.fallbackAt) out.push({ event, channel: 'ZNS', at: r.fallbackAt.toISOString() });
  }
  return out;
}
