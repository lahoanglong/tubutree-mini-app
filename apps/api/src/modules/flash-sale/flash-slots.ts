import type { Prisma } from '@prisma/client';

export type FlashSlotStatus = 'LIVE' | 'UPCOMING' | 'ENDED';

/** Giờ VN là UTC+7 quanh năm (không có giờ mùa hè), nên cộng/trừ hằng số là đủ. */
const VN_OFFSET_MS = 7 * 3600e3;
const DAY_MS = 24 * 3600e3;

export const DEFAULT_SLOT_CLOCKS: readonly string[] = ['12:00', '20:00'];
export const FLASH_SLOT_MINUTES = 120;

export function slotStatus(s: { startAt: Date; endAt: Date }, now: Date): FlashSlotStatus {
  const t = now.getTime();
  if (t >= s.endAt.getTime()) return 'ENDED';
  return t >= s.startAt.getTime() ? 'LIVE' : 'UPCOMING';
}

/** 00:00 giờ VN của ngày chứa `now`. */
export function vnDayStart(now: Date): Date {
  const vn = now.getTime() + VN_OFFSET_MS;
  return new Date(Math.floor(vn / DAY_MS) * DAY_MS - VN_OFFSET_MS);
}

/** 00:00 giờ VN của ngày kia: hết hôm nay và ngày mai. */
export function vnHorizonEnd(now: Date): Date {
  return new Date(vnDayStart(now).getTime() + 2 * DAY_MS);
}

const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Khung giờ cấu hình hỏng thì về mặc định: trang Giờ vàng không được trống chỉ vì một khoá cấu hình gõ sai. */
export function parseSlotClocks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_SLOT_CLOCKS];
  const valid = [...new Set(raw.filter((c): c is string => typeof c === 'string' && CLOCK_RE.test(c)))].sort();
  return valid.length > 0 ? valid : [...DEFAULT_SLOT_CLOCKS];
}

export const FLASH_SLOTS_KEY = 'flashsale.slots';
export const FLASH_SLOTS_MAX = 6;

/** Luật ghi `flashsale.slots`: 1–6 mốc `HH:MM` giờ VN, tăng dần, không trùng. Trả lời lỗi hoặc null. */
export function flashSlotsProblem(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > FLASH_SLOTS_MAX) {
    return `phải là mảng 1–${FLASH_SLOTS_MAX} mốc giờ dạng "HH:MM", vd ["12:00","20:00"]`;
  }
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (typeof c !== 'string' || !CLOCK_RE.test(c)) return `mốc ${JSON.stringify(c)} không đúng dạng "HH:MM" (00:00 đến 23:59, đủ hai chữ số)`;
    if (i > 0 && c <= (value[i - 1] as string)) return 'các mốc phải tăng dần, không trùng nhau';
  }
  return null;
}

function clockMinutes(clock: string): number {
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
}

/** Mốc bắt đầu từng khung cho `days` ngày VN kể từ hôm nay; khung đã bắt đầu (kể cả đang chạy dở) bị bỏ vì giờ bắt đầu của đợt mới tạo là chỗ duy nhất còn sửa được, đợt LIVE thì khoá (FLASH_START_LOCKED). */
export function slotStartsFor(now: Date, clocks: readonly string[], days: number): Date[] {
  const day0 = vnDayStart(now).getTime();
  const out: Date[] = [];
  for (let d = 0; d < days; d++) {
    for (const clock of clocks) {
      const start = day0 + d * DAY_MS + clockMinutes(clock) * 60e3;
      if (start > now.getTime()) out.push(new Date(start));
    }
  }
  return out;
}

/** "HH:MM" giờ VN của một thời điểm. */
export function vnClock(d: Date): string {
  return new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(11, 16);
}

/** Thứ tự cố định của suất trong một khung: chủ shop ghim bằng sortOrder, còn lại rẻ trước, id chốt thứ tự giữa hai lần gọi. */
export const SLOT_ITEM_ORDER_BY = [{ sortOrder: 'asc' }, { flashPrice: 'asc' }, { variationId: 'asc' }, { id: 'asc' }] satisfies Prisma.FlashSaleItemOrderByWithRelationInput[];
