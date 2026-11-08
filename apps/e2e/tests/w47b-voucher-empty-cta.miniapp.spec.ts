import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { mockDiscovery, mockHomeEngagement } from './support/discovery-mocks';
import { mockCollectable, mockCollectableMine, mockCouponHistory, mockWallet } from './support/voucher-mocks';

/**
 * W47B, Mini App ở 320/375/393px: ví "Mã của tôi" trống có nút "Nhận mã" đưa về tab Nhận mã; tab Nhận mã trống thì khung nội dung không có nút. API mock toàn bộ.
 */
const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
  { width: 393, height: 852 },
] as const;

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const vp of VIEWPORTS) {
  test.describe(`Mini App ${vp.width}px: Mã của tôi, ví trống`, () => {
    test.use({ viewport: vp });

    test.beforeEach(({ api }) => {
      mockDiscovery(api, { returning: true });
      mockHomeEngagement(api);
      mockCollectableMine(api, { claimed: [], newCustomerOnly: [] });
      mockWallet(api, []);
      mockCouponHistory(api, []);
    });

    test('nút "Nhận mã" cao từ 44px, nằm trọn trong màn, không tràn ngang; bấm về tab Nhận mã', async ({ page, api }) => {
      mockCollectable(api);
      await page.goto('/vouchers?tab=mine');
      const panel = page.getByRole('tabpanel', { name: 'Mã của tôi' });
      await expect(panel.getByText('Bạn chưa có mã nào dùng được')).toBeVisible({ timeout: 15_000 });
      const cta = panel.getByRole('button', { name: 'Nhận mã' });
      await expect(cta).toBeVisible();
      const b = (await cta.boundingBox())!;
      expect(b.height, 'chiều cao nút Nhận mã').toBeGreaterThanOrEqual(44);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
      expect(await noHorizontalScroll(page)).toBe(true);

      await cta.click();
      await expect(page).toHaveURL(/\/vouchers$/);
      await expect(page.getByRole('tab', { name: 'Nhận mã' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tabpanel', { name: 'Nhận mã' }).getByRole('group').first()).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('tab Nhận mã trống: khung nội dung không có nút', async ({ page, api }) => {
      mockCollectable(api, []);
      await page.goto('/vouchers');
      const panel = page.getByRole('tabpanel', { name: 'Nhận mã' });
      await expect(panel.getByText('Hôm nay chưa có mã mới')).toBeVisible({ timeout: 15_000 });
      await expect(panel.getByRole('button')).toHaveCount(0);
    });
  });
}
