import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { NARROW_WIDTHS, probeLayout } from './support/layout-probe';
import { probeTapTargets } from './support/touch-probe';
import { probeTabularTexts } from './support/tabular-p5';
import { LONG_ORDER_CODE, NOTIFICATIONS, mockBrowse, mockFlashPage, mockLongOrder, seedRecentSearches } from './support/touch-p5-mocks';

/**
 * W41B: Tìm kiếm + Bộ lọc /san-pham, Giờ vàng /gio-vang, Chi tiết đơn /tai-khoan/don-hang/:code và Thông báo /tai-khoan/thong-bao của web ở 320 / 360 / 375px,
 * cùng chuẩn với Mini App (touch-ergonomics-p5.miniapp.spec.ts): vùng chạm thật ≥ 44 × 44px, không phần tử nào tràn ngang, số vẽ bằng số đều.
 * Chỉ dò phần thân trang (`main`): đầu trang và thanh dưới dùng chung của khung web không thuộc các màn này. Mọi lời gọi từ trình duyệt đi qua mock.
 */

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

async function expectClean(page: Page, screen: string, width: number, scope = 'main'): Promise<void> {
  expect.soft(await probeTapTargets(page, { scope }), `${screen} ${width}px: vùng chạm dưới 44px`).toEqual([]);
  const f = await probeLayout(page, { scope });
  expect.soft(f.overflow, `${screen} ${width}px tràn ngang`).toEqual([]);
  expect.soft(f.notTabular, `${screen} ${width}px số không đều`).toEqual([]);
  expect.soft(await probeTabularTexts(page, scope), `${screen} ${width}px chữ có số không đều (đồng hồ, đã bán, %, mốc giờ, khoảng giá)`).toEqual([]);
}

for (const width of NARROW_WIDTHS) {
  test.describe(`Web ${width}px: tìm kiếm, Giờ vàng, chi tiết đơn, thông báo`, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Khổ do spec tự đặt: một project là đủ');
      await page.setViewportSize({ width, height: 700 });
    });

    test('Tìm kiếm: gợi ý', async ({ page, api }) => {
      await signIn(page, api);
      mockBrowse(api);
      await seedRecentSearches(page);
      await page.goto('/san-pham?focus=search');
      const box = page.getByRole('searchbox', { name: 'Tìm sản phẩm' }).first();
      await expect(box).toBeVisible({ timeout: 30_000 });
      await box.fill('nuoc rua');
      await expect(page.getByRole('region', { name: 'Gợi ý tìm kiếm' })).toBeVisible();
      await expectClean(page, 'Tìm kiếm (gợi ý)', width);
    });

    test('Danh sách kết quả + Bộ lọc', async ({ page, api }) => {
      await signIn(page, api);
      mockBrowse(api);
      await page.goto('/san-pham?all=1');
      await expect(page.getByTestId('result-count')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('catalog-grid-skeleton')).toHaveCount(0, { timeout: 30_000 });
      await expectClean(page, 'Kết quả', width);

      await page.getByRole('button', { name: 'Lọc', exact: true }).click();
      const sheet = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Bộ lọc' }) });
      await expect(sheet).toBeVisible();
      await expectClean(page, 'Bộ lọc', width, '[role="dialog"]');
    });

    test('Giờ vàng', async ({ page, api }) => {
      await signIn(page, api);
      mockFlashPage(api);
      api.get('/config/public', { freeshipThreshold: 500_000 });
      api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 500_000, itemCount: 0 });
      api.get('/products', { data: [], meta: { page: 1, limit: 30, total: 0 } });
      await page.goto('/gio-vang');
      await expect(page.getByRole('heading', { level: 1, name: 'Giờ vàng' })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('timer')).toHaveCount(1);
      await expectClean(page, 'Giờ vàng', width);
    });

    test('Chi tiết đơn: mã dài, địa chỉ dài, mốc hành trình', async ({ page, api }) => {
      await mockLongOrder(api, page, 'web');
      await page.goto(`/tai-khoan/don-hang/${LONG_ORDER_CODE}`);
      await expect(page.getByText(LONG_ORDER_CODE).first()).toBeVisible({ timeout: 30_000 });
      await expectClean(page, 'Chi tiết đơn', width);
    });

    test('Thông báo', async ({ page, api }) => {
      await signIn(page, api);
      api.get('/me/notifications', NOTIFICATIONS);
      api.get('/me/summary', { unreadNotifications: 2 });
      api.post('/me/notifications/read-all', { ok: true, count: 2 });
      api.allowUnmocked('GET /cart', 'GET /config/public', 'POST /events');
      await page.goto('/tai-khoan/thong-bao');
      await expect(page.getByText('Nước Rửa Chén Sinh Học Tubu 500ml').first()).toBeVisible({ timeout: 30_000 });
      await expectClean(page, 'Thông báo', width);
    });
  });
}
