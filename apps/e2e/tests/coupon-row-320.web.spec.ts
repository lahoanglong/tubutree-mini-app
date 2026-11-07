import type { Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';
import { footerCart, mockCouponHint, type FooterCartOptions } from './support/cart-footer-mocks';
import { expectRowIntact, rowFacts } from './support/coupon-row-facts';

/**
 * Hàng mã giảm giá ở chân dính giỏ web khổ điện thoại phải là hàng của Mini App (coupon-row-320.miniapp.spec.ts): ở 320px chữ không bị cắt "…",
 * lời mời không rớt xuống 3 dòng, nhãn "Mã giảm giá" nằm trên và nội dung xuống dòng dưới khi dòng đầu không đủ chỗ, cả hàng vẫn cao 44px.
 * Ở 375px lời mời vẫn cùng dòng với nhãn. Trình duyệt mock toàn bộ API (cùng cách với cart-footer.web.spec.ts).
 */
const user = {
  id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};

const HINT = { usable: 3, maxSaving: 50_000 };

async function openCart(page: Page, api: MockApi, size: { width: number; height: number }, o: FooterCartOptions & { hint?: typeof HINT } = {}): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user }));
  api.get('/me', () => user);
  api.get('/me/coupons', []);
  api.get('/me/wishlist/ids', []);
  api.get('/config/public', {
    freeshipThreshold: 200_000,
    support: { hotline: '0984606774', email: 'tubutree@gmail.com' },
    waste: { enabled: true, dropoff: true, mailin: true, pickup: false },
  });
  const cart = footerCart({ lines: 2, reached: false, ...o });
  api.get('/cart', { ...cart, items: cart.items.map((l) => ({ ...l, weight: 600 })) });
  api.get('/flash-sales/active', []);
  api.allowUnmocked('POST /coupons/preview', 'GET /coupons/available');
  if (o.hint) mockCouponHint(api, o.hint);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(size);
  await page.goto('/gio-hang');
  await expect(page.getByTestId('cart-line').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('coupon-row')).toBeVisible();
  if (o.hint) await expect(page.getByTestId('coupon-hint')).toBeVisible();
}

const W320 = { width: 320, height: 568 };
const W375 = { width: 375, height: 812 };

test.describe('Giỏ web: hàng mã giảm giá ở 320px', () => {
  test('chưa có mã: lời mời một dòng dưới nhãn, không "…", hàng vẫn 44px', async ({ page, api }) => {
    await openCart(page, api, W320);
    const f = await rowFacts(page);
    expectRowIntact(f);
    expect(f.lines['coupon-placeholder'], `lời mời ${f.lines['coupon-placeholder']} dòng`).toBe(1);
    expect(f.mids['coupon-placeholder']! - f.mids['coupon-label']!, 'lời mời nằm dưới nhãn (xuống dòng)').toBeGreaterThan(8);
  });

  test('có gợi ý mã: gợi ý một dòng, không "…", hàng vẫn 44px', async ({ page, api }) => {
    await openCart(page, api, W320, { hint: HINT });
    const f = await rowFacts(page);
    expectRowIntact(f);
    expect(f.lines['coupon-hint'], `gợi ý ${f.lines['coupon-hint']} dòng`).toBe(1);
  });

  test('đã áp mã: mã và số giảm hiện đủ, không "…", hàng vẫn 44px', async ({ page, api }) => {
    await openCart(page, api, W320, { coupon: { code: 'WELCOME30', discount: 30_000 } });
    const f = await rowFacts(page);
    expectRowIntact(f);
    await expect(page.getByTestId('coupon-code')).toHaveText('WELCOME30');
    await expect(page.getByTestId('coupon-discount')).toHaveText('-30.000đ');
    expect(f.lines['coupon-code'], 'mã một dòng').toBe(1);
    expect(f.lines['coupon-discount'], 'số giảm một dòng').toBe(1);
  });

  test('mã 11 ký tự và số giảm 50.000đ: vẫn đủ chữ, không "…"', async ({ page, api }) => {
    await openCart(page, api, W320, { coupon: { code: 'XANHTHANG11', discount: 50_000 } });
    const f = await rowFacts(page);
    expectRowIntact(f);
    await expect(page.getByTestId('coupon-code')).toHaveText('XANHTHANG11');
    await expect(page.getByTestId('coupon-discount')).toHaveText('-50.000đ');
  });

  for (const code of ['KHUYENMAI-THANG-MUOI', 'KHUYENMAI-THANG-MUOI-MOT-VIP-2026']) {
    test(`mã dài ${code.length} ký tự: xuống dòng ngay trong pill, đủ từng ký tự, không "…", không tràn`, async ({ page, api }) => {
      await openCart(page, api, W320, { coupon: { code, discount: 1_250_000 } });
      const f = await rowFacts(page);
      expect(f.clipped, `chữ bị cắt: ${JSON.stringify(f.clipped)}`).toEqual([]);
      expect(f.outside, `phần tử tràn ra ngoài hàng: ${JSON.stringify(f.outside)}`).toEqual([]);
      expect(f.pageOverflow, 'trang tràn ngang').toBe(false);
      await expect(page.getByTestId('coupon-code')).toHaveText(code);
      await expect(page.getByTestId('coupon-discount')).toHaveText('-1.250.000đ');
      expect(f.lines['coupon-code'], 'mã hết chỗ một dòng thì xuống dòng, không cắt').toBeGreaterThan(1);
      expect(f.lines['coupon-cta'], 'nút "Thay đổi" một dòng').toBe(1);
      expect(f.lines['coupon-discount'], 'số giảm một dòng').toBe(1);
    });
  }

  test('chạm vào hàng vẫn mở hộp thoại nhập mã', async ({ page, api }) => {
    await openCart(page, api, W320);
    await page.getByTestId('coupon-row').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('input[name="coupon-code"]')).toBeVisible();
  });
});

test.describe('Giỏ web: hàng mã giảm giá ở 375px', () => {
  test('chưa có mã: nhãn và lời mời cùng một dòng (đủ chỗ), hàng 44px', async ({ page, api }) => {
    await openCart(page, api, W375);
    const f = await rowFacts(page);
    expectRowIntact(f);
    expect(Math.abs(f.mids['coupon-placeholder']! - f.mids['coupon-label']!), 'lời mời lệch dòng so với nhãn').toBeLessThanOrEqual(3);
  });

  test('đã áp mã: mã và số giảm hiện đủ, không "…"', async ({ page, api }) => {
    await openCart(page, api, W375, { coupon: { code: 'WELCOME30', discount: 30_000 } });
    const f = await rowFacts(page);
    expectRowIntact(f);
    await expect(page.getByTestId('coupon-code')).toHaveText('WELCOME30');
    await expect(page.getByTestId('coupon-discount')).toHaveText('-30.000đ');
  });
});
