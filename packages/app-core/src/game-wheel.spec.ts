import { describe, expect, it } from 'vitest';
import { WHEEL_SLOTS, pickWheelSlot, slotUnderPointer, wheelKindOf, wheelRotationFor } from './game-wheel';

const prize = (rewardType: string, value = 10, coupon?: unknown) => ({ rewardType, value, coupon });

describe('game-wheel', () => {
  it('giải trúng quyết định loại ô; giải lạ hoặc trắng tay về "Chúc may mắn"', () => {
    expect(wheelKindOf(prize('SEEDS', 30))).toBe('SEEDS');
    expect(wheelKindOf(prize('POINTS', 500))).toBe('POINTS');
    expect(wheelKindOf(prize('COUPON', 20000, { code: 'X' }))).toBe('COUPON');
    expect(wheelKindOf(prize('COUPON', 20000))).toBe('NONE');
    expect(wheelKindOf(prize('NONE', 0))).toBe('NONE');
    expect(wheelKindOf(prize('SEEDS', 0))).toBe('NONE');
    expect(wheelKindOf(prize('MYSTERY', 5))).toBe('NONE');
  });

  it('chỉ chọn ô đúng loại, mọi ô cùng loại đều có thể được chọn', () => {
    for (const [p, kind] of [
      [prize('SEEDS', 30), 'SEEDS'],
      [prize('POINTS', 500), 'POINTS'],
      [prize('COUPON', 1, {}), 'COUPON'],
      [prize('NONE', 0), 'NONE'],
      [prize('LẠ', 3), 'NONE'],
    ] as const) {
      const seen = new Set<number>();
      for (let k = 0; k < 20; k++) {
        const i = pickWheelSlot(p, () => k / 20);
        expect(WHEEL_SLOTS[i]!.kind).toBe(kind);
        seen.add(i);
      }
      expect(seen.size).toBe(2);
    }
  });

  it('rand sát 1 không vượt quá chỉ số cuối', () => {
    expect(WHEEL_SLOTS[pickWheelSlot(prize('SEEDS', 1), () => 0.9999999)]!.kind).toBe('SEEDS');
  });

  it('quay tới đúng ô từ mọi góc xuất phát, kể cả có lệch, và luôn quay thêm >= 5 vòng', () => {
    for (const current of [0, 37, 359, 720, 1234.5]) {
      for (let slot = 0; slot < WHEEL_SLOTS.length; slot++) {
        for (const jitter of [-0.5, 0, 0.5]) {
          const target = wheelRotationFor(current, slot, 5, jitter);
          expect(slotUnderPointer(target)).toBe(slot);
          expect(target - current).toBeGreaterThanOrEqual(360 * 5);
        }
      }
    }
  });
});
