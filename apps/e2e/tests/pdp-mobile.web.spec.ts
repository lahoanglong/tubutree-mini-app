import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './support/mock-api';

/**
 * Trang sản phẩm web ở khổ 375px phải giống Mini App ở ba chỗ: tiêu đề mục không chân, ô số lượng gồm hai nút vuông riêng,
 * khối đánh giá rỗng có hình + lời mời. Phần server của Next gọi API thật nên spec lấy một sản phẩm có sẵn trong DB e2e
 * và tự bỏ qua khi DB chưa có; mọi lời gọi từ trình duyệt đi qua mock.
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

test.describe('Web khách: trang sản phẩm khổ điện thoại giống Mini App', () => {
  test('tiêu đề mục không serif, nút số lượng 44px tách riêng, đánh giá rỗng có hình và lời mời', async ({ page, api, request }, testInfo) => {
    const p = await firstProduct(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm nào');
    api.get('/flash-sales/active', []);
    api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
    api.get(`/products/${p!.slug}`, { variations: p!.variations });
    api.get(`/products/${p!.slug}/related`, []);
    api.get(`/products/${p!.slug}/bought-together`, []);
    api.get('/products/for-you', []);
    api.get(`/products/${p!.slug}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
    api.get('/me/wishlist/ids', []);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/san-pham/${p!.slug}`);

    const family = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily);
    const bodyFamily = await family('body');
    const promise = page.getByRole('heading', { name: 'Cam kết Tubu' });
    await expect(promise).toBeVisible();
    expect(await promise.evaluate((el) => getComputedStyle(el).fontFamily)).toBe(bodyFamily);

    const minus = page.getByRole('button', { name: 'Giảm số lượng' });
    const plus = page.getByRole('button', { name: 'Tăng số lượng' });
    for (const b of [minus, plus]) {
      const box = (await b.boundingBox())!;
      expect(Math.round(box.width)).toBe(44);
      expect(Math.round(box.height)).toBe(44);
      expect(await b.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px');
    }
    expect(await minus.evaluate((el) => getComputedStyle(el.parentElement!).borderTopWidth)).toBe('0px');

    const empty = page.getByText('Chưa có đánh giá', { exact: true });
    await expect(empty).toBeVisible();
    await expect(page.getByText('Hãy là người đầu tiên chia sẻ trải nghiệm.')).toBeVisible();
    await expect(page.locator('#danh-gia svg[aria-hidden="true"]').first()).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('pdp-web375.png'), fullPage: true });
  });
  test('khung chờ chi tiết SP: bấm Quay lại lúc trang SP còn đang tải thì ở lại /san-pham, không rời site và không lùi quá một trang', async ({ page, api }) => {
    api.get('/flash-sales/active', []);
    api.get('/categories', []);
    api.get('/brands', []);
    api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('about:blank');
    await page.goto('/san-pham');
    const card = page.locator('a[href^="/san-pham/"]').first();
    test.skip((await card.count().catch(() => 0)) === 0, 'DB e2e chưa có sản phẩm nào để bấm');
    await expect(card).toBeVisible();
    const href = (await card.getAttribute('href'))!;
    api.allowUnmocked('GET /products/:slug', 'GET /products/:slug/reviews');
    await page.route(/\/san-pham\/[^/?]+\?_rsc=/, async (route) => {
      await new Promise((r) => setTimeout(r, 6000));
      await route.continue().catch(() => undefined);
    });
    await card.click();
    const skeleton = page.getByTestId('pdp-nav-skeleton');
    await expect(skeleton).toBeVisible();
    await skeleton.getByRole('button', { name: 'Quay lại' }).click();
    await expect(skeleton).toBeHidden();
    await page.waitForTimeout(7500);
    const url = new URL(page.url());
    expect(url.origin).toBe(new URL(test.info().project.use.baseURL ?? page.url()).origin);
    expect(url.pathname).toBe('/san-pham');
    expect(url.pathname).not.toBe(href);
    await expect(page.getByRole('button', { name: 'Tăng số lượng' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Danh mục' })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('pdp-back-stay.png') });
  });
});
