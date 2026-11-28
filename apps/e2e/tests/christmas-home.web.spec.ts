import type { Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { HOME_PUBLIC, mockMergedHome } from './support/home-merged';
import { mockChristmasHome, xmasShot, XMAS_NOW } from './support/christmas-home';

/**
 * Web khách: Noel Xanh ở Trang chủ (tubu-w57-01), cùng luồng với Mini App (christmas-home.miniapp.spec.ts). HTML ISR dựng với DB tạm mùa "none"
 * (web-gate.sh / e2e.yml), trình duyệt nhận mùa Noel từ mock nên thẻ hiện sau khi cấu hình về. Có XMAS_SHOTS_DIR thì chụp 375px và 1280px.
 */
const USER = {
  id: 'u-xmas', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 60, pointsConvertedBalance: 0, walletBalance: 0,
};

async function signedIn(page: Page, api: MockApi): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec chạy tiếp, chỉ không có phiên khôi phục
    }
  });
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me/notifications/unread-count', { count: 0 });
  api.get('/me/subscriptions', []);
  api.get('/me/wishlist/ids', []);
  api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350000, itemCount: 0 });
  mockMergedHome(api);
}

for (const width of [375, 1280]) {
  test(`Trang chủ Noel Xanh ${width}px: tuyết, cây thông, lịch quà; rung → mở quà một lần; ❄️ tắt tuyết và nhớ`, async ({ page, api }, testInfo) => {
    // Khổ điện thoại chạy ở project điện thoại, 1280px ở project máy tính (không chạy trùng).
    test.skip(testInfo.project.name.includes('Mobile') !== width < 768, 'khổ này thuộc project còn lại');
    await page.clock.setFixedTime(XMAS_NOW);
    await page.setViewportSize({ width, height: width < 768 ? 812 : 900 });
    await signedIn(page, api);
    const xmas = mockChristmasHome(api);
    // Trang chủ web lấy cấu hình công khai từ request gộp `/home` (lib/home-feed.ts), không gọi lẻ /config/public.
    api.get('/home', { ...HOME_PUBLIC, publicConfig: { ...HOME_PUBLIC.publicConfig, seasonalTheme: 'christmas' } });
    await page.goto('/');

    const hero = page.getByTestId('christmas-hero');
    await expect(hero).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('christmas-snow')).toBeAttached();
    // Dây đèn chỉ ở khổ điện thoại (header dính của Trang chủ); từ md có header khung trang riêng.
    const garland = page.getByTestId('christmas-garland');
    if (width < 768) await expect(garland).toBeVisible();
    else await expect(garland).toBeHidden();
    const tiles = page.getByTestId('advent-strip').locator('.tubu-xmas-tile');
    await expect(tiles).toHaveCount(12);
    await expect(tiles.nth(2)).toHaveAttribute('data-state', 'open');
    await hero.scrollIntoViewIfNeeded();
    await xmasShot(page, `web-${width}-snow-on`);
    await page.getByTestId('advent-strip').scrollIntoViewIfNeeded();
    await xmasShot(page, `web-${width}-advent-strip`);

    const cta = page.getByTestId('christmas-cta');
    await cta.click();
    await expect(cta).toHaveText('Mở quà');
    await xmasShot(page, `web-${width}-tree-shaken`);
    await cta.click();
    await expect(hero).toContainText('Đã mở quà hôm nay', { timeout: 10_000 });
    expect(xmas.posts()).toBe(1);

    await page.getByTestId('christmas-snow-toggle').click();
    await expect(page.getByTestId('christmas-snow')).toHaveCount(0);
    await xmasShot(page, `web-${width}-snow-off`);
    await page.reload();
    await expect(hero).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('christmas-snow')).toHaveCount(0);
  });
}
