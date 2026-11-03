import { test, expect } from './support/mock-api';
import { mockMergedHome } from './support/home-merged';

const USER = {
  id: 'u-back', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 60, pointsConvertedBalance: 0, walletBalance: 0,
};
const card = (n: number, slug = `bs-sp-${n}`) => ({
  id: `bs-${n}`, slug, brand: 'Tubu', name: `Món cuộn ${n}`, thumbnail: null, basePrice: 100_000 + n, salePrice: null, isFeatured: false, inStock: true,
});

/** Web 375: cuộn sâu xuống lưới Gợi ý, chạm một món sang trang sản phẩm rồi Back: vị trí cuộn phải về lại (hook useWindowScrollRestore thử lại tới khi trang đủ cao). */
test.describe('Web khách: Trang chủ — Back giữ vị trí cuộn', () => {
  // 'cứng': món giả không có ở API nên PDP nạp cứng, Back nạp lại tài liệu (back_forward, không popstate).
  // 'mềm': món là sản phẩm thật của DB e2e nên PDP chuyển trang mềm của Next, Back là popstate trong cùng tài liệu.
  for (const mode of ['cứng', 'mềm'] as const) {
  test(`cuộn sâu, vào trang sản phẩm (chuyển ${mode}), Back: scrollY về trong 50px`, async ({ page, api, browserName, request }) => {
    // Chế độ mềm: chỉ dùng đúng số sản phẩm thật có trong DB (mỗi món một slug, không trùng để lưới không bỏ món).
    let realSlugs: string[] = [];
    if (mode === 'mềm') {
      const res = await request.get(`http://localhost:${process.env.E2E_API_PORT}/api/products?limit=40`).catch(() => null);
      realSlugs = res?.ok() ? (((await res.json()) as { data?: { slug: string }[] }).data ?? []).map((x) => x.slug) : [];
      test.skip(realSlugs.length < 30, 'DB e2e có ít hơn 30 sản phẩm');
      api.allowUnmocked('GET /products/:slug', 'GET /products/:slug/reviews', 'GET /products/:slug/reviews/can-review', 'GET /products/for-you', 'GET /affiliate/me');
    }
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
      return { data: Array.from({ length: limit }, (_, i) => card((n - 1) * limit + i + 1, mode === 'mềm' ? realSlugs[(n - 1) * limit + i] : undefined)), meta: { page: n, limit, total: mode === 'mềm' ? Math.min(realSlugs.length, 40) : 100 }, filtersIgnored: false };
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

    await page.evaluate(() => ((window as unknown as { __doc?: number }).__doc = 1));
    const navInfo = (label: string) =>
      page.evaluate((l) => `${l}: type=${(performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).type} href=${location.href} saved=${sessionStorage.getItem('tubu_scroll_web:home')} y=${Math.round(scrollY)} cùngTàiLiệu=${(window as unknown as { __doc?: number }).__doc === 1}`, label);
    test.info().annotations.push({ type: 'nav', description: await navInfo('trước click') });
    await page.evaluate(() => {
      const mid = window.innerHeight / 2;
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/san-pham/"]'));
      const best = links.map((a) => ({ a, d: Math.abs(a.getBoundingClientRect().top - mid) })).sort((x, y) => x.d - y.d)[0];
      if (!best) throw new Error('không có link sản phẩm');
      best.a.click();
    });
    await page.waitForURL(/\/san-pham\//, { timeout: 15_000 });
    const sameDoc = await page.evaluate(() => (window as unknown as { __doc?: number }).__doc === 1);
    expect(sameDoc, `PDP phải là chuyển ${mode}`).toBe(mode === 'mềm');
    test.info().annotations.push({ type: 'nav', description: await navInfo('tại PDP') });
    await page.goBack();
    await page.waitForURL((u) => u.pathname === '/', { timeout: 15_000 });
    test.info().annotations.push({ type: 'nav', description: await navInfo('sau goBack') });
    const readY = () => page.evaluate(() => Math.round(window.scrollY));
    await expect.poll(async () => Math.abs((await readY()) - before), { timeout: 6_000 }).toBeLessThanOrEqual(50).catch(() => undefined);
    const after = await readY();
    test.info().annotations.push({ type: 'after', description: `scrollY=${after}` });
    console.log((test.info().annotations.filter((a) => a.type === 'nav').map((a) => `NAV ${a.description}`)).join('\n'));
    console.log(`BACK-SCROLL before=${before} after=${after} scrollHeight=${docHeight} afterHeight=${await page.evaluate(() => document.documentElement.scrollHeight)}`);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(50);
  });
  }
});
