import type { Locator, Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';
import { footerCart } from './support/cart-footer-mocks';
import { CHECKOUT_ADDRESS, CHECKOUT_CART, ORDER_CODE_COD } from './support/checkout-mocks';
import { mockWorld } from './support/checkout-states';
import { FLOW_PLAIN } from './support/checkout-flow-states';
import { singleVariationProduct } from './support/pdp-product';
import { shippingEstimate } from './support/shipping-estimate-mocks';

/**
 * Web, gói "phí giao sớm": giỏ có dòng "Phí giao (ước tính)" và "Tổng tạm tính" (390: trong chân dính; 1440: trong khung tóm tắt), và khách chưa có
 * địa chỉ đi từ trang sản phẩm tới Đặt hàng trong ≤ 10 chạm. Mọi lời gọi /api/** từ trình duyệt đi qua mock; phần server của Next (trang sản phẩm)
 * gọi API thật nên ca đếm chạm lấy một sản phẩm có sẵn trong DB e2e.
 */
const user = {
  id: 'u-fee', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};

async function openCart(page: Page, api: MockApi, size: { width: number; height: number }, reached = false) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user }));
  api.get('/me', () => user);
  api.get('/me/coupons', []);
  api.get('/me/wishlist/ids', []);
  api.get('/config/public', { freeshipThreshold: 200_000, support: { hotline: '0984606774', email: 'tubutree@gmail.com' } });
  const cart = footerCart({ lines: 3, reached });
  api.get('/cart', { ...cart, items: cart.items.map((l) => ({ ...l, weight: 600 })) });
  api.get('/flash-sales/active', []);
  api.get('/checkout/shipping-estimate', ({ call }) => shippingEstimate(Number(call.query.get('subtotal'))));
  api.allowUnmocked('POST /coupons/preview', 'GET /coupons/available');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(size);
  await page.goto('/gio-hang');
  await expect(page.getByTestId('cart-line').first()).toBeVisible({ timeout: 30_000 });
  return cart;
}

const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

