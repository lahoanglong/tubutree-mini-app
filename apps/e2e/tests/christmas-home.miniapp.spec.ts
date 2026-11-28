import { test, expect } from './support/mock-api';
import { mockDiscovery } from './support/discovery-mocks';
import { mockChristmasHome, xmasShot, XMAS_NOW } from './support/christmas-home';

/**
 * Zalo Mini App: Noel Xanh ở Trang chủ (tubu-w57-01) chạy thật trong trình duyệt, API mock toàn bộ. Mùa khác Noel thì không tải mã Noel nào; mùa Noel có tuyết,
 * dây đèn, thẻ cây thông: rung cây → hộp rơi → "Mở quà" gọi điểm danh đúng một lần, ❄️ tắt tuyết và nhớ sau khi mở lại. Có XMAS_SHOTS_DIR thì chụp ảnh 375px.
 */
const XMAS_FILE = /christmas/;

test.describe('Trang chủ Noel Xanh (Mini App)', () => {
  test('mùa "none": không có thẻ Noel, không tải tệp Noel nào', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockDiscovery(api, { returning: true });
    const loaded: string[] = [];
    page.on('request', (r) => {
      if (XMAS_FILE.test(new URL(r.url()).pathname)) loaded.push(r.url());
    });
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Thẻ thành viên' })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => api.callsTo('GET', '/config/public').length).toBeGreaterThan(0);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('christmas-hero')).toHaveCount(0);
    await expect(page.locator('[data-home-block="season"]')).toHaveCount(0);
    expect(loaded).toEqual([]);
  });

  test('mùa Noel: tuyết + dây đèn + cây thông; rung → hộp rơi → mở quà một lần; ❄️ tắt tuyết và nhớ', async ({ page, api }) => {
    await page.clock.setFixedTime(XMAS_NOW);
    await page.setViewportSize({ width: 375, height: 812 });
    mockDiscovery(api, { returning: true });
    const xmas = mockChristmasHome(api);
    await page.goto('/');

    const hero = page.getByTestId('christmas-hero');
    await expect(hero).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('christmas-snow')).toBeAttached();
    await expect(page.locator('[data-home-block="search"] [data-testid="christmas-garland"]')).toBeAttached();
    const tiles = page.getByTestId('advent-strip').locator('.tubu-xmas-tile');
    await expect(tiles).toHaveCount(12);
    await expect(tiles.nth(0)).toHaveAttribute('data-state', 'claimed');
    await expect(tiles.nth(1)).toHaveAttribute('data-state', 'missed');
    await expect(tiles.nth(2)).toHaveAttribute('data-state', 'open');
    await expect(tiles.nth(3)).toHaveAttribute('data-state', 'locked');
    await hero.scrollIntoViewIfNeeded();
    await xmasShot(page, 'mini-375-snow-on');
    await page.getByTestId('advent-strip').scrollIntoViewIfNeeded();
    await xmasShot(page, 'mini-375-advent-strip');

    const cta = page.getByTestId('christmas-cta');
    await expect(cta).toHaveText('Rung cây nhận quà');
    await cta.click();
    await expect(cta).toHaveText('Mở quà');
    await expect(hero).toHaveAttribute('data-phase', 'dropped');
    await xmasShot(page, 'mini-375-tree-shaken');
    await cta.click();
    await expect(hero).toContainText('Đã mở quà hôm nay', { timeout: 10_000 });
    await expect(tiles.nth(2)).toHaveAttribute('data-state', 'claimed');
    expect(xmas.posts()).toBe(1);
    await xmasShot(page, 'mini-375-gift-opened');

    const toggle = page.getByTestId('christmas-snow-toggle');
    await toggle.click();
    await expect(page.getByTestId('christmas-snow')).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await xmasShot(page, 'mini-375-snow-off');
    await page.reload();
    await expect(hero).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('christmas-snow-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('christmas-snow')).toHaveCount(0);
  });
});
