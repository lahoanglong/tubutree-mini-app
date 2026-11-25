/**
 * Hằng và hàm thuần của luồng giỏ bỏ quên gửi MSS (hợp đồng cart-events v1, `docs/2026-11-25-tubu-mss-cart-events-v1.md` bên MSS).
 * File không import service: recorder, sender, spec cùng đọc từ đây.
 */
import { buyerPhoneOf, type MssPhoneSource } from './mss-order-event-types';

export const MSS_CART_EVENTS_PATH = '/cart-events';

export const MSS_CART_EVENT_TYPES = ['cart.abandoned', 'cart.recovered'] as const;
export type MssCartEventType = (typeof MSS_CART_EVENT_TYPES)[number];

export const MSS_CART_STATUSES = ['PENDING', 'SENDING', 'ACCEPTED', 'SKIPPED', 'REJECTED', 'EXPIRED', 'DEAD'] as const;
export type MssCartStatus = (typeof MSS_CART_STATUSES)[number];

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Mỗi khách tối đa một lần nhắc giỏ qua MSS trong chừng này ngày (MSS cũng tự chặn 7 ngày theo SĐT). */
export const MSS_CART_DEDUPE_DAYS = 7;
/**
 * MSS bỏ lần nhắc khi giỏ cũ hơn 48 giờ kể từ `cart.updated_at`, và chỉ gửi 08:30–20:30. Giỏ bỏ quá 36 giờ thì không gửi nữa:
 * còn 12 giờ cho khung đêm của MSS.
 */
export const MSS_CART_MAX_AGE_MS = 36 * HOUR_MS;
/** Dòng `cart.abandoned` hết hạn gửi sau chừng này kể từ lúc khách bỏ giỏ (MSS 48 giờ, trừ 8 giờ dự phòng). */
export const MSS_CART_ABANDONED_TTL_MS = 40 * HOUR_MS;
/** Dòng `cart.recovered` còn đáng gửi trong chừng này: sau 48 giờ MSS không còn lần nhắc nào của giỏ đó. */
export const MSS_CART_RECOVERED_TTL_MS = 48 * HOUR_MS;
/** Dò "khách đã mua" cho lần nhắc MSS đã nhận trong chừng này kể từ lúc bỏ giỏ. */
export const MSS_CART_RECOVERY_WINDOW_MS = 48 * HOUR_MS;
/** Thân chứa SĐT: dòng quá chừng này ngày bị xoá (mỗi lượt tối đa MSS_CART_PURGE_BATCH dòng). */
export const MSS_CART_PURGE_AFTER_DAYS = 30;
export const MSS_CART_PURGE_BATCH = 1000;
/** Mỗi lượt cron nhận tối đa chừng này dòng để gửi. */
export const MSS_CART_SEND_BATCH = 20;

/** `status` MSS trả cho `cart.abandoned` mà lần nhắc đang chờ, đã gửi, hoặc có thể đã gửi: tính vào trần 7 ngày. */
export const MSS_CART_LIVE_RESULTS: readonly string[] = ['queued', 'sent', 'unknown'];

/** Hợp đồng: `cart.ref` 1–64 ký tự ASCII in được. cuid 25 ký tự + giây epoch 10 chữ số = 38 ký tự. */
export function cartRefOf(cartId: string, abandonedAt: Date): string {
  return `c_${cartId}_${Math.floor(abandonedAt.getTime() / 1000)}`;
}

export function cartExpiresAt(type: MssCartEventType, cartUpdatedAt: Date, occurredAt: Date): Date {
  return type === 'cart.abandoned'
    ? new Date(cartUpdatedAt.getTime() + MSS_CART_ABANDONED_TTL_MS)
    : new Date(occurredAt.getTime() + MSS_CART_RECOVERED_TTL_MS);
}

export function cartDedupeSince(now: Date): Date {
  return new Date(now.getTime() - MSS_CART_DEDUPE_DAYS * DAY_MS);
}

export function cartPurgeBefore(now: Date): Date {
  return new Date(now.getTime() - MSS_CART_PURGE_AFTER_DAYS * DAY_MS);
}

export type MssCartConsentSkip = 'no_consent' | 'opted_out' | 'blocked' | 'no_phone';

export interface MssCartConsentUser {
  phone: string | null;
  phoneVerifiedAt: Date | null;
  isBlocked: boolean;
  notifyPromo: boolean;
  notifyPromoAt: Date | null;
  notifyOrderZalo: boolean;
  notifyOrderZaloAt: Date | null;
  notifyOrderZaloSource: string | null;
}

export interface MssCartConsent {
  phone: string;
  phoneSource: MssPhoneSource;
  /** `consent.at`: lúc khách đồng ý tin khuyến mãi, không có thì lúc đồng ý tin đơn qua Zalo, không có nữa thì lúc ghi. */
  at: Date;
}

/**
 * Cổng đồng ý và SĐT (PO A2): nhắc giỏ là tin tiếp thị, nên cần cả "tin hành trình đơn qua Zalo" lẫn "khuyến mãi & mã giảm giá".
 * MSS báo khách từ chối (`mss_opt_out`) hay tài khoản bị khoá thì không gửi. SĐT tài khoản đã xác minh là `account_verified`, chưa xác
 * minh mà đọc được là `checkout_contact`.
 */
export function cartConsentOf(user: MssCartConsentUser, now: Date): MssCartConsent | MssCartConsentSkip {
  if (user.isBlocked) return 'blocked';
  if (user.notifyOrderZaloSource === 'mss_opt_out') return 'opted_out';
  if (user.notifyOrderZalo !== true || user.notifyPromo !== true) return 'no_consent';
  const buyer = buyerPhoneOf({ user: { phone: user.phone, phoneVerifiedAt: user.phoneVerifiedAt } });
  if (!buyer) return 'no_phone';
  return { phone: buyer.phone, phoneSource: buyer.source, at: user.notifyPromoAt ?? user.notifyOrderZaloAt ?? now };
}

/**
 * `consent.source` (≤ 40 ký tự): nơi khách đồng ý tin đơn qua Zalo. `checkout` tách theo nền tảng của đơn gần nhất; cài đặt tài khoản và
 * chi tiết đơn gộp là `account`.
 */
export function cartConsentSource(orderZaloSource: string | null, lastOrderPlatform: string | null): string {
  if (orderZaloSource === 'checkout') return lastOrderPlatform === 'miniapp' ? 'miniapp' : 'web_checkout';
  if (orderZaloSource === 'account_settings' || orderZaloSource === 'order_detail') return 'account';
  return 'tubutree';
}

/** `status`/`reason` MSS trả trong phản hồi 2xx, chỉ nhận dạng mã ngắn; khác thì null. */
const RESULT_RE = /^[a-z][a-z_]{0,31}$/;
export function mssCartResultOf(raw: unknown): string | null {
  return typeof raw === 'string' && RESULT_RE.test(raw) ? raw : null;
}
