import { test, expect } from './support/mock-api';
import { observeCls, readClsTotal } from './support/cls-observer';
import { NOISE } from './support/noise-png';

/**
 * Web, hub /san-pham: máy đã có "Đã xem gần đây" (localStorage) thì dải ~250px không được chèn vào giữa ô danh mục và "Bán chạy nhất" sau hydrate:
 * script ở <head> đặt data-has-recent và CSS giữ chỗ từ khung hình đầu. API chỉ có phần server (DB e2e); mọi lời gọi từ trình duyệt đi qua mock.
 */
const CLS_MAX = 0.02;
const SEEN = ['a', 'b', 'c', 'd'].map((k, i) => ({ slug: `da-xem-${k}`, name: `Đã xem ${k.toUpperCase()}`, thumbnail: null, viewedAt: 1_700_000_000_000 - i }));
const card = (slug: string, name: string) => ({
  id: slug, name, slug, brand: 'Tubu', thumbnail: null, basePrice: 99_000, salePrice: null, ratingAvg: 0, reviewCount: 0, sold: 0, inStock: true, isFeatured: false, repVariationId: `v-${slug}`,
});

for (const vp of [{ name: 'web375', width: 375, height: 812 }, { name: 'web1280', width: 1280, height: 800 }]) {
  test(`CLS hub /san-pham ${vp.name}: có đã xem gần đây trên máy`, async ({ page, api }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.addInitScript((seen) => {
      try {
        localStorage.setItem('tubu_recently_viewed', JSON.stringify(seen));
      } catch {
        /* không có localStorage */
      }
    }, SEEN);
    await observeCls(page);
    api.get('/flash-sales/active', []);
    api.get('/me/wishlist/ids', []);
    api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350000, itemCount: 0 });
    api.get('/products', (c) => {
      const slugs = c.call.query.get('slugs');
      const list = slugs ? slugs.split(',').map((s) => card(s, `Đã xem ${s.slice(-1).toUpperCase()}`)) : [];
      return { data: list, meta: { page: 1, limit: list.length, total: list.length } };
    });
    api.allowUnmocked('GET /products/best-sellers', 'GET /categories', 'GET /brands', 'GET /me/coupons', 'POST /events');
    await page.goto('/san-pham');
    const rail = page.locator('#browse-recent');
    await expect(rail).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(800);
    const { cls, sources } = await readClsTotal(page);
    test.info().annotations.push({ type: 'CLS', description: cls.toFixed(4) });
    console.log(`CLS hub ${vp.name} = ${cls.toFixed(4)}\n${sources.map((s) => `  shift ${s}`).join('\n')}`);
    expect(cls).toBeLessThan(CLS_MAX);
  });
}

/**
 * Khách quay lại: dải "Đã xem gần đây" nằm trên "Bán chạy nhất", nên ảnh của dải mới là ảnh trong màn đầu. Hai ảnh đầu của dải phải eager + fetchpriority=high,
 * ảnh LCP không lazy, và cả trang không quá 4 ảnh high (2 của dải + 2 của Bán chạy nhất). Ảnh đổi cỡ đi qua `/api/img`: chặn và trả PNG nhiễu để không phụ thuộc mạng
 * (đủ entropy để Chrome tính vào LCP). Máy lưu URL ảnh cũ, API trả URL hiện hành: dải phải dùng URL hiện hành.
 */
const PANCAKE = (name: string) => `https://content.pancake.vn/2-26/${name}.jpg`;
const SEEN_IMG = SEEN.map((it) => ({ ...it, thumbnail: PANCAKE(`cu-${it.slug}`) }));

for (const vp of [{ name: 'web375x812', width: 375, height: 812 }, { name: 'web375x667', width: 375, height: 667 }]) {
  test(`LCP hub /san-pham ${vp.name}: có đã xem gần đây trên máy, ảnh dải ưu tiên`, async ({ page, api }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.addInitScript((seen) => {
      try {
        localStorage.setItem('tubu_recently_viewed', JSON.stringify(seen));
      } catch {
        /* không có localStorage */
      }
    }, SEEN_IMG);
    api.get('/flash-sales/active', []);
    api.get('/me/wishlist/ids', []);
    api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350000, itemCount: 0 });
    api.get('/products', (c) => {
      const slugs = c.call.query.get('slugs');
      const list = slugs ? slugs.split(',').map((s) => ({ ...card(s, `Đã xem ${s.slice(-1).toUpperCase()}`), thumbnail: PANCAKE(`moi-${s}`) })) : [];
      return { data: list, meta: { page: 1, limit: list.length, total: list.length } };
    });
    api.allowUnmocked('GET /products/best-sellers', 'GET /categories', 'GET /brands', 'GET /me/coupons', 'POST /events');
    await page.route('**/api/img?**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: NOISE }));
    await page.goto('/san-pham');
    await expect(page.locator('#browse-recent')).toBeVisible({ timeout: 20_000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    const snap = await page.evaluate(async () => {
      const lcp = await new Promise<{ tag: string; loading: string | null } | null>((resolve) => {
        let last: PerformanceEntry | undefined;
        new PerformanceObserver((list) => {
          last = list.getEntries().at(-1);
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        setTimeout(() => {
          const el = (last as unknown as { element?: Element } | undefined)?.element;
          resolve(el ? { tag: el.tagName, loading: el.getAttribute('loading') } : null);
        }, 300);
      });
      const recent = Array.from(document.querySelectorAll<HTMLImageElement>('#browse-recent img')).map((i) => ({
        loading: i.getAttribute('loading'), fetchpriority: i.getAttribute('fetchpriority'), src: decodeURIComponent(i.currentSrc || i.src),
      }));
      return { lcp, recent, high: document.querySelectorAll('img[fetchpriority="high"]').length };
    });
    expect(snap.recent.length).toBeGreaterThanOrEqual(2);
    expect(snap.recent.slice(0, 2).map((i) => [i.loading, i.fetchpriority])).toEqual([['eager', 'high'], ['eager', 'high']]);
    for (const i of snap.recent.slice(2)) expect([i.loading, i.fetchpriority]).toEqual(['lazy', null]);
    expect(snap.recent[0]!.src).toContain('moi-');
    expect(snap.recent[0]!.src).not.toContain('cu-');
    expect(snap.lcp, 'LCP phải là một phần tử').not.toBeNull();
    // LCP phải là ảnh (không phải đoạn chữ, khi đó kiểm loading qua được một cách rỗng) và không lazy.
    expect(snap.lcp!.tag).toBe('IMG');
    expect(snap.lcp!.loading).not.toBe('lazy');
    expect(snap.high).toBeLessThanOrEqual(4);
  });
}
