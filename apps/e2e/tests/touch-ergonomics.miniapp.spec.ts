import type { Page } from '@playwright/test';
import { test, expect, makeOrder, type MockApi } from './support/mock-api';
import { mockCheckout } from './support/checkout-mocks';
import { mockFooterCart } from './support/cart-footer-mocks';
import { mockBuyFlowSession, mockOrdersTab, THUMB } from './support/buy-flow-mocks';
import { NARROW_WIDTHS, probeLayout, stickyBarClearance } from './support/layout-probe';
import { expectNoPressMotion, expectPressFeedback, probeTapTargets, stickyBarBottomClearance } from './support/touch-probe';

/**
 * W39A: Giỏ hàng, Thanh toán và Đơn hàng của Mini App ở 320 / 360 / 375px.
 *  - Mọi điều khiển có vùng chạm thật ≥ 44 × 44px (nút +/−, ô mã giảm giá, địa chỉ, "Mua lại", "Thanh toán ngay", thẻ đơn).
 *  - Nhấn giữ thì co 0,97..0,99; khách chọn giảm chuyển động thì không co.
 *  - Thanh dính đáy chừa vùng an toàn của iPhone có thanh home (34px): nút không chui xuống dưới, dòng cuối không bị che.
 *  - Danh sách đơn: số tiền, số món vẽ bằng số đều; huy hiệu trạng thái không cắt chữ.
 * API mock toàn bộ.
 */
const SAFE_INSET = 34;

const DELIVERED = makeOrder({ code: 'TUBU-W39A-D', status: 'DELIVERED', paymentStatus: 'PAID', total: 1_249_000 });
const PENDING_PAY = {
  ...makeOrder({ code: 'TUBU-W39A-P', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 349_000 }),
  paymentDeadline: new Date(Date.now() + 3 * 3600_000).toISOString(),
};
const SHIPPING = makeOrder({ code: 'TUBU-W39A-S', status: 'SHIPPING', total: 89_000 });
const CANCELLED = makeOrder({ code: 'TUBU-W39A-C', status: 'CANCELLED', total: 19_000 });

function mockOrdersList(api: MockApi): void {
  mockBuyFlowSession(api);
  mockOrdersTab(api);
  const withThumb = <T extends { items: object[] }>(o: T): T => ({ ...o, items: o.items.map((i) => ({ ...i, thumbnail: THUMB })) });
  const all = [DELIVERED, PENDING_PAY, SHIPPING, CANCELLED].map(withThumb);
  api.get('/orders', { data: all, meta: { page: 1, limit: 20, total: all.length } });
}

async function expectTapTargets(page: Page, screen: string, width: number): Promise<void> {
  const problems = await probeTapTargets(page);
  expect.soft(problems, `${screen} ${width}px: vùng chạm dưới 44px`).toEqual([]);
}

