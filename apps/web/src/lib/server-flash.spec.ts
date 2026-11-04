import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverNow } from '@tubutree/app-core/server-clock';
import type { HttpClient } from '@tubutree/app-core/http';
import { fetchActiveFlashSalesNoSync, toFlashSeed } from './server-flash';

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

describe('toFlashSeed (nội dung gieo vào HTML trang chi tiết)', () => {
  const full = {
    itemId: 'i1', variationId: 'v1', productSlug: 's1', productName: 'Tên dài', variationName: '500ml', thumbnail: 'https://x/y.jpg',
    flashPrice: 70, retailPrice: 100, salePrice: 90, soldCount: 3, quota: 10, endAt: '2099-01-01T00:00:00Z', serverNow: '2026-01-01T00:00:00Z',
    perUserLimit: 2, saleId: 'sale', title: 'Giờ vàng', startAt: '2026-01-01T00:00:00Z',
  };
  it('chỉ giữ các trường giá/hạn/suất mà trình duyệt đọc; bỏ tên, ảnh, tên phân loại, khung giờ, serverNow', () => {
    expect(toFlashSeed([full])).toEqual([
      { itemId: 'i1', variationId: 'v1', productSlug: 's1', flashPrice: 70, retailPrice: 100, salePrice: 90, soldCount: 3, quota: 10, endAt: '2099-01-01T00:00:00Z', perUserLimit: 2 },
    ]);
    expect(JSON.stringify(toFlashSeed([full]))).not.toMatch(/Tên dài|y\.jpg|500ml|saleId|"title"|serverNow|startAt/);
  });
  it('trường tuỳ chọn thiếu hay null thì không có trong kết quả; giữ suất của mọi sản phẩm (thẻ liên quan cần)', () => {
    const { salePrice: _s, perUserLimit: _p, ...bare } = full;
    const out = toFlashSeed([{ ...bare, salePrice: null }, { ...bare, itemId: 'i2', productSlug: 's2' }]);
    expect(out).toHaveLength(2);
    expect(out[0]).not.toHaveProperty('salePrice');
    expect(out[0]).not.toHaveProperty('perUserLimit');
    expect(out.map((x) => x.productSlug)).toEqual(['s1', 's2']);
  });
});
