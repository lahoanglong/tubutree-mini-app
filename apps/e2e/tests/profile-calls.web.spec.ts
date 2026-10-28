import { expect, test } from './support/mock-api';

/**
 * Web khổ điện thoại: số lời gọi API khi mở Cá nhân (/tai-khoan) với khách thường, và CLS của Trang chủ lúc khôi phục phiên.
 * Mọi lời gọi /api/** từ trình duyệt đi qua mock; đếm cả request tới /api chưa mock.
 */

test.describe('Web khách khổ 375: số lời gọi API và dịch chuyển bố cục', () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== 'Web Customer Mobile', 'chỉ đo ở khổ điện thoại');
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  });

  const me = () => ({
    id: 'u1', fullName: 'Nguyễn Văn An', email: null, dob: null, avatarUrl: null, phone: '0912345678', role: 'CUSTOMER', referralCode: 'AN123',
    onboarded: true, segments: [], pointsBalance: 120, pointsConvertedBalance: 0, walletBalance: 50000,
  });

  test('Cá nhân, khách thường: một lời gọi đếm đơn, một lời gọi đếm tin, không hỏi điểm quầy', async ({ page, api }) => {
    api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: me() }));
    api.get('/me', () => me());
    api.get('/auth/me', () => ({ ...me(), ownsBrand: false }));
    api.get('/me/loyalty', { tier: { name: 'Hạt Giống' }, pointsBalance: 120, pointsConvertedBalance: 0 });
    api.get('/me/coupons', [{ id: 'c1', code: 'A' }]);
    api.get('/config/public', { aiAdvisorEnabled: false });
    api.get('/dealer/me', { status: 'NONE', isDealer: false });
    api.get('/orders', { data: [], meta: { page: 1, limit: 1, total: 0 } });
    api.get('/me/notifications', []);
    api.get('/me/notifications/unread-count', { count: 73 });
    api.get('/orders/status-counts', { pending_payment: 2, processing: 1, shipping: 0, delivered: 5, closed: 0 });
    api.allowUnmocked('GET /me/wallet', 'GET /me/referral', 'GET /me/subscriptions', 'GET /brand/owner/me');
    const calls: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api/')) calls.push(`${r.method()} ${u.pathname.replace(/^\/api/, '')}${u.search}`);
    });
    await page.goto('/tai-khoan');
    await expect(page.getByRole('heading', { name: 'Cá nhân', level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    console.log(`PROFILE_CALLS_WEB ${calls.length}\n${calls.join('\n')}`);

    const count = (re: RegExp) => calls.filter((c) => re.test(c)).length;
    expect(count(/^GET \/orders\/status-counts/)).toBe(1);
    expect(count(/^GET \/orders\?/)).toBe(0);
    expect(count(/^GET \/me\/notifications\/unread-count/)).toBe(1);
    expect(count(/^GET \/me\/notifications(\?|$)/)).toBe(0);
    expect(count(/^GET \/waste\/desk\/points/)).toBe(0);
  });

  test('Trang chủ: khách cũ trên máy mới, phiên về chậm; in tổng dịch chuyển bố cục (CLS)', async ({ page, api }) => {
    api.post('/auth/refresh', async () => {
      await new Promise((r) => setTimeout(r, 900));
      return { accessToken: 'e2e-token', user: me() };
    });
    api.get('/me', () => me());
    const item = { variationId: 'v1', productId: 'p1', slug: 's', productName: 'Nước rửa chén', variationName: '', brand: 'Tubu', thumbnail: null, price: 1000, salePrice: null, stock: 3, inStock: true, timesBought: 1, lastPurchasedAt: '2026-01-01' };
    api.get('/me/purchased-items', async () => {
      await new Promise((r) => setTimeout(r, 300));
      return { items: [item], nextCursor: null };
    });
    api.allowUnmocked('POST /events', 'GET /me/new-customer-offer', 'GET /products/for-you', 'GET /me/wishlist/ids', 'GET /flash-sales/upcoming', 'GET /orders/active-count', 'GET /me/orders/active', 'GET /products', 'GET /categories', 'GET /brands', 'GET /me/subscriptions', 'GET /orders');
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { hadRecentInput: boolean; value: number }[]) if (!e.hadRecentInput) w.__cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(6000);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    console.log(`HOME_CLS_WEB ${cls.toFixed(4)}`);
    expect(cls).toBeLessThan(0.1);
  });
});
