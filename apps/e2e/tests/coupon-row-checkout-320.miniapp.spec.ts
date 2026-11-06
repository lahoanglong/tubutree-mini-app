import { expect, test } from './support/mock-api';
import { mockWorld, type CheckoutState } from './support/checkout-states';
import { expectRowIntact, rowFacts } from './support/coupon-row-facts';

/**
 * Hàng mã giảm giá ở màn thanh toán Mini App (ô icon 36px, nhãn trên, nội dung dưới, nút bên phải) trên máy hẹp 320px: lời mời "Chọn hoặc nhập mã"
 * và mã đã áp cùng số giảm hiện đủ trên một dòng, không bị cắt "…", nút "Chọn mã" / "Thay đổi" không vỡ dòng. API mock toàn bộ.
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

// Hàng thanh toán là hai dòng (nhãn trên, nội dung dưới) trong ô cao 44px tối thiểu, nên cho phép cao hơn hàng ở chân dính giỏ.
const MAX_H = 56;
// Mã dài và số giảm không đủ chỗ cạnh nhau: số giảm xuống dòng dưới mã (ba dòng), vẫn không cắt chữ.
const MAX_H_WRAPPED = 84;

async function open(page: import('@playwright/test').Page, api: Parameters<typeof mockWorld>[0], state: CheckoutState, size: { width: number; height: number }): Promise<void> {
  await mockWorld(api, page, 'miniapp', state, Promise.resolve());
  await page.setViewportSize(size);
  await page.goto('/checkout');
  await expect(page.getByTestId('coupon-row')).toBeVisible({ timeout: 15_000 });
}

for (const size of [{ width: 320, height: 568 }, { width: 375, height: 812 }]) {
  test.describe(`Thanh toán Mini App: hàng mã giảm giá ở ${size.width}px`, () => {
    test('chưa có mã: lời mời một dòng, không "…"', async ({ page, api }) => {
      await open(page, api, NONE, size);
      const f = await rowFacts(page);
      expectRowIntact(f, MAX_H);
      expect(f.lines['coupon-placeholder'], `lời mời ${f.lines['coupon-placeholder']} dòng`).toBe(1);
    });

    test('đã áp mã: mã và số giảm hiện đủ, không "…" (hết chỗ thì số giảm xuống dưới mã)', async ({ page, api }) => {
      await open(page, api, APPLIED, size);
      const f = await rowFacts(page);
      expectRowIntact(f, MAX_H_WRAPPED);
      await expect(page.getByTestId('coupon-code')).toHaveText('WELCOME30');
      await expect(page.getByTestId('coupon-discount')).toHaveText('-30.000đ');
      expect(f.lines['coupon-code'], 'mã một dòng').toBe(1);
      expect(f.lines['coupon-discount'], 'số giảm một dòng').toBe(1);
      expect(f.lines['coupon-cta'], 'nút "Thay đổi" một dòng').toBe(1);
    });

    test('mã 11 ký tự và số giảm 50.000đ: đủ chữ, số giảm xuống dưới mã khi hết chỗ, không "…"', async ({ page, api }) => {
      await open(page, api, APPLIED_LONG, size);
      const f = await rowFacts(page);
      expectRowIntact(f, MAX_H_WRAPPED);
      await expect(page.getByTestId('coupon-code')).toHaveText('XANHTHANG11');
      await expect(page.getByTestId('coupon-discount')).toHaveText('-50.000đ');
    });
  });
}
