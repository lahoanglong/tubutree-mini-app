/**
 * Nhắc đổi sang gói Refill 21 ngày sau khi khách nhận chai (tubu-w11-03). Hàm thuần và khoá cấu hình; file không nhập service nào để
 * admin-config-rules và job dùng chung.
 */
export const REFILL_REMINDER_ENABLED_KEY = 'retention.refill_21d_reminder_enabled';
/** Kênh ngoài app (ZNS) cho tin nhắc Refill. Tắt (mặc định) thì tin chỉ vào chuông thông báo trong app, kể cả khi mẫu đã gắn mã ZNS. */
export const REFILL_REMINDER_ZNS_KEY = 'retention.refill_21d_zns_enabled';
/** Mã mẫu mở rộng REORDER_REMINDER: cùng tiêu đề "Nhắc mua lại", cùng nút mua lại (mở trang gói Refill) ở hai app. */
export const REFILL_REMINDER_TEMPLATE = 'REORDER_REMINDER_REFILL';

export const REFILL_REMINDER_DAYS = 21;
/** Đơn giao quá 21 ngày mà quá thêm chừng này ngày thì thôi: lần bật cờ đầu không nhắc cả lịch sử đơn, cron lỡ vài ngày vẫn bù được. */
export const REFILL_REMINDER_WINDOW_DAYS = 7;
/** Mỗi khách tối đa một tin nhắc Refill trong chừng này ngày, dù có nhiều đơn tới hạn. */
export const REFILL_REMINDER_USER_GAP_DAYS = 7;

const DAY_MS = 864e5;

export function refillReminderWindow(now: Date): { dueBefore: Date; oldest: Date; reorderedSince: Date; userGapSince: Date } {
  const t = now.getTime();
  const dueBefore = new Date(t - REFILL_REMINDER_DAYS * DAY_MS);
  return {
    dueBefore,
    oldest: new Date(t - (REFILL_REMINDER_DAYS + REFILL_REMINDER_WINDOW_DAYS) * DAY_MS),
    reorderedSince: dueBefore,
    userGapSince: new Date(t - REFILL_REMINDER_USER_GAP_DAYS * DAY_MS),
  };
}

export const refillReminderDedupeKey = (orderId: string): string => `refill21d:${orderId}`;

/**
 * Khách không nhận tin nhắc: tắt "Khuyến mãi & mã giảm giá", tài khoản bị khoá, hoặc MSS báo khách đã từ chối tin Zalo (nguồn
 * `mss_opt_out`). Chưa từng đồng ý tin đơn qua Zalo (mặc định false) không phải là từ chối.
 */
export function refillReminderOptedOut(u: {
  notifyPromo: boolean;
  notifyOrderZalo: boolean;
  notifyOrderZaloSource: string | null;
  isBlocked: boolean;
}): boolean {
  return u.notifyPromo !== true || u.isBlocked || u.notifyOrderZaloSource === 'mss_opt_out';
}

/** Ghi vào refill_reminders (đơn đó không bao giờ được xét lại): SENT, REORDERED, OPTED_OUT. NO_PAIR và CAPPED không ghi, lượt sau xét lại. */
export type RefillReminderDecision =
  | { outcome: 'SEND'; bottleId: string; refillId: string }
  | { outcome: 'REORDERED' | 'OPTED_OUT' | 'NO_PAIR' | 'CAPPED' };

export function pickRefillReminder(input: {
  /** Chai trong đơn (theo thứ tự dòng), đã bỏ quà 0đ và dòng đã trả hết. */
  bottleIds: readonly string[];
  pairs: ReadonlyMap<string, string>;
  /** Gói Refill khách đã đặt (đơn không huỷ) trong 21 ngày qua. */
  reorderedRefillIds: ReadonlySet<string>;
  optedOut: boolean;
  /** Khách đã nhận một tin nhắc Refill trong REFILL_REMINDER_USER_GAP_DAYS ngày. */
  recentlyReminded: boolean;
}): RefillReminderDecision {
  const paired = input.bottleIds.filter((id) => input.pairs.has(id));
  if (paired.length === 0) return { outcome: 'NO_PAIR' };
  if (input.optedOut) return { outcome: 'OPTED_OUT' };
  const bottleId = paired.find((id) => !input.reorderedRefillIds.has(input.pairs.get(id)!));
  if (!bottleId) return { outcome: 'REORDERED' };
  if (input.recentlyReminded) return { outcome: 'CAPPED' };
  return { outcome: 'SEND', bottleId, refillId: input.pairs.get(bottleId)! };
}
