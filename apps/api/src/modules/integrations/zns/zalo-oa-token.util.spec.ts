import { needsRefresh, computeExpiresAt } from './zalo-oa-token.util';

const NOW = new Date('2026-06-26T00:00:00Z');
const H = 3600 * 1000;

describe('needsRefresh', () => {
  it('chưa có hạn (null) → cần refresh', () => {
    expect(needsRefresh(null, NOW)).toBe(true);
  });
  it('hạn không hợp lệ → cần refresh (an toàn)', () => {
    expect(needsRefresh('không-phải-ngày', NOW)).toBe(true);
  });
  it('còn 2h (< ngưỡng 6h) → cần refresh', () => {
    expect(needsRefresh(new Date(NOW.getTime() + 2 * H).toISOString(), NOW)).toBe(true);
  });
  it('còn 20h (> ngưỡng) → chưa cần', () => {
    expect(needsRefresh(new Date(NOW.getTime() + 20 * H).toISOString(), NOW)).toBe(false);
  });
  it('đã hết hạn → cần refresh', () => {
    expect(needsRefresh(new Date(NOW.getTime() - 1 * H).toISOString(), NOW)).toBe(true);
  });
});

describe('computeExpiresAt', () => {
  it('cộng expires_in giây vào now', () => {
    expect(computeExpiresAt(90000, NOW)).toBe(new Date(NOW.getTime() + 90000 * 1000).toISOString());
  });
  it('expires_in lỗi → mặc định 86400s', () => {
    expect(computeExpiresAt(NaN, NOW)).toBe(new Date(NOW.getTime() + 86400 * 1000).toISOString());
  });
});
