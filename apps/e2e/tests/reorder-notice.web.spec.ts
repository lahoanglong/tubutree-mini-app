import { expect, makeUser, mockSession, test } from './support/mock-api';

/**
 * Web khách: "Mua lại" ở /tai-khoan/don-hang nói rõ từng món của đơn cũ (W27), cùng luật với Mini App.
 * Đơn đã giao 5 dòng: còn hàng giá như cũ, tạm hết hàng, ngừng bán, còn ít hơn số đã mua kèm giá tăng, giá giảm.
 */
const CODE = 'TUBU2026110600027';
const line = (id: string, name: string, over: Record<string, unknown>) => ({
  id, variationId: `var-${id}`, productName: name, productSlug: `sp-${id}`, variationName: '', thumbnail: null, ...over,
});
const ORDER = {
  id: `id-${CODE}`, code: CODE, status: 'DELIVERED', subtotal: 424000, discount: 0, shippingFee: 0, total: 424000, paymentMethod: 'COD',
  paymentStatus: 'PAID', createdAt: '2026-10-01T03:00:00Z',
  items: [
    line('ok', 'Nước rửa chén Tubu', { unitPrice: 65000, quantity: 2, total: 130000, stock: 10, available: true, discontinued: false, currentPrice: 65000 }),
    line('out', 'Xà phòng Tubu tạm hết', { unitPrice: 19000, quantity: 1, total: 19000, stock: 0, available: false, discontinued: false, currentPrice: 19000 }),
    line('gone', 'Nước lau sàn Tubu cũ', { unitPrice: 45000, quantity: 1, total: 45000, stock: 3, available: false, discontinued: true, currentPrice: 45000 }),
    line('few', 'Nước giặt Tubu 2L', { unitPrice: 60000, quantity: 3, total: 180000, stock: 1, available: true, discontinued: false, currentPrice: 70000 }),
    line('down', 'Nước xả vải Tubu', { unitPrice: 50000, quantity: 1, total: 50000, stock: 10, available: true, discontinued: false, currentPrice: 45000 }),
  ],
};
const EMPTY_CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 0 };

test.describe('Web khách: Mua lại báo rõ từng món (W27)', () => {
  test.beforeEach(async ({ page, api }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
    mockSession(api, makeUser({ id: 'u1', fullName: 'Nguyễn Văn An' }));
    api.get('/config/public', { freeshipThreshold: 500000 });
    api.get('/cart', EMPTY_CART);
    api.get('/me/purchased-items', { items: [], nextCursor: null });
    api.get('/orders/me/refunds', []);
    api.get('/orders', { data: [ORDER], meta: { page: 1, limit: 20, total: 1 } });
    api.allowUnmocked('GET /me/coupons', 'GET /me/addresses', 'GET /waste/me', 'GET /me/subscriptions', 'GET /affiliate/me', 'POST /events');
  });

  for (const width of [320, 375]) {
    test(`${width}px: báo hết hàng, ngừng bán, giảm số lượng, đổi giá từng món; chỉ gửi món còn bán`, async ({ page, api }) => {
      api.post('/orders/:code/repurchase', {
        ...EMPTY_CART,
        results: [
          { orderItemId: 'ok', status: 'added', addedQuantity: 2 },
          { orderItemId: 'few', status: 'added', addedQuantity: 1 },
          { orderItemId: 'down', status: 'added', addedQuantity: 1 },
        ],
      });
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/tai-khoan/don-hang');
      await page.getByRole('button', { name: 'Mua lại', exact: true }).first().click({ timeout: 15_000 });
      const sheet = page.getByRole('dialog');
      await expect(sheet).toContainText(`Từ đơn ${CODE}`);
      await expect(sheet.getByTestId('reorder-skipped-note')).toHaveText('2 món hết hàng hoặc ngừng bán sẽ không được thêm vào giỏ.');

      const row = (name: string) => sheet.getByTestId('reorder-line').filter({ hasText: name });
      await expect(row('Xà phòng Tubu tạm hết').locator('[data-notice="out"]')).toHaveText('Tạm hết hàng');
      await expect(row('Nước lau sàn Tubu cũ').locator('[data-notice="discontinued"]')).toHaveText('Ngừng bán');
      await expect(row('Nước giặt Tubu 2L').locator('[data-notice="reduced"]')).toHaveText('Không đủ 3 như đơn trước, đã giảm số lượng');
      await expect(row('Nước giặt Tubu 2L').locator('[data-notice="priceUp"]')).toHaveText('Giá tăng so với đơn trước (60.000đ)');
      await expect(row('Nước xả vải Tubu').locator('[data-notice="priceDown"]')).toHaveText('Giá giảm so với đơn trước (50.000đ)');
      await expect(row('Nước rửa chén Tubu').locator('[data-notice]')).toHaveCount(0);
      await expect(sheet.getByRole('checkbox', { name: 'Chọn Xà phòng Tubu tạm hết' })).toBeDisabled();
      await expect(sheet.getByRole('checkbox', { name: 'Chọn Nước lau sàn Tubu cũ' })).toBeDisabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const overflow = await sheet.evaluate((el) => Array.from(el.querySelectorAll<HTMLElement>('[data-notice]')).filter((n) => n.scrollWidth > n.clientWidth + 1).length);
      expect(overflow).toBe(0);

      const sent = api.waitForCall('POST', '/orders/:code/repurchase');
      await sheet.getByRole('button', { name: 'Thêm vào giỏ (4)' }).click();
      expect((await sent).body).toEqual({
        items: [
          { orderItemId: 'ok', quantity: 2 },
          { orderItemId: 'few', quantity: 1 },
          { orderItemId: 'down', quantity: 1 },
        ],
        addSource: 'repurchase',
      });
      await expect(page).toHaveURL(/\/gio-hang$/);
    });
  }
});
