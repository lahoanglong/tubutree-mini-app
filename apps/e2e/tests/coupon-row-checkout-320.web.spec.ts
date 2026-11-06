import type { Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';
import { mockWorld, type CheckoutState } from './support/checkout-states';
import { expectRowIntact, rowFacts } from './support/coupon-row-facts';

/**
 * Hàng mã giảm giá ở màn /thanh-toan của web khổ điện thoại phải là hàng của Mini App (coupon-row-checkout-320.miniapp.spec.ts): lời mời
 * "Chọn hoặc nhập mã" và mã đã áp cùng số giảm hiện đủ trên một dòng, không bị cắt "…", nút không vỡ dòng. API mock toàn bộ.
 */
const NONE: CheckoutState = { key: 'coupon-none', name: 'Chưa có mã', ready: () => undefined };
const APPLIED: CheckoutState = {
  key: 'coupon-applied',
  name: 'Đã áp WELCOME30',
  ready: () => undefined,
  world: (w) => {
    w.cart.couponCode = 'WELCOME30';
    w.cart.discount = 30_000;
    w.quote.discount = 30_000;
  },
};

// Hàng thanh toán là hai dòng (nhãn trên, nội dung dưới) trong ô cao 44px tối thiểu, nên cho phép cao hơn hàng ở chân dính giỏ.
const MAX_H = 56;

async function open(page: Page, api: MockApi, state: CheckoutState, size: { width: number; height: number }): Promise<void> {
  await mockWorld(api, page, 'web', state, Promise.resolve());
  await page.setViewportSize(size);
  await page.goto('/thanh-toan');
  // Trên điện thoại hàng mã mobile (md:hidden) là hàng đang hiện; hàng desktop bị ẩn nên `first()` có thể là hàng ẩn.
  await expect(page.locator('[data-testid="coupon-row"]:visible, [data-testid="coupon-change"]:visible').first()).toBeVisible({ timeout: 20_000 });
}

const rowId = async (page: Page): Promise<string> => ((await page.getByTestId('coupon-change').count()) > 0 ? 'coupon-change' : 'coupon-row');

for (const size of [{ width: 320, height: 568 }, { width: 375, height: 812 }]) {
  test.describe(`Thanh toán web: hàng mã giảm giá ở ${size.width}px`, () => {
    test('chưa có mã: lời mời một dòng, không "…"', async ({ page, api }) => {
      await open(page, api, NONE, size);
      const f = await rowFacts(page, await rowId(page));
      expectRowIntact(f, MAX_H);
      expect(f.lines['coupon-placeholder'], `lời mời ${f.lines['coupon-placeholder']} dòng`).toBe(1);
    });

    test('đã áp mã: mã và số giảm một dòng, không "…"', async ({ page, api }) => {
      await open(page, api, APPLIED, size);
      const f = await rowFacts(page, await rowId(page));
      expectRowIntact(f, MAX_H);
      await expect(page.getByTestId('coupon-code')).toHaveText('WELCOME30');
      await expect(page.getByTestId('coupon-discount')).toHaveText('-30.000đ');
      expect(f.lines['coupon-code'], 'mã một dòng').toBe(1);
      expect(f.lines['coupon-discount'], 'số giảm một dòng').toBe(1);
      expect(f.lines['coupon-cta'], 'nút "Thay đổi" một dòng').toBe(1);
    });
  });
}
