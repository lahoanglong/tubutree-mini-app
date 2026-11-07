import type { Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';
import { footerCart } from './support/cart-footer-mocks';

/**
 * Đơn tối thiểu của mã giảm giá khi giỏ đổi, giỏ web khổ điện thoại (320px và 375px), cùng hành vi với coupon-min-order.miniapp.spec.ts:
 * mã giữ trong giỏ nhưng chưa áp vì thiếu đơn tối thiểu thì hộp mã nói luôn cần mua thêm bao nhiêu; khách xoá món làm giỏ rơi dưới mức
 * thì máy chủ gỡ mã và lời báo nói mã nào bị gỡ và còn thiếu bao nhiêu, bấm Đóng thì mất. Trình duyệt mock toàn bộ API.
 */
const SIZES = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
] as const;

const REASON = 'Đơn tối thiểu 200.000đ để dùng mã này.';
const REMOVED = { code: 'MIN150', reason: 'Đơn tối thiểu 150.000đ để dùng mã này.', shortfall: 50_000 };

const user = {
  id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};

async function openCart(page: Page, api: MockApi, size: { width: number; height: number }, cart: () => unknown): Promise<void> {
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
  api.get('/cart', cart);
  api.get('/flash-sales/active', []);
  api.allowUnmocked('POST /coupons/preview', 'GET /coupons/available', 'POST /checkout/coupon-previews', 'GET /products');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(size);
  await page.goto('/gio-hang');
  await expect(page.getByTestId('cart-line').first()).toBeVisible({ timeout: 30_000 });
}

async function expectInsideWidth(page: Page, testId: string, size: { width: number; height: number }): Promise<void> {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} phải có khung`).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
}

for (const size of SIZES) {
  test.describe(`Giỏ web: đơn tối thiểu của mã giảm giá ở ${size.width}px`, () => {
    test('mã giữ vì thiếu đơn tối thiểu: lời báo nói lý do và cần mua thêm bao nhiêu, không tràn ngang', async ({ page, api }) => {
      const held = {
        ...footerCart({ lines: 2, reached: false }),
        couponCode: 'MIN200',
        couponNotice: `Mã chưa được áp dụng cho đơn này: ${REASON}`,
        couponShortfall: 140_000,
      };
      await openCart(page, api, size, () => held);
      const notice = page.getByTestId('coupon-notice');
      await expect(notice).toContainText(REASON);
      await expect(notice).toContainText('Mua thêm 140.000đ để áp mã MIN200.');
      await expectInsideWidth(page, 'coupon-notice', size);
    });

    test('mã giữ vì lý do khác đơn tối thiểu (không có số thiếu): chỉ câu của máy chủ, không nói mua thêm', async ({ page, api }) => {
      const held = {
        ...footerCart({ lines: 2, reached: false }),
        couponCode: 'PSGRAN',
        couponNotice: 'Mã chưa được áp dụng cho đơn này: Sản phẩm áp dụng mã đang có giá Giờ vàng.',
      };
      await openCart(page, api, size, () => held);
      const notice = page.getByTestId('coupon-notice');
      await expect(notice).toContainText('đang có giá Giờ vàng');
      await expect(notice).not.toContainText('Mua thêm');
    });

    test('xoá món làm giỏ rơi dưới đơn tối thiểu: lời báo nói mã nào bị gỡ và còn thiếu bao nhiêu, bấm Đóng thì mất', async ({ page, api }) => {
      const full = footerCart({ lines: 2, unit: 100_000, coupon: { code: 'MIN150', discount: 20_000 } });
      const afterDelete = { ...footerCart({ lines: 1, unit: 100_000 }), couponCode: null, discount: 0 };
      let deleted = false;
      // Như máy chủ thật: lệnh xoá làm giỏ rơi dưới mức nên chính lệnh đó gỡ mã và báo `couponRemoved` trong phản hồi; lần đọc GET /cart sau mã đã không còn nên không báo nữa.
      api.delete('/cart/items/:id', () => {
        deleted = true;
        return { ...afterDelete, couponRemoved: REMOVED };
      });
      await openCart(page, api, size, () => (deleted ? afterDelete : full));
      await page.getByRole('button', { name: 'Xoá Sản phẩm thử 2 khỏi giỏ hàng' }).first().click();
      const removed = page.getByTestId('coupon-removed-notice');
      await expect(removed).toContainText('Đã gỡ mã MIN150 vì giỏ chưa đủ đơn tối thiểu. Mua thêm 50.000đ để dùng lại.');
      await expectInsideWidth(page, 'coupon-removed-notice', size);
      await page.getByRole('button', { name: 'Đóng lời báo mã MIN150 đã gỡ' }).click();
      await expect(removed).toHaveCount(0);
    });
  });
}
