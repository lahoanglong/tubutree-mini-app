import { test, expect, makeOrder, reply, type MockApi } from './support/mock-api';
import { mockCheckout } from './support/checkout-mocks';
import { LEGACY_CODE, miniPath, SHORT_COD } from './support/pre-submit';

/**
 * Trước khi gửi duyệt Zalo (tubu-w36-02): mã đơn ngắn (w34-01, `TB7K4M`) và mã dài cũ (`TUBU2026112212345`) cùng chạy ở tab Đơn hàng và chi tiết
 * đơn của Mini App (màn đặt xong với mã ngắn nằm ở pre-submit-checkout.miniapp.spec.ts). Chạy cả Vite dev lẫn bản build `www`. API mock toàn bộ.
 */
test.use({ viewport: { width: 375, height: 812 } });

const CODES = [SHORT_COD, LEGACY_CODE] as const;
const isOurs = (code: string | undefined): code is string => (CODES as readonly string[]).includes(code ?? '');
const orderOf = (code: string) =>
  makeOrder({ code, status: 'SHIPPING', paymentMethod: 'COD', paymentStatus: 'UNPAID', createdAt: '2026-11-24T03:00:00.000Z', updatedAt: '2026-11-24T03:00:00.000Z' });

function mockOrders(api: MockApi): void {
  mockCheckout(api);
  api.get('/me/subscriptions', []);
  api.get('/orders', { data: CODES.map(orderOf), meta: { page: 1, limit: 20, total: CODES.length } });
  api.get('/orders/:code', ({ params }) => (isOurs(params.code) ? orderOf(params.code) : reply(404, { message: 'Không tìm thấy đơn hàng' })));
  api.get('/orders/me/returns', []);
  api.allowUnmocked('GET /flash-sales/upcoming', 'POST /events', 'GET /coupons/available', 'GET /me/vouchers');
}

test.describe('Trước gửi duyệt: mã đơn ngắn và mã cũ trên Mini App', () => {
  test('tab Đơn hàng hiện cả hai mã; chạm thẻ mã ngắn mở chi tiết đúng mã', async ({ page, api }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    mockOrders(api);
    await page.goto(miniPath('/orders'));
    const cards = page.getByTestId('order-card');
    await expect(cards).toHaveCount(2, { timeout: 20_000 });
    for (const code of CODES) await expect(cards.filter({ hasText: code })).toHaveCount(1);
    await cards.filter({ hasText: SHORT_COD }).click();
    await expect(page).toHaveURL(new RegExp(`/order/${SHORT_COD}$`), { timeout: 15_000 });
    // Chi tiết dựng ngay từ dữ liệu danh sách đã có; lời gọi `/orders/:code` kiểm ở hai ca mở thẳng dưới.
    await expect(page.getByText(SHORT_COD).first()).toBeVisible({ timeout: 15_000 });
    expect(errors).toEqual([]);
  });

  for (const code of CODES) {
    test(`chi tiết đơn ${code} mở thẳng: gọi đúng mã, hiện mã đơn`, async ({ page, api }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      mockOrders(api);
      await page.goto(miniPath(`/order/${code}`));
      await expect(page.getByText(code).first()).toBeVisible({ timeout: 20_000 });
      expect(api.callsTo('GET', '/orders/:code').map((c) => c.path)).toContain(`/orders/${code}`);
      expect(errors).toEqual([]);
    });
  }
});
