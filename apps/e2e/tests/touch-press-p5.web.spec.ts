import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { NARROW_WIDTHS } from './support/layout-probe';
import { expectNoPressMotion, expectPressFeedback } from './support/touch-probe';
import { LONG_ORDER_CODE, NOTIFICATIONS, mockBrowse, mockFlashPage, mockLongOrder, seedRecentSearches } from './support/touch-p5-mocks';

/**
 * W41B: phản hồi khi nhấn giữ ở Tìm kiếm + Bộ lọc /san-pham, Giờ vàng /gio-vang, Chi tiết đơn và Thông báo của web ở 320 / 360 / 375px, cùng chuẩn với Mini App
 * (touch-press-p5.miniapp.spec.ts): nút và chip co 0,97..0,99; giảm chuyển động thì không co. Chạy Chromium. Mọi lời gọi từ trình duyệt đi qua mock.
 */
test.use({ browserName: 'chromium' });

async function signIn(page: Page, api: MockApi): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
  mockSession(api, makeUser({ id: 'user-p5', fullName: 'Nguyễn Văn An' }));
  api.get('/me/coupons', []);
  api.get('/me/wishlist/ids', []);
}

for (const width of NARROW_WIDTHS) {
  test.describe(`Web ${width}px: co khi nhấn (tìm kiếm, Giờ vàng, chi tiết đơn, thông báo)`, () => {
    test.beforeEach(async ({ page, browserName }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Khổ do spec tự đặt: một project là đủ');
      expect(browserName, 'spec nhấn giữ phải chạy Chromium').toBe('chromium');
      await page.setViewportSize({ width, height: 700 });
    });

    test('Tìm kiếm và Bộ lọc', async ({ page, api }) => {
      await signIn(page, api);
      mockBrowse(api);
      await seedRecentSearches(page);
      await page.goto('/san-pham?focus=search');
      const box = page.getByRole('searchbox', { name: 'Tìm sản phẩm' }).first();
      await expect(box).toBeVisible({ timeout: 30_000 });
      const recent = page.getByRole('group', { name: 'Tìm gần đây' });
      await expect(recent.getByRole('button').first()).toBeVisible();
      await expectPressFeedback(page, recent.getByRole('button').first(), 'chip tìm gần đây');
      await box.fill('nuoc');
      await expectPressFeedback(page, page.getByRole('button', { name: 'Xoá từ khoá' }).first(), 'nút xoá từ khoá');

      await page.goto('/san-pham?all=1');
      await expect(page.getByTestId('result-count')).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Lọc', exact: true }).click();
      const sheet = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Bộ lọc' }) });
      await expect(sheet).toBeVisible();
      await expectPressFeedback(page, sheet.getByRole('button', { name: 'Dưới 100k' }), 'chip khoảng giá');
      await expectPressFeedback(page, sheet.getByRole('button', { name: /^Đặt lại|^Xoá/ }).first(), 'nút Đặt lại bộ lọc');
      await expectPressFeedback(page, sheet.getByRole('button', { name: /^Xem / }), 'nút Xem kết quả');
    });

    test('Tìm kiếm, giảm chuyển động thì chip không co khi nhấn', async ({ page, api }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await signIn(page, api);
      mockBrowse(api);
      await seedRecentSearches(page);
      await page.goto('/san-pham?focus=search');
      const recent = page.getByRole('group', { name: 'Tìm gần đây' });
      await expect(recent.getByRole('button').first()).toBeVisible({ timeout: 30_000 });
      await expectNoPressMotion(page, recent.getByRole('button').first(), 'chip tìm gần đây');
    });

    test('Giờ vàng', async ({ page, api }) => {
      await signIn(page, api);
      mockFlashPage(api);
      api.get('/config/public', { freeshipThreshold: 500_000 });
      api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 500_000, itemCount: 0 });
      api.get('/products', { data: [], meta: { page: 1, limit: 30, total: 0 } });
      await page.goto('/gio-vang');
      await expect(page.getByRole('heading', { level: 1, name: 'Giờ vàng' })).toBeVisible({ timeout: 30_000 });
      await expectPressFeedback(page, page.getByRole('tab', { name: '20:00 Sắp diễn ra' }), 'tab khung giờ');
      await expectPressFeedback(page, page.getByRole('button', { name: /^Mua ngay Sản phẩm Giờ vàng/ }).first(), 'nút Mua ngay');
    });

    test('Chi tiết đơn', async ({ page, api }) => {
      await mockLongOrder(api, page, 'web');
      await page.goto(`/tai-khoan/don-hang/${LONG_ORDER_CODE}`);
      await expect(page.getByText(LONG_ORDER_CODE).first()).toBeVisible({ timeout: 30_000 });
      await expectPressFeedback(page, page.getByRole('button', { name: /Sao chép|Chép mã/ }).first(), 'nút chép mã vận đơn');
    });

    test('Thông báo', async ({ page, api }) => {
      await signIn(page, api);
      api.get('/me/notifications', NOTIFICATIONS);
      api.get('/me/summary', { unreadNotifications: 2 });
      api.post('/me/notifications/read-all', { ok: true, count: 2 });
      api.allowUnmocked('GET /cart', 'GET /config/public', 'POST /events');
      await page.goto('/tai-khoan/thong-bao');
      await expect(page.getByText('Nước Rửa Chén Sinh Học Tubu 500ml').first()).toBeVisible({ timeout: 30_000 });
      await expectPressFeedback(page, page.getByRole('button', { name: 'Đọc tất cả' }), 'nút Đọc tất cả');
    });
  });
}
