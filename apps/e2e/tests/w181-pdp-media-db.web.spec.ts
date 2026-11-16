import type { Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { observeCls, readClsTotal } from './support/cls-observer';
import { assertSeededOnCi } from './support/a11y-db';
import { MEDIA_IMAGES, MEDIA_VIDEO, restoreMediaPdp, seedMediaPdp, type MediaPdp } from './support/pdp-media-db';

/**
 * W181, web ở 375×812 và 1280×800: thư viện media của trang chi tiết dựng từ dữ liệu THẬT của API (phần server của Next): ảnh, ô video cuối dải
 * (poster + nút phát, preload none, không tự phát, không tải video cho tới khi bấm), nút phát từ 44px, không làm trang nhảy (CLS), và chọn phân loại
 * có ảnh riêng thì dải nhảy tới ảnh đó. DB tạm được gieo ảnh/video vào một sản phẩm 2 phân loại (xem support/pdp-media-db.ts) rồi trả lại.
 * Mọi lời gọi từ trình duyệt đi qua mock; ảnh và video đi qua page.route. Tệp chỉ thuộc project "Web Customer Media DB" (playwright.config.ts).
 */
const CLS_MAX = 0.02;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#9bbf8a"/></svg>';
let media: MediaPdp | null = null;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }, testInfo) => {
  test.setTimeout(240_000);
  if (testInfo.project.name !== 'Web Customer Media DB') return;
  media = await seedMediaPdp(request);
  assertSeededOnCi(media !== null);
  if (!media) return;
  // Trang dựng sẵn có thể giữ bản cũ tới 60 giây (revalidate): hỏi chính trang tới khi HTML có ô video.
  const deadline = Date.now() + 200_000;
  let last = 'chưa hỏi lần nào';
  while (Date.now() < deadline) {
    try {
      const res = await request.get(`/san-pham/${media.slug}`);
      if ((await res.text()).includes('<video')) return;
      last = `HTTP ${res.status()}, HTML chưa có thẻ video`;
    } catch (err) {
      last = `lỗi gọi trang: ${String(err)}`;
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`HTML của /san-pham/${media.slug} không có thẻ video sau 200 giây (lần cuối: ${last})`);
});

test.afterAll(async () => {
  if (media) await restoreMediaPdp(media);
});

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function open(page: Page, api: MockApi, vp: { width: number; height: number }) {
  const m = media!;
  let videoRequests = 0;
  await page.route('https://img.test/**', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG }));
  await page.route('https://cdn.test/**', (route) => {
    videoRequests += 1;
    return route.fulfill({ status: 200, contentType: 'video/mp4', body: 'khong-phai-video' });
  });
  api.get('/flash-sales/active', []);
  api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
  api.get('/me/wishlist/ids', []);
  api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350000, itemCount: 0 });
  const p = `/products/${m.slug}`;
  api.allowUnmocked(`GET ${p}`, `GET ${p}/related`, `GET ${p}/bought-together`, `GET ${p}/bundles`, `GET ${p}/reviews`, `GET ${p}/stock`, 'GET /products', 'GET /products/for-you', 'GET /me/coupons', 'POST /events');
  await page.setViewportSize(vp);
  await page.goto(`/san-pham/${m.slug}`);
  await expect(page.getByRole('group', { name: `Ảnh sản phẩm ${m.name}` })).toBeVisible({ timeout: 20_000 });
  return { videoRequests: () => videoRequests };
}

for (const vp of [{ name: 'web375', width: 375, height: 812 }, { name: 'web1280', width: 1280, height: 800 }]) {
  test.describe(`PDP media ${vp.name}`, () => {
    test('ảnh rồi video cuối dải; video không tải, không tự phát; nút phát từ 44px; CLS thấp', async ({ page, api }) => {
      test.skip(!media, 'DB e2e không phải DB tạm hoặc chưa có sản phẩm 2 phân loại để gieo media');
      await observeCls(page);
      const { videoRequests } = await open(page, api, vp);
      const slides = page.locator('[aria-roledescription="slide"]');
      await expect(slides).toHaveCount(MEDIA_IMAGES.length + 1);
      const video = page.locator('video');
      await expect(video).toHaveCount(1);
      await expect(video).toHaveAttribute('src', MEDIA_VIDEO);
      await expect(video).toHaveAttribute('preload', 'none');
      expect(await video.evaluate((el: HTMLVideoElement) => ({ autoplay: el.autoplay, playsInline: el.playsInline, controls: el.controls, paused: el.paused }))).toEqual({
        autoplay: false,
        playsInline: true,
        controls: false,
        paused: true,
      });

      // Cùng khung vuông với ảnh.
      const first = (await slides.nth(0).boundingBox())!;
      const last = (await slides.nth(MEDIA_IMAGES.length).boundingBox())!;
      expect(Math.round(last.width)).toBe(Math.round(first.width));
      expect(Math.round(last.height)).toBe(Math.round(first.height));

      await slides.nth(MEDIA_IMAGES.length).scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      expect(videoRequests(), 'chưa bấm thì không tải video').toBe(0);

      const play = page.getByRole('button', { name: /^Phát video của/ });
      await expect(play).toBeVisible();
      const box = (await play.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);

      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.waitForTimeout(1000);
      const { cls, sources } = await readClsTotal(page);
      expect(cls, sources.join('\n')).toBeLessThan(CLS_MAX);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await play.click();
      await expect.poll(() => videoRequests(), { message: 'bấm phát thì mới tải video' }).toBeGreaterThan(0);
    });

    test('chọn phân loại có ảnh riêng thì dải nhảy tới ảnh đó', async ({ page, api }) => {
      test.skip(!media, 'DB e2e không phải DB tạm hoặc chưa có sản phẩm 2 phân loại để gieo media');
      await open(page, api, vp);
      const track = page.getByRole('group', { name: `Ảnh sản phẩm ${media!.name}` }).locator('div.flex.snap-x');
      const scrollLeft = () => track.evaluate((el) => el.scrollLeft);
      expect(await scrollLeft()).toBe(0);
      const second = media!.variations[1]!;
      await page.getByRole('group', { name: 'Phân loại' }).getByRole('button', { name: new RegExp(escapeRe(second.name)) }).first().click();
      const width = await track.evaluate((el) => el.clientWidth);
      await expect.poll(scrollLeft, { message: 'dải nhảy tới ảnh thứ 3' }).toBeGreaterThanOrEqual(2 * width - 2);
    });
  });
}
