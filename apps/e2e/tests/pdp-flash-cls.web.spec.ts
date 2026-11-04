import { test, expect } from './support/mock-api';
import { observeCls, readClsTotal } from './support/cls-observer';
import { removeFlashPdp, seedFlashPdp, type FlashPdp } from './support/pdp-flash-db';

/**
 * Web, trang sản phẩm đang trong Giờ vàng: thanh Giờ vàng dưới ảnh, giá và "Đã bán" đã có trong HTML server (trang tải sẵn danh sách Giờ vàng),
 * nên danh sách về ở trình trình duyệt sau hydrate không chèn thanh hay đổi dòng giá. Phần server gọi API thật (DB tạm có đợt Giờ vàng gieo ở đây);
 * mọi lời gọi từ trình duyệt đi qua mock, trả cùng đợt đó.
 */
const CLS_MAX = 0.02;
const HOUR = 3_600_000;
let flash: FlashPdp | null = null;

test.beforeAll(async ({ request }) => {
  flash = await seedFlashPdp(request);
});
test.afterAll(async () => {
  if (flash) await removeFlashPdp(flash.saleId);
});

for (const vp of [{ name: 'web375', width: 375, height: 812 }, { name: 'web1280', width: 1280, height: 800 }]) {
  test(`CLS PDP Giờ vàng ${vp.name}: thanh Giờ vàng và giá không dịch sau hydrate`, async ({ page, api }) => {
    test.skip(!flash, 'DB e2e không phải DB tạm hoặc chưa có sản phẩm để gieo đợt Giờ vàng');
    const f = flash!;
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await observeCls(page);
    api.get('/flash-sales/active', () => {
      const now = Date.now();
      return [
        {
          itemId: 'fi-cls', variationId: f.variationId, productSlug: f.slug, productName: f.name, variationName: f.variationName, thumbnail: null,
          flashPrice: f.flashPrice, retailPrice: f.retailPrice, salePrice: null, soldCount: 10, quota: 100, perUserLimit: 3,
          endAt: new Date(now + 5 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
        },
      ];
    });
    api.get('/flash-sales/me/allowance', { items: {} });
    api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
    api.get('/me/wishlist/ids', []);
    api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350000, itemCount: 0 });
    api.allowUnmocked('GET /products/:slug', 'GET /products/:slug/related', 'GET /products/:slug/bought-together', 'GET /products/:slug/bundles', 'GET /products/:slug/reviews', 'GET /products/:slug/stock', 'GET /products', 'GET /products/for-you', 'GET /me/coupons', 'POST /events');
    await page.goto(`/san-pham/${f.slug}`);
    await expect(page.getByTestId('flash-price-bar')).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(1500);
    const { cls, sources } = await readClsTotal(page);
    test.info().annotations.push({ type: 'CLS', description: cls.toFixed(4) });
    console.log(`CLS PDP flash ${vp.name} = ${cls.toFixed(4)}\n${sources.map((s) => `  shift ${s}`).join('\n')}`);
    expect(cls).toBeLessThan(CLS_MAX);
  });
}
