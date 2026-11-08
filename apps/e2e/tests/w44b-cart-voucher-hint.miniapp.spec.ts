import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, reply, type MockApi } from './support/mock-api';
import { mockPilotCart } from './support/pilot-mocks';
import { footerCart } from './support/cart-footer-mocks';
import { APPLY_CODE, APPLY_DISCOUNT, mockVoucherHint, type HintWallet } from './support/cart-voucher-hint-mocks';

/**
 * W44B, Mini App ở 320/375/393px: gợi ý mã giảm giá ở Giỏ, dưới thanh Miễn phí giao hàng. API mock toàn bộ. Giỏ có 3 dòng, tạm tính 90.000đ:
 * GIAM20 đủ điều kiện (giảm 20.000đ, một chạm "Áp dụng ngay"), GIAM80 đòi đơn tối thiểu 120.000đ nên còn thiếu 30.000đ (thanh đạt 75%).
 * Không đặt đơn thật.
 */
const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
  { width: 393, height: 852 },
] as const;

function mockCart(api: MockApi, o: { wallet?: HintWallet; couponCode?: string; applyError?: string } = {}): void {
  mockSession(api, makeUser({ id: 'user-w44b', fullName: 'Khách Giỏ' }));
  mockPilotCart(api);
  let applied: string | null = o.couponCode ?? null;
  const cart = () => footerCart({ lines: 3, reached: false, ...(applied ? { coupon: { code: applied, discount: APPLY_DISCOUNT } } : {}) });
  api.get('/cart', cart);
  mockVoucherHint(api, o.wallet ?? 'both');
  api.post('/cart/coupon', ({ call }) => {
    if (o.applyError) return reply(400, { statusCode: 400, message: o.applyError });
    applied = (call.body as { code: string }).code;
    return cart();
  });
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const strip = (page: Page) => page.getByTestId('cart-voucher-hint');
const cta = (page: Page) => page.getByTestId('cart-voucher-apply-cta');

async function openCart(page: Page): Promise<void> {
  await page.goto('/cart');
  await expect(page.getByTestId('freeship-progress')).toBeVisible({ timeout: 20_000 });
}

for (const vp of VIEWPORTS) {
  test.describe(`Mini App ${vp.width}px: Giỏ, gợi ý mã giảm giá`, () => {
    test.use({ viewport: vp });

    test('mời áp mã đủ điều kiện và nhắc mã sắp mở khoá: nằm dưới thanh Miễn phí giao hàng, trên "Chọn tất cả", nút từ 44px, không tràn ngang', async ({ page, api }) => {
      mockCart(api);
      await openCart(page);
      await expect(strip(page)).toBeVisible();

      await expect(page.getByTestId('cart-voucher-apply')).toContainText('🎟️ Bạn có mã giảm giá 20.000đ đủ điều kiện');
      await expect(page.getByTestId('cart-voucher-unlock')).toContainText('🔥 Mua thêm 30.000đ để mở khoá mã giảm giá 80.000đ');
      const bar = page.getByTestId('cart-voucher-unlock-bar');
      await expect(bar).toHaveAttribute('role', 'progressbar');
      await expect(bar).toHaveAttribute('aria-valuenow', '75');
      await expect(bar).toHaveAttribute('aria-label', 'Đã đạt 75% đơn tối thiểu của mã giảm giá');
      await expect(cta(page)).toHaveAccessibleName(`Áp dụng ngay mã ${APPLY_CODE}`);
      await expect(cta(page)).toContainText('Áp dụng ngay');

      const freeship = (await page.getByTestId('freeship-progress').boundingBox())!;
      const box = (await strip(page).boundingBox())!;
      const selectAll = (await page.getByText('Chọn tất cả', { exact: true }).first().boundingBox())!;
      expect(freeship.y + freeship.height).toBeLessThanOrEqual(box.y + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(selectAll.y + 1);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width);

      const b = (await cta(page).boundingBox())!;
      expect(b.width, 'chiều rộng nút Áp dụng ngay').toBeGreaterThanOrEqual(44);
      expect(b.height, 'chiều cao nút Áp dụng ngay').toBeGreaterThanOrEqual(44);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('một chạm "Áp dụng ngay": gửi đúng một lệnh áp mã GIAM20, dải gợi ý biến mất vì giỏ đã có mã, không tràn ngang', async ({ page, api }) => {
      mockCart(api);
      await openCart(page);
      await expect(cta(page)).toBeVisible();

      const applying = api.waitForCall('POST', '/cart/coupon');
      await cta(page).click();
      const call = await applying;
      expect(call.body).toEqual({ code: APPLY_CODE });

      await expect(strip(page)).toHaveCount(0);
      expect(api.callsTo('POST', '/cart/coupon')).toHaveLength(1);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('áp không được: lời báo của máy chủ hiện ngay dưới dòng mời áp (role=alert), dải còn nguyên, nút bấm lại được', async ({ page, api }) => {
      mockCart(api, { applyError: 'Mã giảm giá đã hết lượt dùng.' });
      await openCart(page);

      await cta(page).click();
      const alert = page.getByTestId('cart-voucher-error');
      await expect(alert).toHaveAttribute('role', 'alert');
      await expect(alert).toHaveText('Mã giảm giá đã hết lượt dùng.');
      await expect(strip(page)).toBeVisible();
      await expect(cta(page)).toBeEnabled();
      await expect(cta(page)).not.toHaveAttribute('aria-busy', 'true');
      expect(api.callsTo('POST', '/cart/coupon')).toHaveLength(1);
      const a = (await alert.boundingBox())!;
      expect(a.x + a.width).toBeLessThanOrEqual(vp.width);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('ví chỉ có mã còn thiếu: chỉ dòng nhắc mở khoá, có đúng một nút "Mua thêm" từ 44px và không tràn ngang', async ({ page, api }) => {
      mockCart(api, { wallet: 'unlock' });
      await openCart(page);
      await expect(page.getByTestId('cart-voucher-unlock')).toBeVisible();
      await expect(page.getByTestId('cart-voucher-apply')).toHaveCount(0);
      const buttons = strip(page).getByRole('button');
      await expect(buttons).toHaveCount(1);
      await expect(buttons).toHaveText('Mua thêm');
      const b = (await page.getByTestId('cart-voucher-unlock-cta').boundingBox())!;
      expect(b.width, 'chiều rộng nút Mua thêm').toBeGreaterThanOrEqual(44);
      expect(b.height, 'chiều cao nút Mua thêm').toBeGreaterThanOrEqual(44);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('giỏ đã có mã: không vẽ dải gợi ý và không hỏi xem trước từng mã', async ({ page, api }) => {
      mockCart(api, { couponCode: 'DACO' });
      await openCart(page);
      await page.waitForTimeout(800);
      await expect(strip(page)).toHaveCount(0);
      expect(api.callsTo('POST', '/checkout/coupon-previews')).toHaveLength(0);
    });

    test('giảm chuyển động: thanh mở khoá không đổi bề rộng bằng transition, vẫn không tràn ngang', async ({ page, api }) => {
      mockCart(api);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openCart(page);
      await expect(page.getByTestId('cart-voucher-unlock-bar')).toBeVisible();
      const transition = await page.getByTestId('cart-voucher-unlock-bar').locator('.tubu-freeship-fill').evaluate((el) => getComputedStyle(el).transitionProperty);
      expect(transition).toBe('none');
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  });
}
