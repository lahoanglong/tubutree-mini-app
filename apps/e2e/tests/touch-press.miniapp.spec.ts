import { test, expect } from './support/mock-api';
import { mockCheckout } from './support/checkout-mocks';
import { mockFooterCart } from './support/cart-footer-mocks';
import { SHIPPING_CODE, mockOrdersList } from './support/touch-orders';
import { NARROW_WIDTHS } from './support/layout-probe';
import { expectNoPressMotion, expectPressFeedback } from './support/touch-probe';

/**
 * W39A: phản hồi khi nhấn giữ ở Giỏ hàng, Thanh toán và Đơn hàng của Mini App ở 320 / 360 / 375px: nút co 0,97..0,99, thẻ đơn co nhẹ hơn;
 * khách chọn giảm chuyển động thì không co. Chạy Chromium: trên CI (WebKit Linux) phép đo hệ số co ra 1
 * chập chờn dù cục bộ (WebKit macOS) đo đúng; luật CSS nhấn giữ là một nên Chromium đo đủ. API mock toàn bộ.
 */
test.use({ browserName: 'chromium' });

const CART_QTY_2 = (cart: ReturnType<typeof mockFooterCart>) => ({
  ...cart,
  // Dòng cuối mua 2 để nút − còn bấm được (ở số lượng 1 nút − khoá, không co khi nhấn).
  items: cart.items.map((l, i) => (i === cart.items.length - 1 ? { ...l, quantity: 2, total: l.unitPrice * 2 } : l)),
});

for (const width of NARROW_WIDTHS) {
  test.describe(`Mini App ${width}px: co khi nhấn`, () => {
    test.beforeEach(async ({ page, browserName }) => {
      expect(browserName, 'spec nhấn giữ phải chạy Chromium').toBe('chromium');
      await page.setViewportSize({ width, height: 700 });
    });

    test('Giỏ hàng', async ({ page, api }) => {
      const cart = mockFooterCart(api, { lines: 3, reached: false, combo: 6_000, saving: 8_000, coupon: { code: 'TUBU10', discount: 15_000 }, deals: true });
      api.get('/cart', CART_QTY_2(cart));
      await page.goto('/cart');
      await expect(page.getByTestId('sticky-bar')).toBeVisible({ timeout: 15_000 });
      await expectPressFeedback(page, page.getByRole('button', { name: /^Tăng số lượng/ }).first(), 'nút + của giỏ');
      await expectPressFeedback(page, page.locator('button[aria-label^="Giảm số lượng"]:not([aria-disabled="true"]):not([disabled])').first(), 'nút − của giỏ (còn bấm được)');
      await expectPressFeedback(page, page.getByTestId('coupon-row'), 'hàng mã giảm giá của giỏ');
      await expectPressFeedback(page, page.getByRole('button', { name: /Thanh toán/ }).last(), 'nút Thanh toán của giỏ');
    });

    test('Giỏ hàng, giảm chuyển động thì không co khi nhấn', async ({ page, api }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const cart = mockFooterCart(api, { lines: 3, reached: false, combo: 0, saving: 0, deals: false });
      api.get('/cart', CART_QTY_2(cart));
      await page.goto('/cart');
      await expect(page.getByTestId('sticky-bar')).toBeVisible({ timeout: 15_000 });
      await expectNoPressMotion(page, page.getByRole('button', { name: /^Tăng số lượng/ }).first(), 'nút + của giỏ');
      await expectNoPressMotion(page, page.getByRole('button', { name: /Thanh toán/ }).last(), 'nút Thanh toán của giỏ');
    });

    test('Thanh toán', async ({ page, api }) => {
      mockCheckout(api);
      await page.goto('/checkout');
      const place = page.getByRole('button', { name: /Đặt hàng/ });
      await expect(place).toBeVisible({ timeout: 15_000 });
      await expectPressFeedback(page, page.getByTestId('coupon-row'), 'hàng mã giảm giá của thanh toán');
      await expectPressFeedback(page, page.getByTestId('checkout-address-block').getByRole('radio').first(), 'thẻ địa chỉ');
      await expectPressFeedback(page, place, 'nút Đặt hàng');
    });

    test('Đơn hàng', async ({ page, api }) => {
      mockOrdersList(api);
      await page.goto('/orders');
      await expect(page.getByTestId('order-card')).toHaveCount(4, { timeout: 15_000 });
      const card = page.getByTestId('order-card').filter({ has: page.getByRole('button', { name: `Đơn ${SHIPPING_CODE}` }) });
      await expectPressFeedback(page, page.getByRole('button', { name: 'Mua lại', exact: true }).first(), 'nút Mua lại');
      await expectPressFeedback(page, page.getByRole('button', { name: 'Thanh toán ngay' }).first(), 'nút Thanh toán ngay');
      await expectPressFeedback(page, page.getByRole('button', { name: `Đơn ${SHIPPING_CODE}` }), 'thẻ đơn', card);
    });

    test('Đơn hàng, giảm chuyển động thì thẻ và nút không co khi nhấn', async ({ page, api }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      mockOrdersList(api);
      await page.goto('/orders');
      await expect(page.getByTestId('order-card')).toHaveCount(4, { timeout: 15_000 });
      const card = page.getByTestId('order-card').filter({ has: page.getByRole('button', { name: `Đơn ${SHIPPING_CODE}` }) });
      await expectNoPressMotion(page, page.getByRole('button', { name: 'Mua lại', exact: true }).first(), 'nút Mua lại');
      await expectNoPressMotion(page, page.getByRole('button', { name: 'Thanh toán ngay' }).first(), 'nút Thanh toán ngay');
      await expectNoPressMotion(page, page.getByRole('button', { name: `Đơn ${SHIPPING_CODE}` }), 'thẻ đơn', card);
    });
  });
}
