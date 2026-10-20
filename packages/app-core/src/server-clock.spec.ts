import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverNow, syncServerClock } from './server-clock';

const PHONE_NOW = new Date('2026-10-18T10:00:00.000Z');

describe('server-clock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(PHONE_NOW);
    syncServerClock(PHONE_NOW.toISOString());
  });
  afterEach(() => vi.useRealTimers());

  it('chưa đo thì bằng đồng hồ điện thoại', () => {
    expect(serverNow()).toBe(PHONE_NOW.getTime());
  });

  it('điện thoại nhanh 10 phút: giờ máy chủ lùi 10 phút và đi tiếp theo đồng hồ máy', () => {
    syncServerClock(new Date(PHONE_NOW.getTime() - 10 * 60_000).toISOString());
    expect(serverNow()).toBe(PHONE_NOW.getTime() - 10 * 60_000);
    vi.advanceTimersByTime(5_000);
    expect(serverNow()).toBe(PHONE_NOW.getTime() - 10 * 60_000 + 5_000);
  });

  it('API cũ không trả mốc hoặc mốc hỏng: giữ độ lệch đang có', () => {
    syncServerClock(new Date(PHONE_NOW.getTime() - 60_000).toISOString());
    syncServerClock(undefined);
    syncServerClock(12345);
    syncServerClock('không phải ngày');
    expect(serverNow()).toBe(PHONE_NOW.getTime() - 60_000);
  });
});
