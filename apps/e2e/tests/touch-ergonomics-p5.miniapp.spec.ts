import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { NARROW_WIDTHS, probeLayout } from './support/layout-probe';
import { probeTapTargets } from './support/touch-probe';
import { probeTabularTexts } from './support/tabular-p5';
import { LONG_ORDER_CODE, mockBrowse, mockFlashPage, mockLongOrder, mockNotifications, seedRecentSearches } from './support/touch-p5-mocks';

/**
 * W41B: Tìm kiếm + Bộ lọc, Giờ vàng (đồng hồ, đã bán, thanh cháy hàng), Chi tiết đơn (mốc hành trình, mã vận đơn, địa chỉ dài) và Thông báo của Mini App
 * ở 320 / 360 / 375px: mọi điều khiển có vùng chạm thật ≥ 44 × 44px, không phần tử nào tràn ngang, số tiền / số đếm vẽ bằng số đều.
 * Phản hồi nhấn giữ nằm ở touch-press-p5.miniapp.spec.ts (Chromium). API mock toàn bộ.
 */

async function expectClean(page: Page, screen: string, width: number): Promise<void> {
  expect.soft(await probeTapTargets(page), `${screen} ${width}px: vùng chạm dưới 44px`).toEqual([]);
  const f = await probeLayout(page);
  expect.soft(f.overflow, `${screen} ${width}px tràn ngang`).toEqual([]);
  expect.soft(f.notTabular, `${screen} ${width}px số không đều`).toEqual([]);
  expect.soft(await probeTabularTexts(page), `${screen} ${width}px chữ có số không đều (đồng hồ, đã bán, %, mốc giờ, khoảng giá)`).toEqual([]);
}

for (const width of NARROW_WIDTHS) {
  test.describe(`Mini App ${width}px: tìm kiếm, Giờ vàng, chi tiết đơn, thông báo`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
    });

    test('Tìm kiếm: gợi ý + tìm gần đây', async ({ page, api }) => {
      mockBrowse(api);
      await seedRecentSearches(page);
      await page.goto('/browse?focus=search');
      const box = page.getByRole('searchbox', { name: 'Tìm sản phẩm' });
      await expect(box).toBeFocused({ timeout: 15_000 });
      await box.fill('nuoc rua');
      await expect(page.getByRole('region', { name: 'Gợi ý tìm kiếm' })).toBeVisible();
      await expectClean(page, 'Tìm kiếm (gợi ý)', width);
    });

    test('Danh sách kết quả + Bộ lọc', async ({ page, api }) => {
      mockBrowse(api);
      await page.goto('/browse?all=1');
      await expect(page.getByTestId('result-count')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('catalog-grid-skeleton')).toHaveCount(0, { timeout: 15_000 });
      await expectClean(page, 'Kết quả', width);

      await page.getByRole('button', { name: 'Lọc', exact: true }).click();
      const sheet = page.locator('.zaui-sheet-content').filter({ has: page.getByRole('heading', { name: 'Bộ lọc', level: 2 }) });
      await expect(sheet).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
      const minPrice = sheet.getByRole('textbox', { name: /Giá từ|Từ/ }).first();
      if (await minPrice.count()) await minPrice.fill('100000');
      await expectClean(page, 'Bộ lọc', width);
    });

    test('Giờ vàng', async ({ page, api }) => {
      mockFlashPage(api);
      await page.goto('/flash-sale');
      await expect(page.getByRole('heading', { level: 1, name: 'Giờ vàng' })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('timer')).toHaveCount(1);
      await expectClean(page, 'Giờ vàng', width);
    });

    test('Chi tiết đơn: mã dài, địa chỉ dài, mốc hành trình', async ({ page, api }) => {
      await mockLongOrder(api, page, 'miniapp');
      await page.goto(`/order/${LONG_ORDER_CODE}`);
      await expect(page.getByText(LONG_ORDER_CODE).first()).toBeVisible({ timeout: 15_000 });
      await expectClean(page, 'Chi tiết đơn', width);
    });

    test('Thông báo', async ({ page, api }) => {
      mockNotifications(api);
      await page.goto('/notifications');
      await expect(page.getByText('Nước Rửa Chén Sinh Học Tubu 500ml').first()).toBeVisible({ timeout: 15_000 });
      await expectClean(page, 'Thông báo', width);
    });
  });
}
