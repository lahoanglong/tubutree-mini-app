import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('./api', () => ({ api: { get: mocks.get } }));

import { getBankQr } from './payment-api';
import { serverNow, syncServerClock } from '../utils/server-clock';

describe('getBankQr đồng bộ giờ máy chủ', () => {
  const PHONE_NOW = new Date('2026-10-18T10:00:00.000Z');
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(PHONE_NOW);
    syncServerClock(PHONE_NOW.toISOString());
  });
  afterEach(() => vi.useRealTimers());

  it('API trả serverNow: độ lệch giờ được đo, không cần suất giờ vàng nào', async () => {
    const server = new Date(PHONE_NOW.getTime() - 10 * 60_000);
    mocks.get.mockResolvedValue({ data: { orderCode: 'TT001', serverNow: server.toISOString() } });
    await getBankQr('TT001');
    expect(serverNow()).toBe(server.getTime());
  });

  it('API bản cũ không trả serverNow: giữ nguyên độ lệch đang có', async () => {
    mocks.get.mockResolvedValue({ data: { orderCode: 'TT001' } });
    await getBankQr('TT001');
    expect(serverNow()).toBe(PHONE_NOW.getTime());
  });
});
