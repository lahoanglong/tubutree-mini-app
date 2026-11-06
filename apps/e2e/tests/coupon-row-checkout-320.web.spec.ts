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

const APPLIED_LONG: CheckoutState = {
  key: 'coupon-applied-long',
  name: 'Đã áp XANHTHANG11',
  ready: () => undefined,
  world: (w) => {
    w.cart.couponCode = 'XANHTHANG11';
    w.cart.discount = 50_000;
    w.quote.discount = 50_000;
  },
};

const APPLIED_VERY_LONG: CheckoutState = {
  key: 'coupon-applied-very-long',
  name: 'Đã áp mã 33 ký tự',
  ready: () => undefined,
  world: (w) => {
    w.cart.couponCode = 'KHUYENMAI-THANG-MUOI-MOT-VIP-2026';
    w.cart.discount = 1_250_000;
    w.quote.discount = 1_250_000;
  },
};

// Hàng thanh toán là hai dòng (nhãn trên, nội dung dưới) trong ô cao 44px tối thiểu, nên cho phép cao hơn hàng ở chân dính giỏ.
const MAX_H = 56;
// Mã dài và số giảm không đủ chỗ cạnh nhau: số giảm xuống dòng dưới mã (ba dòng), vẫn không cắt chữ.
const MAX_H_WRAPPED = 84;
// Mã 33 ký tự xuống nhiều dòng ngay trong pill nên hàng cao hơn nữa; chỉ cần không cắt chữ và không tràn.
const MAX_H_LONG_CODE = 160;
// Từ chữ "Thay đổi" tới số giảm: 8px của khoảng cách trong hàng cộng ít nhất 4px độ dư, để lệch phông vài px không đẩy số giảm xuống dòng.
const MIN_BREATH = 12;

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

    test('đã áp mã WELCOME30: mã và số giảm cùng một dòng, còn độ dư, không khít sát từng px', async ({ page, api }) => {
      await open(page, api, APPLIED, size);
      const f = await rowFacts(page, await rowId(page));
      expectRowIntact(f, MAX_H);
      await expect(page.getByTestId('coupon-code')).toHaveText('WELCOME30');
      await expect(page.getByTestId('coupon-discount')).toHaveText('-30.000đ');
      expect(f.lines['coupon-code'], 'mã một dòng').toBe(1);
      expect(f.lines['coupon-discount'], 'số giảm một dòng').toBe(1);
      expect(f.lines['coupon-cta'], 'nút "Thay đổi" một dòng').toBe(1);
      expect(Math.abs(f.mids['coupon-code']! - f.mids['coupon-discount']!), 'số giảm lệch dòng so với mã').toBeLessThanOrEqual(3);
      const breath = f.boxes['coupon-cta']!.left - f.boxes['coupon-discount']!.right;
      expect(breath, `từ số giảm tới nút chỉ ${breath.toFixed(1)}px (cần ≥ ${MIN_BREATH})`).toBeGreaterThanOrEqual(MIN_BREATH);
    });

    test('mã 33 ký tự: xuống nhiều dòng ngay trong pill, đủ từng ký tự, không "…", không tràn', async ({ page, api }) => {
      await open(page, api, APPLIED_VERY_LONG, size);
      const f = await rowFacts(page, await rowId(page));
      expectRowIntact(f, MAX_H_LONG_CODE);
      await expect(page.getByTestId('coupon-code')).toHaveText('KHUYENMAI-THANG-MUOI-MOT-VIP-2026');
      await expect(page.getByTestId('coupon-discount')).toHaveText('-1.250.000đ');
      expect(f.lines['coupon-code'], 'mã hết chỗ một dòng thì xuống dòng').toBeGreaterThan(1);
      expect(f.lines['coupon-discount'], 'số giảm một dòng').toBe(1);
    });

    test('mã 11 ký tự và số giảm 50.000đ: đủ chữ, số giảm xuống dưới mã khi hết chỗ, không "…"', async ({ page, api }) => {
      await open(page, api, APPLIED_LONG, size);
      const f = await rowFacts(page, await rowId(page));
      expectRowIntact(f, MAX_H_WRAPPED);
      await expect(page.getByTestId('coupon-code')).toHaveText('XANHTHANG11');
      await expect(page.getByTestId('coupon-discount')).toHaveText('-50.000đ');
    });
  });
}
