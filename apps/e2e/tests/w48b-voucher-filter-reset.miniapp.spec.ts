import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { mockDiscovery, mockHomeEngagement } from './support/discovery-mocks';
import { blockingViolations, runAxe } from './support/axe';
import { COLLECTABLE, mockCollectable, mockCollectableMine, mockCouponHistory, mockWallet } from './support/voucher-mocks';

/**
 * W48B, Mini App ở 320/375/393px: chip lọc làm tab Nhận mã rỗng thì khối trạng thái rỗng có nút "Xem tất cả mã"; bấm đặt lại về "Tất cả", phiếu hiện
 * lại và focus về chip "Tất cả". Kho chỉ có mã giảm tiền hạn dài, nên chip "Miễn phí giao hàng" luôn rỗng. API mock toàn bộ.
 */
const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
  { width: 393, height: 852 },
] as const;

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const chip = (page: Page, name: string) => page.locator('button[aria-pressed]').filter({ hasText: new RegExp(`^${name}$`) });

for (const vp of VIEWPORTS) {
  test.describe(`Mini App ${vp.width}px: bộ lọc mã rỗng, Xem tất cả mã`, () => {
    test.use({ viewport: vp });

    test.beforeEach(({ api }) => {
      mockDiscovery(api, { returning: true });
      mockHomeEngagement(api);
      mockCollectable(api, [COLLECTABLE[0]!]);
      mockCollectableMine(api, { claimed: [], newCustomerOnly: [] });
      mockWallet(api, []);
      mockCouponHistory(api, []);
    });

    test('chip không khớp mã nào: nút "Xem tất cả mã" cao từ 44px, bấm về Tất cả, phiếu hiện lại, focus ở chip Tất cả, không tràn ngang, axe sạch', async ({ page }) => {
      await page.goto('/vouchers');
      const panel = page.getByRole('tabpanel', { name: 'Nhận mã' });
      await expect(panel.getByRole('group').first()).toBeVisible({ timeout: 15_000 });

      await chip(page, 'Miễn phí giao hàng').click();
      await expect(panel.getByText('Không có mã nào ở mục này')).toBeVisible();
      const cta = panel.getByRole('button', { name: 'Xem tất cả mã' });
      await expect(cta).toBeVisible();
      const b = (await cta.boundingBox())!;
      expect(b.height, 'chiều cao nút Xem tất cả mã').toBeGreaterThanOrEqual(44);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
      expect(await noHorizontalScroll(page)).toBe(true);
      expect(blockingViolations('miniapp', 'vouchers-filter-empty', await runAxe(page))).toEqual([]);

      await cta.click();
      await expect(chip(page, 'Tất cả')).toHaveAttribute('aria-pressed', 'true');
      await expect(panel.getByRole('button', { name: 'Xem tất cả mã' })).toHaveCount(0);
      await expect(panel.getByRole('group').first()).toBeVisible();
      await expect(chip(page, 'Tất cả')).toBeFocused();
      expect(await noHorizontalScroll(page)).toBe(true);
      expect(blockingViolations('miniapp', 'vouchers-filter-reset', await runAxe(page))).toEqual([]);
    });
  });
}
