import { test, expect } from './support/mock-api';
import { observeCls, readClsTotal } from './support/cls-observer';

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
