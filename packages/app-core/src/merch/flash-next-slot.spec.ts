import { describe, expect, it } from 'vitest';
import { NEXT_SLOT_WINDOW_MS, nextFlashSlot, slotClock } from './flash-next-slot';

const NOW = Date.parse('2026-11-01T01:00:00.000Z');
const at = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();

describe('nextFlashSlot', () => {
  it('không có suất sắp mở → null', () => {
    expect(nextFlashSlot([], NOW)).toBeNull();
  });

  it('lấy suất mở sớm nhất và đếm số món cùng mốc mở', () => {
    const slot = nextFlashSlot([{ startAt: at(5) }, { startAt: at(3) }, { startAt: at(3) }, { startAt: at(3) }], NOW);
    expect(slot).toEqual({ startAt: at(3), count: 3 });
  });

  it('chỉ trong 6 giờ tới: đúng 6 giờ vẫn tính, quá thì không', () => {
    expect(NEXT_SLOT_WINDOW_MS).toBe(6 * 3_600_000);
    expect(nextFlashSlot([{ startAt: at(6) }], NOW)).toEqual({ startAt: at(6), count: 1 });
    expect(nextFlashSlot([{ startAt: at(8) }], NOW)).toBeNull();
  });

  it('suất đã tới giờ hoặc mốc hỏng bị bỏ qua, suất kế tiếp thế chỗ', () => {
    expect(nextFlashSlot([{ startAt: at(-1) }, { startAt: 'không phải ngày' }, { startAt: at(2) }], NOW)).toEqual({ startAt: at(2), count: 1 });
    expect(nextFlashSlot([{ startAt: at(0) }], NOW)).toBeNull();
  });
});

describe('slotClock', () => {
  it('giờ Việt Nam HH:mm dù máy ở múi giờ nào', () => {
    expect(slotClock('2026-11-01T01:00:00.000Z')).toBe('08:00');
    expect(slotClock('2026-11-01T14:05:00.000Z')).toBe('21:05');
    expect(slotClock('2026-11-01T17:30:00.000Z')).toBe('00:30');
  });

  it('mốc hỏng → chuỗi rỗng', () => {
    expect(slotClock('x')).toBe('');
  });
});
