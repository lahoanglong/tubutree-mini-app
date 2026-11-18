import { test } from './support/mock-api';
import { expect, type Page, type Request } from '@playwright/test';
import { assertSeededOnCi } from './support/a11y-db';
import { observeCls, readClsTotal } from './support/cls-observer';
import { solidPng } from './support/noise-png';
import { seedTourPublicData } from './support/tour-db';
import { mockTourWorld, tourUser } from './support/tour-world';

/**
 * Đợt tốc độ trên máy khách, phía web:
 * - HTML đầu của Trang chủ chỉ có ô giữ chỗ cho lưới Gợi ý và dải Story (dựng ở trình duyệt khi khách cuộn tới gần; dải không đủ món thì khối rỗng,
 *   không giữ chỗ), và dữ liệu `suggest`/`brands` không theo vào dữ liệu RSC của trang.
 * - Ô giữ chỗ cao bằng dải Story thật (đo HTML không chạy JS so với trang đã dựng), cuộn hết trang thì lưới Gợi ý hiện và CLS ≤ 0,1, ở 360, 390, 768 và 1440.
 * - Cờ `perf.rum_enabled` tắt (mặc định của DB e2e sau migration): ẩn trang không gửi sự kiện `web_vital` nào, trong khi sự kiện web thường vẫn đi.
 */
const SIZES = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;
const SHOTS = '/tmp/review/tubu/shots/waves/tubu-w4-05-real-user-vitals-and-speed-budget';
const DEFERRED = ['stories', 'suggest'] as const;

const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;
const IMAGE_PNG = solidPng(150, 60, [47, 107, 79]);
const isServedImage = (url: URL) => url.pathname === '/api/img' || url.pathname.startsWith('/api/public-image/');

test.beforeAll(async () => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      assertSeededOnCi(await seedTourPublicData());
      return;
    } catch (e) {
      if (attempt >= 4 || !/40P01|deadlock/i.test(String(e))) throw e;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
});

test.beforeEach(async ({ api, page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'Web Customer', 'tự đặt khổ từng ca, chỉ chạy ở một project');
  mockTourWorld(api, tourUser('CUSTOMER'));
  // HTML đầu dựng từ cấu hình thật của API e2e; trình duyệt nhận đúng cấu hình đó như ở PROD.
  api.get('/config/public', await (await request.get(`${API_ORIGIN}/api/config/public`)).json());
  api.allowUnmocked('GET /auth/me', 'GET /me/summary', 'GET /waste/requests');
  await page.route(isServedImage, (route) => route.fulfill({ contentType: 'image/png', body: IMAGE_PNG }));
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_garden_hint_seen', '1');
    } catch {
      // không có localStorage
    }
  });
});

const blockHeight = (page: Page, block: string) =>
  page.locator(`[data-home-block="${block}"]`).evaluate((el) => Math.round(el.getBoundingClientRect().height));

test('HTML đầu: lưới Gợi ý (và dải Story khi dải có món) chỉ là ô giữ chỗ, dữ liệu suggest/brands không theo vào dữ liệu RSC', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const placeholder = (block: string) => new RegExp(`data-home-block="${block}"[^>]*><div aria-hidden="true" data-testid="home-defer"`);
  expect(html, 'khối suggest là ô giữ chỗ').toMatch(placeholder('suggest'));
  // Sản phẩm của DB e2e không có ảnh nên dải Story không đủ món: khối rỗng (chỉ còn vùng thông báo cho trình đọc màn hình), không giữ chỗ; ca có
  // món kiểm ở home-view.spec.tsx.
  expect(html, 'khối stories là ô giữ chỗ hoặc rỗng').toMatch(
    new RegExp(`${placeholder('stories').source}|data-home-block="stories"[^>]*>(<div role="status"></div>)?</div>`),
  );
  expect(html.match(/data-testid="home-defer"/g)?.length ?? 0, 'tối đa hai ô giữ chỗ').toBeLessThanOrEqual(DEFERRED.length);
  expect(html, 'dữ liệu RSC không mang suggest').not.toMatch(/\\"suggest\\":/);
  expect(html, 'dữ liệu RSC không mang brands').not.toMatch(/\\"brands\\":/);
});

for (const size of SIZES) {
  test(`${size.width}px: ô giữ chỗ cao bằng dải Story thật, cuộn hết trang thì lưới Gợi ý hiện, CLS ≤ 0,1`, async ({ page, browser, baseURL }) => {
    const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: size, baseURL });
    const ssr = await noJs.newPage();
    await ssr.goto('/');
    const placeholder = await blockHeight(ssr, 'stories');
    await noJs.close();

    await observeCls(page);
    await page.setViewportSize(size);
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {});
    await expect(page.locator('[data-home-block="stories"] [data-testid="home-defer"]')).toHaveCount(0, { timeout: 10_000 });
    await page.screenshot({ path: `${SHOTS}/web-home-top-${size.width}.png` });

    // Cuộn từng khung nhìn tới cuối phần Trang chủ để mọi khối hoãn được dựng như khi khách cuộn thật.
    for (let i = 0; i < 40; i += 1) {
      const done = await page.evaluate(() => {
        window.scrollBy(0, Math.round(window.innerHeight * 0.8));
        const suggest = document.querySelector('[data-home-block="suggest"]');
        return suggest !== null && suggest.getBoundingClientRect().top < window.innerHeight && !suggest.querySelector('[data-testid="home-defer"]');
      });
      await page.waitForTimeout(150);
      if (done) break;
    }
    await expect(page.locator('[data-home-block="suggest"] [data-testid="home-defer"]')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('[data-home-block="suggest"] [data-ds="product-tile"]').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/web-home-suggest-${size.width}.png` });

    const real = await blockHeight(page, 'stories');
    const cls = await readClsTotal(page);
    const overflowX = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
    console.log(`VITALS_WEB ${size.width}x${size.height} storiesPlaceholder=${placeholder} storiesReal=${real} cls=${cls.cls.toFixed(4)} overflowX=${overflowX}`);
    expect(Math.abs(real - placeholder), 'ô giữ chỗ Story cao bằng dải thật').toBeLessThanOrEqual(1);
    expect(overflowX, 'tràn ngang').toBe(0);
    expect(cls.cls, `CLS ${cls.sources.join(' ; ')}`).toBeLessThanOrEqual(0.1);
  });
}

test('Cờ perf.rum_enabled tắt: ẩn trang không gửi web_vital nào, sự kiện web thường vẫn gửi', async ({ page, api }) => {
  const posted: string[] = [];
  page.on('request', (req: Request) => {
    if (req.method() === 'POST') posted.push(`${req.url()} ${req.postData() ?? ''}`);
  });
  await page.setViewportSize(SIZES[0]);
  await page.goto('/');
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
  });
  await expect
    .poll(() => api.callsTo('POST', '/events/web').length + api.callsTo('POST', '/events/web/beacon').length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  expect(posted.filter((p) => p.includes('web_vital'))).toEqual([]);
});
