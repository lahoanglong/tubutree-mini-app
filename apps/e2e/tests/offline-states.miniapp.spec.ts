import type { Page, TestInfo } from '@playwright/test';
import { test, expect, makeUser, makeOrder, mockSession } from './support/mock-api';

/**
 * R5-BUYER-1: mất mạng/API không tới được thì Đơn hàng, Giỏ, Thông báo, Yêu thích, Đổi vỏ từng vẽ màn "trống" (như thể khách chưa
 * có gì) và Cá nhân hiện "Network Error" tiếng Anh. Mọi màn phải nói đúng bằng tiếng Việt + nút Thử lại, và tự về nội dung thật
 * khi có mạng lại. Chạy ở khung 390px của project "Zalo Mini App" (iPhone 12).
 */

const SESSION_LOST = 'Mất kết nối. Vui lòng kiểm tra mạng rồi thử lại.';

const PAGES: { name: string; path: string; forbidden: RegExp }[] = [
  { name: 'Đơn hàng', path: '/orders', forbidden: /Bạn chưa có đơn nào|Không có đơn nào ở mục này/ },
  { name: 'Giỏ hàng', path: '/cart', forbidden: /Giỏ còn trống đấy/ },
  { name: 'Thông báo', path: '/notifications', forbidden: /Chưa có thông báo nào/ },
  { name: 'Yêu thích', path: '/wishlist', forbidden: /Chưa có sản phẩm yêu thích/ },
  { name: 'Đổi rác', path: '/recycle', forbidden: /Chương trình đang tạm dừng|Đăng nhập Zalo và chia sẻ số điện thoại để đổi rác/ },
  { name: 'Cá nhân', path: '/profile', forbidden: /Đã đăng xuất|network error/i },
];

/** Cắt mọi lời gọi API (trình duyệt báo lỗi mạng như khi máy chủ không với tới được); `cut=false` trả lại cho mock. */
async function cutApi(page: Page) {
  const state = { cut: true };
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => (state.cut ? route.abort('connectionrefused') : route.fallback()),
  );
  return state;
}

async function shot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

test.describe('Mất kết nối không vẽ màn trống (R5-BUYER-1)', () => {
  for (const p of PAGES) {
    test(`${p.name}: mở app khi API không tới được → "Mất kết nối" + Thử lại, không có màn trống hay "Network Error"`, async ({ page, api }, testInfo) => {
      mockSession(api, makeUser({ id: 'user-offline', fullName: 'Khách ngoại tuyến' }));
      await cutApi(page);
      await page.goto(p.path);

      await expect(page.getByText(SESSION_LOST)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();
      const body = await page.locator('body').innerText();
      expect(body).not.toMatch(p.forbidden);
      expect(body).not.toMatch(/network error/i);
      await shot(page, testInfo, `${p.name}-mat-ket-noi`);
    });
  }

  test('có mạng lại: bấm Thử lại khôi phục phiên và hiện đơn thật, không cần tải lại app', async ({ page, api }, testInfo) => {
    mockSession(api, makeUser({ id: 'user-offline', fullName: 'Khách ngoại tuyến' }));
    api.get('/orders', { data: [makeOrder({ code: 'TT-OFF-1', status: 'CONFIRMED' })], meta: { page: 1, limit: 20, total: 1 } });
    const net = await cutApi(page);
    await page.goto('/orders');
    await expect(page.getByText(SESSION_LOST)).toBeVisible({ timeout: 15_000 });

    net.cut = false;
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await expect(page.getByText(/TT-OFF-1/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(SESSION_LOST)).toHaveCount(0);
    await shot(page, testInfo, 'don-hang-sau-khi-co-mang');
  });

  test('mất mạng thật sau khi đã vào app: tab chưa có dữ liệu báo mất mạng + Thử lại; có mạng lại thì tự tải lại', async ({ page, context, api }, testInfo) => {
    mockSession(api, makeUser({ id: 'user-offline', fullName: 'Khách ngoại tuyến' }));
    api.allowUnmocked('POST /events');
    api.get('/orders', { data: [makeOrder({ code: 'TT-OFF-2', status: 'CONFIRMED' })], meta: { page: 1, limit: 20, total: 1 } });
    await page.goto('/orders');
    await expect(page.getByText(/TT-OFF-2/)).toBeVisible({ timeout: 15_000 });

    // Tab "Đã giao" chưa từng tải: ngắt mạng rồi mở nó thì không có dữ liệu nào để giữ lại, chỉ còn lỗi mạng.
    await context.setOffline(true);
    await page.getByRole('tab', { name: 'Đã giao' }).click();
    await expect(page.getByText('Có vẻ mất mạng. Kiểm tra kết nối rồi thử lại nhé.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/Bạn chưa có đơn nào|Không có đơn nào ở mục này|network error/i);
    await shot(page, testInfo, 'don-hang-mat-mang-that');

    // Có mạng lại: truy vấn đang lỗi tự tải lại (refetchOnReconnect), khách không phải bấm gì.
    await context.setOffline(false);
    await expect(page.getByText(/TT-OFF-2/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Có vẻ mất mạng. Kiểm tra kết nối rồi thử lại nhé.')).toHaveCount(0);
  });
});
