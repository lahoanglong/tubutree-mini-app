import { test, expect } from './support/mock-api';
import { mockPilotProduct, PILOT_CART, PILOT_PRODUCT, PILOT_PRODUCT_NAME, PILOT_SLUG } from './support/pilot-mocks';
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
const IN_CART_2 = 'Giỏ đã có 2. Thêm 2 thì cả 4 sản phẩm tính giá thường.';
const MERGE_2 = 'Giỏ đã có 2: Mua ngay thanh toán cả 3 sản phẩm.';
const SPENT = 'Bạn không còn suất Giờ vàng của sản phẩm này nên tính giá thường.';

const VARIATIONS = [
  { id: 'var-1', sku: 'KU-80', name: 'Gói 80 tờ', attributes: {}, retailPrice: 35_000, salePrice: null, stock: 245 },
  { id: 'var-2', sku: 'KU-3', name: 'Combo 3 gói', attributes: {}, retailPrice: 90_000, salePrice: null, stock: 0 },
];

/** Giỏ đã có `quantity` sản phẩm của `var-1` (giá Giờ vàng trong giỏ nếu chưa vượt suất); thêm giỏ cộng dồn và máy chủ giá cả dòng. */
function cartWith(quantity: number) {
  return { ...PILOT_CART, items: [{ ...PILOT_CART.items[0]!, variationId: 'var-1', variationName: 'Gói 80 tờ', unitPrice: 26_000, quantity, stock: 245, total: 26_000 * quantity }], subtotal: 26_000 * quantity, itemCount: quantity };
}

/** Số suất khách còn mua được ở đơn trước (`perUserLeft` của suất `fi-1`); `delayMs` cho số về muộn. Không truyền thì như API cũ (không có số). */
type Allowance = { perUserLeft: number; delayMs?: number };

