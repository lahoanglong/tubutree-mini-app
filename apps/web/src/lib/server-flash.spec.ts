import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverNow } from '@tubutree/app-core/server-clock';
import type { HttpClient } from '@tubutree/app-core/http';
import { fetchActiveFlashSalesNoSync } from './server-flash';

const ahead = () => [{ itemId: 'i', variationId: 'v', productSlug: 's', flashPrice: 1, retailPrice: 2, soldCount: 0, quota: 1, endAt: '2099-01-01T00:00:00Z', serverNow: new Date(Date.now() + 3_600_000).toISOString() }];
const http = (get: () => Promise<unknown>) => ({ get }) as unknown as HttpClient;

afterEach(() => vi.restoreAllMocks());

describe('đồng hồ máy chủ khi lấy Giờ vàng', () => {
  it('phía web server: bản trả về có serverNow lệch 1 giờ KHÔNG làm dịch serverNow() của tiến trình', async () => {
    const before = serverNow();
    const out = await fetchActiveFlashSalesNoSync(http(async () => ahead()));
    expect(out).toHaveLength(1);
    expect(Math.abs(serverNow() - before)).toBeLessThan(5_000);
  });

  it('phía trình duyệt (fetchActiveFlashSales của app-core): vẫn đồng bộ đồng hồ', async () => {
    const { fetchActiveFlashSales } = await import('@tubutree/app-core/api/flash-sale');
    const before = serverNow();
    await fetchActiveFlashSales(http(async () => ahead()));
    expect(serverNow() - before).toBeGreaterThan(3_000_000);
    const { syncServerClock } = await import('@tubutree/app-core/server-clock');
    syncServerClock(new Date().toISOString());
  });
});
