import { describe, expect, it } from 'vitest';
import { formatCountdown } from './countdown-format';

const MIN = 60_000;
describe('formatCountdown', () => {
  it('dưới 24 giờ: "Xh YYm", làm tròn lên theo phút', () => {
    expect(formatCountdown(3_600_000)).toBe('1h 00m');
    expect(formatCountdown(59_000)).toBe('0h 01m');
    expect(formatCountdown(23 * 60 * MIN + 59 * MIN)).toBe('23h 59m');
  });
  it('từ 24 giờ: ghi theo ngày, bỏ phần giờ khi tròn ngày', () => {
    expect(formatCountdown(24 * 60 * MIN)).toBe('1 ngày');
    expect(formatCountdown(143 * 60 * MIN + 52 * MIN)).toBe('5 ngày 23 giờ');
    expect(formatCountdown(48 * 60 * MIN + 30 * MIN)).toBe('2 ngày');
    expect(formatCountdown(25 * 60 * MIN)).toBe('1 ngày 1 giờ');
  });
  it('hết giờ hoặc số lạ → rỗng', () => {
    expect(formatCountdown(0)).toBe('');
    expect(formatCountdown(-5)).toBe('');
    expect(formatCountdown(NaN)).toBe('');
  });
});
