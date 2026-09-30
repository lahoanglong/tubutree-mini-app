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
  PILOT_PRODUCT,
  PILOT_PRODUCT_NAME,
  PILOT_SLUG,
  PILOT_STOREFRONT_SLUG,
} from './support/pilot-mocks';
import { CHECKOUT_ADDRESS, mockCheckout } from './support/checkout-mocks';
import type { AddressDTO } from '../../miniapp/src/services/shop-api';

/**
 * Zalo Mini App E2E — Design System v2, luồng pilot (product-detail, cart, storefront-view,
 * order-detail). Mỗi test khoá một hành vi mà việc migrate DS v2 phải giữ / sửa:
 *   1. CTA chính là xanh rừng (token --color-action-primary-bg), KHÔNG phải xanh Zalo mặc định.
 *   2. Button hiện spinner khi mutation đang chạy (bug cũ: loading bị đẩy vào `disabled` nên ZaUI
 *      không vẽ spinner — audit A4-07).
 *   3. Cart: bấm vào ảnh sản phẩm (xa chữ tên) vẫn mở trang sản phẩm.
 *   4. Storefront: hàng hết có overlay "tạm hết", hàng còn thì không (audit A4-06).
 *   5. Đơn đã giao: "Mua lại đơn này" mở sheet; CTA trong sheet hiện spinner rồi chuyển sang /cart.
 *   6. PDP 375px: thanh CTA dính đáy không tràn màn hình (còn hàng giá dài + hết hàng).
 *   7-8. Component con CHƯA migrate trong luồng pilot (quantity-selector, address-section) vẫn
 *      có viền/nền thật nhờ khối alias v1 → v2 (final review C1: trước đó resolve ra "không gì").
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
    // 3s (trước 1,5s): khi máy tải nặng, request mock từng xong trước lúc đo boundingBox → flaky.
    mockPilotProduct(api, { addToCartDelayMs: 3000 });
    await page.goto(`/product/${PILOT_SLUG}`);

    // getByRole(name) PHẢI khớp cả lúc loading: CSS ZaUI ẩn nhãn (visibility:hidden) nên trước fix I1
    // accessible name thành rỗng; Button DS v2 giờ giữ aria-label = nhãn khi loading.
    const addBtn = page.getByRole('button', { name: 'Thêm vào giỏ' });
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
    // Không được tắt bằng THUỘC TÍNH DOM disabled (nguyên nhân gốc của bug cũ). Không dùng
    // not.toBeDisabled(): Playwright tính cả aria-disabled="true" (cố ý bật khi loading — I1).
    await expect(addBtn).not.toHaveAttribute('disabled');
    // Báo bận cho trình đọc màn hình (nút không disabled thật nên phải có aria-*).
    await expect(addBtn).toHaveAttribute('aria-busy', 'true');
    await expect(addBtn).toHaveAttribute('aria-disabled', 'true');

    // Xong request → spinner biến mất.
    await posted;
    await expect(spinner).toHaveCount(0, { timeout: 10_000 });
    expect(api.callsTo('POST', '/cart/items')).toHaveLength(1);
  });

  test('PDP 375px: mọi nút trong thanh CTA dính đáy nằm trọn trong màn hình, "Mua ngay" + giá hiện đủ', async ({ page, api }) => {
    // Bug cũ: hàng CTA đôi không co được (min-width:auto + nhãn nowrap + min-width 120 của ZaUI) →
    // "Mua ngay · 65.000đ" tràn tới x=421 trên màn 375/390px. Giá dài (1.250.000đ) là ca xấu nhất.
    await page.setViewportSize({ width: 375, height: 812 });
    mockPilotProduct(api);
    api.get('/products/:slug', {
      ...PILOT_PRODUCT,
      basePrice: 1_250_000,
      variations: PILOT_PRODUCT.variations.map((v) => ({ ...v, retailPrice: 1_250_000 })),
    });

    const assertBarFits = async () => {
      const bar = page.getByTestId('sticky-bar');
      const buttons = bar.locator('button, [role=button]');
      const n = await buttons.count();
      expect(n).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) {
        const box = await buttons.nth(i).boundingBox();
        expect(box, `nút #${i} trong sticky-bar`).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, `nút #${i} tràn phải`).toBeLessThanOrEqual(375);
      }
    };

    // Còn hàng: nút giỏ + "Thêm vào giỏ" + "Mua ngay".
    await page.goto(`/product/${PILOT_SLUG}`);
    const buy = page.getByRole('button', { name: 'Mua ngay · 1.250.000đ' });
    await expect(buy).toBeVisible({ timeout: 15_000 });
    await assertBarFits();
    // Cả nhãn lẫn giá hiện đủ — không bị rút gọn "…".
    for (const text of ['Mua ngay', '1.250.000đ']) {
      const line = buy.getByText(text, { exact: true });
      await expect(line).toBeVisible();
      expect(await line.evaluate((el) => el.scrollWidth <= el.clientWidth), `"${text}" bị rút gọn`).toBe(true);
    }

    // Hết hàng: CTA đơn.
    api.get('/products/:slug', { ...PILOT_PRODUCT, variations: PILOT_PRODUCT.variations.map((v) => ({ ...v, stock: 0 })) });
    await page.goto(`/product/${PILOT_SLUG}`);
    await expect(page.getByTestId('sticky-bar').getByRole('button', { name: /hết/i })).toBeVisible({ timeout: 15_000 });
    await assertBarFits();
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

  test('Giỏ hàng: nút "−" ở qty=1 có viền + nền disabled khác nút "+" (alias v1 → v2 resolve)', async ({ page, api }) => {
    mockPilotCart(api);
    await page.goto('/cart');

    const minus = page.getByRole('button', { name: 'Giảm số lượng' }).first();
    const plus = page.getByRole('button', { name: 'Tăng số lượng' }).first();
    await expect(minus).toBeVisible({ timeout: 15_000 });
    await expect(minus).toHaveAttribute('aria-disabled', 'true');

    const style = (el: Element) => {
      const s = getComputedStyle(el);
      return { bw: s.borderTopWidth, bs: s.borderTopStyle, bg: s.backgroundColor, color: s.color };
    };
    const m = await minus.evaluate(style);
    const p = await plus.evaluate(style);
    // Bug C1: var(--neutral-200) không định nghĩa → border-style none / width 0, nền trong suốt.
    expect(m.bs).toBe('solid');
    expect(m.bw).toBe('1px');
    expect(m.bg).toBe(await resolveToken(page, '--stone-100'));
    expect(p.bg).toBe(await resolveToken(page, '--stone-0'));
    expect(m.color).not.toBe(p.color);
  });

  test('Checkout: thẻ địa chỉ đang chọn có viền + nền khác hẳn thẻ không chọn', async ({ page, api }) => {
    mockCheckout(api);
    const other: AddressDTO = {
      ...CHECKOUT_ADDRESS,
      id: 'addr-other-2',
      recipient: 'Trần Thị B',
      phone: '0907654321',
      street: '45 Nguyễn Huệ',
      isDefault: false,
    };
    api.get('/me/addresses', [CHECKOUT_ADDRESS, other]); // đăng ký sau → thắng route của mockCheckout
    await page.goto('/checkout');

    const selected = page.getByRole('radio', { name: new RegExp(CHECKOUT_ADDRESS.recipient) });
    const unselected = page.getByRole('radio', { name: new RegExp(other.recipient) });
    await expect(selected).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
    await expect(unselected).toHaveAttribute('aria-checked', 'false');

    const style = (el: Element) => {
      const s = getComputedStyle(el);
      return { bw: s.borderTopWidth, bs: s.borderTopStyle, bc: s.borderTopColor, bg: s.backgroundColor };
    };
    const sel = await selected.evaluate(style);
    const uns = await unselected.evaluate(style);

    // Bug C1: var(--primary-600)/(--primary-50) không định nghĩa → không viền, nền trong suốt,
    // 2 thẻ trông y hệt nhau (chỉ aria-checked khác).
    expect(sel.bs).toBe('solid');
    expect(uns.bs).toBe('solid');
    expect(parseFloat(sel.bw)).toBeGreaterThan(0);
    expect(sel.bc).toBe(await resolveToken(page, '--forest-600'));
    expect(sel.bg).toBe(await resolveToken(page, '--forest-50'));
    expect(uns.bg).toBe(await resolveToken(page, '--stone-0'));
    expect(sel.bc).not.toBe(uns.bc);
    expect(sel.bg).not.toBe(uns.bg);
    expect(sel.bg).not.toBe('rgba(0, 0, 0, 0)');

    // Canvas body = --color-bg-canvas (trước đây var(--neutral-50) không định nghĩa → trắng/trong suốt).
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bodyBg).toBe(await resolveToken(page, '--color-bg-canvas'));
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

  test('Đơn đã giao: "Mua lại đơn này" mở sheet; CTA trong sheet hiện spinner rồi chuyển sang /cart', async ({ page, api }) => {
    mockPilotDeliveredOrder(api, { repurchaseDelayMs: 1500 });
    await page.goto(`/order/${PILOT_ORDER_CODE}`);

    const rebuy = page.getByRole('button', { name: 'Mua lại đơn này' });
    await expect(rebuy).toBeVisible({ timeout: 15_000 });
    await rebuy.click();

    // makeOrder: 1 dòng SL 2, API mock cũ không trả stock → coi như còn hàng (Ruling 19).
    const cta = page.getByRole('button', { name: 'Thêm vào giỏ (2)' });
    await expect(cta).toBeEnabled();
    const posted = api.waitForCall('POST', '/orders/:code/repurchase');
    await cta.click();

    await expect(cta.locator('.zaui-btn-loading-icon')).toBeVisible();
    await expect(cta).toHaveAttribute('aria-busy', 'true');
    const call = await posted;
    expect(call.body).toEqual({ items: [{ orderItemId: `item-${PILOT_ORDER_CODE}`, quantity: 2 }], addSource: 'repurchase' });
    await expect(page).toHaveURL(/\/cart$/, { timeout: 10_000 });
    expect(api.callsTo('POST', '/orders/:code/repurchase')).toHaveLength(1);
  });
});
