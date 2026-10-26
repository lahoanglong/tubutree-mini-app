import { describe, expect, it } from 'vitest';
import { nextBackHidden } from './back-button-scroll';

describe('nextBackHidden', () => {
  it('gần đầu trang luôn hiện, kể cả khi đang cuộn xuống', () => {
    expect(nextBackHidden(false, 40, 10)).toBe(false);
    expect(nextBackHidden(true, 80, 0)).toBe(false);
  });

  it('cuộn xuống qua ngưỡng thì ẩn', () => {
    expect(nextBackHidden(false, 300, 12)).toBe(true);
  });

  it('cuộn ngược lên đủ xa thì hiện lại', () => {
    expect(nextBackHidden(true, 300, -20)).toBe(false);
  });

  it('nhích ngược rất nhỏ thì giữ nguyên trạng thái', () => {
    expect(nextBackHidden(true, 300, -2)).toBe(true);
    expect(nextBackHidden(false, 300, -2)).toBe(false);
    expect(nextBackHidden(true, 300, 0)).toBe(true);
  });
});
