import { test, expect } from './support/mock-api';
import { mockPilotProduct, PILOT_CART, PILOT_PRODUCT, PILOT_PRODUCT_NAME, PILOT_SLUG } from './support/pilot-mocks';

/**
 * Mini App, trang Yêu thích: nút giỏ nhanh trên thẻ. Một phân loại thêm thẳng, nhiều phân loại mở bảng chọn,
 * hết hàng không có nút. API mock toàn bộ.
 */

const card = (id: string, slug: string, name: string, inStock: boolean) => ({
  id, slug, brand: 'Tubu', name, thumbnail: null, basePrice: 65000, salePrice: null, isFeatured: false, inStock,
});

function mockWishlist(api: Parameters<typeof mockPilotProduct>[0], variations = PILOT_PRODUCT.variations) {
  mockPilotProduct(api);
  api.get('/me/wishlist', [card('prod-1', PILOT_SLUG, PILOT_PRODUCT_NAME, true), card('prod-2', 'xa-phong-het', 'Xà Phòng Tubu Đã Hết', false)]);
  api.get('/me/wishlist/ids', ['prod-1', 'prod-2']);
  api.get('/products/:slug', { ...PILOT_PRODUCT, variations });
}

test.describe('Mini App — Yêu thích: nút giỏ nhanh', () => {
  test('chỉ thẻ còn hàng có nút 44px; một phân loại: bấm là thêm giỏ với nguồn wishlist', async ({ page, api }) => {
    mockWishlist(api);
    await page.goto('/wishlist');
    const btn = page.getByRole('button', { name: `Thêm ${PILOT_PRODUCT_NAME} vào giỏ` });
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Thêm Xà Phòng Tubu Đã Hết vào giỏ/ })).toHaveCount(0);
    const box = (await btn.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);

    const posted = api.waitForCall('POST', '/cart/items');
    await btn.click();
    const call = await posted;
    expect(call.body).toMatchObject({ variationId: 'var-1', quantity: 1, addSource: 'wishlist' });
    await expect(page.getByText('Đã thêm vào giỏ')).toBeVisible();
    await expect(page).toHaveURL(/\/wishlist/);
  });

  test('nhiều phân loại: mở bảng "Chọn phân loại", chỉ thêm khi xác nhận', async ({ page, api }) => {
    const second = { ...PILOT_PRODUCT.variations[0]!, id: 'var-2', name: 'Hương Sả', sku: 'TUBU-NRC-500-SA' };
    mockWishlist(api, [...PILOT_PRODUCT.variations, second]);
    await page.goto('/wishlist');
    await page.getByRole('button', { name: `Thêm ${PILOT_PRODUCT_NAME} vào giỏ` }).click();
    await expect(page.getByText('Chọn phân loại')).toBeVisible({ timeout: 10_000 });
    expect(api.callsTo('POST', '/cart/items')).toHaveLength(0);

    await page.getByRole('button', { name: 'Hương Sả' }).click();
    const posted = api.waitForCall('POST', '/cart/items');
    await page.getByRole('button', { name: /^Thêm vào giỏ/ }).click();
    expect((await posted).body).toMatchObject({ variationId: 'var-2', quantity: 1, addSource: 'wishlist' });
  });

  test('Giờ vàng giới hạn 3, giỏ đã có 2 gói var-1: bảng Thêm nhanh ghi phần giỏ tăng 88.000đ (4 × 35.000 − 2 × 26.000), không phải 52.000đ', async ({ page, api }) => {
    const second = { ...PILOT_PRODUCT.variations[0]!, id: 'var-2', name: 'Hương Sả', sku: 'TUBU-NRC-500-SA' };
    const first = { ...PILOT_PRODUCT.variations[0]!, id: 'var-1', name: 'Gói 80 tờ', retailPrice: 35_000, salePrice: null, stock: 245 };
    mockWishlist(api, [first, second]);
    api.get('/me/wishlist', [{ ...card('prod-1', PILOT_SLUG, PILOT_PRODUCT_NAME, true), repVariationId: 'var-1' }]);
    api.get('/cart', {
      ...PILOT_CART,
      items: [{ ...PILOT_CART.items[0]!, variationId: 'var-1', variationName: 'Gói 80 tờ', unitPrice: 26_000, quantity: 2, stock: 245, total: 52_000 }],
      subtotal: 52_000,
      itemCount: 2,
    });
    api.get('/flash-sales/active', () => {
      const now = Date.now();
      return [
        {
          itemId: 'fi-1', variationId: 'var-1', productSlug: PILOT_SLUG, productName: PILOT_PRODUCT_NAME, variationName: 'Gói 80 tờ', thumbnail: null,
          flashPrice: 26_000, retailPrice: 35_000, salePrice: null, soldCount: 10, quota: 100, perUserLimit: 3,
          endAt: new Date(now + 3_600_000).toISOString(), serverNow: new Date(now).toISOString(),
        },
      ];
    });
    await page.goto('/wishlist');
    await page.getByRole('button', { name: `Thêm ${PILOT_PRODUCT_NAME} vào giỏ` }).click();
    const dialog = page.getByRole('dialog', { name: 'Chọn phân loại' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    const add = dialog.getByRole('button', { name: /^Thêm vào giỏ · / });
    // Giỏ 2 + chọn 1 = 3 = giới hạn: còn giá Giờ vàng cho cả dòng, giỏ tăng 26.000đ.
    await expect(add).toHaveText('Thêm vào giỏ · 26.000đ');
    await dialog.getByRole('button', { name: 'Tăng số lượng' }).click();
    await expect(add).toHaveText('Thêm vào giỏ · 88.000đ');
    await expect(dialog.getByRole('status')).toHaveText('Giỏ đã có 2. Thêm 2 thì cả 4 sản phẩm tính giá thường.');
  });
  test('Giờ vàng, khách đã dùng hết suất ở đơn trước (perUserLeft 0): bảng Thêm nhanh ghi giá thường 35.000đ kèm ghi chú', async ({ page, api }) => {
    const second = { ...PILOT_PRODUCT.variations[0]!, id: 'var-2', name: 'Hương Sả', sku: 'TUBU-NRC-500-SA' };
    const first = { ...PILOT_PRODUCT.variations[0]!, id: 'var-1', name: 'Gói 80 tờ', retailPrice: 35_000, salePrice: null, stock: 245 };
    mockWishlist(api, [first, second]);
    api.get('/me/wishlist', [{ ...card('prod-1', PILOT_SLUG, PILOT_PRODUCT_NAME, true), repVariationId: 'var-1' }]);
    api.get('/flash-sales/active', () => {
      const now = Date.now();
      return [
        {
          itemId: 'fi-1', variationId: 'var-1', productSlug: PILOT_SLUG, productName: PILOT_PRODUCT_NAME, variationName: 'Gói 80 tờ', thumbnail: null,
          flashPrice: 26_000, retailPrice: 35_000, salePrice: null, soldCount: 10, quota: 100, perUserLimit: 3,
          endAt: new Date(now + 3_600_000).toISOString(), serverNow: new Date(now).toISOString(),
        },
      ];
    });
    api.get('/flash-sales/me/allowance', { items: { 'fi-1': { perUserLeft: 0, allowance: 0 } } });
    await page.goto('/wishlist');
    await page.getByRole('button', { name: `Thêm ${PILOT_PRODUCT_NAME} vào giỏ` }).click();
    const dialog = page.getByRole('dialog', { name: 'Chọn phân loại' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByRole('button', { name: /^Thêm vào giỏ · / })).toHaveText('Thêm vào giỏ · 35.000đ');
    await expect(dialog.getByRole('status')).toHaveText('Bạn không còn suất Giờ vàng của sản phẩm này nên tính giá thường.');
  });
});
