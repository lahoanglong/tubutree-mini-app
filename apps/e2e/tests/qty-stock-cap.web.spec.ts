import { expect, makeUser, mockSession, reply, test, type MockApi } from './support/mock-api';
import { assertProductOnCi, singleVariationProduct } from './support/pdp-product';

/**
 * Web khách (W29), cùng luật với Mini App (qty-stock-cap.miniapp.spec.ts): bộ chọn số lượng không lộ tồn trên 20.
 * Tồn 1–20 khoá nút + ở đúng tồn; tồn cao hơn thì không, máy chủ từ chối phần vượt bằng câu không có số, dòng vượt tồn kéo về 20, Mua lại không kẹp theo tồn đó.
 */
const OVER = 'Số lượng này vượt số hàng đang có.';
const overReply = reply(400, { statusCode: 400, message: OVER, error: 'Bad Request' });
const showsNumber = (n: number) => new RegExp(`(^|[^\\d.])${n}([^\\d.]|$)`);
const EMPTY_CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 0 };
const cartWith = (quantity: number, stock: number) => ({
  ...EMPTY_CART,
  items: [{
    id: 'c1', variationId: 'v1', slug: 'dau-goi', productName: 'Dầu gội bồ kết', variationName: 'Mặc định', thumbnail: null,
    unitPrice: 65_000, quantity, stock, weight: 600, total: quantity * 65_000,
  }],
  subtotal: quantity * 65_000,
  itemCount: quantity,
});

async function signedIn(page: import('@playwright/test').Page, api: MockApi): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
  mockSession(api, makeUser({ id: 'u1', fullName: 'Nguyễn Văn An' }));
  api.get('/config/public', { freeshipThreshold: 500000, support: { hotline: '0984606774', email: 'tubutree@gmail.com' } });
  api.get('/me/coupons', []);
  api.get('/me/wishlist/ids', []);
  api.get('/flash-sales/active', []);
  api.allowUnmocked('POST /coupons/preview', 'GET /coupons/available', 'GET /me/addresses', 'GET /waste/me', 'GET /me/subscriptions', 'GET /affiliate/me', 'POST /events');
}

