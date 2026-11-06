import { test, expect, makeOrder, reply } from './support/mock-api';
import { mockBuyFlowSession, mockOrdersTab, THUMB } from './support/buy-flow-mocks';
import { mockPilotCart, mockPilotProduct, PILOT_CART, PILOT_PRODUCT, PILOT_SLUG } from './support/pilot-mocks';

/**
 * Zalo Mini App E2E (W29): bộ chọn số lượng không lộ tồn trên 20 (luật Smart Stock).
 * Tồn 1–20 đã in "Chỉ còn n" nên nút + khoá ở đúng tồn. Tồn cao hơn thì nút + không khoá ở tồn (khách bấm tới khi khoá là đọc ra tồn thật);
 * máy chủ từ chối phần vượt bằng câu không có số, dòng vượt tồn kéo về 20 chứ không về sát tồn, Mua lại không kẹp theo tồn đó.
 */
const OVER = 'Số lượng này vượt số hàng đang có.';
const overReply = reply(400, { statusCode: 400, message: OVER, error: 'Bad Request' });
const withStock = (stock: number) => ({ ...PILOT_PRODUCT, variations: [{ ...PILOT_PRODUCT.variations[0]!, stock }] });
const cartWith = (quantity: number, stock: number) => ({
  ...PILOT_CART,
  items: [{ ...PILOT_CART.items[0]!, quantity, stock, total: quantity * 65000 }],
  subtotal: quantity * 65000,
  itemCount: quantity,
});
/** Có phần tử nào trên trang ghi đúng con số tồn (đứng riêng, không phải một phần của số khác). */
const showsNumber = (n: number) => new RegExp(`(^|[^\\d.])${n}([^\\d.]|$)`);

test.describe('Zalo Mini App E2E - bộ chọn số lượng không lộ tồn trên 20 (W29)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
  });

  test('PDP tồn 25: nút + qua được 25, không có chữ số tồn; thêm giỏ bị máy chủ từ chối thì báo câu không có số', async ({ page, api }) => {
    mockPilotProduct(api);
    api.get('/products/:slug', withStock(25));
    api.post('/cart/items', overReply);
    await page.goto(`/product/${PILOT_SLUG}`);

    const plus = page.getByRole('button', { name: 'Tăng số lượng' });
    await expect(plus).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Còn hàng', { exact: true }).first()).toBeVisible();
    for (let i = 0; i < 25; i++) await plus.click();
    await expect(plus.locator('..')).toContainText('26');
    await expect(plus).toHaveAttribute('aria-disabled', 'false');
    await expect(page.locator('body')).not.toContainText(showsNumber(25));

    const posted = api.waitForCall('POST', '/cart/items');
    await page.getByRole('button', { name: /^Thêm vào giỏ/ }).first().click();
    expect((await posted).body).toMatchObject({ variationId: 'var-1', quantity: 26 });
    await expect(page.getByText(OVER)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(showsNumber(25));
  });

  test('PDP tồn 5: nút + khoá ở 5, ghi "Chỉ còn 5 sản phẩm"', async ({ page, api }) => {
    mockPilotProduct(api);
    api.get('/products/:slug', withStock(5));
    await page.goto(`/product/${PILOT_SLUG}`);

    const plus = page.getByRole('button', { name: 'Tăng số lượng' });
    await expect(plus).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Chỉ còn 5 sản phẩm').first()).toBeVisible();
    for (let i = 0; i < 4; i++) await plus.click();
    await expect(plus.locator('..')).toContainText('5');
    await expect(plus).toHaveAttribute('aria-disabled', 'true');
  });

  test('giỏ: dòng 25/25 tồn 25 bấm + gửi 26, máy chủ từ chối thì báo câu không có số và về lại 25; không có câu "đã chọn hết"', async ({ page, api }) => {
    mockPilotCart(api);
    api.get('/cart', cartWith(25, 25));
    api.patch('/cart/items/:id', overReply);
    await page.goto('/cart');

    const line = page.getByTestId('cart-line');
    await expect(line).toHaveCount(1, { timeout: 15_000 });
    const plus = line.getByRole('button', { name: 'Tăng số lượng' });
    await expect(plus).toHaveAttribute('aria-disabled', 'false');
    await expect(line).not.toContainText('hàng đang có');

    const patched = api.waitForCall('PATCH', '/cart/items/:id');
    await plus.click();
    expect((await patched).body).toEqual({ quantity: 26 });
    await expect(page.getByText(OVER)).toBeVisible();
    await expect(plus.locator('..')).toContainText('25');
  });

  test('giỏ: dòng vượt tồn 30 trên tồn 25 báo "Vượt số hàng đang có…", bấm − về 20 chứ không về 25', async ({ page, api }) => {
    mockPilotCart(api);
    api.get('/cart', cartWith(30, 25));
    api.patch('/cart/items/:id', cartWith(20, 25));
    await page.goto('/cart');

    const line = page.getByTestId('cart-line');
    await expect(line.getByText('Vượt số hàng đang có, giảm bớt để thanh toán')).toBeVisible({ timeout: 15_000 });
    await expect(line).not.toContainText(showsNumber(25));
    const patched = api.waitForCall('PATCH', '/cart/items/:id');
    await line.getByRole('button', { name: 'Giảm số lượng' }).click();
    expect((await patched).body).toEqual({ quantity: 20 });
    await expect(line.getByText('Vượt số hàng đang có, giảm bớt để thanh toán')).toHaveCount(0);
  });

  test('Mua lại: đơn cũ 30, tồn 25 → sheet giữ 30, không báo "Không đủ", gửi 30 để máy chủ kẹp', async ({ page, api }) => {
    const CODE = 'TUBU-W29-RE';
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    api.get('/orders', {
      data: [{
        ...makeOrder({ code: CODE, status: 'DELIVERED', paymentStatus: 'PAID' }),
        items: [{
          id: 'many', variationId: 'var-many', productName: 'Nước giặt Tubu 2L', productSlug: 'sp-many', variationName: '', backorderedQty: 0, thumbnail: THUMB,
          unitPrice: 60000, quantity: 30, total: 1_800_000, stock: 25, available: true, discontinued: false, currentPrice: 60000, flashActive: false,
        }],
      }],
      meta: { page: 1, limit: 20, total: 1 },
    });
    await page.goto('/orders');

    const card = page.getByTestId('order-card').filter({ has: page.getByRole('button', { name: `Đơn ${CODE}` }) });
    await card.getByRole('button', { name: 'Mua lại', exact: true }).click({ timeout: 15_000 });
    const sheet = page.getByRole('dialog');
    const row = sheet.getByTestId('reorder-line').filter({ hasText: 'Nước giặt Tubu 2L' });
    await expect(row).toBeVisible();
    await expect(row.locator('[data-notice]')).toHaveCount(0);
    await expect(sheet).not.toContainText(showsNumber(25));

    const posted = api.waitForCall('POST', '/orders/:code/repurchase');
    await sheet.getByRole('button', { name: 'Thêm vào giỏ (30)' }).click();
    expect((await posted).body).toEqual({ items: [{ orderItemId: 'many', quantity: 30 }], addSource: 'repurchase' });
  });
});
