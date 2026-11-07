import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { mockCheckout } from './support/checkout-mocks';
import { mockFooterCart } from './support/cart-footer-mocks';
import { mockOrdersList } from './support/touch-orders';
import { NARROW_WIDTHS, probeLayout, stickyBarClearance } from './support/layout-probe';
import { probeTapTargets, stickyBarBottomClearance } from './support/touch-probe';

/**
 * W39A: Giỏ hàng, Thanh toán và Đơn hàng của Mini App ở 320 / 360 / 375px.
 *  - Mọi điều khiển có vùng chạm thật ≥ 44 × 44px (nút +/−, ô mã giảm giá, địa chỉ, "Mua lại", "Thanh toán ngay", thẻ đơn).
 *  - Thanh dính đáy chừa vùng an toàn của iPhone có thanh home (34px): nút không chui xuống dưới, dòng cuối không bị che.
 *  - Danh sách đơn: số tiền, số món vẽ bằng số đều; huy hiệu trạng thái không cắt chữ.
 * Phản hồi khi nhấn giữ nằm ở touch-press.miniapp.spec.ts (chạy Chromium: phép đo hệ số co chập chờn trên WebKit Linux của CI). API mock toàn bộ.
 */
const SAFE_INSET = 34;

async function expectTapTargets(page: Page, screen: string, width: number): Promise<void> {
  const problems = await probeTapTargets(page);
  expect.soft(problems, `${screen} ${width}px: vùng chạm dưới 44px`).toEqual([]);
}

for (const width of NARROW_WIDTHS) {
  test.describe(`Mini App ${width}px: vùng chạm, vùng an toàn, số đều`, () => {
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


      await page.evaluate((px) => document.documentElement.style.setProperty('--safe-bottom', `${px}px`), SAFE_INSET);
      expect.soft(await stickyBarBottomClearance(page, SAFE_INSET), 'Giỏ: nút chui xuống dưới vùng an toàn').toBeGreaterThanOrEqual(0);
      expect.soft(await stickyBarClearance(page), 'Giỏ: dòng cuối bị thanh dính che khi có vùng an toàn').toBeGreaterThanOrEqual(0);
    });

    test('Thanh toán', async ({ page, api }) => {
      mockCheckout(api);
      await page.goto('/checkout');
      const place = page.getByRole('button', { name: /Đặt hàng/ });
      await expect(place).toBeVisible({ timeout: 15_000 });
      await expectTapTargets(page, 'Thanh toán', width);


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

      const badges = await page.getByTestId('order-card').evaluateAll((cards) =>
        cards.flatMap((c) => Array.from(c.querySelectorAll<HTMLElement>('[class*="badge"], [data-badge]')).filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent ?? '')),
      );
      expect.soft(badges, `Đơn hàng ${width}px: huy hiệu trạng thái bị cắt chữ`).toEqual([]);
    });

  });
}