function mockPage(api: Parameters<typeof mockPilotProduct>[0], inCart = 0, allowance?: Allowance) {
  mockPilotProduct(api);
  if (allowance) {
    api.get('/flash-sales/me/allowance', async () => {
      if (allowance.delayMs) await new Promise((r) => setTimeout(r, allowance.delayMs));
      return { items: { 'fi-1': { perUserLeft: allowance.perUserLeft, allowance: Math.min(allowance.perUserLeft, 90) } } };
    });
  }
  if (inCart > 0) api.get('/cart', cartWith(inCart));
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
    await expect(page.getByRole('button', { name: /^Mua ngay / })).toHaveAccessibleName('Mua ngay 175.000đ');
    await expect(page.getByText(OVER_5)).toBeVisible();
    await page.getByRole('button', { name: 'Giảm số lượng' }).click();
    await page.getByRole('button', { name: 'Giảm số lượng' }).click();
    await expect(page.getByRole('button', { name: /^Mua ngay / })).toHaveAccessibleName('Mua ngay 78.000đ');
    await expect(page.getByText(/cả dòng tính giá thường/)).toHaveCount(0);
  });

  test('giỏ đã có 2 gói var-1 (giới hạn 3): bảng "Mua ngay" ghi cả dòng 140.000đ, "Thêm vào giỏ" ghi giỏ tăng 88.000đ, ghi chú nói theo giỏ và ô Số lượng không nhảy', async ({ page, api }) => {
    mockPage(api, 2);
    await page.goto(`/product/${PILOT_SLUG}`);
    await expect(page.getByTestId('flash-price-bar')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^Mua ngay/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Chọn phân loại' });
    await expect(dialog).toBeVisible();
    const buy = dialog.getByRole('button', { name: /^Mua ngay · / });
    const plus = dialog.getByRole('button', { name: 'Tăng số lượng' });
    const note = dialog.getByRole('status');
    // Giỏ có 2 + chọn 1 = 3 = giới hạn: còn giá Giờ vàng cho cả dòng.
    await expect(buy).toHaveText('Mua ngay · 78.000đ');
    await expect(note).toHaveText(MERGE_2);
    const before = (await plus.boundingBox())!;
    await plus.click();
    await expect(buy).toHaveText('Mua ngay · 140.000đ');
    await expect(note).toHaveText(IN_CART_2);
    const after = (await plus.boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  });

  test('giỏ đã có 2 gói var-1: bảng "Thêm vào giỏ" ghi 88.000đ (giỏ tăng thật) và gửi đúng số lượng 2 vừa chọn', async ({ page, api }) => {
    mockPage(api, 2);
    await page.goto(`/product/${PILOT_SLUG}`);
    await expect(page.getByTestId('flash-price-bar')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Thêm vào giỏ', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Chọn phân loại' });
    await dialog.getByRole('button', { name: 'Tăng số lượng' }).click();
    const add = dialog.getByRole('button', { name: /^Thêm vào giỏ · / });
    await expect(add).toHaveText('Thêm vào giỏ · 88.000đ');
    const posted = api.waitForCall('POST', '/cart/items');
    await add.click();
    expect((await posted).body).toMatchObject({ variationId: 'var-1', quantity: 2 });
  });

  test('giỏ đã có 2 gói var-1: nút Mua ngay ở thanh dưới ghi cả dòng sau khi chọn thêm 2, ghi chú dưới ô Số lượng nói theo giỏ', async ({ page, api }) => {
    mockPage(api, 2);
    await page.goto(`/product/${PILOT_SLUG}`);
    await expect(page.getByTestId('flash-price-bar')).toBeVisible({ timeout: 15_000 });
    const buy = page.getByRole('button', { name: /^Mua ngay / });
    await expect(buy).toHaveAccessibleName('Mua ngay 78.000đ');
    await expect(page.getByText(MERGE_2)).toBeVisible();
    await page.getByRole('button', { name: 'Tăng số lượng' }).click();
    await expect(buy).toHaveAccessibleName('Mua ngay 140.000đ');
    await expect(page.getByText(IN_CART_2)).toBeVisible();
  });
  test('khách đã dùng hết suất Giờ vàng ở đơn trước (perUserLeft 0): bảng "Mua ngay" và "Thêm vào giỏ" ghi giá thường 35.000đ kèm ghi chú, chỉ một request cho cả lần đổi số lượng', async ({ page, api }) => {
    mockPage(api, 0, { perUserLeft: 0 });
    await page.goto(`/product/${PILOT_SLUG}`);
    await expect(page.getByTestId('flash-price-bar')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^Mua ngay/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Chọn phân loại' });
    await expect(dialog).toBeVisible();
    const buy = dialog.getByRole('button', { name: /^Mua ngay · / });
    await expect(buy).toHaveText('Mua ngay · 35.000đ');
    await expect(dialog.getByRole('status')).toHaveText(SPENT);
    await dialog.getByRole('button', { name: 'Tăng số lượng' }).click();
    await expect(buy).toHaveText('Mua ngay · 70.000đ');
    expect(api.callsTo('GET', '/flash-sales/me/allowance')).toHaveLength(1);
    await dialog.getByRole('button', { name: 'Đóng' }).click();
    // Ngoài bảng: thanh dưới và ghi chú dưới ô Số lượng cùng số.
    await expect(page.getByRole('button', { name: /^Mua ngay / })).toHaveAccessibleName('Mua ngay 35.000đ');
    await expect(page.getByText(SPENT).first()).toBeVisible();
  });

  test('còn 1 suất (đã mua 2 trên giới hạn 3): chọn 1 vẫn 26.000đ, chọn 2 cả dòng giá thường 70.000đ kèm "Bạn còn 1 suất"', async ({ page, api }) => {
    mockPage(api, 0, { perUserLeft: 1 });
    await page.goto(`/product/${PILOT_SLUG}`);
    await expect(page.getByTestId('flash-price-bar')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Thêm vào giỏ', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Chọn phân loại' });
    const add = dialog.getByRole('button', { name: /^Thêm vào giỏ · / });
    await expect(add).toHaveText('Thêm vào giỏ · 26.000đ');
    await expect(dialog.getByRole('status')).toHaveText('');
    await dialog.getByRole('button', { name: 'Tăng số lượng' }).click();
    await expect(add).toHaveText('Thêm vào giỏ · 70.000đ');
    await expect(dialog.getByRole('status')).toHaveText('Bạn còn 1 suất Giờ vàng. Mua 2 thì cả dòng tính giá thường.');
  });

  test('số về muộn (request chậm 2 giây): bảng đã mở, ô Số lượng không nhảy khi nút đổi sang giá thường và ghi chú hiện', async ({ page, api }) => {
    mockPage(api, 0, { perUserLeft: 0, delayMs: 2_000 });
    await page.goto(`/product/${PILOT_SLUG}`);
    await expect(page.getByTestId('flash-price-bar')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^Mua ngay/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Chọn phân loại' });
    const buy = dialog.getByRole('button', { name: /^Mua ngay · / });
    const plus = dialog.getByRole('button', { name: 'Tăng số lượng' });
    await expect(buy).toHaveText('Mua ngay · 26.000đ');
    // Bảng còn đang trượt lên lúc vừa mở: hover chờ nó đứng yên rồi mới đo vị trí.
    await plus.hover();
    const before = (await plus.boundingBox())!;
    const header = (await dialog.getByTestId('variation-sheet-price').boundingBox())!;
    await expect(buy).toHaveText('Mua ngay · 35.000đ', { timeout: 10_000 });
    await expect(dialog.getByRole('status')).toHaveText(SPENT);
    const after = (await plus.boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    expect(Math.abs((await dialog.getByTestId('variation-sheet-price').boundingBox())!.y - header.y)).toBeLessThanOrEqual(1);
  });
});
