import { expect, makeUser, mockSession, test, type MockApi } from './support/mock-api';
import { mockFlashSlots } from './support/flash-slot-mocks';

/**
 * Web khách, trang Giờ vàng theo khung (/gio-vang): giống Mini App /flash-sale. Tab khung giờ, chip danh mục, món hết suất mờ ở cuối,
 * Nhắc tôi, Mua ngay, khách chưa đăng nhập vào trang được và bị mời đăng nhập khi bấm Nhắc tôi. Mọi lời gọi /api/** đi qua mock; giờ máy chủ cố định.
 * Host phải là localhost (baseURL) vì middleware coi nhãn đầu của Host là subdomain gian hàng.
 */

const buyButtons = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /^Mua ngay Sản phẩm Giờ vàng/ });

/** Dòng `li` của một nút Mua ngay/Nhắc tôi: món hết suất thì ảnh và nút mờ, thân thẻ (chữ) không mờ để chữ giữ tương phản 4,5:1. */
const rowOf = (btn: import('@playwright/test').Locator) => btn.locator('xpath=ancestor::li[1]');

const CART_LINE = {
  id: 'cart-line-3', variationId: 'var-flash-3', productName: 'Sản phẩm Giờ vàng 3', variationName: null, slug: 'san-pham-gio-vang-3', thumbnail: null,
  unitPrice: 52_000, quantity: 1, stock: 8, total: 52_000, fulfiller: { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' },
};
const CART = { items: [CART_LINE], couponCode: null, subtotal: 52_000, discount: 0, freeship: false, freeshipThreshold: 500_000, itemCount: 1 };

function mockBuyer(api: MockApi): void {
  mockSession(api, makeUser({ id: 'u-flash', fullName: 'Nguyễn Văn An', phone: '0912345678' }));
  api.get('/me/addresses', [
    { id: 'a1', recipient: 'Nguyễn Văn An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Phường Ba Đình', street: '12 Phố Huế', provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true },
  ]);
  api.get('/me/coupons', []);
  api.get('/config/public', { freeshipThreshold: 500_000 });
  api.post('/cart/items', CART);
  api.get('/cart', CART);
  api.post('/checkout/quote', {
    subtotal: 52_000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30_000, total: 82_000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0,
  });
  api.get('/orders', { data: [], meta: { page: 1, limit: 20, total: 0 } });
  api.get('/me/loyalty', { tier: { name: 'Hạt Giống' }, pointsBalance: 0, pointsConvertedBalance: 0 });
  api.get('/me/notifications', []);
  api.get('/auth/me', { ...makeUser({ id: 'u-flash' }), ownsBrand: false });
  api.get('/dealer/me', { status: 'NONE', isDealer: false });
  api.get('/products', { data: [], meta: { page: 1, limit: 30, total: 0 } });
  api.get('/me/new-customer-offer', { isNewCustomer: false, welcomeVoucher: null });
}

test.describe('Web khách: Giờ vàng theo khung, đã đăng nhập', () => {
  test.beforeEach(async ({ page, api }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
    mockBuyer(api);
    mockFlashSlots(api);
  });

  test('ba tab khung giờ, một đồng hồ, chip danh mục, món hết suất mờ và xuống cuối', async ({ page }) => {
    await page.goto('/gio-vang');
    await expect(page.getByRole('heading', { level: 1, name: 'Giờ vàng' })).toBeVisible();
    const tabs = page.getByRole('tablist', { name: 'Khung giờ' });
    await expect(tabs.getByRole('tab')).toHaveCount(3);
    await expect(tabs.getByRole('tab', { name: '12:00, đang diễn ra' })).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('tab', { name: '20:00, sắp diễn ra' })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: '12:00, ngày mai' })).toBeVisible();
    await expect(page.getByRole('timer')).toHaveCount(1);
    await expect(page.getByRole('group', { name: 'Danh mục' }).getByRole('button')).toHaveCount(3);

    await expect(buyButtons(page)).toHaveCount(14);
    const names = await buyButtons(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    expect(names.slice(-2)).toEqual(['Mua ngay Sản phẩm Giờ vàng 1', 'Mua ngay Sản phẩm Giờ vàng 2']);
    await expect(buyButtons(page).last()).toHaveAttribute('aria-disabled', 'true');
    await expect(rowOf(buyButtons(page).last()).locator('[data-ds-part="media"]')).toHaveCSS('opacity', '0.55');
    await expect(rowOf(buyButtons(page).last()).locator('[data-ds-part="body"]')).toHaveCSS('opacity', '1');
    await expect(buyButtons(page).last()).toHaveCSS('opacity', '0.55');
  });

  test('khung 14 món cao hơn màn hình: cuộn tới cuối vẫn thấy dải tab và đồng hồ dưới thanh trên cùng, đổi khung được mà không cuộn ngược', async ({ page }) => {
    await page.goto('/gio-vang');
    const tablist = page.getByRole('tablist', { name: 'Khung giờ' });
    await expect(tablist).toBeVisible();
    await expect(buyButtons(page)).toHaveCount(14);
    const sticky = page.getByTestId('flash-sticky');
    // Cuộn tới món cuối, không tới đáy tài liệu: ở đáy, chân trang (cao thấp tuỳ font của máy) chiếm màn hình, khối nội dung hết chỗ
    // và đẩy dải tab lên theo đúng luật sticky.
    await rowOf(buyButtons(page).last()).evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 }).toBeGreaterThan(600);
    // `top` đã tính: điện thoại là dưới thanh nút lùi (56px), máy tính là dưới thanh đầu trang của site (--header-h).
    const stickyTop = await sticky.evaluate((el) => parseFloat(getComputedStyle(el).top));
    expect(stickyTop).toBeGreaterThan(0);
    await expect.poll(async () => Math.abs((await sticky.boundingBox())!.y - stickyTop), { timeout: 5_000 }).toBeLessThanOrEqual(1);
    // Đã cuộn thật: món đầu danh sách trôi khỏi màn hình trong khi dải tab vẫn ghim.
    await expect(buyButtons(page).first()).not.toBeInViewport();
    const siteHeader = page.locator('header[data-site-header]');
    if (await siteHeader.isVisible()) expect((await siteHeader.boundingBox())!.y + (await siteHeader.boundingBox())!.height).toBeLessThanOrEqual(stickyTop + 1);
    await expect(page.getByRole('timer')).toBeInViewport();
    await expect(page.getByRole('tab', { name: '12:00, đang diễn ra' })).toBeInViewport();
    await page.getByRole('tab', { name: '20:00, sắp diễn ra' }).click();
    await expect(page.getByRole('tab', { name: '20:00, sắp diễn ra' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Nhắc tôi Sản phẩm Giờ vàng 21', exact: true })).toBeVisible();
  });

  test('chip danh mục lọc danh sách, Tất cả trả đủ món', async ({ page }) => {
    await page.goto('/gio-vang');
    const chips = page.getByRole('group', { name: 'Danh mục' });
    await chips.getByRole('button', { name: /Thực phẩm/ }).click();
    await expect(buyButtons(page)).toHaveCount(7);
    await chips.getByRole('button', { name: /Tất cả/ }).click();
    await expect(buyButtons(page)).toHaveCount(14);
  });

  test('phím mũi tên sang tab 20:00; Nhắc tôi gửi POST remind, bấm lại gửi DELETE', async ({ page, api }) => {
    await page.goto('/gio-vang');
    const live = page.getByRole('tab', { name: '12:00, đang diễn ra' });
    await expect(live).toBeVisible();
    await live.focus();
    await page.keyboard.press('ArrowRight');
    const next = page.getByRole('tab', { name: '20:00, sắp diễn ra' });
    await expect(next).toHaveAttribute('aria-selected', 'true');
    await expect(next).toBeFocused();
    await expect(buyButtons(page)).toHaveCount(0);

    const remind = page.getByRole('button', { name: 'Nhắc tôi Sản phẩm Giờ vàng 21', exact: true });
    await expect(remind).toBeVisible();
    await expect.poll(() => api.callsTo('GET', '/flash-sales/upcoming').length).toBeGreaterThan(0);
    const posted = api.waitForCall('POST', '/flash-sales/items/:id/remind');
    await remind.click();
    expect((await posted).path).toBe('/flash-sales/items/fi-21/remind');
    const undo = page.getByRole('button', { name: 'Đã đặt nhắc Sản phẩm Giờ vàng 21, bỏ nhắc', exact: true });
    await expect(undo).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('status').filter({ hasText: 'Tubu sẽ nhắc bạn lúc 20:00' })).toBeVisible();

    const deleted = api.waitForCall('DELETE', '/flash-sales/items/:id/remind');
    await undo.click();
    expect((await deleted).path).toBe('/flash-sales/items/fi-21/remind');
  });

  test('Mua ngay: thêm đúng phân loại Giờ vàng, nhớ một dòng giỏ và sang /thanh-toan', async ({ page, api }) => {
    await page.goto('/gio-vang');
    const buy = page.getByRole('button', { name: 'Mua ngay Sản phẩm Giờ vàng 3', exact: true });
    await expect(buy).toBeVisible();
    const posted = api.waitForCall('POST', '/cart/items');
    await buy.click();
    expect((await posted).body).toMatchObject({ variationId: 'var-flash-3', quantity: 1 });
    await expect(page).toHaveURL(/\/thanh-toan$/);
    expect(await page.evaluate(() => sessionStorage.getItem('tubu_checkout_selection'))).toBe(JSON.stringify({ itemIds: ['cart-line-3'] }));
  });
});