for (const width of NARROW_WIDTHS) {
  test.describe(`Mini App ${width}px: vùng chạm, nhấn, vùng an toàn`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
    });

    test('Giỏ hàng', async ({ page, api }) => {
      const cart = mockFooterCart(api, { lines: 3, reached: false, combo: 6_000, saving: 8_000, coupon: { code: 'TUBU10', discount: 15_000 }, deals: true });
      // Dòng cuối mua 2 để nút − còn bấm được (ở số lượng 1 nút − khoá, không co khi nhấn).
      api.get('/cart', { ...cart, items: cart.items.map((l, i) => (i === cart.items.length - 1 ? { ...l, quantity: 2, total: l.unitPrice * 2 } : l)) });
      await page.goto('/cart');
      await expect(page.getByTestId('sticky-bar')).toBeVisible({ timeout: 15_000 });
      await expectTapTargets(page, 'Giỏ', width);

      await expectPressFeedback(page, page.getByRole('button', { name: /^Tăng số lượng/ }).first(), 'nút + của giỏ');
      await expectPressFeedback(page, page.locator('button[aria-label^="Giảm số lượng"]:not([aria-disabled="true"]):not([disabled])').first(), 'nút − của giỏ (còn bấm được)');
      await expectPressFeedback(page, page.getByTestId('coupon-row'), 'hàng mã giảm giá của giỏ');
      await expectPressFeedback(page, page.getByRole('button', { name: /Thanh toán/ }).last(), 'nút Thanh toán của giỏ');

      await page.evaluate((px) => document.documentElement.style.setProperty('--safe-bottom', `${px}px`), SAFE_INSET);
      expect.soft(await stickyBarBottomClearance(page, SAFE_INSET), 'Giỏ: nút chui xuống dưới vùng an toàn').toBeGreaterThanOrEqual(0);
      expect.soft(await stickyBarClearance(page), 'Giỏ: dòng cuối bị thanh dính che khi có vùng an toàn').toBeGreaterThanOrEqual(0);
    });

    test('Giỏ hàng, giảm chuyển động thì không co khi nhấn', async ({ page, api }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      mockFooterCart(api, { lines: 3, reached: false, combo: 0, saving: 0, deals: false });
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
      await expectTapTargets(page, 'Thanh toán', width);

      await expectPressFeedback(page, page.getByTestId('coupon-row'), 'hàng mã giảm giá của thanh toán');
      await expectPressFeedback(page, page.getByTestId('checkout-address-block').getByRole('radio').first(), 'thẻ địa chỉ');
      await expectPressFeedback(page, place, 'nút Đặt hàng');

      await page.evaluate((px) => document.documentElement.style.setProperty('--safe-bottom', `${px}px`), SAFE_INSET);
      expect.soft(await stickyBarBottomClearance(page, SAFE_INSET), 'Thanh toán: nút chui xuống dưới vùng an toàn').toBeGreaterThanOrEqual(0);
      expect.soft(await stickyBarClearance(page), 'Thanh toán: dòng cuối bị thanh dính che khi có vùng an toàn').toBeGreaterThanOrEqual(0);
    });

    test('Đơn hàng', async ({ page, api }) => {
      mockOrdersList(api);
      await page.goto('/orders');
      await expect(page.getByTestId('order-card').first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('order-card')).toHaveCount(4);
      await expectTapTargets(page, 'Đơn hàng', width);

      const f = await probeLayout(page);
      expect.soft(f.overflow, `Đơn hàng ${width}px tràn ngang`).toEqual([]);
      expect.soft(f.notTabular, `Đơn hàng ${width}px số không đều`).toEqual([]);

      await expectPressFeedback(page, page.getByRole('button', { name: 'Mua lại', exact: true }).first(), 'nút Mua lại');
      await expectPressFeedback(page, page.getByRole('button', { name: 'Thanh toán ngay' }).first(), 'nút Thanh toán ngay');
      await expectPressFeedback(page, page.getByRole('button', { name: 'Đơn TUBU-W39A-S' }), 'thẻ đơn', page.getByTestId('order-card').filter({ has: page.getByRole('button', { name: 'Đơn TUBU-W39A-S' }) }));
      const badges = await page.getByTestId('order-card').evaluateAll((cards) =>
        cards.flatMap((c) => Array.from(c.querySelectorAll<HTMLElement>('[class*="badge"], [data-badge]')).filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent ?? '')),
      );
      expect.soft(badges, `Đơn hàng ${width}px: huy hiệu trạng thái bị cắt chữ`).toEqual([]);
    });

    test('Đơn hàng, giảm chuyển động thì thẻ và nút không co khi nhấn', async ({ page, api }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      mockOrdersList(api);
      await page.goto('/orders');
      await expect(page.getByTestId('order-card').first()).toBeVisible({ timeout: 15_000 });
      await expectNoPressMotion(page, page.getByRole('button', { name: 'Mua lại', exact: true }).first(), 'nút Mua lại');
      await expectNoPressMotion(page, page.getByRole('button', { name: 'Thanh toán ngay' }).first(), 'nút Thanh toán ngay');
      await expectNoPressMotion(page, page.getByRole('button', { name: 'Đơn TUBU-W39A-S' }), 'thẻ đơn', page.getByTestId('order-card').filter({ has: page.getByRole('button', { name: 'Đơn TUBU-W39A-S' }) }));
    });
  });
}
