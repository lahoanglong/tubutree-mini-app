import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { CHECKOUT_CART, mockCheckout } from './support/checkout-mocks';
import { CATALOG, mockDiscovery } from './support/discovery-mocks';
import { mockFlashSlots, mockNoSession } from './support/flash-slot-mocks';

/**
 * Mini App, trang Giờ vàng theo khung (/flash-sale): tab khung giờ, chip danh mục, món hết suất mờ ở cuối, Mua ngay, Nhắc tôi, khách chưa đăng nhập,
 * và hai lối vào từ Trang chủ. API mock toàn bộ, giờ máy chủ cố định (13:00 ngày 01/11, khung 12:00 đang diễn ra).
 */

const HOUR = 3_600_000;

test.use({ viewport: { width: 375, height: 812 } });

const buyButtons = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /^Mua ngay Sản phẩm Giờ vàng/ });

/** Dòng `li` của một nút Mua ngay/Nhắc tôi: món hết suất thì ảnh và nút mờ, thân thẻ (chữ) không mờ để chữ giữ tương phản 4,5:1. */
const rowOf = (btn: import('@playwright/test').Locator) => btn.locator('xpath=ancestor::li[1]');

/** Danh sách Giờ vàng công khai nên hiện trước khi phiên khôi phục xong; chạm Mua ngay/Nhắc tôi lúc đó bị bỏ qua. Lời gọi /flash-sales/upcoming chỉ đi khi đã đăng nhập. */
const sessionReady = (api: MockApi) => expect.poll(() => api.callsTo('GET', '/flash-sales/upcoming').length, { timeout: 15_000 }).toBeGreaterThan(0);

