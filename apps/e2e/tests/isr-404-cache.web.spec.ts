import { test, expect } from '@playwright/test';
import { firstProduct } from './support/pdp-product';

/**
 * Slug bịa (đúng ký tự, đúng độ dài) không được ghi vào cache ISR: mỗi lần là một bộ file ~53 KB không bao giờ xoá (isr-cache-handler.mjs).
 * Trang sản phẩm thật vẫn được cache như cũ.
 */
test('slug bịa hỏi hai lần: luôn 404, không bao giờ HIT từ cache', async ({ request, baseURL }) => {
  const slug = `khong-co-that-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  for (let i = 0; i < 2; i++) {
    const res = await request.get(`${baseURL}/san-pham/${slug}`);
    expect(res.status(), `lần ${i + 1}`).toBe(404);
    expect(res.headers()['x-nextjs-cache'], `lần ${i + 1}`).not.toBe('HIT');
  }
});

test('sản phẩm thật: lần hỏi thứ hai HIT cache ISR', async ({ request, baseURL }) => {
  const p = await firstProduct(request);
  test.skip(!p, 'DB e2e chưa có sản phẩm nào');
  const first = await request.get(`${baseURL}/san-pham/${p!.slug}`);
  expect(first.status()).toBe(200);
  await expect
    .poll(async () => (await request.get(`${baseURL}/san-pham/${p!.slug}`)).headers()['x-nextjs-cache'], { timeout: 15_000 })
    .toBe('HIT');
});
