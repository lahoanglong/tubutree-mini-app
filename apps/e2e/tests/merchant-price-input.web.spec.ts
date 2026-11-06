import type { Page } from '@playwright/test';
import { expect, reply, test, type MockApi } from './support/mock-api';

/**
 * Form đăng/sửa sản phẩm của đối tác (trang /merchant): người Việt gõ giá có dấu chấm ngăn nghìn ("120.000", "5.000") thì giá gửi lên API
 * phải là 120000 và 5000, không bị đọc thành 120 hay 5 như ô type=number. Giá sai thì báo lỗi ngay, không gửi. API mock toàn bộ.
 */
const DEALER = {
  id: 'd1', fullName: 'Đối tác An', referralCode: 'AN123', phone: '0912345678', role: 'DEALER',
  pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};

const STORE = {
  id: 's1', type: 'MERCHANT', isPartner: true, slug: 'gian-hang-an', title: 'Gian hàng An', theme: 'forest',
  isPublished: true, ordersPausedAt: null,
};

const PRODUCTS_EMPTY = { ownProducts: [], resellProducts: [], meta: { page: 1, limit: 20, ownTotal: 0, resellTotal: 0 } };

async function openCreateModal(page: Page, api: MockApi): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
  api.post('/auth/refresh', { accessToken: 'e2e-token', user: DEALER });
  api.get('/me', DEALER);
  api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 0, itemCount: 0 });
  api.get('/merchant/store', STORE);
  api.get('/merchant/products', PRODUCTS_EMPTY);
  api.allowUnmocked('GET /merchant/orders', 'GET /merchant/fulfil-orders', 'GET /flash-sales/active', 'GET /me/coupons', 'GET /me/wishlist/ids');
  await page.goto('/merchant?tab=products');
  await page.getByRole('button', { name: /Đăng sản phẩm mới/ }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 });
}

async function fill(page: Page, price: string): Promise<void> {
  await page.locator('#merchant-product-name').fill('Bột giặt sinh học');
  await page.locator('#merchant-product-description').fill('Bột giặt từ bồ hòn, an toàn cho da nhạy cảm');
  await page.locator('#merchant-product-price').fill(price);
  await page.locator('#merchant-product-stock').fill('5');
}

const send = (page: Page) => page.getByRole('button', { name: 'Gửi kiểm duyệt' }).click();

test.describe('Đối tác: ô giá nhận dấu chấm ngăn nghìn', () => {
  for (const [typed, sent] of [
    ['120.000', 120000],
    ['5.000', 5000],
    ['1.250.000', 1250000],
    ['120000', 120000],
  ] as const) {
    test(`gõ "${typed}" → gửi basePrice ${sent}`, async ({ page, api }) => {
      api.post('/merchant/products', ({ call }) => ({ id: 'p1', ...(call.body as object) }));
      await openCreateModal(page, api);
      await fill(page, typed);
      await send(page);
      await expect.poll(() => api.callsTo('POST', '/merchant/products').length).toBe(1);
      expect(api.callsTo('POST', '/merchant/products')[0]!.body).toMatchObject({ basePrice: sent, stock: 5, name: 'Bột giặt sinh học' });
    });
  }

  for (const [typed, message] of [
    ['5', 'Giá bán tối thiểu 1.000đ.'],
    ['12.5', 'Nhập giá bằng số đồng, ví dụ 120.000 hoặc 120000.'],
    ['100.000.001', 'Giá bán tối đa 100.000.000đ.'],
  ] as const) {
    test(`gõ "${typed}" → báo "${message}", không gửi`, async ({ page, api }) => {
      api.post('/merchant/products', () => reply(500, { message: 'không được gọi' }));
      await openCreateModal(page, api);
      await fill(page, typed);
      await send(page);
      await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(message);
      expect(api.callsTo('POST', '/merchant/products')).toHaveLength(0);
    });
  }

  test('ô giá là ô văn bản có gợi ý cách gõ (type=number nuốt "120.000" thành 120)', async ({ page, api }) => {
    await openCreateModal(page, api);
    const input = page.locator('#merchant-product-price');
    await expect(input).toHaveAttribute('type', 'text');
    await expect(input).toHaveAttribute('inputmode', 'numeric');
    await expect(page.locator('#merchant-product-price-hint')).toContainText('120.000');
  });
});
