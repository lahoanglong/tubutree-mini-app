import type { Page } from '@playwright/test';
import { expect, reply, test, type MockApi } from './support/mock-api';
import { footerCart } from './support/cart-footer-mocks';

/**
 * Hộp mã giảm giá của giỏ web khổ điện thoại (320px và 375px): lỗi áp mã hiện trong role="alert" ngay dưới ô nhập, cùng chỗ với tấm chọn mã của
 * Mini App (coupon-alert-320.miniapp.spec.ts), nằm trọn trong màn hình. Sửa mã, đóng rồi mở lại hộp đều xoá lời báo cũ. Trình duyệt mock toàn bộ API.
 */
const WRONG = 'Mã giảm giá không tồn tại hoặc đã hết hạn.';
const SIZES = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
] as const;

const user = {
  id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};
// Sáu mã: danh sách dài hơn hộp ở 320x568, nên bấm mã cuối thì lời báo ở đầu hộp đã cuộn khỏi tầm nhìn nếu không được kéo lại.
const WALLET = [10, 20, 30, 40, 50, 60].map((k) => ({
  code: `GIAM${k}K`, type: 'AMOUNT', value: k * 1_000, minOrder: null, maxDiscount: null, endAt: new Date(Date.now() + 12 * 86_400_000).toISOString(),
}));

const dialog = (page: Page) => page.getByRole('dialog');
const codeInput = (page: Page) => page.locator('input[name="coupon-code"]');
const applyButton = (page: Page) => dialog(page).getByRole('button', { name: 'Áp dụng' });

async function openCart(page: Page, api: MockApi, size: { width: number; height: number }): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user }));
  api.get('/me', () => user);
  api.get('/me/coupons', WALLET);
  api.get('/me/wishlist/ids', []);
  api.get('/config/public', {
    freeshipThreshold: 200_000,
    support: { hotline: '0984606774', email: 'tubutree@gmail.com' },
    waste: { enabled: true, dropoff: true, mailin: true, pickup: false },
  });
  const cart = footerCart({ lines: 2, reached: false });
  api.get('/cart', { ...cart, items: cart.items.map((l) => ({ ...l, weight: 600 })) });
  api.get('/flash-sales/active', []);
  api.post('/cart/coupon', () => reply(400, { message: WRONG }));
  api.allowUnmocked('POST /coupons/preview', 'GET /coupons/available');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(size);
  await page.goto('/gio-hang');
  await expect(page.getByTestId('cart-line').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('coupon-row')).toBeVisible();
}

async function openBox(page: Page): Promise<void> {
  await page.getByTestId('coupon-row').click();
  await expect(dialog(page)).toBeVisible();
  await expect(codeInput(page)).toBeVisible();
}

for (const size of SIZES) {
  test.describe(`Giỏ web: lời báo lỗi mã giảm giá trong hộp nhập mã ở ${size.width}px`, () => {
    test('mã tay sai: lời báo ngay dưới ô nhập, trọn trong màn hình', async ({ page, api }) => {
      await openCart(page, api, size);
      await openBox(page);
      await codeInput(page).fill('SAI');
      await applyButton(page).click();
      const alert = dialog(page).getByRole('alert');
      await expect(alert).toHaveText(WRONG);
      const [a, i] = await Promise.all([alert.boundingBox(), codeInput(page).boundingBox()]);
      expect(a!.y).toBeGreaterThanOrEqual(i!.y + i!.height - 1);
      expect(a!.x).toBeGreaterThanOrEqual(0);
      expect(a!.x + a!.width).toBeLessThanOrEqual(size.width);
      expect(a!.y + a!.height).toBeLessThanOrEqual(size.height);
      expect(api.callsTo('POST', '/cart/coupon')).toHaveLength(1);
    });

    test('sửa mã: lời báo cũ biến mất ngay', async ({ page, api }) => {
      await openCart(page, api, size);
      await openBox(page);
      await codeInput(page).fill('SAI');
      await applyButton(page).click();
      await expect(dialog(page).getByRole('alert')).toHaveText(WRONG);
      await codeInput(page).pressSequentially('X');
      await expect(dialog(page).getByRole('alert')).toHaveCount(0);
    });

    test('đóng rồi mở lại hộp: lời báo cũ không còn', async ({ page, api }) => {
      await openCart(page, api, size);
      await openBox(page);
      await codeInput(page).fill('SAI');
      await applyButton(page).click();
      await expect(dialog(page).getByRole('alert')).toHaveText(WRONG);
      await page.keyboard.press('Escape');
      await expect(dialog(page)).toBeHidden();
      await openBox(page);
      await expect(dialog(page).getByRole('alert')).toHaveCount(0);
    });

    test('lỗi từ nút "Dùng mã" cuối danh sách: lời báo ở đầu hộp được kéo vào tầm nhìn', async ({ page, api }) => {
      await openCart(page, api, size);
      await openBox(page);
      await dialog(page).getByRole('button', { name: /^Dùng mã / }).last().click();
      const alert = dialog(page).getByRole('alert');
      await expect(alert).toHaveText(WRONG);
      await expect(alert).toBeInViewport();
    });
  });
}
