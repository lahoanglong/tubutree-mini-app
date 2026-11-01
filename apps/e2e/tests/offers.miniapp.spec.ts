import type { Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { CATALOG, mockDiscovery, mockHomeEngagement } from './support/discovery-mocks';
import { mockNoSession } from './support/flash-slot-mocks';
import { COLLECTABLE, mockCollectable, mockWallet } from './support/voucher-mocks';

/**
 * Zalo Mini App E2E — Ưu đãi (/offers) theo thứ tự Q10: Banner, Giờ vàng hôm nay, Nhận mã, dải Điểm Xanh, Mã của tôi, Đổi quà.
 * Ba khối đầu công khai: khách chưa đăng nhập xem được, "Lưu mã" mở đăng nhập và KHÔNG gọi /coupons/claim. API mock toàn bộ.
 */
test.use({ viewport: { width: 375, height: 812 } });

const HOUR = 3_600_000;

function mockFlash(api: MockApi): void {
  api.get('/flash-sales/active', () => {
    const now = Date.now();
    return CATALOG.slice(4, 7).map((p, i) => ({
      itemId: `fi-${p.id}`, variationId: `v-${p.id}`, productSlug: p.slug, productName: p.name, variationName: null, thumbnail: p.thumbnail,
      flashPrice: 59_000 + i * 1_000, retailPrice: p.basePrice, salePrice: p.salePrice, soldCount: 10 + i, quota: 50,
      endAt: new Date(now + 3 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
    }));
  });
}

const regionTop = async (page: Page, name: string, exact = true) => (await page.getByRole('region', { name, exact }).boundingBox())!.y;

test.describe('Ưu đãi — khách chưa đăng nhập', () => {
  test('thấy Giờ vàng và Nhận mã; bấm Lưu mã mở đăng nhập, không gọi claim', async ({ page, api }) => {
    mockNoSession(api);
    mockFlash(api);
    mockCollectable(api);
    await page.goto('/offers');
    await expect(page.getByRole('region', { name: 'Giờ vàng hôm nay', exact: true })).toBeVisible({ timeout: 15_000 });
    const collect = page.getByRole('region', { name: 'Nhận mã', exact: true });
    await expect(collect).toBeVisible();
    const save = collect.getByRole('button', { name: 'Lưu mã' });
    await expect(save).toHaveCount(3);
    // Phần cần tài khoản không dựng cho khách.
    await expect(page.getByRole('region', { name: 'Điểm Xanh của bạn' })).toHaveCount(0);

    const authCalls = () => api.callsTo('POST', '/auth/guest').length + api.callsTo('POST', '/auth/zalo-mini-app').length;
    await expect.poll(authCalls, { timeout: 10_000 }).toBeGreaterThan(0);
    const before = authCalls();
    // Chạm lúc phiên còn đang khôi phục bị bỏ qua: bấm lại tới khi app đã ở trạng thái khách và mở đăng nhập.
    await expect(async () => {
      await save.first().click();
      expect(authCalls()).toBeGreaterThan(before);
    }).toPass({ timeout: 10_000 });
    expect(api.callsTo('POST', '/coupons/claim')).toHaveLength(0);
  });

  test('kho mã rỗng: không có khối Nhận mã', async ({ page, api }) => {
    mockNoSession(api);
    mockFlash(api);
    mockCollectable(api, []);
    await page.goto('/offers');
    await expect(page.getByRole('region', { name: 'Giờ vàng hôm nay', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => api.callsTo('GET', '/coupons/collectable').length, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect(page.getByRole('region', { name: 'Nhận mã', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('offers-collect-loading')).toHaveCount(0);
  });
});

test.describe('Ưu đãi — khách đã đăng nhập', () => {
  test.beforeEach(({ api }) => {
    mockDiscovery(api, { returning: true });
    mockHomeEngagement(api);
    mockFlash(api);
    mockCollectable(api);
    mockWallet(api);
  });

  test('thứ tự khối: Giờ vàng, Nhận mã, Điểm Xanh, Mã của tôi, Đổi quà', async ({ page }) => {
    await page.goto('/offers');
    await expect(page.getByRole('region', { name: 'Mã của tôi', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Nhận mã', exact: true })).toBeVisible();
    const ys = [
      await regionTop(page, 'Giờ vàng hôm nay'),
      await regionTop(page, 'Nhận mã'),
      await regionTop(page, 'Điểm Xanh của bạn'),
      await regionTop(page, 'Mã của tôi'),
      await regionTop(page, 'Đổi quà'),
    ];
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  test('ví 8 mã: Mã của tôi chỉ xếp 3 phiếu, nút "Tất cả (8)" mở trang Mã giảm giá tab Mã của tôi', async ({ page, api }) => {
    const DAY = 86_400_000;
    mockWallet(
      api,
      Array.from({ length: 8 }, (_, i) => ({ code: `MA${i}`, title: null, type: 'AMOUNT' as const, value: 10_000 * (i + 1), minOrder: 100_000, maxDiscount: null, endAt: new Date(Date.now() + (i + 3) * DAY).toISOString() })),
    );
    await page.goto('/offers');
    const mine = page.getByRole('region', { name: 'Mã của tôi', exact: true });
    await expect(mine.getByRole('group')).toHaveCount(3, { timeout: 15_000 });
    const all = mine.getByRole('button', { name: 'Xem tất cả Mã của tôi' });
    await expect(all).toHaveText('Tất cả (8)');
    await all.click();
    await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe('/vouchers?tab=mine');
  });

  test('Điểm danh gọn ở 375px: thẻ thấp (luật gập sẵn), mở luật bằng một chạm rồi gập lại', async ({ page }) => {
    await page.goto('/offers');
    const card = page.getByTestId('daily-check-in');
    await expect(card).toBeVisible({ timeout: 15_000 });
    const h = Math.round((await card.boundingBox())!.height);
    expect(h, `thẻ điểm danh cao ${h}px`).toBeLessThanOrEqual(170);
    const toggle = card.getByRole('button', { name: 'Luật điểm danh' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(card.getByText(/Một lần bấm nhận cả Điểm Xanh/)).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(card.getByText(/Một lần bấm nhận cả Điểm Xanh/)).toBeVisible();
    await toggle.click();
    await expect(card.getByText(/Một lần bấm nhận cả Điểm Xanh/)).toBeHidden();
  });

  test('mã đã có trong ví không chiếm chỗ ở Nhận mã; Lưu mã gọi POST /coupons/claim đúng mã', async ({ page, api }) => {
    api.post('/coupons/claim', ({ call }) => {
      const code = (call.body as { code: string }).code;
      const c = COLLECTABLE.find((x) => x.code === code)!;
      return { code: c.code, type: c.type, value: c.value, minOrder: c.minOrder, maxDiscount: c.maxDiscount, endAt: c.endAt, newCustomerOnly: false, alreadyClaimed: false };
    });
    await page.goto('/offers');
    const collect = page.getByRole('region', { name: 'Nhận mã', exact: true });
    await expect(collect).toBeVisible({ timeout: 15_000 });
    // KM30K đã nằm trong ví (voucher-mocks) nên chỉ còn hai mã nhận được.
    const save = collect.getByRole('button', { name: 'Lưu mã' });
    await expect(save).toHaveCount(2);
    await save.first().click();
    await expect.poll(() => api.callsTo('POST', '/coupons/claim').length).toBe(1);
    expect(api.callsTo('POST', '/coupons/claim')[0]!.body).toEqual({ code: 'FS99' });
  });

  test('"Tất cả N mã" và "Xem tất cả" của Mã của tôi dẫn tới trang Mã giảm giá', async ({ page }) => {
    await page.goto('/offers');
    await page.getByRole('button', { name: 'Xem tất cả Mã giảm giá' }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/vouchers');
    await page.goBack();
    await page.getByRole('button', { name: 'Xem tất cả Mã của tôi' }).click();
    await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe('/vouchers?tab=mine');
  });
});