test.describe('Web khách: Giờ vàng theo khung, chưa đăng nhập', () => {
  test('xem được trang; bấm Nhắc tôi chuyển tới đăng nhập kèm đường quay lại và không gọi remind', async ({ page, api }) => {
    mockFlashSlots(api);
    await page.goto('/gio-vang');
    await expect(page.getByRole('tab', { name: '12:00, đang diễn ra' })).toBeVisible();
    await expect(buyButtons(page).first()).toBeVisible();
    await page.getByRole('tab', { name: '20:00, sắp diễn ra' }).click();
    await page.getByRole('button', { name: 'Nhắc tôi Sản phẩm Giờ vàng 21', exact: true }).click();
    await expect(page).toHaveURL(/\/dang-nhap\?returnTo=%2Fgio-vang/);
    expect(api.callsTo('POST', '/flash-sales/items/:id/remind')).toHaveLength(0);
    // Suất được nhớ qua vòng đăng nhập để đặt nốt khi khách quay về.
    expect(JSON.parse((await page.evaluate(() => sessionStorage.getItem('tubu_pending_remind')))!)).toMatchObject({ itemId: 'fi-21' });
  });
});

test.describe('Web khách: quay về /gio-vang sau đăng nhập với một Nhắc tôi đang chờ', () => {
  /** Giả lập đúng thứ tự thật: khách đã bấm Nhắc tôi (ý định nằm ở sessionStorage), đi đăng nhập, rồi tải lại trang với phiên đã có. */
  test.beforeEach(async ({ page, api }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
        if (!sessionStorage.getItem('tubu_pending_remind')) {
          sessionStorage.setItem('tubu_pending_remind', JSON.stringify({ itemId: 'fi-21', startAt: '2026-11-01T13:00:00.000Z', at: Date.now() }));
        }
      } catch {
        // không có storage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
    mockBuyer(api);
  });

  test('món chưa nhắc: tự đặt nhắc đúng một lần, ý định bị xoá, nút thành "Đã đặt nhắc"', async ({ page, api }) => {
    mockFlashSlots(api);
    const posted = api.waitForCall('POST', '/flash-sales/items/:id/remind');
    await page.goto('/gio-vang');
    expect((await posted).path).toBe('/flash-sales/items/fi-21/remind');
    await page.getByRole('tab', { name: '20:00, sắp diễn ra' }).click();
    await expect(page.getByRole('button', { name: 'Đã đặt nhắc Sản phẩm Giờ vàng 21, bỏ nhắc', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(api.callsTo('POST', '/flash-sales/items/:id/remind')).toHaveLength(1);
    expect(api.callsTo('DELETE', '/flash-sales/items/:id/remind')).toHaveLength(0);
    expect(await page.evaluate(() => sessionStorage.getItem('tubu_pending_remind'))).toBeNull();
  });

  test('món đã nhắc từ trước (máy khác): không gọi POST lẫn DELETE', async ({ page, api }) => {
    mockFlashSlots(api, { remindedIds: ['fi-21'] });
    await page.goto('/gio-vang');
    await expect.poll(() => api.callsTo('GET', '/flash-sales/upcoming').length).toBeGreaterThan(0);
    await page.getByRole('tab', { name: '20:00, sắp diễn ra' }).click();
    await expect(page.getByRole('button', { name: 'Đã đặt nhắc Sản phẩm Giờ vàng 21, bỏ nhắc', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(api.callsTo('POST', '/flash-sales/items/:id/remind')).toHaveLength(0);
    expect(api.callsTo('DELETE', '/flash-sales/items/:id/remind')).toHaveLength(0);
  });
});
