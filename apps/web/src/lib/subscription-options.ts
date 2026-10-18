import { MAX_START_DAYS_AHEAD } from '@tubutree/app-core/api/subscriptions';

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

/** "2026-10-20" thành "20/10/2026" (không qua Date để khỏi lệch ngày theo múi giờ máy). */
export function formatVnDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

export function addressText(a: { street: string; ward: string; district: string }): string {
  return [a.street, a.ward, a.district].filter(Boolean).join(', ');
}
