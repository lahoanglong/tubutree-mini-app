import type { Page } from '@playwright/test';
import { test, expect, makeOrder, type MockApi } from './support/mock-api';
import { deliveredOrder, mockBuyFlowSession } from './support/buy-flow-mocks';

/**
 * W46B, Mini App ở 320/375/393px: ô tìm đơn theo mã đơn hoặc tên sản phẩm ở tab Đơn hàng, dưới tab trạng thái. API mock toàn bộ. Hai đơn: đã giao (2 dòng,
 * có "Xà Phòng Tubu Đã Hết") và đang giao. Không đặt đơn thật.
 */
const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
  { width: 393, height: 852 },
] as const;

const SHIPPING_CODE = 'TUBU-SHP-46B';

function mockOrders(api: MockApi): void {
  mockBuyFlowSession(api);
  api.get('/me/subscriptions', []);
  api.get('/me/addresses', []);
  api.get('/orders', ({ call }) => {
    const q = (call.query.get('q') ?? '').trim().toLowerCase();
    const all = [deliveredOrder(), makeOrder({ code: SHIPPING_CODE, status: 'SHIPPING' })];
    const data = q ? all.filter((o) => o.code.toLowerCase().includes(q) || o.items.some((i) => i.productName.toLowerCase().includes(q))) : all;
    return { data, meta: { page: 1, limit: 20, total: data.length } };
  });
  api.allowUnmocked('GET /coupons/available', 'GET /me/vouchers');
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const searchBox = (page: Page) => page.getByRole('searchbox', { name: 'Tìm đơn theo mã đơn hoặc tên sản phẩm' });
const cards = (page: Page) => page.getByTestId('order-card');
const queried = (api: MockApi, q: string) => api.callsTo('GET', '/orders').some((c) => c.query.get('q') === q);

for (const vp of VIEWPORTS) {
  test.describe(`Mini App ${vp.width}px: Đơn hàng, ô tìm`, () => {
    test.use({ viewport: vp });

    test('ô tìm nằm dưới tab trạng thái và trên danh sách, khung từ 44px, trong màn, không tràn ngang', async ({ page, api }) => {
      mockOrders(api);
      await page.goto('/orders');
      await expect(cards(page)).toHaveCount(2, { timeout: 20_000 });

      await expect(searchBox(page)).toHaveAttribute('placeholder', 'Mã đơn hoặc tên sản phẩm');
      const tabs = (await page.getByRole('tablist').boundingBox())!;
      const box = (await page.getByTestId('search-field-box').boundingBox())!;
      const first = (await cards(page).first().boundingBox())!;
      expect(tabs.y + tabs.height).toBeLessThanOrEqual(box.y + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(first.y + 1);
      expect(box.height, 'chiều cao khung ô tìm').toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('Enter gửi từ khoá cho API, chỉ đơn khớp còn lại và kệ Mua lại ẩn khi đang tìm', async ({ page, api }) => {
      mockOrders(api);
      await page.goto('/orders');
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
      await page.goto('/orders');
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
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
      await clear.click();
      await expect(cards(page)).toHaveCount(2);
      await expect(searchBox(page)).toHaveValue('');
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  });
}