test.describe('Giỏ web: phí giao ước tính dưới Tạm tính', () => {
  test('390: chân dính có một dòng phí và Tổng tạm tính cộng phí; không thêm nút, không tràn ngang', async ({ page, api }) => {
    const cart = await openCart(page, api, { width: 390, height: 844 });
    const bar = page.getByTestId('sticky-bar');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('Phí giao (ước tính)19.000đ');
    await expect(bar).toContainText(`Tổng tạm tính${vnd(cart.subtotal + 19_000)}`);
    await expect(bar.getByRole('link', { name: /^Thanh toán/ })).toHaveCount(1);
    const h = Math.round((await bar.boundingBox())!.height);
    expect(h, `chân dính cao ${h}px`).toBeLessThanOrEqual(175);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

  test('1440: khung tóm tắt có Tạm tính, Phí giao (ước tính) và Tổng tạm tính', async ({ page, api }) => {
    const cart = await openCart(page, api, { width: 1440, height: 900 });
    const summary = page.getByTestId('cart-summary');
    await expect(summary.getByTestId('cart-ship-estimate')).toHaveText('Phí giao (ước tính)19.000đ');
    await expect(summary).toContainText(`Tạm tính${vnd(cart.subtotal)}`);
    await expect(summary).toContainText(`Tổng tạm tính${vnd(cart.subtotal + 19_000)}`);
  });

  test('390, đã đạt miễn phí giao: dòng phí ghi "Miễn phí", tổng bằng tiền hàng', async ({ page, api }) => {
    const cart = await openCart(page, api, { width: 390, height: 844 }, true);
    const bar = page.getByTestId('sticky-bar');
    await expect(bar).toContainText('Phí giao (ước tính)Miễn phí');
    await expect(bar).toContainText(`Tổng tạm tính${vnd(cart.subtotal)}`);
  });
});

function tapCounter() {
  let taps = 0;
  return {
    tap: async (l: Locator) => {
      taps += 1;
      await l.click();
    },
    type: async (l: Locator, text: string) => {
      taps += 1;
      await l.fill(text);
    },
    get count() {
      return taps;
    },
  };
}

test('390, khách chưa có địa chỉ: trang sản phẩm → Đặt hàng ≤ 10 chạm, form địa chỉ mở sẵn, phí ước tính trước khi có địa chỉ', async ({ page, api, request }) => {
  const p = await singleVariationProduct(request);
  test.skip(!p, 'DB e2e chưa có sản phẩm một phân loại');
  await mockWorld(api, page, 'web', FLOW_PLAIN, Promise.resolve());
  api.get('/me', { id: 'user-checkout', fullName: 'Nguyễn Văn A', phone: '0901234567', email: null, avatarUrl: null, dob: null, onboarded: true, segments: [], walletBalance: 0 });
  let added = false;
  let addresses: (typeof CHECKOUT_ADDRESS)[] = [];
  api.get('/cart', () => (added ? CHECKOUT_CART : { ...CHECKOUT_CART, items: [], subtotal: 0, itemCount: 0 }));
  api.post('/cart/items', () => {
    added = true;
    return CHECKOUT_CART;
  });
  api.get('/me/addresses', () => addresses);
  api.post('/me/addresses', ({ call }) => {
    const created = { ...CHECKOUT_ADDRESS, ...(call.body as object), id: 'addr-first' };
    addresses = [created];
    return created;
  });
  api.get('/checkout/shipping-estimate', ({ call }) => shippingEstimate(Number(call.query.get('subtotal'))));
  api.get(`/products/${p!.slug}`, { variations: p!.variations });
  api.get(`/products/${p!.slug}/related`, []);
  api.get(`/products/${p!.slug}/bought-together`, []);
  api.get('/products/for-you', []);
  api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
  api.get(`/products/${p!.slug}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
  api.get('/me/wishlist/ids', []);
  api.get('/flash-sales/active', []);
  api.allowUnmocked('GET /products/:slug/reviews/can-review', 'POST /events', 'POST /affiliate/touch', 'GET /affiliate/me', 'GET /products/:slug/bundles');

  await page.setViewportSize({ width: 390, height: 844 });
  const t = tapCounter();
  await page.goto(`/san-pham/${p!.slug}`);
  const buyNow = page.getByRole('button', { name: /Mua ngay/ }).filter({ visible: true }).first();
  await expect(buyNow).toBeEnabled({ timeout: 30_000 });
  await t.tap(buyNow);

  await expect(page).toHaveURL(/\/thanh-toan/, { timeout: 30_000 });
  const form = page.getByRole('form', { name: 'Thêm địa chỉ' });
  await expect(form).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('19.000đ (ước tính)').first()).toBeVisible();

  await t.tap(form.getByLabel('Tỉnh/Thành phố'));
  await t.tap(page.getByRole('dialog', { name: 'Tỉnh/Thành phố' }).getByRole('option', { name: 'TP. Hồ Chí Minh' }));
  await t.tap(page.getByRole('dialog', { name: 'Phường/Xã' }).getByRole('option', { name: 'Phường Sài Gòn' }));
  await t.type(form.getByLabel(/Số nhà/), '123 Lê Lợi');
  const created = api.waitForCall('POST', '/me/addresses');
  await t.tap(form.getByRole('button', { name: /^Lưu$/ }));
  await created;

  const place = page.getByTestId('sticky-bar').getByRole('button', { name: /^Đặt hàng · / });
  await expect(place).toBeEnabled({ timeout: 30_000 });
  const placed = api.waitForCall('POST', '/checkout/place-order');
  await t.tap(place);
  expect((await placed).body).toMatchObject({ addressId: 'addr-first' });
  await expect(page.getByText(ORDER_CODE_COD).first()).toBeVisible({ timeout: 30_000 });
  expect(t.count, `số chạm ${t.count}`).toBeLessThanOrEqual(10);
});
