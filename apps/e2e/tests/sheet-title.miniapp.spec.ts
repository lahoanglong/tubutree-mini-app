import { test, expect } from './support/mock-api';
import { mockPilotProduct, PILOT_PRODUCT, PILOT_PRODUCT_NAME, PILOT_SLUG } from './support/pilot-mocks';

/**
 * Mini App 375px: tiêu đề sheet là tiêu đề khối Inter 16/700 (DESIGN.md, Q1), không phải Fraunces 18px.
 * Mở sheet "Chọn phân loại" từ nút giỏ nhanh của trang Yêu thích. API mock toàn bộ. `K7_SHOTS_DIR` (+ `K7_LABEL`) bật chụp ảnh trước/sau.
 */
const card = (id: string, slug: string, name: string) => ({
  id, slug, brand: 'Tubu', name, thumbnail: null, basePrice: 65000, salePrice: null, isFeatured: false, inStock: true,
});

test.describe('Mini App: tiêu đề sheet', () => {
  test('"Chọn phân loại" là Inter 700 16px, cùng họ chữ với thân trang', async ({ page, api }) => {
    const second = { ...PILOT_PRODUCT.variations[0]!, id: 'var-2', name: 'Hương Sả', sku: 'TUBU-NRC-500-SA' };
    mockPilotProduct(api);
    api.get('/me/wishlist', [card('prod-1', PILOT_SLUG, PILOT_PRODUCT_NAME)]);
    api.get('/me/wishlist/ids', ['prod-1']);
    api.get('/products/:slug', { ...PILOT_PRODUCT, variations: [...PILOT_PRODUCT.variations, second] });
    await page.goto('/wishlist');
    await page.getByRole('button', { name: `Thêm ${PILOT_PRODUCT_NAME} vào giỏ` }).click();

    const title = page.getByRole('dialog').getByRole('heading', { name: 'Chọn phân loại' });
    await expect(title).toBeVisible({ timeout: 10_000 });
    const dir = process.env.K7_SHOTS_DIR;
    if (dir) await page.screenshot({ path: `${dir}/${process.env.K7_LABEL ?? 'run'}__mini375-variant-sheet.png` });

    const bodyFamily = await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily);
    const css = await title.evaluate((el) => {
      const s = getComputedStyle(el);
      return { family: s.fontFamily, weight: s.fontWeight, size: s.fontSize };
    });
    expect(css.family).toMatch(/Inter/);
    expect(css.family).not.toMatch(/Fraunces/);
    expect(css.weight).toBe('700');
    expect(css.size).toBe('16px');
    expect(bodyFamily).toMatch(/Inter|system-ui/);
  });
});
