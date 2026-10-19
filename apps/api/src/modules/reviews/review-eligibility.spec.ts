import { returnWindowClosed } from './review-eligibility';

describe('returnWindowClosed', () => {
  const NOW = new Date('2026-10-20T00:00:00.000Z');
  const daysBefore = (n: number, extraMs = 0) => new Date(NOW.getTime() - n * 864e5 - extraMs);

  it('đúng hạn (đủ N ngày) vẫn còn gửi được yêu cầu trả như OrderReturnsService.request; quá một mili giây là hết hạn', () => {
    expect(returnWindowClosed({ deliveredAt: daysBefore(7), updatedAt: NOW }, 7, NOW)).toBe(false);
    expect(returnWindowClosed({ deliveredAt: daysBefore(7, 1), updatedAt: NOW }, 7, NOW)).toBe(true);
  });

  it('đơn cũ thiếu deliveredAt dùng updatedAt', () => {
    expect(returnWindowClosed({ deliveredAt: null, updatedAt: daysBefore(30) }, 7, NOW)).toBe(true);
    expect(returnWindowClosed({ deliveredAt: null, updatedAt: daysBefore(1) }, 7, NOW)).toBe(false);
  });

  it('cửa sổ 0 ngày: đơn giao trước đó đã hết hạn', () => {
    expect(returnWindowClosed({ deliveredAt: daysBefore(0, 1), updatedAt: NOW }, 0, NOW)).toBe(true);
  });
});
