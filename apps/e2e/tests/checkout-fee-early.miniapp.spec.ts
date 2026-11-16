import type { Locator, Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { mockFooterCart } from './support/cart-footer-mocks';
import { CHECKOUT_ADDRESS, CHECKOUT_CART, CHECKOUT_QUOTE, ORDER_CODE_COD, placedOrderFor } from './support/checkout-mocks';
import { mockPilotProduct, PILOT_SLUG } from './support/pilot-mocks';
import { shippingEstimate } from './support/shipping-estimate-mocks';

/**
 * Mini App 360px, gói "phí giao sớm": giỏ có dòng "Phí giao (ước tính)" và "Tổng tạm tính" trong chân dính (không thêm khối, không thêm nút),
 * và khách chưa có địa chỉ đi từ trang sản phẩm tới Đặt hàng trong ≤ 8 chạm (màn của Zalo không tính). Việc không mở tấm xin số (ở Đặt hàng và
 * khi form tự mở) kiểm ở test đơn vị checkout.spec / address-section.spec: ngoài Zalo không có tấm đó để nhìn thấy.
 * API mock toàn bộ.
 */
test.use({ viewport: { width: 360, height: 780 } });

const bar = (page: Page) => page.getByTestId('sticky-bar');

test.describe('Giỏ: phí giao ước tính dưới Tạm tính', () => {
  test.beforeEach(({ api }) => {
    mockSession(api, makeUser({ id: 'user-fee-early', fullName: 'Khách Phí' }));
  });

  test('chưa đạt miễn phí giao: một dòng phí 19.000đ và Tổng tạm tính cộng phí; tổng và nút vẫn một hàng, không tràn ngang 360px', async ({ page, api }) => {
    const cart = mockFooterCart(api, { lines: 3, reached: false });
    api.get('/checkout/shipping-estimate', ({ call }) => shippingEstimate(Number(call.query.get('subtotal'))));
    await page.goto('/cart');
    await expect(bar(page)).toBeVisible({ timeout: 15_000 });

    await expect(bar(page).getByText('Phí giao (ước tính)')).toBeVisible();
    await expect(bar(page).getByText('19.000đ')).toBeVisible();
    await expect(bar(page).getByText('Tổng tạm tính')).toBeVisible();
    await expect(page.getByTestId('cart-total-value')).toHaveText(`${(cart.subtotal + 19_000).toLocaleString('vi-VN')}đ`);
    const asked = api.callsTo('GET', '/checkout/shipping-estimate');
    expect(asked.at(-1)!.query.get('subtotal')).toBe(String(cart.subtotal));

    const pay = bar(page).getByRole('button', { name: /^Thanh toán/ });
    const total = (await page.getByTestId('cart-total-value').boundingBox())!;
    const payBox = (await pay.boundingBox())!;
    expect(Math.abs(total.y + total.height / 2 - (payBox.y + payBox.height / 2))).toBeLessThanOrEqual(12);
    const h = Math.round((await bar(page).boundingBox())!.height);
    // Chân dính chưa đạt miễn phí giao (không dòng giảm) trước gói này ≈ 140px; dòng phí thêm một hàng gọn ≈ 20px.
    expect(h, `chân dính cao ${h}px`).toBeLessThanOrEqual(175);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });

  test('đã đạt miễn phí giao: dòng phí ghi "Miễn phí", tổng bằng tiền hàng', async ({ page, api }) => {
    const cart = mockFooterCart(api, { lines: 3, reached: true });
    api.get('/checkout/shipping-estimate', ({ call }) => shippingEstimate(Number(call.query.get('subtotal'))));
    await page.goto('/cart');
    await expect(bar(page)).toBeVisible({ timeout: 15_000 });
    await expect(bar(page).getByText('Miễn phí', { exact: true })).toBeVisible();
    await expect(page.getByTestId('cart-total-value')).toHaveText(`${cart.subtotal.toLocaleString('vi-VN')}đ`);
  });
});

/** Đếm chạm: mỗi lần bấm hoặc chạm vào ô để gõ là một chạm. */
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

function mockFirstOrder(api: MockApi): void {
  mockPilotProduct(api);
  mockSession(api, makeUser({ id: 'user-first-order', fullName: 'Nguyễn Văn A' }));
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
  api.get('/me/wallet', { walletBalance: 0, cashbackPending: 0, commissionApproved: 0, commissionPending: 0 });
  api.post('/checkout/quote', CHECKOUT_QUOTE);
  api.post('/checkout/place-order', ({ call }) => placedOrderFor((call.body ?? {}) as Record<string, unknown>));
  api.get('/geo/provinces', [{ code: '84_VN79', name: 'TP. Hồ Chí Minh' }]);
  api.get('/geo/communes', [{ code: '84_VN79_26734', name: 'Phường Sài Gòn' }]);
  api.get('/checkout/shipping-estimate', ({ call }) => shippingEstimate(Number(call.query.get('subtotal'))));
  api.allowUnmocked('GET /me/coupons', 'POST /checkout/coupon-previews', 'GET /payments/bank-qr/:code');
}

test('khách chưa có địa chỉ: trang sản phẩm → Đặt hàng ≤ 8 chạm, form địa chỉ mở sẵn, phí ước tính trước khi có địa chỉ', async ({ page, api }) => {
  mockFirstOrder(api);
  const t = tapCounter();
  await page.goto(`/product/${PILOT_SLUG}`);
  const buyNow = page.getByRole('button', { name: /^Mua ngay/ });
  await expect(buyNow).toBeEnabled({ timeout: 15_000 });
  await t.tap(buyNow);

  await expect(page).toHaveURL(/\/checkout/, { timeout: 15_000 });
  await expect(page.getByText('19.000đ (ước tính)').first()).toBeVisible({ timeout: 15_000 });
  const street = page.getByLabel('Số nhà, tên đường');
  await expect(street).toBeVisible();
  await expect(page.getByLabel(/Người nhận/).first()).toHaveValue('Nguyễn Văn A');

  await t.tap(page.getByRole('button', { name: /^Tỉnh\/Thành phố/ }));
  await t.tap(page.getByRole('option', { name: 'TP. Hồ Chí Minh' }));
  await t.tap(page.getByRole('button', { name: /^Phường\/Xã/ }));
  await t.tap(page.getByRole('option', { name: 'Phường Sài Gòn' }));
  await t.type(street, '123 Lê Lợi');
  const created = api.waitForCall('POST', '/me/addresses');
  await t.tap(page.getByRole('button', { name: /^Lưu$/ }));
  await created;

  const place = page.getByRole('button', { name: /Đặt hàng · / });
  await expect(place).toBeEnabled({ timeout: 15_000 });
  const placed = api.waitForCall('POST', '/checkout/place-order');
  await t.tap(place);
  expect((await placed).body).toMatchObject({ addressId: 'addr-first' });
  await expect(page.getByText(ORDER_CODE_COD)).toBeVisible({ timeout: 15_000 });
  expect(t.count, `số chạm ${t.count}`).toBeLessThanOrEqual(8);
});
