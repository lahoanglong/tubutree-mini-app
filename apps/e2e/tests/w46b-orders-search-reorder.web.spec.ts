import type { Page } from '@playwright/test';
import { expect, makeOrder, test, type MockApi } from './support/mock-api';
import { deliveredOrder, mockBuyFlowSession, DELIVERED_CODE } from './support/buy-flow-mocks';

/**
 * W46B, web khách ở 320/375/393px và 1440×900: ô tìm đơn theo mã đơn hoặc tên sản phẩm ở trang Đơn hàng (/tai-khoan/don-hang, bản web của tab Đơn hàng
 * Mini App) và nút "Mua lại" ở khối đơn của Tài khoản (/tai-khoan, chỉ desktop). Trang client nên mọi dữ liệu đi qua mock, không cần seed. Hai đơn: đã giao
 * (2 dòng, có "Xà Phòng Tubu Đã Hết") và đang giao. Khổ do spec tự đặt, chỉ chạy ở project Web Customer Mobile. Không đặt đơn thật.
 */
const SIZES = [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
  { width: 393, height: 852 },
  { width: 1440, height: 900 },
] as const;

const SHIPPING_CODE = 'TUBU-SHP-46B';
const USER = {
  id: 'user-4a', fullName: 'Khách Mua Lại', email: null, dob: null, avatarUrl: null, phone: '0912345678', role: 'CUSTOMER', referralCode: 'AN123',
  onboarded: true, segments: [], pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};

