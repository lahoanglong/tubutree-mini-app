/** Chỉ báo "suất kế tiếp" ở Trang chủ khi nó mở trong cửa sổ này; xa hơn thì không đáng chiếm một dòng. */
export const NEXT_SLOT_WINDOW_MS = 6 * 3_600_000;

export interface NextFlashSlot {
  startAt: string;
  count: number;
}

/**
 * Suất Giờ vàng sắp mở sớm nhất trong `NEXT_SLOT_WINDOW_MS`, kèm số món cùng mốc mở. Mốc đã qua hoặc không đọc được bị bỏ (suất đó
 * đã thuộc danh sách đang chạy hoặc là dữ liệu hỏng), suất kế tiếp thế chỗ.
 */
export function nextFlashSlot(items: readonly { startAt: string }[], nowMs: number): NextFlashSlot | null {
  const starts = items
    .map((it) => ({ startAt: it.startAt, ms: Date.parse(it.startAt) }))
    .filter((it) => Number.isFinite(it.ms) && it.ms > nowMs && it.ms - nowMs <= NEXT_SLOT_WINDOW_MS);
  if (starts.length === 0) return null;
  const first = starts.reduce((a, b) => (b.ms < a.ms ? b : a));
  return { startAt: first.startAt, count: starts.filter((s) => s.ms === first.ms).length };
}

// Khách ở Việt Nam, nhưng máy có thể đặt múi giờ khác: cố định giờ Việt Nam để "08:00" luôn là 8 giờ sáng của khung giờ bán.
const VN_CLOCK = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "HH:mm" theo giờ Việt Nam; mốc hỏng thì rỗng. */
export function slotClock(startAt: string): string {
  const ms = Date.parse(startAt);
  return Number.isFinite(ms) ? VN_CLOCK.format(ms) : '';
}
