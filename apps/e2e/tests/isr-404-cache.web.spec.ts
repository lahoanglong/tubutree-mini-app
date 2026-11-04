import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { firstProduct } from './support/pdp-product';

/**
 * Slug bịa (đúng ký tự, đúng độ dài) không được ghi xuống đĩa trong cache ISR: mỗi lần là một bộ file ~53 KB không bao giờ xoá
 * (isr-cache-handler.mjs). Trang 404 đó nằm trong kho bộ nhớ có hạn, nên lần hỏi lại trả từ cache, không dựng lại. Trang sản phẩm thật vẫn cache như cũ.
 */
const SERVER_DIR = join(__dirname, '..', '..', 'web', '.next', 'server');

function filesNamed(dir: string, needle: string): string[] {
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.includes(needle)) hits.push(join(d, e.name));
      if (e.isDirectory()) walk(join(d, e.name));
    }
  };
  walk(dir);
  return hits;
}

test('slug bịa hỏi hai lần: luôn 404, lần hai trả từ kho bộ nhớ (HIT), không có file nào trên đĩa', async ({ request, baseURL }) => {
  const slug = `khong-co-that-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const first = await request.get(`${baseURL}/san-pham/${slug}`);
  expect(first.status()).toBe(404);
  expect(first.headers()['x-nextjs-cache']).not.toBe('HIT');
  const second = await request.get(`${baseURL}/san-pham/${slug}`);
  expect(second.status()).toBe(404);
  expect(second.headers()['x-nextjs-cache']).toBe('HIT');
  expect(filesNamed(SERVER_DIR, slug)).toEqual([]);
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
