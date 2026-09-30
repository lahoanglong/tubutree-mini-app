import { test, expect } from './support/mock-api';
import {
  IN_STOCK_NAME,
  IN_STOCK_NAME_2,
  mockPilotCart,
  mockPilotDeliveredOrder,
  mockPilotProduct,
  mockPilotStorefront,
  OUT_OF_STOCK_NAME,
  PILOT_ORDER_CODE,
  PILOT_PRODUCT_NAME,
  PILOT_SLUG,
  PILOT_STOREFRONT_SLUG,
} from './support/pilot-mocks';

/**
 * Zalo Mini App E2E — Design System v2, luồng pilot (product-detail, cart, storefront-view,
 * order-detail). Mỗi test khoá một hành vi mà việc migrate DS v2 phải giữ / sửa:
 *   1. CTA chính là xanh rừng (token --color-action-primary-bg), KHÔNG phải xanh Zalo mặc định.
 *   2. Button hiện spinner khi mutation đang chạy (bug cũ: loading bị đẩy vào `disabled` nên ZaUI
 *      không vẽ spinner — audit A4-07).
 *   3. Cart: bấm vào ảnh sản phẩm (xa chữ tên) vẫn mở trang sản phẩm.
 *   4. Storefront: hàng hết có overlay "tạm hết", hàng còn thì không (audit A4-06).
 *   5. Đơn đã giao: "Mua lại" hiện spinner rồi chuyển sang /cart.
 * Toàn bộ API được mock (tests/support/mock-api.ts) — không cần API/DB.
 */

const ZALO_BLUE = 'rgb(0, 106, 245)'; // #006AF5 — màu primary mặc định của ZaUI trước DS v2
const FOREST = 'rgb(36, 94, 62)'; // --color-action-primary-bg (forest)

/** Chuẩn hoá giá trị custom property (hex/rgb bất kỳ) về `rgb(r, g, b)` bằng chính trình duyệt. */
async function resolveToken(page: import('@playwright/test').Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = `var(${name})`;
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return rgb;
  }, token);
}

