import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession } from './support/mock-api';
import { footerCart, mockFooterCart } from './support/cart-footer-mocks';

/**
 * Đơn tối thiểu của mã giảm giá khi giỏ đổi, giỏ Mini App ở 320px và 375px (cùng hành vi với coupon-min-order.web.spec.ts):
 * mã giữ trong giỏ nhưng chưa áp vì thiếu đơn tối thiểu thì chân giỏ nói luôn cần mua thêm bao nhiêu; khách xoá món làm giỏ rơi dưới mức
 * thì máy chủ gỡ mã và lời báo nói mã nào bị gỡ và còn thiếu bao nhiêu, bấm Đóng thì mất. API mock toàn bộ.
 */
const SIZES = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
] as const;

const REASON = 'Đơn tối thiểu 200.000đ để dùng mã này.';
const REMOVED = { code: 'MIN150', reason: 'Đơn tối thiểu 150.000đ để dùng mã này.', shortfall: 50_000 };

async function expectInside(page: Page, testId: string, size: { width: number; height: number }): Promise<void> {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} phải có khung`).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(size.height);
}

for (const size of SIZES) {
  test.describe(`Giỏ Mini App: đơn tối thiểu của mã giảm giá ở ${size.width}px`, () => {
    test.use({ viewport: size });

    test.beforeEach(({ api }) => {
      mockSession(api, makeUser({ id: 'user-min-order', fullName: 'Khách Đơn Tối Thiểu' }));
    });

    test('mã giữ vì thiếu đơn tối thiểu: lời báo nói lý do và cần mua thêm bao nhiêu, trọn trong màn hình', async ({ page, api }) => {
      mockFooterCart(api, { lines: 2, reached: false });
      api.get('/cart', {
        ...footerCart({ lines: 2, reached: false }),
        couponCode: 'MIN200',
        couponNotice: `Mã chưa được áp dụng cho đơn này: ${REASON}`,
        couponShortfall: 140_000,
      });
      await page.goto('/cart');
      const notice = page.getByTestId('coupon-notice');
      await expect(notice).toContainText(REASON, { timeout: 15_000 });
      await expect(notice).toContainText('Mua thêm 140.000đ để áp mã MIN200.');
      await expectInside(page, 'coupon-notice', size);
      // Chân giỏ vẫn đủ chỗ cho nút thanh toán dù có thêm dòng lời báo.
      await expect(page.getByRole('button', { name: /Thanh toán|Mua hàng/ }).first()).toBeInViewport();
    });

    test('mã giữ vì lý do khác đơn tối thiểu (không có số thiếu): chỉ câu của máy chủ, không nói mua thêm', async ({ page, api }) => {
      mockFooterCart(api, { lines: 2, reached: false });
      api.get('/cart', {
        ...footerCart({ lines: 2, reached: false }),
        couponCode: 'PSGRAN',
        couponNotice: 'Mã chưa được áp dụng cho đơn này: Sản phẩm áp dụng mã đang có giá Giờ vàng.',
      });
      await page.goto('/cart');
      const notice = page.getByTestId('coupon-notice');
      await expect(notice).toContainText('đang có giá Giờ vàng', { timeout: 15_000 });
      await expect(notice).not.toContainText('Mua thêm');
    });

    test('xoá món làm giỏ rơi dưới đơn tối thiểu: lời báo nói mã nào bị gỡ và còn thiếu bao nhiêu, bấm Đóng thì mất', async ({ page, api }) => {
      const full = footerCart({ lines: 2, unit: 100_000, coupon: { code: 'MIN150', discount: 20_000 } });
      const afterDelete = { ...footerCart({ lines: 1, unit: 100_000 }), couponCode: null, discount: 0 };
      let deleted = false;
      mockFooterCart(api, { lines: 2, unit: 100_000 });
      // Như máy chủ thật: lệnh xoá làm giỏ rơi dưới mức nên chính lệnh đó gỡ mã và báo `couponRemoved` trong phản hồi; lần đọc GET /cart sau mã đã không còn nên không báo nữa.
      api.get('/cart', () => (deleted ? afterDelete : full));
      api.delete('/cart/items/:id', () => {
        deleted = true;
        return { ...afterDelete, couponRemoved: REMOVED };
      });
      await page.goto('/cart');
      await expect(page.getByTestId('coupon-code')).toHaveText('MIN150', { timeout: 15_000 });
      await page.getByRole('button', { name: 'Xoá Sản phẩm thử 2' }).click();
      const removed = page.getByTestId('coupon-removed-notice');
      await expect(removed).toContainText('Đã gỡ mã MIN150 vì giỏ chưa đủ đơn tối thiểu. Mua thêm 50.000đ để dùng lại.');
      await expectInside(page, 'coupon-removed-notice', size);
      await expect(page.getByTestId('coupon-code')).toHaveCount(0);
      await page.getByRole('button', { name: 'Đóng lời báo mã MIN150 đã gỡ' }).click();
      await expect(removed).toHaveCount(0);
    });
  });
}
