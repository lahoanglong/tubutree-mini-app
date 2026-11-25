import type { Page } from '@playwright/test';
import { test, expect, makeOrder, publicConfig, reply, type MockApi } from './support/mock-api';
import { mockWorld } from './support/checkout-states';
import { FLOW_PLAIN } from './support/checkout-flow-states';
import { serverGuestCheckoutReady, setServerGuestCheckout } from './support/guest-checkout-flag';
import { LEGACY_CODE, SHORT_COD } from './support/pre-submit';

/**
 * Trước khi gửi duyệt Zalo (tubu-w36-02): mã đơn ngắn (w34-01, `TB7K4M`) và mã dài cũ (`TUBU2026112212345`) cùng chạy ở danh sách đơn, chi tiết đơn
 * và tra đơn không đăng nhập `/don`; mã sai khuôn báo câu của w34-01. `/don` đọc cờ `web.guest_checkout_enabled` ở máy chủ nên ca tra đơn chỉ chạy
 * trên DB tạm của web-gate.sh với một worker (support/guest-checkout-flag.ts), như web-guest-checkout.web.spec.ts.
 */
const WEB_PROJECTS = new Set(['Web Customer', 'Web Customer Mobile']);
const CODES = [SHORT_COD, LEGACY_CODE] as const;
const isOurs = (code: string | undefined): code is string => (CODES as readonly string[]).includes(code ?? '');
const PHONE = '0912345678';
const KEY = 'K'.repeat(43);
const NEEDS_TEMP_DB = 'trang /don đọc cờ ở máy chủ: cần DB tạm của web-gate.sh và một worker để bật cờ thật';
const INVALID_CODE = 'Mã đơn gồm chữ và số, như TB7K4M hay TUBU2026112212345.';

const orderOf = (code: string) =>
  makeOrder({ code, status: 'SHIPPING', paymentMethod: 'COD', paymentStatus: 'UNPAID', createdAt: '2026-11-24T03:00:00.000Z', updatedAt: '2026-11-24T03:00:00.000Z' });

function mockOrders(api: MockApi): void {
  api.get('/orders', { data: CODES.map(orderOf), meta: { page: 1, limit: 20, total: CODES.length } });
  api.get('/orders/:code', ({ params }) => (isOurs(params.code) ? orderOf(params.code) : reply(404, { message: 'Không tìm thấy đơn hàng' })));
  api.get('/orders/me/returns', []);
}

/** Bản xem đơn khách vãng lai (`GET /checkout/guest/orders/:code`) đủ cho trang theo dõi. */
const guestView = (code: string) => ({
  code,
  status: 'CONFIRMED',
  paymentMethod: 'COD',
  paymentStatus: 'UNPAID',
  createdAt: new Date().toISOString(),
  deliveredAt: null,
  statusTimes: {},
  subtotal: 130000,
  discount: 0,
  shippingFee: 19000,
  total: 149000,
  items: [{ productName: 'Nước Rửa Chén Sinh Học Tubu 500ml', variationName: 'Hương Chanh Gừng', quantity: 2, unitPrice: 65000, total: 130000, isGift: false }],
  phoneMasked: '091****678',
  area: { ward: 'Phường Bến Thành', province: 'TP. Hồ Chí Minh' },
  siblings: [],
  expiresAt: null,
});

function mockGuestLookup(api: MockApi): void {
  api.get('/config/public', { ...publicConfig(), webGuestCartEnabled: true, webGuestCheckoutEnabled: true });
  api.post('/checkout/guest/lookup', ({ call }) => {
    const body = call.body as { orderCode: string; phone: string };
    if (!isOurs(body.orderCode) || body.phone !== PHONE) return reply(404, { statusCode: 404, message: 'Không tìm thấy đơn khớp mã đơn và số điện thoại này.' });
    return {
      order: guestView(body.orderCode),
      trackingKey: KEY,
      trackPath: `/don/${body.orderCode}#k=${KEY}`,
      bankPath: null,
      linkExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
  });
  api.get('/checkout/guest/orders/:code', ({ call, params }) =>
    isOurs(params.code) && call.headers['x-order-key'] === KEY ? guestView(params.code) : reply(404, { statusCode: 404, message: 'Không tìm thấy đơn hàng.' }),
  );
  api.allowUnmocked('GET /me/wishlist/ids', 'GET /affiliate/me', 'POST /affiliate/touch');
}

async function lookup(page: Page, code: string): Promise<void> {
  await page.getByTestId('guest-lookup-code').fill(code);
  await page.getByTestId('guest-lookup-phone').fill(PHONE);
  await page.getByTestId('guest-lookup-submit').click();
}

test.describe('Trước gửi duyệt: mã đơn ngắn và mã cũ trên web', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!WEB_PROJECTS.has(testInfo.project.name), 'Chỉ hai project web khách');
    await page.setViewportSize(testInfo.project.name === 'Web Customer Mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  });

  test('danh sách đơn hiện cả hai mã và trỏ đúng trang chi tiết', async ({ page, api }) => {
    await mockWorld(api, page, 'web', FLOW_PLAIN, Promise.resolve());
    mockOrders(api);
    await page.goto('/tai-khoan/don-hang');
    for (const code of CODES) {
      await expect(page.getByText(code).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(`a[href="/tai-khoan/don-hang/${code}"]`).first()).toBeAttached();
    }
  });

  for (const code of CODES) {
    test(`chi tiết đơn ${code}: gọi đúng mã, hiện mã đơn`, async ({ page, api }) => {
      await mockWorld(api, page, 'web', FLOW_PLAIN, Promise.resolve());
      mockOrders(api);
      await page.goto(`/tai-khoan/don-hang/${code}`);
      await expect(page.getByRole('heading', { name: 'Chi tiết đơn hàng', level: 1 })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(code).filter({ visible: true }).first()).toBeVisible();
      expect(api.callsTo('GET', '/orders/:code').map((c) => c.path)).toContain(`/orders/${code}`);
    });
  }
});

test.describe('Trước gửi duyệt: tra đơn /don với mã ngắn và mã cũ', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!WEB_PROJECTS.has(testInfo.project.name), 'Chỉ hai project web khách');
    test.skip(!(await serverGuestCheckoutReady(testInfo.config.workers)), NEEDS_TEMP_DB);
    await page.setViewportSize(testInfo.project.name === 'Web Customer Mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  });
  test.afterEach(async ({ request }) => {
    await setServerGuestCheckout(request, false);
  });

  for (const code of CODES) {
    test(`mã ${code} gõ chữ thường kèm khoảng trắng và #: gửi mã chuẩn hoá, mở trang theo dõi bằng khoá tạm`, async ({ page, api, request }) => {
      await setServerGuestCheckout(request, true);
      mockGuestLookup(api);
      await page.goto('/don');
      await lookup(page, ` #${code.toLowerCase().replace(/^(.{3})/, '$1 ')} `);
      await page.waitForURL(new RegExp(`/don/${code}#k=${KEY}$`), { timeout: 20_000 });
      await expect(page.getByText(code).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
      expect(api.callsTo('POST', '/checkout/guest/lookup').map((c) => c.body)).toEqual([{ orderCode: code, phone: PHONE }]);
    });
  }

  test('mã sai khuôn: báo câu mã đơn của w34-01, không gọi API tra cứu', async ({ page, api, request }) => {
    await setServerGuestCheckout(request, true);
    mockGuestLookup(api);
    await page.goto('/don');
    await lookup(page, 'TB');
    await expect(page.getByText(INVALID_CODE).filter({ visible: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('guest-lookup-code')).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('POST', '/checkout/guest/lookup')).toHaveLength(0);
  });
});
