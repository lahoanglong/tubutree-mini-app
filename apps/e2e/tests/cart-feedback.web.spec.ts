import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { singleVariationProduct, type PdpProduct } from './support/pdp-product';

/**
 * W42B, web khách: thêm vào giỏ ở trang sản phẩm thì huy hiệu giỏ nảy một nhịp 220ms (`.cart-badge-bump`) và một chấm bay từ nút "Thêm vào giỏ" tới
 * biểu tượng giỏ (`[data-cart-fly]`, 420ms), cùng chuẩn với Mini App (cart-feedback.miniapp.spec.ts). Khách bật giảm chuyển động thì không có chấm bay
 * và huy hiệu không chạy hoạt ảnh. Phần server của Next gọi API thật (sản phẩm một phân loại có sẵn trong DB e2e); mọi lời gọi từ trình duyệt đi qua mock.
 */
const CART_LINE = {
  id: 'cart-line-1', variationId: 'v1', productName: 'Sản phẩm thử', variationName: null, slug: 'san-pham-thu', thumbnail: null,
  unitPrice: 52_000, quantity: 1, stock: 8, total: 52_000, fulfiller: { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' },
};
const CART = { items: [CART_LINE], couponCode: null, subtotal: 52_000, discount: 0, freeship: false, freeshipThreshold: 500_000, itemCount: 1 };

function mockPdp(api: MockApi, p: PdpProduct): void {
  mockSession(api, makeUser({ id: 'u-cart-fx', fullName: 'Nguyễn Văn An' }));
  api.get('/flash-sales/active', []);
  api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
  api.get(`/products/${p.slug}`, { variations: p.variations });
  api.get(`/products/${p.slug}/related`, []);
  api.get(`/products/${p.slug}/bought-together`, []);
  api.get('/products/for-you', []);
  api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
  api.get(`/products/${p.slug}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
  api.get('/me/wishlist/ids', []);
  api.get('/me/coupons', []);
  api.get('/cart', CART);
  api.post('/cart/items', CART);
  api.allowUnmocked('POST /events', 'GET /affiliate/me', 'GET /products/:slug/reviews/can-review');
}

/** Khổ điện thoại có hai nút "Thêm vào giỏ" cùng data-testid (một ở thân trang ẩn dưới md, một ở thanh dính): lấy bản ở thanh dính. */
const addButton = (page: Page) => page.getByTestId('sticky-bar').getByTestId('pdp-add-to-cart');

async function watchFly(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
    (window as unknown as { __flySeen: number }).__flySeen = 0;
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of Array.from(r.addedNodes)) if (n instanceof HTMLElement && n.hasAttribute('data-cart-fly')) (window as unknown as { __flySeen: number }).__flySeen += 1;
      }
    }).observe(document, { childList: true, subtree: true });
  });
}
const flySeen = (page: Page) => page.evaluate(() => (window as unknown as { __flySeen: number }).__flySeen);

test.describe('Web khách: phản hồi khi thêm vào giỏ', () => {
  test('chấm bay một lần rồi tự dọn, huy hiệu nảy 220ms theo đường cong drawer', async ({ page, api, request }) => {
    const p = await singleVariationProduct(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm nào chỉ một phân loại');
    mockPdp(api, p!);
    await watchFly(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/san-pham/${p!.slug}`);
    const add = addButton(page);
    await expect(add).toBeEnabled({ timeout: 30_000 });
    expect(await flySeen(page)).toBe(0);

    const posted = api.waitForCall('POST', '/cart/items');
    await add.click();
    await posted;
    await expect.poll(() => flySeen(page), { timeout: 5_000 }).toBe(1);
    await expect(page.locator('[data-cart-fly]')).toHaveCount(0, { timeout: 3_000 });

    const bump = page.locator('.cart-badge-bump:visible').first();
    await expect(bump).toBeVisible();
    const style = await bump.evaluate((el) => {
      const s = getComputedStyle(el);
      return { name: s.animationName, duration: s.animationDuration };
    });
    expect(style).toEqual({ name: 'cart-badge-bump', duration: '0.22s' });
  });

  test('giảm chuyển động: không có chấm bay, huy hiệu không chạy hoạt ảnh', async ({ page, api, request }) => {
    const p = await singleVariationProduct(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm nào chỉ một phân loại');
    mockPdp(api, p!);
    await watchFly(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/san-pham/${p!.slug}`);
    const add = addButton(page);
    await expect(add).toBeEnabled({ timeout: 30_000 });
    const posted = api.waitForCall('POST', '/cart/items');
    await add.click();
    await posted;
    await expect(page.locator('.cart-badge-bump:visible').first()).toBeVisible();
    await page.waitForTimeout(700);
    expect(await flySeen(page)).toBe(0);
    expect(await page.locator('.cart-badge-bump:visible').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  });
});
