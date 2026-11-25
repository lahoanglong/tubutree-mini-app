import type { Page } from '@playwright/test';
import { expect, makeUser, mockSession, test, type MockApi } from './support/mock-api';

/**
 * tubu-w36-01 trên Mini App, API mock toàn bộ: thẻ "Mua lại" hàng tiêu hao (tải lười) ở Cá nhân và Giỏ trống, khổ 375px.
 * Kiểm thẻ nằm gọn trong màn (không tràn ngang), một chạm gửi đúng phân loại, SL 1, nguồn `repurchase_due`, thẻ biến mất và báo "Đã thêm";
 * × ẩn đúng món đó, mở lại vẫn ẩn. Mặc định của mock-api là `{ item: null }` nên các spec khác không thấy thẻ. Đặt SHOT_DIR thì chụp thẻ.
 */
test.use({ viewport: { width: 375, height: 812 } });

const ITEM = {
  key: 'o-rd1:v-refill',
  days: 31,
  boughtName: 'Nước rửa chén Fuwa3e 500ml',
  kind: 'refill',
  variationId: 'v-refill',
  productId: 'p-refill',
  slug: 'refill-fuwa3e-1l',
  productName: 'Túi Refill nước rửa chén Fuwa3e 1L',
  variationName: '',
  thumbnail: null,
  price: 89_000,
  listPrice: 99_000,
};

const ACCOUNT_UNMOCKED = ['GET /me/wallet', 'GET /me/referral', 'GET /dealer/me', 'GET /auth/me', 'GET /me/coupons', 'GET /me/loyalty', 'GET /brand/owner/me', 'GET /chat/summary'];

function setup(api: MockApi, id: string) {
  mockSession(api, makeUser({ id, fullName: 'Nguyễn Văn An' }));
  api.get('/me/summary', { orders: { pending_payment: 0, processing: 0, shipping: 0, delivered: 1, closed: 0, active: 0 }, unreadNotifications: 0, activeSubscriptions: 0 });
  api.allowUnmocked(...ACCOUNT_UNMOCKED);
  api.get('/me/repurchase-due', { item: ITEM });
}

const card = (page: Page) => page.getByRole('region', { name: 'Gợi ý mua lại' });

async function fitsScreen(page: Page) {
  const box = await card(page).boundingBox();
  expect(box, 'thẻ phải có kích thước').not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  // Tên món thật cỡ này phải đọc trọn: tiêu đề và thân không bị cắt "…" ở 375px.
  const clipped = await card(page).locator('p').evaluateAll((els) => els.filter((e) => e.scrollHeight > e.clientHeight + 1).map((e) => e.textContent));
  expect(clipped).toEqual([]);
}

async function shot(page: Page, name: string) {
  const dir = process.env.SHOT_DIR;
  if (dir) await card(page).screenshot({ path: `${dir}/repurchase-due-miniapp-${name}.png` });
}

test.describe('Zalo Mini App E2E — thẻ Mua lại hàng tiêu hao (w36-01)', () => {
  test('Cá nhân 375px: thẻ hiện gọn, một chạm thêm gói Refill với nguồn repurchase_due, thẻ biến mất, báo "Đã thêm"', async ({ page, api }) => {
    setup(api, 'u-rd-account');
    api.post('/cart/items', { items: [], couponCode: null, subtotal: 89_000, discount: 0, freeship: false, freeshipThreshold: 200_000, itemCount: 1 });
    await page.goto('/profile');
    await expect(card(page)).toBeVisible({ timeout: 15_000 });
    await expect(card(page)).toContainText('Đã 31 ngày từ khi bạn nhận Nước rửa chén Fuwa3e 500ml');
    await expect(card(page)).toContainText('Châm lại bằng Túi Refill nước rửa chén Fuwa3e 1L');
    await expect(card(page).getByRole('button')).toHaveCount(2);
    await fitsScreen(page);
    await shot(page, 'account');

    await card(page).getByRole('button', { name: /^Thêm vào giỏ · 89\.000/ }).click();
    await expect.poll(() => api.callsTo('POST', '/cart/items').length).toBe(1);
    expect(api.callsTo('POST', '/cart/items')[0]!.body).toEqual({ variationId: 'v-refill', quantity: 1, addSource: 'repurchase_due' });
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByText('Đã thêm', { exact: true }).first()).toBeVisible();
  });

  test('Giỏ trống 375px: thẻ hiện dưới khối rỗng; × ẩn thẻ, mở lại Giỏ vẫn ẩn', async ({ page, api }) => {
    setup(api, 'u-rd-cart');
    await page.goto('/cart');
    await expect(page.getByText('Giỏ còn trống đấy')).toBeVisible({ timeout: 15_000 });
    await expect(card(page)).toBeVisible({ timeout: 15_000 });
    await fitsScreen(page);
    await shot(page, 'cart-empty');

    await card(page).getByRole('button', { name: 'Ẩn gợi ý này' }).click();
    await expect(card(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('Giỏ còn trống đấy')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => api.callsTo('GET', '/me/repurchase-due').length).toBeGreaterThan(1);
    await page.waitForTimeout(500);
    await expect(card(page)).toHaveCount(0);
  });
});
