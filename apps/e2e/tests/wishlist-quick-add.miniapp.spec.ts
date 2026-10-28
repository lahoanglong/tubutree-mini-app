import { test, expect } from './support/mock-api';
import { mockPilotProduct, PILOT_PRODUCT, PILOT_PRODUCT_NAME, PILOT_SLUG } from './support/pilot-mocks';

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
});
