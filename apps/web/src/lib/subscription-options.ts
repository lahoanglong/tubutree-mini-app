import { MAX_START_DAYS_AHEAD, type SubscriptionDTO } from '@tubutree/app-core/api/subscriptions';

const VN_OFFSET_MS = 7 * 3600 * 1000;

/** Ngày lịch giờ Việt Nam (YYYY-MM-DD): API so ngày bắt đầu theo giờ VN, máy khách có thể ở múi giờ khác. */
export function vnDateOf(at: Date): string {
  return new Date(at.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Khoảng được hẹn: từ ngày mai (hôm nay là "Giao ngay") tới hết `MAX_START_DAYS_AHEAD` ngày, như API. */
export function startDateRange(now: Date = new Date()): { min: string; max: string } {
  return {
    min: vnDateOf(new Date(now.getTime() + 864e5)),
    max: vnDateOf(new Date(now.getTime() + MAX_START_DAYS_AHEAD * 864e5)),
  };
}

export function isStartDateAllowed(date: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const { min, max } = startDateRange(now);
  return date >= min && date <= max;
}

/** Chu kỳ giao hợp lệ (tuần), khớp SUBSCRIPTION_INTERVAL_WEEKS của API. */
export const SUBSCRIPTION_INTERVAL_WEEKS = [4, 6, 8, 10] as const;

const startOfVnDayMs = (d: Date): number => Date.parse(`${vnDateOf(d)}T00:00:00+07:00`);

/**
 * Ngày giao kế tiếp sau khi đổi chu kỳ, cùng luật với API (intervalPatch): 0h VN của ngày đơn kỳ gần nhất + chu kỳ mới,
 * không sớm hơn 0h ngày mai giờ VN. Gói tạm dừng tính như gói đang chạy vì API ghi sẵn ngày đó để bật lại giữ đúng.
 * null = không tính được hoặc không có gì đổi (cùng chu kỳ, API cũ chưa trả lastOrderAt, gói chưa ra đơn mà ngày bắt đầu
 * đã qua). Gói chưa ra đơn nào giữ ngày bắt đầu đã hẹn.
 */
export function nextRunAfterIntervalChange(
  sub: Pick<SubscriptionDTO, 'intervalWeeks' | 'nextRunAt' | 'lastOrderAt'>,
  weeks: number,
  now: Date = new Date(),
): Date | null {
  if (weeks === sub.intervalWeeks || sub.lastOrderAt === undefined) return null;
  if (sub.lastOrderAt === null) {
    const kept = new Date(sub.nextRunAt);
    return kept >= now ? kept : null;
  }
  const due = new Date(startOfVnDayMs(new Date(sub.lastOrderAt)) + weeks * 7 * 864e5);
  const earliest = new Date(startOfVnDayMs(new Date(now.getTime() + 864e5)));
  return due < earliest ? earliest : due;
}

/** "2026-10-20" thành "20/10/2026" (không qua Date để khỏi lệch ngày theo múi giờ máy). */
export function formatVnDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

export function addressText(a: { street: string; ward: string; district: string }): string {
  return [a.street, a.ward, a.district].filter(Boolean).join(', ');
}
