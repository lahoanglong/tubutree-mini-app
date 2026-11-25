import type { Page } from '@playwright/test';
import { test, expect, publicConfig, type MockApi } from './support/mock-api';
import { axeInside } from './support/order-zalo-mocks';
import { SHORT_BANK, SHORT_COD } from './support/pre-submit';

/**
 * Trước khi gửi duyệt Zalo (tubu-w36-02), web /thanh-toan của khách không đăng nhập (cờ `web.guest_checkout_enabled`), phần web-guest-checkout.web.spec.ts
 * chưa phủ: ô "Nhận hành trình đơn hàng qua Zalo" ẩn khi số vừa gõ không đọc được, tick sẵn theo `orderZaloPrechecked`, bỏ tick thì gửi false, cờ
 * `orderZaloGuest` tắt thì không ô và không trường; không bao giờ có công tắc người nhận (một ô số điện thoại). Sản phẩm và mọi lời gọi /api/** của
 * trình duyệt là mock; spec dừng ở lời gọi đặt đơn nên không cần DB tạm (trang `/don` có ở pre-submit-order-code.web.spec.ts).
 */
const WEB_PROJECTS = new Set(['Web Customer', 'Web Customer Mobile']);
const PROVINCE = { code: '84_VN79', name: 'TP. Hồ Chí Minh' };
const WARD = { code: '84_VN7901', name: 'Phường Bến Thành' };
const GUEST_CART_KEY = 'tubu.guestCart.v1';
const PRODUCT = {
  id: 'prod-presubmit',
  slug: 'nuoc-rua-chen-presubmit',
  name: 'Nước Rửa Chén Sinh Học Tubu 500ml',
  brand: 'Tubu',
  thumbnail: null,
  images: [],
  description: 'Nước rửa chén sinh học.',
  variations: [{ id: 'var-presubmit', name: 'Hương Chanh Gừng', retailPrice: 65000, salePrice: null, stock: 50, attributes: {} }],
};
const UNIT = PRODUCT.variations[0]!.retailPrice;

function quote(quantity: number) {
  const subtotal = UNIT * quantity;
  return {
    flashNotice: false,
    blockedPaymentMethods: {},
    codMax: 500000,
    subtotal,
    discount: 0,
    comboDiscount: 0,
    shippingFee: 19000,
    total: subtotal + 19000,
    items: [{ id: 'var-presubmit', variationId: 'var-presubmit', productName: PRODUCT.name, variationName: 'Hương Chanh Gừng', slug: PRODUCT.slug, thumbnail: null, unitPrice: UNIT, quantity, total: subtotal }],
  };
}

function mockGuestShop(api: MockApi, zalo: { guest: boolean; prechecked: boolean }): void {
  api.get('/config/public', {
    ...publicConfig(),
    freeshipThreshold: 199000,
    webGuestCartEnabled: true,
    webGuestCheckoutEnabled: true,
    newCustomer: { welcomeVoucher: { amount: 30000 } },
    orderZaloEnabled: true,
    orderZaloGuest: zalo.guest,
    orderZaloPrechecked: zalo.prechecked,
    tubuZaloPhone: '0899149229',
  });
  api.get('/flash-sales/active', []);
  api.get('/flash-sales/upcoming', []);
  api.get(`/products/${PRODUCT.slug}`, PRODUCT);
  api.get('/geo/provinces', [PROVINCE]);
  api.get('/geo/communes', [WARD]);
  api.post('/checkout/guest/quote', ({ call }) => quote((call.body as { lines: { quantity: number }[] }).lines[0]!.quantity));
  api.post('/checkout/guest/orders', ({ call }) => {
    const body = call.body as { paymentMethod: 'COD' | 'BANK_TRANSFER'; lines: { quantity: number }[] };
    const code = body.paymentMethod === 'COD' ? SHORT_COD : SHORT_BANK;
    return { code, status: body.paymentMethod === 'COD' ? 'CONFIRMED' : 'PENDING_PAYMENT', paymentMethod: body.paymentMethod, total: quote(body.lines[0]!.quantity).total, codes: [code], keyAccepted: true };
  });
  api.allowUnmocked('GET /affiliate/me', 'POST /affiliate/touch', 'GET /me/wishlist/ids', 'GET /products', 'GET /dang-nhap', 'POST /coupons/preview', 'GET /coupons/available', 'GET /checkout/guest/orders/:code', 'GET /checkout/guest/orders/:code/bank-qr');
}

async function seedGuestCart(page: Page): Promise<void> {
  const line = { variationId: PRODUCT.variations[0]!.id, slug: PRODUCT.slug, quantity: 1, addedAt: 1 };
  await page.addInitScript(
    ([k, value]) => {
      try {
        if (!localStorage.getItem(k!)) localStorage.setItem(k!, value!);
      } catch {
        // không có localStorage: giỏ trống
      }
    },
    [GUEST_CART_KEY, JSON.stringify([line])],
  );
  // Giỏ khách ghi món luôn đặt kèm cookie này (lib/guest-cart/store.ts); thiếu nó middleware phục vụ bản dựng sẵn giỏ trống.
  await page.context().addCookies([{ name: 'tubu_guest_cart', value: '1', domain: 'localhost', path: '/' }]);
}

