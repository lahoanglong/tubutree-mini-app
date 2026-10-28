import { expect, makeUser, mockSession, test, type MockApi } from './support/mock-api';

/**
 * Web khách, trang Yêu thích: nút giỏ nhanh trên thẻ (như Mini App). Một phân loại thêm thẳng, nhiều phân loại
 * mở bảng chọn, thẻ hết hàng không có nút. Lời gọi /api/** từ trình duyệt đi qua mock; host phải là localhost.
 */

const card = (n: number, over: Record<string, unknown> = {}) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 100000 + n,
  salePrice: null, isFeatured: false, inStock: true, ...over,
});
const variation = (id: string, name: string) => ({ id, sku: id, name, attributes: {}, retailPrice: 101000, salePrice: null, stock: 8 });
const CART = { items: [], subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 1, couponCode: null };

function mockWishlist(api: MockApi, variations: ReturnType<typeof variation>[]) {
  mockSession(api, makeUser({ id: 'u1', fullName: 'Nguyễn Văn An' }));
  api.get('/flash-sales/active', []);
  api.get('/me/wishlist', [card(1), card(2, { inStock: false })]);
  api.get('/me/wishlist/ids', ['p1', 'p2']);
  api.get('/products/:slug', { ...card(1), images: [], description: '', shortDesc: null, certifications: [], variations });
  api.post('/cart/items', CART);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
});

test.describe('Web: yêu thích, nút giỏ nhanh', () => {
  test('chỉ thẻ còn hàng có nút 44px; một phân loại thì thêm thẳng với nguồn wishlist', async ({ page, api }) => {
    mockWishlist(api, [variation('var-1', '500ml')]);
    await page.goto('/tai-khoan/yeu-thich');
    const btn = page.getByRole('button', { name: 'Thêm Sản phẩm 1 vào giỏ' });
    await expect(btn).toBeVisible();
    await expect(page.getByRole('button', { name: 'Thêm Sản phẩm 2 vào giỏ' })).toHaveCount(0);
    await expect(page.getByText('Hết hàng')).toBeVisible();
    const box = (await btn.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);

    const posted = api.waitForCall('POST', '/cart/items');
    await btn.click();
    expect((await posted).body).toMatchObject({ variationId: 'var-1', quantity: 1, addSource: 'wishlist' });
    await expect(page.getByRole('status').filter({ hasText: 'Đã thêm vào giỏ' })).toBeVisible();
    await expect(page).toHaveURL(/\/tai-khoan\/yeu-thich/);
  });

  test('nhiều phân loại: mở bảng chọn phân loại, chỉ thêm khi xác nhận', async ({ page, api }) => {
    mockWishlist(api, [variation('var-1', '250ml'), variation('var-2', '500ml')]);
    await page.goto('/tai-khoan/yeu-thich');
    await page.getByRole('button', { name: 'Thêm Sản phẩm 1 vào giỏ' }).click();
    await expect(page.getByRole('dialog', { name: 'Chọn phân loại' })).toBeVisible();
    expect(api.callsTo('POST', '/cart/items')).toHaveLength(0);

    await page.getByRole('button', { name: '500ml' }).click();
    const posted = api.waitForCall('POST', '/cart/items');
    await page.getByRole('button', { name: /^Thêm vào giỏ/ }).click();
    expect((await posted).body).toMatchObject({ variationId: 'var-2', quantity: 1, addSource: 'wishlist' });
  });
});
