import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, reply } from './support/mock-api';
import { mockFooterCart } from './support/cart-footer-mocks';

/**
 * Tấm "Chọn mã giảm giá" của giỏ Mini App ở 320px và 375px: lỗi áp mã hiện trong role="alert" ngay dưới ô nhập, cùng chỗ với hộp mã của web
 * (coupon-alert-320.web.spec.ts), nằm trọn trong màn hình, không nhân đôi thành toast. Sửa mã, đóng rồi mở lại tấm đều xoá lời báo cũ.
 * Lỗi từ nút "Dùng mã" ở danh sách phía dưới cũng kéo lời báo (ở đầu tấm) vào tầm nhìn. API mock toàn bộ.
 */
const WRONG = 'Mã giảm giá không tồn tại hoặc đã hết hạn.';
const SIZES = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
] as const;

// Sáu mã: danh sách dài hơn khung 70vh của tấm (320x568), nên bấm mã cuối thì lời báo ở đầu tấm đã cuộn khỏi tầm nhìn nếu không được kéo lại.
const WALLET = [10, 20, 30, 40, 50, 60].map((k) => ({
  code: `GIAM${k}K`, type: 'AMOUNT', value: k * 1_000, minOrder: null, maxDiscount: null, endAt: new Date(Date.now() + 12 * 86_400_000).toISOString(),
}));
const PREVIEWS = WALLET.map((c) => ({ code: c.code, eligible: true, discount: c.value }));

const dialog = (page: Page) => page.getByRole('dialog');
const codeInput = (page: Page) => dialog(page).getByLabel('Nhập mã giảm giá khác');
const applyButton = (page: Page) => dialog(page).getByRole('button', { name: 'Áp dụng' });

async function openPicker(page: Page): Promise<void> {
  await page.getByTestId('coupon-row').click();
  await expect(dialog(page).getByRole('heading', { name: 'Chọn mã giảm giá' })).toBeVisible({ timeout: 15_000 });
  await expect(dialog(page).getByRole('button', { name: /^Dùng mã / }).first()).toBeVisible({ timeout: 15_000 });
}

for (const size of SIZES) {
  test.describe(`Giỏ Mini App: lời báo lỗi mã giảm giá trong tấm chọn mã ở ${size.width}px`, () => {
    test.use({ viewport: size });

    test.beforeEach(async ({ page, api }) => {
      mockSession(api, makeUser({ id: 'user-coupon-alert', fullName: 'Khách Báo Lỗi' }));
      mockFooterCart(api, { lines: 2, reached: false });
      api.get('/me/coupons', WALLET);
      api.post('/checkout/coupon-previews', { coupons: PREVIEWS });
      api.post('/cart/coupon', () => reply(400, { message: WRONG }));
      await page.goto('/cart');
      await expect(page.getByTestId('coupon-row')).toBeVisible({ timeout: 15_000 });
    });

    test('mã tay sai: lời báo ngay dưới ô nhập, trọn trong màn hình, không nhân đôi thành toast', async ({ page, api }) => {
      await openPicker(page);
      await codeInput(page).fill('SAI');
      await applyButton(page).click();
      const alert = dialog(page).getByRole('alert');
      await expect(alert).toHaveText(WRONG);
      await expect(page.getByText(WRONG)).toHaveCount(1);
      const [a, i] = await Promise.all([alert.boundingBox(), codeInput(page).boundingBox()]);
      expect(a!.y).toBeGreaterThanOrEqual(i!.y + i!.height - 1);
      expect(a!.x).toBeGreaterThanOrEqual(0);
      expect(a!.x + a!.width).toBeLessThanOrEqual(size.width);
      expect(a!.y + a!.height).toBeLessThanOrEqual(size.height);
      expect(api.callsTo('POST', '/cart/coupon')).toHaveLength(1);
    });

    test('sửa mã: lời báo cũ biến mất ngay', async ({ page }) => {
      await openPicker(page);
      await codeInput(page).fill('SAI');
      await applyButton(page).click();
      await expect(dialog(page).getByRole('alert')).toHaveText(WRONG);
      await codeInput(page).pressSequentially('X');
      await expect(dialog(page).getByRole('alert')).toHaveCount(0);
    });

    test('đóng rồi mở lại tấm: lời báo cũ không còn', async ({ page }) => {
      await openPicker(page);
      await codeInput(page).fill('SAI');
      await applyButton(page).click();
      await expect(dialog(page).getByRole('alert')).toHaveText(WRONG);
      await page.keyboard.press('Escape');
      await expect(dialog(page)).toBeHidden();
      await openPicker(page);
      await expect(dialog(page).getByRole('alert')).toHaveCount(0);
    });

    test('lỗi từ nút "Dùng mã" cuối danh sách: lời báo ở đầu tấm được kéo vào tầm nhìn', async ({ page }) => {
      await openPicker(page);
      await dialog(page).getByRole('button', { name: /^Dùng mã / }).last().click();
      const alert = dialog(page).getByRole('alert');
      await expect(alert).toHaveText(WRONG);
      await expect(alert).toBeInViewport();
    });

    test('bấm "Áp dụng" lần hai với cùng mã sai: lời báo dựng lại, vẫn trong tầm nhìn', async ({ page, api }) => {
      await openPicker(page);
      await codeInput(page).fill('SAI');
      await applyButton(page).click();
      await expect(dialog(page).getByRole('alert')).toHaveText(WRONG);
      await applyButton(page).click();
      await expect.poll(() => api.callsTo('POST', '/cart/coupon').length).toBe(2);
      await expect(dialog(page).getByRole('alert')).toHaveText(WRONG);
      await expect(dialog(page).getByRole('alert')).toBeInViewport();
    });
  });
}
