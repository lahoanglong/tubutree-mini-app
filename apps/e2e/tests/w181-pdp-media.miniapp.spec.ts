import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { observeCls, readClsTotal } from './support/cls-observer';
import { mockPilotProduct, PILOT_PRODUCT, PILOT_SLUG } from './support/pilot-mocks';

/**
 * W181, Mini App 375×812: thư viện media của trang chi tiết có ảnh + video từ Pancake. Video chỉ là một ô cuối dải cùng khung vuông với ảnh,
 * không tải gì cho tới khi khách bấm phát, không tự phát, nút phát từ 44px; chọn phân loại có ảnh riêng thì dải nhảy tới ảnh đó.
 * Dự án Mini chạy WebKit, không có 'layout-shift', nên ép Chromium để đo CLS thật. API mock toàn bộ, ảnh và video đi qua page.route.
 */
test.use({ browserName: 'chromium', viewport: { width: 375, height: 812 } });

const IMG = (n: string) => `https://img.test/${n}.svg`;
const VIDEO = 'https://cdn.test/clip.mp4';
const SVG = (c: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${c}"/></svg>`;

const VARIATIONS = [
  { id: 'var-1', sku: 'S1', name: 'Gói nhỏ', attributes: {}, retailPrice: 65_000, salePrice: null, stock: 50, imageUrl: IMG('a') },
  { id: 'var-2', sku: 'S2', name: 'Gói lớn', attributes: {}, retailPrice: 99_000, salePrice: null, stock: 50, imageUrl: IMG('c') },
];

async function setup(page: Page, api: Parameters<typeof mockPilotProduct>[0], product: Record<string, unknown>): Promise<{ videoRequests: () => number }> {
  mockPilotProduct(api);
  api.get('/products/:slug', { ...PILOT_PRODUCT, variations: VARIATIONS, ...product });
  let video = 0;
  await page.route('https://img.test/**', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG('#9bbf8a') }));
  await page.route('https://cdn.test/**', (route) => {
    video += 1;
    return route.fulfill({ status: 200, contentType: 'video/mp4', body: 'khong-phai-video' });
  });
  return { videoRequests: () => video };
}

const open = async (page: Page) => {
  await page.goto(`/product/${PILOT_SLUG}`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
};

const track = (page: Page) => page.getByRole('region', { name: 'Ảnh sản phẩm' });

test.describe('Mini App 375px: ảnh và video ở trang chi tiết (W181)', () => {
  test('video là ô cuối dải cùng khung vuông với ảnh; không tải video, không tự phát cho tới khi bấm', async ({ page, api }) => {
    const { videoRequests } = await setup(page, api, { images: [IMG('a'), IMG('b'), IMG('c')], videos: [VIDEO] });
    await open(page);

    const slides = track(page).locator(':scope > *');
    await expect(slides).toHaveCount(4);
    const video = page.getByTestId('pdp-video').locator('video');
    await expect(video).toHaveAttribute('preload', 'none');
    expect(await video.evaluate((el: HTMLVideoElement) => ({ autoplay: el.autoplay, playsInline: el.playsInline, controls: el.controls, paused: el.paused }))).toEqual({
      autoplay: false,
      playsInline: true,
      controls: false,
      paused: true,
    });

    // Cùng khung vuông với ảnh: thêm video không đổi chiều cao dải.
    const first = (await slides.nth(0).boundingBox())!;
    const last = (await slides.nth(3).boundingBox())!;
    expect(Math.round(last.height)).toBe(Math.round(first.height));
    expect(Math.round(last.width)).toBe(Math.round(first.width));

    // Cuộn tới ô video: vẫn chưa tải gì.
    await page.getByTestId('pdp-video').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    expect(videoRequests()).toBe(0);

    const play = page.getByTestId('pdp-video-play');
    await expect(play).toBeVisible();
    const box = (await play.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);

    await play.click();
    await expect.poll(() => videoRequests(), { message: 'bấm phát thì mới tải video' }).toBeGreaterThan(0);
  });

  test('thêm ô video không làm trang nhảy (CLS ≤ 0.02)', async ({ page, api }) => {
    await observeCls(page);
    await setup(page, api, { images: [IMG('a'), IMG('b'), IMG('c')], videos: [VIDEO] });
    await open(page);
    await page.waitForTimeout(1200);
    const { cls, sources } = await readClsTotal(page);
    expect(cls, sources.join('\n')).toBeLessThanOrEqual(0.02);
  });

  test('không có video: như trước, không ô video', async ({ page, api }) => {
    await setup(page, api, { images: [IMG('a'), IMG('b')], videos: [] });
    await open(page);
    await expect(page.getByTestId('pdp-video')).toHaveCount(0);
    await expect(track(page).locator(':scope > *')).toHaveCount(2);
  });

  test('URL video không phải http(s) bị bỏ', async ({ page, api }) => {
    await setup(page, api, { images: [IMG('a')], videos: ['javascript:alert(1)', 'data:video/mp4;base64,AAAA'] });
    await open(page);
    await expect(page.getByTestId('pdp-video')).toHaveCount(0);
  });

  test('chọn phân loại có ảnh riêng thì dải cuộn tới ảnh đó', async ({ page, api }) => {
    await setup(page, api, { images: [IMG('a'), IMG('b'), IMG('c')], videos: [] });
    await open(page);
    const scrollLeft = () => track(page).evaluate((el) => el.scrollLeft);
    expect(await scrollLeft()).toBe(0);
    await page.getByRole('button', { name: /Gói lớn/ }).first().click();
    await expect.poll(scrollLeft, { message: 'dải nhảy tới ảnh thứ 3' }).toBeGreaterThanOrEqual(2 * 375 - 2);
    await page.getByRole('button', { name: /Gói nhỏ/ }).first().click();
    await expect.poll(scrollLeft).toBeLessThanOrEqual(2);
  });

  test('video không phát được (định dạng hỏng): hiện câu báo, không làm vỡ trang', async ({ page, api }) => {
    await setup(page, api, { images: [IMG('a')], videos: [VIDEO] });
    await open(page);
    await page.getByTestId('pdp-video').scrollIntoViewIfNeeded();
    await page.getByTestId('pdp-video-play').click();
    await expect(page.getByTestId('pdp-video-failed')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('pdp-video-failed')).toHaveText('Không phát được video này.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
