import type { Page } from '@playwright/test';
import { test, expect, makeOrder, makeUser, mockSession, type MockApi } from './support/mock-api';
import { footerCart } from './support/cart-footer-mocks';
import { STATES, mockWorld } from './support/checkout-states';
import { NARROW_WIDTHS, probeLayout, stickyBarClearance } from './support/layout-probe';
import { expectNoPressMotion, expectPressFeedback, probeTapTargets, stickyBarBottomClearance } from './support/touch-probe';

/**
 * W39A: Giỏ hàng /gio-hang, Thanh toán /thanh-toan và Đơn hàng /tai-khoan/don-hang của web ở 320 / 360 / 375px, cùng chuẩn với Mini App
 * (touch-ergonomics.miniapp.spec.ts): vùng chạm thật ≥ 44 × 44px, nhấn giữ co 0,97..0,99 (giảm chuyển động thì không co), thanh dính đáy chừa vùng an toàn
 * của iPhone (độ lệch đặt bằng CDP, chỉ Chromium), số tiền và số món ở danh sách đơn vẽ bằng số đều. Chỉ dò phần thân trang (`main`): đầu trang và thanh dưới
 * dùng chung của khung web không thuộc ba màn này. Mọi lời gọi từ trình duyệt đi qua mock.
 */
const SAFE_INSET = 34;

const DELIVERED = makeOrder({ code: 'TUBU-W39A-D', status: 'DELIVERED', paymentStatus: 'PAID', total: 1_249_000 });
const PENDING_PAY = {
  ...makeOrder({ code: 'TUBU-W39A-P', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 349_000 }),
  paymentDeadline: new Date(Date.now() + 3 * 3600_000).toISOString(),
};
const SHIPPING = makeOrder({ code: 'TUBU-W39A-S', status: 'SHIPPING', total: 89_000 });
const CANCELLED = makeOrder({ code: 'TUBU-W39A-C', status: 'CANCELLED', total: 19_000 });

async function signIn(page: Page, api: MockApi): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
  mockSession(api, makeUser({ id: 'u1', fullName: 'Nguyễn Văn An' }));
  api.get('/me/coupons', []);
  api.get('/me/wishlist/ids', []);
}

async function mockCart(api: MockApi): Promise<void> {
  api.get('/config/public', {
    freeshipThreshold: 200_000,
    support: { hotline: '0984606774', email: 'tubutree@gmail.com' },
    waste: { enabled: true, dropoff: true, mailin: true, pickup: false },
  });
  const cart = footerCart({ lines: 3, reached: false, combo: 6_000, saving: 8_000, coupon: { code: 'TUBU10', discount: 15_000 }, deals: true });
  // Dòng cuối mua 2 để nút − còn bấm được (ở số lượng 1 nút − khoá, không co khi nhấn).
  api.get('/cart', { ...cart, items: cart.items.map((l, i) => ({ ...l, weight: 600, ...(i === cart.items.length - 1 ? { quantity: 2, total: l.unitPrice * 2 } : null) })) });
  api.get('/flash-sales/active', []);
  api.allowUnmocked('POST /coupons/preview', 'GET /coupons/available');
}

function mockOrdersList(api: MockApi): void {
  api.get('/config/public', { freeshipThreshold: 500000 });
  api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 0 });
  api.get('/me/purchased-items', { items: [], nextCursor: null });
  api.get('/orders/me/refunds', []);
  const all = [DELIVERED, PENDING_PAY, SHIPPING, CANCELLED];
  api.get('/orders', { data: all, meta: { page: 1, limit: 20, total: all.length } });
  api.allowUnmocked('GET /me/coupons', 'GET /me/addresses', 'GET /waste/me', 'GET /me/subscriptions', 'GET /affiliate/me', 'POST /events');
}

async function setSafeInset(page: Page, px: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, bottom: px, right: 0 } });
}

async function expectTapTargets(page: Page, screen: string, width: number): Promise<void> {
  const problems = await probeTapTargets(page, { scope: 'main' });
  expect.soft(problems, `${screen} ${width}px: vùng chạm dưới 44px`).toEqual([]);
}

