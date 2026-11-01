import { expect, makeUser, mockSession, test, type MockApi } from './support/mock-api';
import { mockFlashSlots } from './support/flash-slot-mocks';

/**
 * Web khách, trang Giờ vàng theo khung (/gio-vang): giống Mini App /flash-sale. Tab khung giờ, chip danh mục, món hết suất mờ ở cuối,
 * Nhắc tôi, Mua ngay, khách chưa đăng nhập vào trang được và bị mời đăng nhập khi bấm Nhắc tôi. Mọi lời gọi /api/** đi qua mock; giờ máy chủ cố định.
 * Host phải là localhost (baseURL) vì middleware coi nhãn đầu của Host là subdomain gian hàng.
 */

const buyButtons = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /^Mua ngay Sản phẩm Giờ vàng/ });

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
    await expect(buyButtons(page).last().locator('xpath=ancestor::li[1]/div')).toHaveCSS('opacity', '0.55');
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
  });
});
