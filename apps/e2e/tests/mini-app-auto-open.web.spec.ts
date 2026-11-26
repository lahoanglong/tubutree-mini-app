import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, publicConfig, test, type MockApi } from './support/mock-api';

/**
 * Web điện thoại tự mở Zalo Mini App (W42, cờ `app.mobile_miniapp_redirect_enabled`): apps/web/src/components/layout/mini-app-auto-open.tsx.
 * Trình duyệt Playwright có `navigator.webdriver = true` nên mặc định chỉ thấy dải mời (không chuyển ngầm); ca tự mở giả lập trình duyệt thường
 * bằng cách che `webdriver`, rồi chặn lượt sang zalo.me để kiểm đúng link. Đặt MINIAPP_AUTO_SHOTS_DIR để chụp ảnh 375px.
 */
const SHOTS = process.env.MINIAPP_AUTO_SHOTS_DIR;
const PAGE = '/cau-chuyen';
const DEEP_LINK_RE = /^https:\/\/zalo\.me\/s\/\d+\/brand-story$/;

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'Web Customer Mobile', 'cần UA điện thoại (Pixel 7), chỉ chạy ở một project');
});
test.use({ viewport: { width: 375, height: 812 } });

function mockPage(api: MockApi, flagOn: boolean): void {
  api.get('/config/public', { ...publicConfig(), mobileMiniappRedirectEnabled: flagOn });
  // Trang tĩnh: lời gọi phụ (đếm giỏ, gợi ý, sự kiện) không phải đối tượng của spec này.
  api.allowUnmocked('GET /:a', 'GET /:a/:b', 'GET /:a/:b/:c', 'POST /events', 'POST /events/:a', 'POST /events/:a/:b');
}

async function cookieOf(page: Page, name: string) {
  return (await page.context().cookies()).find((c) => c.name === name) ?? null;
}

function zaloRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith('https://zalo.me/')) urls.push(r.url());
  });
  return urls;
}

const bar = (page: Page) => page.getByTestId('miniapp-smartbar');

test.describe('Web điện thoại: tự mở Mini App (W42)', () => {
  test('cờ tắt: không dải, không lớp phủ, không cookie, không sang Zalo', async ({ page, api }) => {
    mockPage(api, false);
    const zalo = zaloRequests(page);
    await page.goto(PAGE);
    await expect(page.locator('main').first()).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(bar(page)).toHaveCount(0);
    await expect(page.getByTestId('miniapp-opening')).toHaveCount(0);
    expect(await cookieOf(page, 'tubu_mini_auto')).toBeNull();
    expect(zalo).toEqual([]);
  });

  test('cờ bật, trình duyệt tự động: chỉ dải mời nằm trong luồng ở đầu nội dung, không cookie tự mở, không sang Zalo', async ({ page, api }) => {
    mockPage(api, true);
    const zalo = zaloRequests(page);
    await page.goto(PAGE);
    await expect(bar(page)).toBeVisible({ timeout: 15_000 });
    await expect(bar(page).getByRole('button', { name: 'Mở', exact: true })).toBeVisible();
    expect(await bar(page).evaluate((el) => getComputedStyle(el).position)).toBe('static');
    const box = (await bar(page).boundingBox())!;
    const mainTop = (await page.locator('main').first().boundingBox())!.y;
    expect(box.y + box.height, 'dải nằm trên nội dung, không đè').toBeLessThanOrEqual(mainTop + 1);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    // Trang con tràn viền (PageHeader): nút lùi nổi không được đè lên dải.
    const back = (await page.getByRole('button', { name: 'Quay lại' }).first().boundingBox())!;
    const overlap = !(back.x + back.width <= box.x || box.x + box.width <= back.x || back.y + back.height <= box.y || box.y + box.height <= back.y);
    expect(overlap, `nút lùi ${JSON.stringify(back)} đè dải ${JSON.stringify(box)}`).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    expect(await cookieOf(page, 'tubu_mini_auto')).toBeNull();
    expect(zalo).toEqual([]);
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: `${SHOTS}/web375-miniapp-smartbar.png` });
    }
  });

  test('× trên dải: ghi tubu_stay_web 24 giờ, dải biến mất và không quay lại khi tải lại', async ({ page, api }) => {
    mockPage(api, true);
    await page.goto(PAGE);
    await bar(page).getByRole('button', { name: 'Đóng, ở lại bản Web' }).click();
    await expect(bar(page)).toHaveCount(0);
    const stay = (await cookieOf(page, 'tubu_stay_web'))!;
    expect(stay.value).toBe('1');
    expect(Math.abs(stay.expires - Date.now() / 1000 - 86_400)).toBeLessThan(300);
    await page.reload();
    await expect(page.locator('main').first()).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(bar(page)).toHaveCount(0);
  });

  test('?stay=web: ghi tubu_stay_web, bỏ tham số khỏi địa chỉ, không dải', async ({ page, api }) => {
    mockPage(api, true);
    await page.goto(`${PAGE}?ref=A1&stay=web`);
    await expect.poll(async () => (await cookieOf(page, 'tubu_stay_web'))?.value ?? null, { timeout: 15_000 }).toBe('1');
    await expect.poll(() => new URL(page.url()).search).toBe('?ref=A1');
    await page.waitForTimeout(1500);
    await expect(bar(page)).toHaveCount(0);
    expect(await cookieOf(page, 'tubu_mini_auto')).toBeNull();
  });

  test('trang bị loại (giỏ hàng): không dải', async ({ page, api }) => {
    mockPage(api, true);
    await page.goto('/gio-hang');
    await page.waitForTimeout(2500);
    await expect(bar(page)).toHaveCount(0);
  });

  test('trình duyệt thường: ghi tubu_mini_auto 24 giờ, lớp phủ có lối "Ở lại bản Web" dạng chữ, rồi mở đúng màn Mini App', async ({ page, api }) => {
    mockPage(api, true);
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { configurable: true, get: () => false });
    });
    // Giữ lượt sang zalo.me tới khi kiểm xong: trang hiện tại còn nguyên lớp phủ trong lúc chờ (như khi hệ điều hành hỏi "Mở bằng Zalo?").
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('https://zalo.me/**', async (route) => {
      await hold;
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Zalo</title><p>zalo</p>' });
    });
    const nav = page.waitForRequest((r) => r.url().startsWith('https://zalo.me/'), { timeout: 20_000 });
    await page.goto(PAGE);
    const overlay = page.getByTestId('miniapp-opening');
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    await expect(overlay.getByRole('status')).toHaveText('Đang mở Tubu Tree trên Zalo…');
    const stay = overlay.getByRole('button', { name: 'Ở lại bản Web' });
    await expect(stay).toBeVisible();
    expect(await stay.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: `${SHOTS}/web375-miniapp-opening.png` });
    }
    expect((await nav).url()).toMatch(DEEP_LINK_RE);
    const auto = await cookieOf(page, 'tubu_mini_auto');
    expect(auto?.value).toBe('1');
    expect(Math.abs(auto!.expires - Date.now() / 1000 - 86_400)).toBeLessThan(300);
    // Playwright chờ lượt chuyển đang treo xong mới đọc lại DOM, nên ca "bấm Ở lại sau khi đã gửi lượt chuyển" kiểm ở mini-app-auto-open.spec.tsx.
    release();
    await expect.poll(() => page.url(), { timeout: 15_000 }).toMatch(DEEP_LINK_RE);
  });
});