async function fillForm(page: Page, phone: string): Promise<void> {
  const form = page.getByTestId('guest-checkout');
  await form.getByLabel('Họ tên người nhận').fill('Nguyễn Văn An');
  await form.getByLabel('Số điện thoại', { exact: true }).fill(phone);
  await form.getByLabel('Tỉnh/Thành phố').click();
  await page.getByRole('option', { name: PROVINCE.name }).click();
  // Chọn tỉnh xong sheet Phường/Xã tự mở.
  await page.getByRole('option', { name: WARD.name }).click();
  await expect(form.getByLabel('Phường/Xã')).toContainText(WARD.name);
  await form.getByLabel('Số nhà, tên đường').fill('12 Lê Lợi');
}

const zaloBox = (page: Page) => page.getByRole('checkbox', { name: /Nhận hành trình đơn hàng qua Zalo/ });
const zaloRow = (page: Page) => page.locator('label').filter({ has: zaloBox(page) });
const placeButton = (page: Page) => page.locator('[data-testid="guest-place-order"]:visible').first();
const phoneInput = (page: Page) => page.getByTestId('guest-checkout').getByLabel('Số điện thoại', { exact: true });

test.describe('Trước gửi duyệt: đặt hàng không đăng nhập trên web, ô Zalo', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!WEB_PROJECTS.has(testInfo.project.name), 'Chỉ hai project web khách');
    await page.setViewportSize(testInfo.project.name === 'Web Customer Mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  });

  test('orderZaloGuest bật + tick sẵn: ô ẩn khi số không đọc được, hiện khi số đúng và đã tick, không có công tắc người nhận, axe sạch; đặt COD gửi orderZaloConsent: true', async ({ page, api }) => {
    mockGuestShop(api, { guest: true, prechecked: true });
    await seedGuestCart(page);
    await page.goto('/thanh-toan');
    await expect(page.getByTestId('guest-checkout')).toBeVisible({ timeout: 20_000 });
    await expect(zaloBox(page)).toHaveCount(0);

    // Điền đủ với số đúng trước: lỗi số hiện lúc rời ô đẩy bố cục, chạm ô Tỉnh ngay sau đó trượt ở khổ điện thoại.
    await fillForm(page, '0912345678');
    await expect(zaloRow(page)).toContainText('Số nhận: 091•••5678');
    for (const unreadable of ['12345', '0281234567']) {
      await phoneInput(page).fill(unreadable);
      await expect(zaloBox(page)).toHaveCount(0);
    }
    await phoneInput(page).fill('0912345678');
    await expect(zaloRow(page)).toContainText('Số nhận: 091•••5678');
    await expect(zaloBox(page)).toBeChecked();
    await expect(page.getByTestId('order-zalo-recipient')).toHaveCount(0);
    expect(await axeInside(page, zaloRow(page))).toEqual([]);

    await expect(placeButton(page)).toBeEnabled({ timeout: 15_000 });
    const placed = api.waitForCall('POST', '/checkout/guest/orders');
    await placeButton(page).click();
    const body = (await placed).body as Record<string, unknown>;
    expect(body).toMatchObject({ paymentMethod: 'COD', orderZaloConsent: true });
    expect(body).not.toHaveProperty('notifyRecipientZalo');
  });

  test('orderZaloGuest bật + tick sẵn, khách bỏ tick: chuyển khoản gửi orderZaloConsent: false', async ({ page, api }) => {
    mockGuestShop(api, { guest: true, prechecked: true });
    await seedGuestCart(page);
    await page.goto('/thanh-toan');
    await expect(page.getByTestId('guest-checkout')).toBeVisible({ timeout: 20_000 });
    await fillForm(page, '0912345678');
    await expect(zaloBox(page)).toBeChecked();
    await zaloRow(page).click();
    await expect(zaloBox(page)).not.toBeChecked();
    await page.getByRole('radio', { name: /Chuyển khoản/ }).check();
    await expect(placeButton(page)).toBeEnabled({ timeout: 15_000 });
    const placed = api.waitForCall('POST', '/checkout/guest/orders');
    await placeButton(page).click();
    const body = (await placed).body as Record<string, unknown>;
    expect(body).toMatchObject({ paymentMethod: 'BANK_TRANSFER', orderZaloConsent: false });
    expect(body).not.toHaveProperty('notifyRecipientZalo');
  });

  test('orderZaloGuest tắt: số đúng vẫn không có ô, thân đơn không có orderZaloConsent', async ({ page, api }) => {
    mockGuestShop(api, { guest: false, prechecked: true });
    await seedGuestCart(page);
    await page.goto('/thanh-toan');
    await expect(page.getByTestId('guest-checkout')).toBeVisible({ timeout: 20_000 });
    await fillForm(page, '0912345678');
    await expect(placeButton(page)).toBeEnabled({ timeout: 15_000 });
    await expect(zaloBox(page)).toHaveCount(0);
    const placed = api.waitForCall('POST', '/checkout/guest/orders');
    await placeButton(page).click();
    const body = (await placed).body as Record<string, unknown>;
    expect(body).not.toHaveProperty('orderZaloConsent');
    expect(body).not.toHaveProperty('notifyRecipientZalo');
  });
});
