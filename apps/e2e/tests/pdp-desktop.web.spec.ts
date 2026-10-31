import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './support/mock-api';

/**
 * Trang sản phẩm web ở khổ máy tính 1280×800: ảnh 440px và thông tin nằm trong một thẻ, cuộn cùng một trang (không cột dính tự cuộn),
 * nên nút "Thêm vào giỏ" nằm gọn trong khung nhìn đầu tiên. Phần server của Next gọi API thật nên spec lấy một sản phẩm có sẵn trong
 * DB e2e và tự bỏ qua khi DB chưa có; mọi lời gọi từ trình duyệt đi qua mock. Cần API thật: chạy ở CI (web-gate.sh), không chạy ở Mini.
 */
const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;

async function firstProduct(request: APIRequestContext) {
  const res = await request.get(`${API_ORIGIN}/api/products?limit=1`).catch(() => null);
  if (!res?.ok()) return null;
  const first = ((await res.json()) as { data?: { slug: string }[] }).data?.[0];
  if (!first) return null;
  const detail = await request.get(`${API_ORIGIN}/api/products/${encodeURIComponent(first.slug)}`);
  return detail.ok() ? ((await detail.json()) as { slug: string; variations: { id: string; stock: number }[] }) : null;
}

test.describe('Web khách: trang sản phẩm khổ máy tính', () => {
  test('nút Thêm vào giỏ nằm trong khung 1280×800 và không có vùng cuộn dọc riêng trong trang', async ({ page, api, request }) => {
    const p = await firstProduct(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm nào');
    test.skip(!p!.variations.some((v) => v.stock > 0), 'Sản phẩm đầu tiên hết hàng nên không có nút Thêm vào giỏ');
    api.get('/flash-sales/active', []);
    api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
    api.get(`/products/${p!.slug}`, { variations: p!.variations });
    api.get(`/products/${p!.slug}/related`, []);
    api.get(`/products/${p!.slug}/bought-together`, []);
    api.get('/products/for-you', []);
    api.get(`/products/${p!.slug}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
    api.get('/me/wishlist/ids', []);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/san-pham/${p!.slug}`);

    await expect(page.getByRole('button', { name: /Thêm vào giỏ/ }).first()).toBeInViewport();

    const scrollers = await page.evaluate(() =>
      Array.from(document.querySelectorAll('main *'))
        .filter((el) => {
          const overflowY = getComputedStyle(el).overflowY;
          return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight && !el.closest('[role="dialog"]');
        })
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`),
    );
    expect(scrollers).toEqual([]);
  });
});
