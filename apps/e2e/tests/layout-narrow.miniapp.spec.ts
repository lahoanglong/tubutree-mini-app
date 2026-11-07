import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { mockCheckout } from './support/checkout-mocks';
import { mockFooterCart } from './support/cart-footer-mocks';
import { mockPilotProduct, PILOT_SLUG } from './support/pilot-mocks';
import { mockDiscovery, mockHomeEngagement } from './support/discovery-mocks';
import { NARROW_WIDTHS, pointsEarnClearance, probeLayout, stickyBarClearance } from './support/layout-probe';

/**
 * W38A: bốn màn mua sắm của Mini App (Trang chủ, chi tiết sản phẩm, giỏ, thanh toán) ở 320 / 360 / 375px không tràn ngang, thanh dính đáy không
 * tràn hay chồng lấp và không che dòng cuối, và mọi số tiền / số đếm vẽ bằng số đều (tabular-nums). API mock toàn bộ.
 */
// Bỏ qua: số giảm trong hàng mã giữ số tỉ lệ (số đều rộng hơn vài px, mà hàng mã ở 320px chỉ còn độ dư 12px, xem coupon-row-checkout-320);
// số thứ tự 01..05 của câu chuyện sản phẩm là số trang trí cỡ lớn, không phải số tiền hay số đếm.
const NOT_FIGURES = ['[data-testid="coupon-discount"]', '.tubu-story-num'];

async function expectClean(page: Page, screen: string, width: number): Promise<void> {
  const f = await probeLayout(page, { ignoreNumeric: NOT_FIGURES });
  expect.soft(f.overflow, `${screen} ${width}px tràn ngang`).toEqual([]);
  expect.soft(f.stickyBar, `${screen} ${width}px thanh dính`).toEqual([]);
  expect.soft(f.notTabular, `${screen} ${width}px số không đều`).toEqual([]);
}

async function expectBarClearsContent(page: Page, screen: string, width: number): Promise<void> {
  const gap = await stickyBarClearance(page);
  expect.soft(gap, `${screen} ${width}px: dòng cuối bị thanh dính che (khoảng ${gap}px)`).toBeGreaterThanOrEqual(0);
}

for (const width of NARROW_WIDTHS) {
  test.describe(`Mini App ${width}px: nhịp khoảng cách, thanh dính, số đều`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
    });

    test('Trang chủ', async ({ page, api }) => {
      mockDiscovery(api, { returning: true });
      mockHomeEngagement(api);
      await page.goto('/');
      await expect(page.locator('[data-home-block]').first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
      await expectClean(page, 'Trang chủ', width);
    });

    test('Chi tiết sản phẩm', async ({ page, api }) => {
      mockPilotProduct(api);
      await page.goto(`/product/${PILOT_SLUG}`);
      await expect(page.getByRole('button', { name: /^Thêm vào giỏ/ }).first()).toBeVisible({ timeout: 15_000 });
      await expectClean(page, 'PDP', width);
      await expectBarClearsContent(page, 'PDP', width);
      const points = await pointsEarnClearance(page);
      expect.soft(points, `PDP ${width}px: có dòng Điểm Xanh`).not.toBeNull();
      expect.soft(points ?? 0, `PDP ${width}px: dòng Điểm Xanh đè lên dòng giá`).toBeGreaterThanOrEqual(0);
    });

    test('Giỏ hàng (có mã, combo, tiết kiệm)', async ({ page, api }) => {
      mockFooterCart(api, { lines: 3, reached: false, combo: 6_000, saving: 8_000, coupon: { code: 'TUBU10', discount: 15_000 }, deals: true });
      await page.goto('/cart');
      await expect(page.getByTestId('sticky-bar')).toBeVisible({ timeout: 15_000 });
      await expectClean(page, 'Giỏ', width);
      await expectBarClearsContent(page, 'Giỏ', width);
    });

    test('Thanh toán', async ({ page, api }) => {
      mockCheckout(api);
      await page.goto('/checkout');
      await expect(page.getByRole('button', { name: /Đặt hàng/ })).toBeVisible({ timeout: 15_000 });
      await expectClean(page, 'Thanh toán', width);
      await expectBarClearsContent(page, 'Thanh toán', width);
    });
  });
}
