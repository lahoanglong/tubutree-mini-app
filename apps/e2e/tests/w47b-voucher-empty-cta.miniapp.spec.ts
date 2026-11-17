import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { mockDiscovery, mockHomeEngagement } from './support/discovery-mocks';
import { mockCollectable, mockCollectableMine, mockCouponHistory, mockWallet } from './support/voucher-mocks';

/**
 * W47B, Mini App ở 320/375/393px (hub Ưu đãi, trang Mã giảm giá cũ đã gộp vào đây): ví "Mã của tôi" trống có nút "Nhận thêm mã" đưa về tab Săn mã;
 * kho mã mở cả (`?codes=all`) mà trống thì khối Nhận mã không có nút. API mock toàn bộ.
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

    test('nút "Nhận thêm mã" cao từ 44px, nằm trọn trong màn, không tràn ngang; bấm về tab Săn mã', async ({ page, api }) => {
      mockCollectable(api);
      await page.goto('/offers?tab=wallet');
      const panel = page.getByRole('tabpanel', { name: 'Mã của tôi' });
      await expect(panel.getByText('Chưa có mã giảm giá khả dụng')).toBeVisible({ timeout: 15_000 });
      const cta = panel.getByRole('button', { name: 'Nhận thêm mã' });
      await expect(cta).toBeVisible();
      const b = (await cta.boundingBox())!;
      expect(b.height, 'chiều cao nút Nhận thêm mã').toBeGreaterThanOrEqual(44);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
      expect(await noHorizontalScroll(page)).toBe(true);

      await cta.click();
      await expect(page).toHaveURL(/\/offers$/);
      await expect(page.getByRole('tab', { name: 'Săn mã' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('region', { name: 'Nhận mã', exact: true }).getByRole('group').first()).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('kho mã mở cả mà trống: khối Nhận mã không có nút', async ({ page, api }) => {
      mockCollectable(api, []);
      await page.goto('/offers?codes=all');
      const panel = page.getByRole('region', { name: 'Nhận mã', exact: true });
      await expect(panel.getByText('Hôm nay chưa có mã mới')).toBeVisible({ timeout: 15_000 });
      await expect(panel.getByRole('button')).toHaveCount(0);
    });
  });
}