for (const width of NARROW_WIDTHS) {
  test.describe(`Web ${width}px: vùng chạm, nhấn, vùng an toàn`, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Khổ do spec tự đặt, cần Chromium (CDP vùng an toàn): một project là đủ');
      await page.setViewportSize({ width, height: 700 });
    });

    test('Giỏ hàng', async ({ page, api }) => {
      await signIn(page, api);
      await mockCart(api);
      await page.goto('/gio-hang');
      await expect(page.getByTestId('cart-line').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('sticky-bar')).toBeVisible();
      await expectTapTargets(page, 'Giỏ', width);

      const bar = page.getByTestId('sticky-bar');
      await expectPressFeedback(page, page.getByRole('button', { name: /^Tăng số lượng/ }).first(), 'nút + của giỏ');
      await expectPressFeedback(page, page.locator('button[aria-label^="Giảm số lượng"]:not([aria-disabled="true"]):not([disabled])').first(), 'nút − của giỏ (còn bấm được)');
      await expectPressFeedback(page, bar.getByTestId('coupon-row').or(bar.getByTestId('coupon-change')).first(), 'hàng mã giảm giá của giỏ');
      await expectPressFeedback(page, bar.getByRole('link', { name: /Thanh toán/ }).or(bar.getByRole('button', { name: /Thanh toán/ })).last(), 'nút Thanh toán của giỏ');

      await setSafeInset(page, SAFE_INSET);
      expect.soft(await stickyBarBottomClearance(page, SAFE_INSET), 'Giỏ: nút chui xuống dưới vùng an toàn').toBeGreaterThanOrEqual(0);
      expect.soft(await stickyBarClearance(page), 'Giỏ: dòng cuối bị thanh dính che khi có vùng an toàn').toBeGreaterThanOrEqual(0);
    });

    test('Giỏ hàng, giảm chuyển động thì không co khi nhấn', async ({ page, api }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await signIn(page, api);
      await mockCart(api);
      await page.goto('/gio-hang');
      await expect(page.getByTestId('cart-line').first()).toBeVisible({ timeout: 30_000 });
      await expectNoPressMotion(page, page.getByRole('button', { name: /^Tăng số lượng/ }).first(), 'nút + của giỏ');
      const bar = page.getByTestId('sticky-bar');
      await expectNoPressMotion(page, bar.getByRole('link', { name: /Thanh toán/ }).or(bar.getByRole('button', { name: /Thanh toán/ })).last(), 'nút Thanh toán của giỏ');
    });

    test('Thanh toán', async ({ page, api }) => {
      await mockWorld(api, page, 'web', STATES[0]!, Promise.resolve());
      await page.goto('/thanh-toan');
      const place = page.getByRole('button', { name: /Đặt hàng/ }).last();
      await expect(place).toBeVisible({ timeout: 30_000 });
      await expectTapTargets(page, 'Thanh toán', width);

      await expectPressFeedback(page, page.locator('[data-ds="checkout-address-card"]').first(), 'thẻ địa chỉ');
      await expectPressFeedback(page, page.locator('[data-testid="coupon-row"]:visible, [data-testid="coupon-change"]:visible').first(), 'hàng mã giảm giá của thanh toán');
      await expectPressFeedback(page, place, 'nút Đặt hàng');

      await setSafeInset(page, SAFE_INSET);
      expect.soft(await stickyBarBottomClearance(page, SAFE_INSET), 'Thanh toán: nút chui xuống dưới vùng an toàn').toBeGreaterThanOrEqual(0);
      expect.soft(await stickyBarClearance(page), 'Thanh toán: dòng cuối bị thanh dính che khi có vùng an toàn').toBeGreaterThanOrEqual(0);
    });

    test('Đơn hàng', async ({ page, api }) => {
      await signIn(page, api);
      mockOrdersList(api);
      await page.goto('/tai-khoan/don-hang');
      await expect(page.getByTestId('order-card').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('order-card')).toHaveCount(4);
      await expectTapTargets(page, 'Đơn hàng', width);

      const f = await probeLayout(page, { scope: 'main' });
      expect.soft(f.overflow, `Đơn hàng ${width}px tràn ngang`).toEqual([]);
      expect.soft(f.notTabular, `Đơn hàng ${width}px số không đều`).toEqual([]);

      await expectPressFeedback(page, page.getByRole('button', { name: 'Mua lại', exact: true }).first(), 'nút Mua lại');
      await expectPressFeedback(page, page.getByRole('link', { name: 'Thanh toán ngay' }).first(), 'nút Thanh toán ngay');
      await expectPressFeedback(page, page.getByRole('link', { name: 'Đơn TUBU-W39A-S' }), 'thẻ đơn', page.getByTestId('order-card').filter({ has: page.getByRole('link', { name: 'Đơn TUBU-W39A-S' }) }));
    });

    test('Đơn hàng, giảm chuyển động thì nút không co khi nhấn', async ({ page, api }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await signIn(page, api);
      mockOrdersList(api);
      await page.goto('/tai-khoan/don-hang');
      await expect(page.getByTestId('order-card').first()).toBeVisible({ timeout: 30_000 });
      await expectNoPressMotion(page, page.getByRole('button', { name: 'Mua lại', exact: true }).first(), 'nút Mua lại');
      await expectNoPressMotion(page, page.getByRole('link', { name: 'Thanh toán ngay' }).first(), 'nút Thanh toán ngay');
      await expectNoPressMotion(page, page.getByRole('link', { name: 'Đơn TUBU-W39A-S' }), 'thẻ đơn', page.getByTestId('order-card').filter({ has: page.getByRole('link', { name: 'Đơn TUBU-W39A-S' }) }));
    });
  });
}
