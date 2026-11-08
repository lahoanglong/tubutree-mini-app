import type { Page } from '@playwright/test';
import { expect, test } from './support/mock-api';
import { mockCollectable, mockCollectableMine, mockCouponHistory, mockWallet } from './support/voucher-mocks';

/**
 * W47B, web khách ở 320/375/393px và 1440×900: ví "Mã của tôi" trống ở /ma-giam-gia có nút "Nhận mã" đưa về tab Nhận mã; tab Nhận mã trống thì khung nội dung không có nút.
 * Mọi lời gọi từ trình duyệt đi qua mock; trang không gọi API ở máy chủ nên không cần dữ liệu e2e. Khổ do spec tự đặt, chỉ chạy ở project Web Customer Mobile.
 */
const SIZES = [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
  { width: 393, height: 852 },
  { width: 1440, height: 900 },
] as const;

const USER = {
  id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const size of SIZES) {
  test.describe(`Web khách ${size.width}×${size.height}: Mã của tôi, ví trống`, () => {
    test.beforeEach(async ({ page, api }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Khổ do spec tự đặt: một project là đủ');
      await page.setViewportSize(size);
      await page.addInitScript(() => {
        try {
          localStorage.setItem('tubu_web_session', '1');
        } catch {
          // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
        }
      });
      api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
      api.get('/me', () => USER);
      mockCollectableMine(api, { claimed: [], newCustomerOnly: [] });
      mockWallet(api, []);
      mockCouponHistory(api, []);
      api.allowUnmocked('GET /affiliate/me', 'GET /me/wishlist/ids', 'GET /cart', 'POST /events', 'GET /notifications/unread-count');
    });

    test('nút "Nhận mã" cao từ 44px, nằm trọn trong màn, không tràn ngang; bấm về tab Nhận mã', async ({ page, api }) => {
      mockCollectable(api);
      await page.goto('/ma-giam-gia?tab=mine');
      const panel = page.getByRole('tabpanel', { name: 'Mã của tôi' });
      await expect(panel.getByText('Bạn chưa có mã nào dùng được')).toBeVisible({ timeout: 20_000 });
      const cta = panel.getByRole('button', { name: 'Nhận mã' });
      await expect(cta).toBeVisible();
      const b = (await cta.boundingBox())!;
      expect(b.height, 'chiều cao nút Nhận mã').toBeGreaterThanOrEqual(44);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(size.width);
      expect(await noHorizontalScroll(page)).toBe(true);

      await cta.click();
      await expect(page).toHaveURL(/\/ma-giam-gia$/);
      await expect(page.getByRole('tab', { name: 'Nhận mã' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tabpanel', { name: 'Nhận mã' }).getByRole('group').first()).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('tab Nhận mã trống: khung nội dung không có nút', async ({ page, api }) => {
      mockCollectable(api, []);
      await page.goto('/ma-giam-gia');
      const panel = page.getByRole('tabpanel', { name: 'Nhận mã' });
      await expect(panel.getByText('Hôm nay chưa có mã mới')).toBeVisible({ timeout: 20_000 });
      await expect(panel.getByRole('button')).toHaveCount(0);
    });
  });
}
