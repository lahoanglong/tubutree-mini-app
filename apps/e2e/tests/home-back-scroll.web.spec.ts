import { test, expect } from './support/mock-api';
import { mockMergedHome } from './support/home-merged';

const USER = {
  id: 'u-back', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 60, pointsConvertedBalance: 0, walletBalance: 0,
};
const card = (n: number) => ({
  id: `bs-${n}`, slug: `bs-sp-${n}`, brand: 'Tubu', name: `Món cuộn ${n}`, thumbnail: null, basePrice: 100_000 + n, salePrice: null, isFeatured: false, inStock: true,
});

/** Web 375: cuộn sâu xuống lưới Gợi ý, chạm một món sang trang sản phẩm rồi Back: vị trí cuộn phải về lại (hook useWindowScrollRestore thử lại tới khi trang đủ cao). */
test.describe('Web khách: Trang chủ — Back giữ vị trí cuộn', () => {
  test('cuộn sâu, vào trang sản phẩm, Back: scrollY về trong 50px', async ({ page, api, browserName }) => {
    // Máy CI chậm và không giữ trang trong bộ nhớ đệm back/forward: Back nạp lại tài liệu, lưới Gợi ý dựng lại từ trang 1 nên trình duyệt kẹp vị trí cuộn. Làm chậm CPU để lỗi hiện ổn định (chỉ Chromium có CDP).
    if (browserName === 'chromium') {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 5 });
    }
    await page.setViewportSize({ width: 375, height: 812 });
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
    api.get('/products', ({ call }) => {
      const n = Number(call.query.get('page') ?? '1');
      const limit = Number(call.query.get('limit') ?? '20');
      return { data: Array.from({ length: limit }, (_, i) => card((n - 1) * limit + i + 1)), meta: { page: n, limit, total: 100 }, filtersIgnored: false };
    });
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Gợi ý hôm nay' })).toBeVisible({ timeout: 20_000 });

    // Cuộn từng bước để lưới nạp thêm trang (cuộn vô tận), tới độ sâu đủ lớn hoặc hết trang.
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(800);
    const before = await page.evaluate(() => Math.round(window.scrollY));
    const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    test.info().annotations.push({ type: 'before', description: `scrollY=${before}, scrollHeight=${docHeight}` });
    expect(before).toBeGreaterThan(1500);

    await page.evaluate(() => {
      const mid = window.innerHeight / 2;
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/san-pham/"]'));
      const best = links.map((a) => ({ a, d: Math.abs(a.getBoundingClientRect().top - mid) })).sort((x, y) => x.d - y.d)[0];
      if (!best) throw new Error('không có link sản phẩm');
      best.a.click();
    });
    await page.waitForURL(/\/san-pham\//, { timeout: 15_000 });
    await page.goBack();
    await page.waitForURL((u) => u.pathname === '/', { timeout: 15_000 });
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => Math.round(window.scrollY));
    test.info().annotations.push({ type: 'after', description: `scrollY=${after}` });
    console.log(`BACK-SCROLL before=${before} after=${after} scrollHeight=${docHeight}`);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(50);
  });
});