test.describe('Web khách: bộ chọn số lượng không lộ tồn trên 20 (W29)', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 375, height: 812 });
  });

  test('giỏ: dòng 25/25 bấm + gửi 26, máy chủ từ chối thì báo câu không có số; không có câu "đã chọn hết"', async ({ page, api }) => {
    await signedIn(page, api);
    api.get('/cart', cartWith(25, 25));
    api.patch('/cart/items/:id', overReply);
    await page.goto('/gio-hang');

    const line = page.getByTestId('cart-line');
    await expect(line).toHaveCount(1, { timeout: 30_000 });
    const plus = line.getByRole('button', { name: 'Tăng số lượng Dầu gội bồ kết' });
    await expect(plus).toBeEnabled();
    await expect(line).not.toContainText('hàng đang có');

    const patched = api.waitForCall('PATCH', '/cart/items/:id');
    await plus.click();
    expect((await patched).body).toEqual({ quantity: 26 });
    await expect(line.getByRole('alert')).toHaveText(OVER);
  });

  test('giỏ: dòng vượt tồn 30 trên tồn 25 báo "Vượt số hàng đang có…", bấm − về 20 chứ không về 25', async ({ page, api }) => {
    await signedIn(page, api);
    api.get('/cart', cartWith(30, 25));
    api.patch('/cart/items/:id', cartWith(20, 25));
    await page.goto('/gio-hang');

    const line = page.getByTestId('cart-line');
    await expect(line.getByText('Vượt số hàng đang có, giảm bớt để thanh toán')).toBeVisible({ timeout: 30_000 });
    await expect(line).not.toContainText(showsNumber(25));
    const patched = api.waitForCall('PATCH', '/cart/items/:id');
    await line.getByRole('button', { name: 'Giảm số lượng Dầu gội bồ kết' }).click();
    expect((await patched).body).toEqual({ quantity: 20 });
    await expect(line.getByText('Vượt số hàng đang có, giảm bớt để thanh toán')).toHaveCount(0);
  });

  test('Mua lại: đơn cũ 30, tồn 25 → sheet giữ 30, không báo "Không đủ", gửi 30 để máy chủ kẹp', async ({ page, api }) => {
    const CODE = 'TUBU2026110600029';
    await signedIn(page, api);
    api.get('/cart', EMPTY_CART);
    api.get('/me/purchased-items', { items: [], nextCursor: null });
    api.get('/orders/me/refunds', []);
    api.get('/orders', {
      data: [{
        id: `id-${CODE}`, code: CODE, status: 'DELIVERED', subtotal: 1_800_000, discount: 0, shippingFee: 0, total: 1_800_000, paymentMethod: 'COD',
        paymentStatus: 'PAID', createdAt: '2026-10-01T03:00:00Z',
        items: [{
          id: 'many', variationId: 'var-many', productName: 'Nước giặt Tubu 2L', productSlug: 'sp-many', variationName: '', thumbnail: null,
          unitPrice: 60000, quantity: 30, total: 1_800_000, stock: 25, available: true, discontinued: false, currentPrice: 60000, flashActive: false,
        }],
      }],
      meta: { page: 1, limit: 20, total: 1 },
    });
    api.post('/orders/:code/repurchase', { ...EMPTY_CART, results: [{ orderItemId: 'many', status: 'partial', reason: 'EXCEEDS_STOCK', addedQuantity: 20 }] });
    await page.goto('/tai-khoan/don-hang');

    await page.getByRole('button', { name: 'Mua lại', exact: true }).first().click({ timeout: 15_000 });
    const sheet = page.getByRole('dialog');
    const row = sheet.getByTestId('reorder-line').filter({ hasText: 'Nước giặt Tubu 2L' });
    await expect(row).toBeVisible();
    await expect(row.locator('[data-notice]')).toHaveCount(0);
    await expect(sheet).not.toContainText(showsNumber(25));

    const posted = api.waitForCall('POST', '/orders/:code/repurchase');
    await sheet.getByRole('button', { name: 'Thêm vào giỏ (30)' }).click();
    expect((await posted).body).toEqual({ items: [{ orderItemId: 'many', quantity: 30 }], addSource: 'repurchase' });
  });

  test('PDP: tồn 25 thì nút + qua được 25 và không có chữ số tồn; tồn 5 thì khoá ở 5', async ({ page, api, request }) => {
    const p = await singleVariationProduct(request);
    assertProductOnCi(p, 'sản phẩm một phân loại');
    test.skip(!p, 'DB e2e chưa có sản phẩm một phân loại');
    let stock = 25;
    api.get('/flash-sales/active', []);
    api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
    api.get(`/products/${p!.slug}`, () => ({ variations: p!.variations.map((v) => ({ ...v, stock })) }));
    api.get(`/products/${p!.slug}/related`, []);
    api.get(`/products/${p!.slug}/bought-together`, []);
    api.get('/products/for-you', []);
    api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
    api.get(`/products/${p!.slug}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
    api.get('/me/wishlist/ids', []);
    await page.goto(`/san-pham/${p!.slug}`);

    const plus = page.locator('[data-section="pdp-quantity"]').getByRole('button', { name: 'Tăng số lượng' });
    await expect(page.getByTestId('pdp-stock-label')).toHaveText(/^Còn hàng/, { timeout: 30_000 });
    for (let i = 0; i < 25; i++) await plus.click();
    await expect(plus.locator('..')).toContainText('26');
    await expect(plus).toHaveAttribute('aria-disabled', 'false');
    await expect(page.locator('main')).not.toContainText(showsNumber(25));

    stock = 5;
    await page.reload();
    await expect(page.getByTestId('pdp-low-stock')).toHaveText('Chỉ còn 5 sản phẩm', { timeout: 30_000 });
    for (let i = 0; i < 4; i++) await plus.click();
    await expect(plus.locator('..')).toContainText('5');
    await expect(plus).toHaveAttribute('aria-disabled', 'true');
  });
});