function mockOrders(api: MockApi): void {
  mockBuyFlowSession(api);
  // Trang Cá nhân đọc số điểm và số dư ví của khách (formatVnd ném khi thiếu): đăng ký sau mockSession để thắng.
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me', () => USER);
  api.get('/me/subscriptions', []);
  api.get('/me/addresses', []);
  api.get('/orders', ({ call }) => {
    const q = (call.query.get('q') ?? '').trim().toLowerCase();
    const all = [deliveredOrder(), makeOrder({ code: SHIPPING_CODE, status: 'SHIPPING' })];
    const data = q ? all.filter((o) => o.code.toLowerCase().includes(q) || o.items.some((i) => i.productName.toLowerCase().includes(q))) : all;
    return { data, meta: { page: 1, limit: 20, total: data.length } };
  });
  api.get('/auth/me', { ...USER, ownsBrand: false });
  api.get('/me/loyalty', { tier: { name: 'Hạt Giống' }, pointsBalance: 0, pointsConvertedBalance: 0 });
  api.get('/dealer/me', { status: 'NONE', isDealer: false });
  api.allowUnmocked('GET /me/referral', 'GET /me/summary', 'GET /me/wallet', 'GET /brand/owner/me', 'GET /chat/summary', 'GET /coupons/available', 'GET /me/vouchers');
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const searchBox = (page: Page) => page.getByRole('searchbox', { name: 'Tìm đơn theo mã đơn hoặc tên sản phẩm' });
const fieldFrame = (page: Page) => page.getByTestId('search-field-box');
const cards = (page: Page) => page.getByTestId('order-card');
const queried = (api: MockApi, q: string) => api.callsTo('GET', '/orders').some((c) => c.query.get('q') === q);

async function signIn(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
}

for (const size of SIZES) {
  test.describe(`Web khách ${size.width}×${size.height}: Đơn hàng — ô tìm`, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Khổ do spec tự đặt: một project là đủ');
      await page.setViewportSize(size);
      await signIn(page);
    });

    test('ô tìm nằm dưới tab trạng thái và trên danh sách, khung từ 44px, trong màn, không tràn ngang', async ({ page, api }) => {
      mockOrders(api);
      await page.goto('/tai-khoan/don-hang');
      await expect(cards(page)).toHaveCount(2, { timeout: 20_000 });

      await expect(searchBox(page)).toHaveAttribute('placeholder', 'Mã đơn hoặc tên sản phẩm');
      const tabs = (await page.getByRole('tablist').boundingBox())!;
      const box = (await fieldFrame(page).boundingBox())!;
      const first = (await cards(page).first().boundingBox())!;
      expect(tabs.y + tabs.height).toBeLessThanOrEqual(box.y + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(first.y + 1);
      expect(box.height, 'chiều cao khung ô tìm').toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('Enter gửi từ khoá cho API, chỉ đơn khớp còn lại và kệ Mua lại ẩn khi đang tìm', async ({ page, api }) => {
      mockOrders(api);
      await page.goto('/tai-khoan/don-hang');
      await expect(cards(page)).toHaveCount(2, { timeout: 20_000 });

      // Kệ phải có mặt trước khi tìm, nếu không "ẩn khi đang tìm" xanh cả khi kệ chưa bao giờ dựng.
      await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible();
      await searchBox(page).fill('shp');
      await searchBox(page).press('Enter');
      await expect.poll(() => queried(api, 'shp')).toBe(true);
      await expect(cards(page)).toHaveCount(1);
      await expect(cards(page).first()).toContainText(SHIPPING_CODE);
      await expect(page.getByRole('region', { name: 'Mua lại' })).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('không khớp: câu báo kèm từ khoá dài 60 ký tự không tràn ngang, "Xoá tìm kiếm" cao từ 44px và trả lại danh sách', async ({ page, api }) => {
      mockOrders(api);
      await page.goto('/tai-khoan/don-hang');
      await expect(cards(page)).toHaveCount(2, { timeout: 20_000 });

      const long = 'x'.repeat(60);
      await searchBox(page).fill(long);
      await searchBox(page).press('Enter');
      await expect(page.getByText(`Không tìm thấy đơn nào khớp “${long}”`)).toBeVisible();
      await expect(cards(page)).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);

      // Hai nút cùng tên: ✕ trong ô (đứng trên) và nút ở màn trống (đứng dưới).
      const clear = page.getByRole('button', { name: 'Xoá tìm kiếm' }).last();
      const b = (await clear.boundingBox())!;
      expect(b.height, 'chiều cao nút Xoá tìm kiếm').toBeGreaterThanOrEqual(44);
      expect(b.x + b.width).toBeLessThanOrEqual(size.width);
      await clear.click();
      await expect(cards(page)).toHaveCount(2);
      await expect(searchBox(page)).toHaveValue('');
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  });
}

test.describe('Web khách: khối đơn ở Tài khoản — nút Mua lại', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Khổ do spec tự đặt: một project là đủ');
    await signIn(page);
  });

  test('1440px: chỉ đơn đã xong có "Mua lại" cao từ 44px, cạnh "Xem chi tiết"; bấm mở sheet đúng đơn, không tràn ngang', async ({ page, api }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    mockOrders(api);
    await page.goto('/tai-khoan');
    await expect(page.locator('#orders-title')).toBeVisible({ timeout: 20_000 });

    const reorder = page.getByRole('button', { name: `Mua lại đơn ${DELIVERED_CODE}` });
    await expect(reorder).toBeVisible();
    await expect(page.getByRole('button', { name: `Mua lại đơn ${SHIPPING_CODE}` })).toHaveCount(0);
    const b = (await reorder.boundingBox())!;
    const detail = (await page.getByRole('link', { name: `Xem chi tiết đơn ${DELIVERED_CODE}` }).boundingBox())!;
    expect(b.height, 'chiều cao nút Mua lại').toBeGreaterThanOrEqual(44);
    expect(b.x).toBeGreaterThanOrEqual(detail.x + detail.width);
    expect(await noHorizontalScroll(page)).toBe(true);

    await reorder.click();
    await expect(page.getByRole('dialog')).toContainText(`Từ đơn ${DELIVERED_CODE}`);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  for (const width of [320, 375, 393]) {
    test(`${width}px: khối đơn ở Tài khoản ẩn (khổ điện thoại dùng trang Đơn hàng như Mini App)`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 800 });
      mockOrders(api);
      await page.goto('/tai-khoan');
      // Đợi phần client của hub dựng xong (tên khách chỉ có sau khi phiên khôi phục) rồi mới kiểm khối đơn ẩn.
      await expect(page.getByText('Khách Mua Lại').first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('#orders-title')).toBeHidden();
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  }
});