function mockHomeFlash(api: MockApi): void {
  api.get('/flash-sales/active', () => {
    const now = Date.now();
    return CATALOG.slice(4, 7).map((p, i) => ({
      itemId: `fi-${p.id}`, variationId: `v-${p.id}`, productSlug: p.slug, productName: p.name, variationName: null, thumbnail: p.thumbnail,
      flashPrice: 59_000 + i * 1_000, retailPrice: p.basePrice, salePrice: p.salePrice, soldCount: 10 + i, quota: 50,
      endAt: new Date(now + 3 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
    }));
  });
}

test.describe('Mini App — Giờ vàng theo khung: khách đã đăng nhập', () => {
  test.beforeEach(({ api }) => {
    mockSession(api, makeUser({ id: 'user-flash', fullName: 'Khách Giờ Vàng' }));
    mockFlashSlots(api);
  });

  test('mở /flash-sale: ba tab khung giờ, một đồng hồ, chip danh mục khi có 14 món, món hết suất mờ và xuống cuối', async ({ page }) => {
    await page.goto('/flash-sale');
    await expect(page.getByRole('heading', { level: 1, name: 'Giờ vàng' })).toBeVisible({ timeout: 15_000 });
    const tabs = page.getByRole('tablist', { name: 'Khung giờ' });
    await expect(tabs.getByRole('tab')).toHaveCount(3);
    await expect(tabs.getByRole('tab', { name: '12:00, đang diễn ra' })).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('tab', { name: '20:00, sắp diễn ra' })).toHaveAttribute('aria-selected', 'false');
    await expect(tabs.getByRole('tab', { name: '12:00, ngày mai' })).toBeVisible();
    await expect(page.getByRole('timer')).toHaveCount(1);

    const chips = page.getByRole('group', { name: 'Danh mục' });
    await expect(chips).toBeVisible();
    await expect(chips.getByRole('button')).toHaveCount(3);
    await expect(chips.getByRole('button', { name: /Tất cả/ })).toHaveAttribute('aria-pressed', 'true');

    await expect(buyButtons(page)).toHaveCount(14);
    const names = await buyButtons(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    expect(names.slice(-2)).toEqual(['Mua ngay Sản phẩm Giờ vàng 1', 'Mua ngay Sản phẩm Giờ vàng 2']);
    const last = buyButtons(page).last();
    await expect(last).toHaveAttribute('aria-disabled', 'true');
    await expect(last).toHaveCSS('opacity', '0.55');
    await expect(rowOf(last).locator('[data-ds-part="media"]')).toHaveCSS('opacity', '0.55');
    await expect(rowOf(last).locator('[data-ds-part="body"]')).toHaveCSS('opacity', '1');
    await expect(buyButtons(page).first()).toHaveCSS('opacity', '1');
    await expect(rowOf(buyButtons(page).first()).locator('[data-ds-part="media"]')).toHaveCSS('opacity', '1');
  });

  test('khung 14 món cao hơn màn hình: cuộn tới cuối vẫn thấy dải tab và đồng hồ dưới thanh nút lùi, đổi khung được mà không cuộn ngược', async ({ page }) => {
    await page.goto('/flash-sale');
    const tablist = page.getByRole('tablist', { name: 'Khung giờ' });
    await expect(tablist).toBeVisible({ timeout: 15_000 });
    await expect(buyButtons(page)).toHaveCount(14);
    const scroller = page.locator('.zaui-page', { has: tablist }).first();
    await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 10_000 }).toBeGreaterThan(600);
    // Dính ngay dưới thanh đặc của nút lùi: cao 56px (cộng vùng an toàn, 0 ở trình duyệt thật). Cao hơn nữa thì có khe hở lộ thẻ món cuộn qua.
    // Hàng tiêu đề trang cũng cao đúng 56px nên chỗ dính trùng chỗ nằm yên: đã cuộn quá 600px mà tab vẫn ở 56px là bằng chứng của việc dính.
    await expect.poll(async () => Math.round((await tablist.boundingBox())!.y), { timeout: 5_000 }).toBe(56);
    await expect(page.getByRole('timer')).toBeInViewport();
    await expect(page.getByRole('tab', { name: '12:00, đang diễn ra' })).toBeInViewport();
    await page.getByRole('tab', { name: '20:00, sắp diễn ra' }).click();
    await expect(page.getByRole('tab', { name: '20:00, sắp diễn ra' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Nhắc tôi Sản phẩm Giờ vàng 21', exact: true })).toBeVisible();
  });

  test('chip danh mục lọc danh sách; chọn lại Tất cả trả đủ 14 món', async ({ page }) => {
    await page.goto('/flash-sale');
    const chips = page.getByRole('group', { name: 'Danh mục' });
    await expect(chips).toBeVisible({ timeout: 15_000 });
    await chips.getByRole('button', { name: /Thực phẩm/ }).click();
    await expect(chips.getByRole('button', { name: /Thực phẩm/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(buyButtons(page)).toHaveCount(7);
    await chips.getByRole('button', { name: /Tất cả/ }).click();
    await expect(buyButtons(page)).toHaveCount(14);
  });

  test('phím mũi tên chuyển tab sang 20:00 (Nhắc tôi thay Mua ngay); bấm Nhắc tôi gửi POST remind, bấm lại gửi DELETE', async ({ page, api }) => {
    await page.goto('/flash-sale');
    const live = page.getByRole('tab', { name: '12:00, đang diễn ra' });
    await expect(live).toBeVisible({ timeout: 15_000 });
    await live.focus();
    await page.keyboard.press('ArrowRight');
    const next = page.getByRole('tab', { name: '20:00, sắp diễn ra' });
    await expect(next).toHaveAttribute('aria-selected', 'true');
    await expect(next).toBeFocused();
    await expect(buyButtons(page)).toHaveCount(0);

    const remind = page.getByRole('button', { name: 'Nhắc tôi Sản phẩm Giờ vàng 21', exact: true });
    await expect(remind).toBeVisible({ timeout: 10_000 });
    await sessionReady(api);
    const posted = api.waitForCall('POST', '/flash-sales/items/:id/remind');
    await remind.click();
    expect((await posted).path).toBe('/flash-sales/items/fi-21/remind');
    const undo = page.getByRole('button', { name: 'Đã đặt nhắc Sản phẩm Giờ vàng 21, bỏ nhắc', exact: true });
    await expect(undo).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Tubu sẽ nhắc bạn lúc 20:00')).toBeVisible();

    const deleted = api.waitForCall('DELETE', '/flash-sales/items/:id/remind');
    await undo.click();
    expect((await deleted).path).toBe('/flash-sales/items/fi-21/remind');
    await expect(page.getByRole('button', { name: 'Nhắc tôi Sản phẩm Giờ vàng 21', exact: true })).toHaveAttribute('aria-pressed', 'false');
  });

  test('Mua ngay: thêm đúng phân loại Giờ vàng với nguồn buy_now, nhớ đúng một dòng giỏ và sang /checkout', async ({ page, api }) => {
    mockCheckout(api);
    api.post('/cart/items', {
      ...CHECKOUT_CART,
      items: [{ ...CHECKOUT_CART.items[0]!, variationId: 'var-flash-3', productName: 'Sản phẩm Giờ vàng 3', quantity: 1, total: 52_000, unitPrice: 52_000 }],
    });
    await page.goto('/flash-sale');
    const buy = page.getByRole('button', { name: 'Mua ngay Sản phẩm Giờ vàng 3', exact: true });
    await expect(buy).toBeVisible({ timeout: 15_000 });
    await sessionReady(api);
    const posted = api.waitForCall('POST', '/cart/items');
    await buy.click();
    expect((await posted).body).toEqual({ variationId: 'var-flash-3', quantity: 1, addSource: 'buy_now' });
    await expect(page).toHaveURL(/\/checkout$/, { timeout: 10_000 });
    expect(await page.evaluate(() => sessionStorage.getItem('tubu_checkout_selection'))).toBe(JSON.stringify({ itemIds: ['cart-item-1'] }));
  });

  test('món hết suất: nút Mua ngay khoá, bấm không gọi giỏ', async ({ page, api }) => {
    await page.goto('/flash-sale');
    const sold = page.getByRole('button', { name: 'Mua ngay Sản phẩm Giờ vàng 1', exact: true });
    await sold.scrollIntoViewIfNeeded();
    await expect(sold).toHaveAttribute('aria-disabled', 'true');
    await sold.click({ force: true });
    expect(api.callsTo('POST', '/cart/items')).toHaveLength(0);
  });
});

test.describe('Mini App — Giờ vàng theo khung: khách chưa đăng nhập', () => {
  test('xem được trang; bấm Nhắc tôi mở đăng nhập lại và không gọi remind', async ({ page, api }) => {
    mockNoSession(api);
    mockFlashSlots(api);
    await page.goto('/flash-sale');
    await expect(page.getByRole('tab', { name: '12:00, đang diễn ra' })).toBeVisible({ timeout: 15_000 });
    await expect(buyButtons(page).first()).toBeVisible();
    await page.getByRole('tab', { name: '20:00, sắp diễn ra' }).click();
    const remind = page.getByRole('button', { name: 'Nhắc tôi Sản phẩm Giờ vàng 21', exact: true });
    await expect(remind).toBeVisible({ timeout: 10_000 });

    const authCalls = () => api.callsTo('POST', '/auth/guest').length + api.callsTo('POST', '/auth/zalo-mini-app').length;
    await expect.poll(authCalls, { timeout: 10_000 }).toBeGreaterThan(0);
    const before = authCalls();
    // Chạm lúc phiên còn đang khôi phục bị bỏ qua: bấm lại tới khi app đã ở trạng thái khách và mở đăng nhập.
    await expect(async () => {
      await remind.click();
      expect(authCalls()).toBeGreaterThan(before);
    }).toPass({ timeout: 10_000 });
    expect(api.callsTo('POST', '/flash-sales/items/:id/remind')).toHaveLength(0);
    await expect(remind).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('Mini App — Giờ vàng: bấm Nhắc tôi khi chưa đăng nhập rồi đăng nhập xong', () => {
  /**
   * Mở trang như khách (phiên bị từ chối), sang khung 20:00, cho lần đăng nhập kế thành công rồi bấm Nhắc tôi ĐÚNG MỘT lần có hiệu lực:
   * chạm lúc phiên còn đang khôi phục bị bỏ qua nên chạm lại tới khi thấy đăng nhập chạy; lần chạm có hiệu lực dừng vòng lặp ngay,
   * không chạm thêm (chạm thứ hai vào nút "Đã đặt nhắc" sẽ HUỶ nhắc, che mất lỗi cần bắt).
   */
  async function pressRemindThenLogin(page: import('@playwright/test').Page, api: MockApi, remindedIds: string[]) {
    mockNoSession(api);
    const reminded = mockFlashSlots(api, { remindedIds });
    await page.goto('/flash-sale');
    await expect(page.getByRole('tab', { name: '12:00, đang diễn ra' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('tab', { name: '20:00, sắp diễn ra' }).click();
    const remind = page.getByRole('button', { name: 'Nhắc tôi Sản phẩm Giờ vàng 21', exact: true });
    await expect(remind).toBeVisible({ timeout: 10_000 });
    const authCalls = () => api.callsTo('POST', '/auth/guest').length + api.callsTo('POST', '/auth/zalo-mini-app').length;
    await expect.poll(authCalls, { timeout: 10_000 }).toBeGreaterThan(0);
    // Phiên đã ở trạng thái khách: từ giờ đăng nhập thành công.
    mockSession(api, makeUser({ id: 'user-late', fullName: 'Khách Vừa Đăng Nhập' }));
    const before = authCalls();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await remind.click();
      try {
        await expect.poll(authCalls, { timeout: 1_500 }).toBeGreaterThan(before);
        return reminded;
      } catch {
        // phiên chưa sẵn sàng, cú chạm bị bỏ qua: chạm lại
      }
    }
    throw new Error('Nhắc tôi không bao giờ mở đăng nhập');
  }

  test('món chưa nhắc: đăng nhập xong tự đặt nhắc đúng một lần, không bấm lần hai, nút đổi thành Đã đặt nhắc', async ({ page, api }) => {
    const posted = api.waitForCall('POST', '/flash-sales/items/:id/remind', 15_000);
    const reminded = await pressRemindThenLogin(page, api, []);
    expect((await posted).path).toBe('/flash-sales/items/fi-21/remind');
    await expect(page.getByRole('button', { name: 'Đã đặt nhắc Sản phẩm Giờ vàng 21, bỏ nhắc', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // Câu báo nằm ở cả snackbar và vùng đọc ẩn (ghi sau một nhịp trễ), nên tìm theo chữ lúc thấy một lúc thấy hai: kiểm vùng đọc.
    await expect(page.getByTestId('notify-status')).toHaveText('Tubu sẽ nhắc bạn lúc 20:00');
    expect(api.callsTo('POST', '/flash-sales/items/:id/remind')).toHaveLength(1);
    expect(api.callsTo('DELETE', '/flash-sales/items/:id/remind')).toHaveLength(0);
    expect(reminded.has('fi-21')).toBe(true);
  });

  test('món đã nhắc từ trước (máy khác): đăng nhập xong không gọi POST lẫn DELETE, nút vẫn Đã đặt nhắc', async ({ page, api }) => {
    const reminded = await pressRemindThenLogin(page, api, ['fi-21']);
    await expect(page.getByRole('button', { name: 'Đã đặt nhắc Sản phẩm Giờ vàng 21, bỏ nhắc', exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    await page.waitForTimeout(500);
    expect(api.callsTo('POST', '/flash-sales/items/:id/remind')).toHaveLength(0);
    expect(api.callsTo('DELETE', '/flash-sales/items/:id/remind')).toHaveLength(0);
    expect(reminded.has('fi-21')).toBe(true);
  });
});

test.describe('Mini App — Trang chủ dẫn tới Giờ vàng', () => {
  test.beforeEach(({ api }) => {
    mockDiscovery(api, { returning: true });
    mockHomeFlash(api);
    mockFlashSlots(api);
  });

  test('Giờ vàng là ô đầu của lối tắt và mở /flash-sale', async ({ page }) => {
    await page.goto('/');
    const grid = page.getByTestId('shortcut-grid');
    await expect(grid.getByRole('button').first()).toBeVisible({ timeout: 15_000 });
    await expect(grid.getByRole('button').first()).toHaveAccessibleName(/^Giờ vàng/);
    await grid.getByRole('button').first().click();
    await expect(page).toHaveURL(/\/flash-sale$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Giờ vàng' })).toBeVisible({ timeout: 15_000 });
  });

  test('"Xem tất cả" của khối Giờ vàng mở /flash-sale', async ({ page }) => {
    await page.goto('/');
    const flash = page.getByRole('region', { name: 'Giờ vàng', exact: true });
    await expect(flash).toBeVisible({ timeout: 15_000 });
    await flash.getByRole('button', { name: /Xem tất cả/ }).click();
    await expect(page).toHaveURL(/\/flash-sale$/);
  });
});
