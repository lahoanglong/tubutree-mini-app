import { test, expect } from './support/mock-api';
import { mockPilotProduct, PILOT_PRODUCT, PILOT_PRODUCT_NAME, PILOT_SLUG } from './support/pilot-mocks';
import { expectChipMetrics } from './support/variation-chip';

/**
 * Mini App, trang sản phẩm: mua quá giới hạn Giờ vàng mỗi khách thì máy chủ tính CẢ dòng giá thường (flash-line-price.ts), nên nút Mua ngay,
 * Thêm vào giỏ và tổng trong bảng chọn phân loại phải ghi đúng số đó chứ không phải qty × giá Giờ vàng. API mock toàn bộ.
 * Số của báo cáo extra-critique-2 P1 #1: giá thường 35.000đ, giá Giờ vàng 26.000đ, giới hạn 3.
 */

test.use({ viewport: { width: 375, height: 812 } });

const HOUR = 3_600_000;
const OVER_5 = 'Giá Giờ vàng tối đa 3 sản phẩm mỗi khách. Mua 5 thì cả dòng tính giá thường.';
const OVER_4 = 'Giá Giờ vàng tối đa 3 sản phẩm mỗi khách. Mua 4 thì cả dòng tính giá thường.';

const VARIATIONS = [
  { id: 'var-1', sku: 'KU-80', name: 'Gói 80 tờ', attributes: {}, retailPrice: 35_000, salePrice: null, stock: 245 },
  { id: 'var-2', sku: 'KU-3', name: 'Combo 3 gói', attributes: {}, retailPrice: 90_000, salePrice: null, stock: 0 },
];

function mockPage(api: Parameters<typeof mockPilotProduct>[0]) {
  mockPilotProduct(api);
  api.get('/products/:slug', { ...PILOT_PRODUCT, variations: VARIATIONS });
  api.get('/flash-sales/active', () => {
    const now = Date.now();
    return [
      {
        itemId: 'fi-1', variationId: 'var-1', productSlug: PILOT_SLUG, productName: PILOT_PRODUCT_NAME, variationName: 'Gói 80 tờ', thumbnail: null,
        flashPrice: 26_000, retailPrice: 35_000, salePrice: null, soldCount: 10, quota: 100, perUserLimit: 3,
        endAt: new Date(now + 3 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
      },
    ];
  });
}

test.describe('Mini App — giá Giờ vàng ở bảng chọn phân loại và nút mua', () => {
  test('bảng "Mua ngay": nút ghi đúng tiền máy chủ tính ở qty 3, 4, 5; ghi chú hiện khi vượt và ô Số lượng không nhảy', async ({ page, api }) => {
    mockPage(api);
    await page.goto(`/product/${PILOT_SLUG}`);
    await expect(page.getByTestId('flash-price-bar')).toBeVisible({ timeout: 15_000 });
    await expectChipMetrics(page.getByRole('group', { name: 'Phân loại nhanh' }).getByRole('button').first());
    await page.getByRole('button', { name: /^Mua ngay/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Chọn phân loại' });
    await expect(dialog).toBeVisible();

    // Phần đầu bảng nói rõ giá đang là Giờ vàng: nhãn, giới hạn, giá màu deal.
    await expect(dialog.getByTestId('variation-sheet-flash')).toContainText('Giờ vàng');
    await expect(dialog.getByTestId('variation-sheet-flash')).toContainText('Tối đa 3/khách');
    await expect(dialog.getByText('Tối đa 3 sản phẩm mỗi khách')).toHaveCount(1);
    await expect(dialog.getByTestId('variation-sheet-price').getByText('26.000đ')).toHaveCSS('color', 'rgb(154, 82, 0)');

    // Chip hết hàng có chữ, không chỉ gạch ngang; chip Giờ vàng có giá.
    await expect(dialog.getByRole('button', { name: /Combo 3 gói/ })).toContainText('Tạm hết hàng');
    await expect(dialog.getByRole('button', { name: /Gói 80 tờ/ })).toContainText('26.000đ');
    // Cùng số đo với chip web khổ 375px (flash-sheet-price.web.spec.ts).
    await expectChipMetrics(dialog.getByRole('button', { name: /Gói 80 tờ/ }));

    const buy = dialog.getByRole('button', { name: /^Mua ngay · / });
    const plus = dialog.getByRole('button', { name: 'Tăng số lượng' });
    const note = dialog.getByRole('status');
    await expect(buy).toHaveText('Mua ngay · 26.000đ');
    await plus.click();
    await plus.click();
    await expect(buy).toHaveText('Mua ngay · 78.000đ');
    await expect(note).toHaveText('');
    const before = (await plus.boundingBox())!;

    await plus.click();
    await expect(buy).toHaveText('Mua ngay · 140.000đ');
    await expect(note).toHaveText(OVER_4);
    const after = (await plus.boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);

    await plus.click();
    await expect(buy).toHaveText('Mua ngay · 175.000đ');
    await expect(note).toHaveText(OVER_5);
  });

  test('Thêm vào giỏ từ bảng ở qty 5: nút ghi 175.000đ và gửi đúng số lượng 5 (không chặn số lượng)', async ({ page, api }) => {
    mockPage(api);
    await page.goto(`/product/${PILOT_SLUG}`);
    await expect(page.getByTestId('flash-price-bar')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Thêm vào giỏ', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Chọn phân loại' });
    for (let i = 0; i < 4; i += 1) await dialog.getByRole('button', { name: 'Tăng số lượng' }).click();
    const add = dialog.getByRole('button', { name: /^Thêm vào giỏ · / });
    await expect(add).toHaveText('Thêm vào giỏ · 175.000đ');
    const posted = api.waitForCall('POST', '/cart/items');
    await add.click();
    expect((await posted).body).toMatchObject({ variationId: 'var-1', quantity: 5 });
  });

  test('trang sản phẩm (ngoài bảng): nút Mua ngay ở thanh dưới ghi cùng số và có ghi chú dưới ô Số lượng', async ({ page, api }) => {
    mockPage(api);
    await page.goto(`/product/${PILOT_SLUG}`);
    await expect(page.getByTestId('flash-price-bar')).toBeVisible({ timeout: 15_000 });
    const plus = page.getByRole('button', { name: 'Tăng số lượng' });
    for (let i = 0; i < 4; i += 1) await plus.click();
    await expect(page.getByRole('button', { name: /^Mua ngay · / })).toHaveAccessibleName('Mua ngay · 175.000đ');
    await expect(page.getByText(OVER_5)).toBeVisible();
    await page.getByRole('button', { name: 'Giảm số lượng' }).click();
    await page.getByRole('button', { name: 'Giảm số lượng' }).click();
    await expect(page.getByRole('button', { name: /^Mua ngay · / })).toHaveAccessibleName('Mua ngay · 78.000đ');
    await expect(page.getByText(/cả dòng tính giá thường/)).toHaveCount(0);
  });
});
