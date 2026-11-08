import type { Page } from '@playwright/test';
import { expect, test } from './support/mock-api';
import { blockingViolations, runAxe } from './support/axe';
import { COLLECTABLE, mockCollectable, mockCollectableMine, mockCouponHistory, mockWallet } from './support/voucher-mocks';

/**
 * W48B, web khách ở 320/375/393px và 1440×900: chip lọc làm tab Nhận mã rỗng thì khối trạng thái rỗng có nút "Xem tất cả mã"; bấm đặt lại về "Tất cả",
 * phiếu hiện lại và focus về chip "Tất cả". Kho chỉ có mã giảm tiền hạn dài, nên chip "Miễn phí giao hàng" luôn rỗng. Mọi lời gọi từ trình duyệt đi
 * qua mock; trang không gọi API ở máy chủ. Khổ do spec tự đặt, chỉ chạy ở project Web Customer Mobile.
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
const chip = (page: Page, name: string) => page.locator('button[aria-pressed]').filter({ hasText: new RegExp(`^${name}$`) });

for (const size of SIZES) {
  test.describe(`Web khách ${size.width}×${size.height}: bộ lọc mã rỗng, Xem tất cả mã`, () => {
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
      mockCollectable(api, [COLLECTABLE[0]!]);
      mockCollectableMine(api, { claimed: [], newCustomerOnly: [] });
      mockWallet(api, []);
      mockCouponHistory(api, []);
      api.allowUnmocked('GET /affiliate/me', 'GET /me/wishlist/ids', 'GET /cart', 'POST /events', 'GET /notifications/unread-count');
    });

    test('chip không khớp mã nào: nút "Xem tất cả mã" cao từ 44px, bấm về Tất cả, phiếu hiện lại, focus ở chip Tất cả, không tràn ngang, axe sạch', async ({ page }) => {
      await page.goto('/ma-giam-gia');
      const panel = page.getByRole('tabpanel', { name: 'Nhận mã' });
      await expect(panel.getByRole('group').first()).toBeVisible({ timeout: 20_000 });

      await chip(page, 'Miễn phí giao hàng').click();
      await expect(panel.getByText('Không có mã nào ở mục này')).toBeVisible();
      const cta = panel.getByRole('button', { name: 'Xem tất cả mã' });
      await expect(cta).toBeVisible();
      const b = (await cta.boundingBox())!;
      expect(b.height, 'chiều cao nút Xem tất cả mã').toBeGreaterThanOrEqual(44);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(size.width);
      expect(await noHorizontalScroll(page)).toBe(true);
      expect(blockingViolations('web', 'ma-giam-gia-filter-empty', await runAxe(page))).toEqual([]);

      await cta.click();
      await expect(chip(page, 'Tất cả')).toHaveAttribute('aria-pressed', 'true');
      await expect(panel.getByRole('button', { name: 'Xem tất cả mã' })).toHaveCount(0);
      await expect(panel.getByRole('group').first()).toBeVisible();
      await expect(chip(page, 'Tất cả')).toBeFocused();
      expect(await noHorizontalScroll(page)).toBe(true);
      expect(blockingViolations('web', 'ma-giam-gia-filter-reset', await runAxe(page))).toEqual([]);
    });
  });
}
