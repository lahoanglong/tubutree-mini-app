import { test, expect } from './support/mock-api';
import { NARROW_WIDTHS } from './support/layout-probe';
import { expectNoPressMotion, expectPressFeedback } from './support/touch-probe';
import { LONG_ORDER_CODE, mockBrowse, mockFlashPage, mockLongOrder, mockNotifications, seedRecentSearches } from './support/touch-p5-mocks';

/**
 * W41B: phản hồi khi nhấn giữ ở Tìm kiếm + Bộ lọc, Giờ vàng, Chi tiết đơn và Thông báo của Mini App ở 320 / 360 / 375px: nút và chip co 0,97..0,99; khách chọn giảm
 * chuyển động thì không co. Chạy Chromium (phép đo hệ số co chập chờn trên WebKit Linux của CI). API mock toàn bộ.
 */
test.use({ browserName: 'chromium' });

for (const width of NARROW_WIDTHS) {
  test.describe(`Mini App ${width}px: co khi nhấn (tìm kiếm, Giờ vàng, chi tiết đơn, thông báo)`, () => {
    test.beforeEach(async ({ page, browserName }) => {
      expect(browserName, 'spec nhấn giữ phải chạy Chromium').toBe('chromium');
      await page.setViewportSize({ width, height: 700 });
      await seedRecentSearches(page);
    });

    test('Tìm kiếm và Bộ lọc', async ({ page, api }) => {
      mockBrowse(api);
      await page.goto('/browse?focus=search');
      const box = page.getByRole('searchbox', { name: 'Tìm sản phẩm' });
      await expect(box).toBeFocused({ timeout: 15_000 });
      const recent = page.getByRole('group', { name: 'Tìm gần đây' });
      await expect(recent.getByRole('button').first()).toBeVisible();
      await expectPressFeedback(page, recent.getByRole('button').first(), 'chip tìm gần đây');
      await box.fill('nuoc');
      await expectPressFeedback(page, page.getByRole('button', { name: 'Xoá từ khoá' }), 'nút xoá từ khoá');

      await page.goto('/browse?all=1');
      await expect(page.getByTestId('result-count')).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Lọc', exact: true }).click();
      const sheet = page.locator('.zaui-sheet-content').filter({ has: page.getByRole('heading', { name: 'Bộ lọc', level: 2 }) });
      await expect(sheet).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
      await expectPressFeedback(page, sheet.getByRole('button', { name: 'Dưới 100k' }), 'chip khoảng giá');
      await expectPressFeedback(page, sheet.getByRole('button', { name: 'Đặt lại' }).or(sheet.getByRole('button', { name: /^Xoá/ })).first(), 'nút Đặt lại bộ lọc');
      await expectPressFeedback(page, sheet.getByRole('button', { name: /^Xem / }), 'nút Xem kết quả');
    });

    test('Tìm kiếm, giảm chuyển động thì chip không co khi nhấn', async ({ page, api }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      mockBrowse(api);
      await page.goto('/browse?focus=search');
      const recent = page.getByRole('group', { name: 'Tìm gần đây' });
      await expect(recent.getByRole('button').first()).toBeVisible({ timeout: 15_000 });
      await expectNoPressMotion(page, recent.getByRole('button').first(), 'chip tìm gần đây');
    });

    test('Giờ vàng', async ({ page, api }) => {
      mockFlashPage(api);
      await page.goto('/flash-sale');
      await expect(page.getByRole('heading', { level: 1, name: 'Giờ vàng' })).toBeVisible({ timeout: 15_000 });
      await expectPressFeedback(page, page.getByRole('tab', { name: '20:00 Sắp diễn ra' }), 'tab khung giờ');
      await expectPressFeedback(page, page.getByRole('button', { name: /^Mua ngay Sản phẩm Giờ vàng/ }).first(), 'nút Mua ngay');
    });

    test('Chi tiết đơn', async ({ page, api }) => {
      await mockLongOrder(api, page, 'miniapp');
      await page.goto(`/order/${LONG_ORDER_CODE}`);
      await expect(page.getByText(LONG_ORDER_CODE).first()).toBeVisible({ timeout: 15_000 });
      await expectPressFeedback(page, page.getByRole('button', { name: /Sao chép|Chép mã/ }).first(), 'nút chép mã vận đơn');
    });

    test('Thông báo', async ({ page, api }) => {
      mockNotifications(api);
      await page.goto('/notifications');
      await expect(page.getByText('Nước Rửa Chén Sinh Học Tubu 500ml').first()).toBeVisible({ timeout: 15_000 });
      await expectPressFeedback(page, page.getByRole('button', { name: 'Đọc tất cả' }), 'nút Đọc tất cả');
    });
  });
}