test.describe('Zalo Mini App E2E - Design System v2 pilot flow', () => {
  test('PDP: nút CTA chính "Mua ngay" màu xanh rừng, không phải xanh Zalo', async ({ page, api }) => {
    mockPilotProduct(api);
    await page.goto(`/product/${PILOT_SLUG}`);

    const cta = page.getByRole('button', { name: /^Mua ngay/ });
    await expect(cta).toBeVisible({ timeout: 15_000 });
    await expect(cta).toBeEnabled();

    const bg = await cta.evaluate((el) => getComputedStyle(el).backgroundColor);
    const tokenBg = await resolveToken(page, '--color-action-primary-bg');

    expect(bg).not.toBe(ZALO_BLUE);
    // Khớp token đã resolve (bắt cả trường hợp ai đó hard-code màu khác) VÀ giá trị forest mong đợi.
    expect(tokenBg).toBe(FOREST);
    expect(bg).toBe(tokenBg);
  });

  test('PDP: "Thêm vào giỏ" hiện spinner khi request đang chờ, rồi tắt khi xong', async ({ page, api }) => {
    mockPilotProduct(api, { addToCartDelayMs: 1500 });
    await page.goto(`/product/${PILOT_SLUG}`);

    // Locator theo text (không theo role+name): khi loading, ZaUI vẽ span role=img rỗng làm accessible
    // name của nút thành rỗng nên getByRole(name) mất khớp đúng lúc cần xác nhận spinner.
    const addBtn = page.locator('button', { hasText: 'Thêm vào giỏ' });
    await expect(addBtn).toBeEnabled({ timeout: 15_000 });
    await expect(addBtn.locator('.zaui-btn-loading-icon')).toHaveCount(0);

    // waitForCall chỉ resolve SAU khi mock trả lời (xong độ trễ 1,5s) — nên KHÔNG await trước khi
    // kiểm tra spinner; chờ nó ở cuối để chứng minh request thật sự được gửi đúng 1 lần.
    const posted = api.waitForCall('POST', '/cart/items');
    await addBtn.click();

    // Spinner thật sự được vẽ (ZaUI chỉ vẽ khi loading && !disabled) và có kích thước nhìn thấy.
    const spinner = addBtn.locator('.zaui-btn-loading-icon');
    await expect(spinner).toBeVisible();
    const box = await spinner.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(4);
    expect(box?.height ?? 0).toBeGreaterThan(4);
    // Không được tắt bằng thuộc tính disabled (nguyên nhân gốc của bug cũ).
    await expect(addBtn).not.toBeDisabled();

    // Xong request → spinner biến mất.
    await posted;
    await expect(spinner).toHaveCount(0, { timeout: 10_000 });
    expect(api.callsTo('POST', '/cart/items')).toHaveLength(1);
  });

  test('Giỏ hàng: bấm vào ảnh sản phẩm (xa chữ tên, sát mép trái) vẫn mở trang chi tiết', async ({ page, api }) => {
    mockPilotCart(api);
    await page.goto('/cart');

    // Dòng hàng: tên hiện ra, và "vùng bấm" ảnh là một nút riêng (aria-label = tên sản phẩm).
    await expect(page.getByText(PILOT_PRODUCT_NAME).first()).toBeVisible({ timeout: 15_000 });
    // exact: tránh khớp nút "Xoá <tên>" của cùng dòng.
    const thumb = page.getByRole('button', { name: PILOT_PRODUCT_NAME, exact: true });
    await expect(thumb).toBeVisible();
    const titleBox = await page.getByText(PILOT_PRODUCT_NAME, { exact: true }).first().boundingBox();
    const thumbBox = await thumb.boundingBox();
    expect(thumbBox).not.toBeNull();
    // Điểm bấm phải nằm ngoài khung chữ tên (bug cũ: chỉ chữ tên mới bấm được).
    const clickX = thumbBox!.x + 3;
    const clickY = thumbBox!.y + thumbBox!.height / 2;
    if (titleBox) {
      const insideTitle =
        clickX >= titleBox.x && clickX <= titleBox.x + titleBox.width &&
        clickY >= titleBox.y && clickY <= titleBox.y + titleBox.height;
      expect(insideTitle, 'điểm bấm không được rơi vào chữ tên').toBe(false);
    }

    await page.mouse.click(clickX, clickY);
    await expect(page).toHaveURL(new RegExp(`/product/${PILOT_SLUG}$`), { timeout: 10_000 });
  });

  test('Storefront CTV: chỉ sản phẩm hết hàng có overlay "tạm hết"', async ({ page, api }) => {
    mockPilotStorefront(api);
    await page.goto(`/s/${PILOT_STOREFRONT_SLUG}`);

    const outTile = page.getByRole('button', { name: OUT_OF_STOCK_NAME });
    const inTile1 = page.getByRole('button', { name: IN_STOCK_NAME });
    const inTile2 = page.getByRole('button', { name: IN_STOCK_NAME_2 });
    await expect(outTile).toBeVisible({ timeout: 15_000 });
    await expect(inTile1).toBeVisible();
    await expect(inTile2).toBeVisible();

    const overlay = /tạm hết/i;
    await expect(outTile.getByText(overlay)).toBeVisible();
    await expect(inTile1.getByText(overlay)).toHaveCount(0);
    await expect(inTile2.getByText(overlay)).toHaveCount(0);
    // Đúng 1 overlay trên cả trang.
    await expect(page.getByText(overlay)).toHaveCount(1);
  });

  test('Đơn đã giao: "Mua lại" hiện spinner rồi chuyển sang /cart', async ({ page, api }) => {
    mockPilotDeliveredOrder(api, { repurchaseDelayMs: 1500 });
    await page.goto(`/order/${PILOT_ORDER_CODE}`);

    const rebuy = page.locator('button', { hasText: 'Mua lại' }); // theo text — xem ghi chú ở test PDP
    await expect(rebuy).toBeVisible({ timeout: 15_000 });
    await expect(rebuy).toBeEnabled();

    // waitForCall resolve sau khi mock trả lời (hết độ trễ) → kiểm spinner TRƯỚC, await sau.
    const posted = api.waitForCall('POST', '/orders/:code/repurchase');
    await rebuy.click();

    await expect(rebuy.locator('.zaui-btn-loading-icon')).toBeVisible();
    await posted;
    await expect(page).toHaveURL(/\/cart$/, { timeout: 10_000 });
    expect(api.callsTo('POST', '/orders/:code/repurchase')).toHaveLength(1);
  });
});
