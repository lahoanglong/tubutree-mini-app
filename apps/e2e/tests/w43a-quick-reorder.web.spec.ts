import type { Locator, Page } from '@playwright/test';
import { expect, reply, test, type MockApi } from './support/mock-api';

/**
 * W43A, web khách: dải "Mua lại món quen" ở Trang chủ, ở 375×812 (project "Web Customer Mobile") và 1440×900 (project "Web Customer").
 * Mọi lời gọi từ trình duyệt đi qua mock; khách cũ có 5 món đã mua, trong đó 1 món hết hàng nên dải còn 4 thẻ. Không đặt đơn thật.
 * Host phải là localhost (baseURL): middleware coi nhãn đầu của Host là subdomain gian hàng.
 */
const SIZES = [
  { width: 375, height: 812, project: 'Web Customer Mobile' },
  { width: 1440, height: 900, project: 'Web Customer' },
] as const;

const USER = {
  id: 'u-w43a', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 60, pointsConvertedBalance: 0, walletBalance: 0,
};

const bought = (n: number, over: Record<string, unknown> = {}) => ({
  variationId: `var-q${n}`, productId: `prod-q${n}`, slug: `san-pham-q${n}`, productName: `Món quen ${n}`, variationName: '', brand: 'Tubu',
  thumbnail: null, price: 40_000 + n * 10_000, salePrice: null, stock: 9, inStock: true, timesBought: n === 1 ? 5 : 1, retailOnly: false,
  lastPurchasedAt: '2026-09-10T00:00:00.000Z', ...over,
});
const ITEMS = [bought(1), bought(2), bought(3, { stock: 0, inStock: false }), bought(4), bought(5)];
const IN_STOCK = ITEMS.filter((i) => i.inStock !== false);
const EMPTY_CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350_000, itemCount: 0 };
const pageOf = (data: unknown[]) => ({ data, meta: { page: 1, limit: Math.max(data.length, 1), total: data.length } });
const product = (n: number) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 100_000 + n, salePrice: null, isFeatured: false, inStock: true,
});

const strip = (page: Page) => page.getByTestId('quick-reorder');
const cards = (page: Page) => page.getByTestId('quick-reorder-card');
const adds = (page: Page) => page.getByTestId('quick-reorder-add');
const addAll = (page: Page) => page.getByRole('button', { name: /^Thêm lại tất cả/ });
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function expectTouchTarget44(t: Locator): Promise<void> {
  const b = (await t.boundingBox())!;
  expect(b.width, 'chiều rộng vùng chạm').toBeGreaterThanOrEqual(44);
  expect(b.height, 'chiều cao vùng chạm').toBeGreaterThanOrEqual(44);
}

function mockHome(api: MockApi, purchased: unknown[] = ITEMS): void {
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me/notifications/unread-count', { count: 0 });
  api.get('/me/subscriptions', []);
  api.get('/me/wishlist/ids', []);
  api.get('/me/new-customer-offer', { isNewCustomer: false, welcomeVoucher: null });
  api.get('/orders/active-count', { count: 0 });
  api.get('/cart', EMPTY_CART);
  api.get('/categories', []);
  api.get('/brands', []);
  api.get('/products', ({ call }) => (call.query.get('sort') === 'best_seller_30d' ? pageOf([product(1), product(2), product(3)]) : pageOf([product(4)])));
  api.get('/products/for-you', [product(9)]);
  api.get('/config/public', { freeshipThreshold: 350_000, subscribeDiscountPct: 0.12, loyalty: { vndPerPoint: 50, vndPerPointRedeem: 1000 } });
  api.get('/flash-sales/active', []);
  api.get('/flash-sales/upcoming', []);
  api.get('/me/purchased-items', { items: purchased, nextCursor: null });
  api.post('/cart/items', { ...EMPTY_CART, itemCount: 1 });
  api.post('/cart/items/batch', { ...EMPTY_CART, itemCount: IN_STOCK.length });
}

async function openHome(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
  await page.goto('/');
  await expect(strip(page)).toBeVisible({ timeout: 20_000 });
  await expect(cards(page).first()).toBeVisible();
}

for (const size of SIZES) {
  test.describe(`Web khách ${size.width}×${size.height}: dải Mua lại món quen`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test.beforeEach(async ({}, testInfo) => {
      test.skip(testInfo.project.name !== size.project, `Khổ ${size.width}px kiểm ở project ${size.project}`);
    });

    test('dải thế chỗ kệ Mua lại, chỉ món còn hàng, mọi nút từ 44px, không tràn ngang', async ({ page, api }) => {
      mockHome(api);
      await openHome(page);

      await expect(page.getByRole('heading', { level: 2, name: 'Mua lại món quen' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Mua lại', exact: true })).toHaveCount(0);
      expect(await cards(page).count()).toBe(IN_STOCK.length);
      await expect(cards(page).filter({ hasText: 'Món quen 3' })).toHaveCount(0);
      await expect(cards(page).first()).toContainText('Món quen 1');
      await expect(cards(page).first()).toContainText('Đã mua 5 lần');
      await expect(cards(page).first()).toContainText('50.000đ');

      const box = (await strip(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);

      await expectTouchTarget44(addAll(page));
      const n = await adds(page).count();
      for (let i = 0; i < n; i += 1) {
        await adds(page).nth(i).scrollIntoViewIfNeeded();
        await expectTouchTarget44(adds(page).nth(i));
        await expectTouchTarget44(cards(page).nth(i).locator('button.tubu-quick-open'));
      }
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('thẻ cao đúng 232px, rộng 128px, lề trái thẻ đầu 12px (khổ điện thoại); cả dải cao 292px', async ({ page, api }) => {
      mockHome(api);
      await openHome(page);
      const card = (await cards(page).first().boundingBox())!;
      const section = (await strip(page).boundingBox())!;
      // Tiêu đề 44 + đệm kệ 8×2 + thẻ 232: số của `purchasedSkeletonHeight('many')` ở app-core.
      expect(section.height).toBe(292);
      expect(card.height).toBe(232);
      expect(card.width).toBe(128);
      if (size.width < 768) expect(card.x).toBe(12);
    });

    test('"+ Thêm" một chạm: đúng một lệnh POST /cart/items cho đúng phân loại, ở lại Trang chủ, báo "Đã thêm vào giỏ!", nút mở lại', async ({ page, api }) => {
      mockHome(api);
      await openHome(page);

      const added = api.waitForCall('POST', '/cart/items');
      await adds(page).nth(1).click();
      const call = await added;
      expect(call.body).toEqual({ variationId: 'var-q2', quantity: 1, addSource: 'repurchase' });
      await expect(page.getByText('Đã thêm vào giỏ!')).toBeVisible();
      await expect(adds(page).nth(1)).toBeEnabled();
      await expect(page).toHaveURL(/\/$/);
      expect(api.callsTo('POST', '/cart/items')).toHaveLength(1);
      expect(api.callsTo('POST', '/cart/items/batch')).toHaveLength(0);
    });

    test('"Thêm lại tất cả": một lệnh POST /cart/items/batch, mỗi món còn hàng một đơn vị, ở lại Trang chủ', async ({ page, api }) => {
      mockHome(api);
      await openHome(page);

      await addAll(page).click();
      await expect(page.getByText(`Đã thêm ${IN_STOCK.length} món vào giỏ`).first()).toBeVisible();
      const calls = api.callsTo('POST', '/cart/items/batch');
      expect(calls).toHaveLength(1);
      expect(calls[0]!.body).toEqual({ items: IN_STOCK.map((i) => ({ variationId: i.variationId, quantity: 1 })), addSource: 'ctv_sheet' });
      expect(api.callsTo('POST', '/cart/items')).toHaveLength(0);
      await expect(page).toHaveURL(/\/$/);
      await expect(addAll(page)).toBeEnabled();
    });

    test('"Thêm lại tất cả" bị từ chối (một món hết hàng): đọc lời của máy chủ, không báo đã thêm, dải còn nguyên', async ({ page, api }) => {
      mockHome(api);
      api.post('/cart/items/batch', reply(400, { code: 'CART_BATCH_REJECTED', message: 'Sản phẩm Món quen 4 đã hết hàng.' }));
      await openHome(page);

      await addAll(page).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Sản phẩm Món quen 4 đã hết hàng.' })).toBeVisible();
      await expect(page.getByText(/Đã thêm \d+ món vào giỏ/)).toHaveCount(0);
      expect(await cards(page).count()).toBe(IN_STOCK.length);
      await expect(addAll(page)).toBeEnabled();
    });

    test('chạm thân thẻ mở trang sản phẩm đúng món', async ({ page, api }) => {
      mockHome(api);
      await openHome(page);
      await cards(page).nth(2).locator('button.tubu-quick-open').click();
      await expect(page).toHaveURL(/\/san-pham\/san-pham-q4(\?.*)?$/, { timeout: 10_000 });
    });

    test('khách chỉ có một món đã mua: không có dải, vẫn là dòng "Mua lại" một món', async ({ page, api }) => {
      mockHome(api, [bought(1)]);
      await page.addInitScript(() => localStorage.setItem('tubu_web_session', '1'));
      await page.goto('/');
      await expect(page.getByTestId('rebuy-line')).toBeVisible({ timeout: 15_000 });
      await expect(strip(page)).toHaveCount(0);
    });

    test('hai món đã mua nhưng chỉ một còn hàng (dưới 2 món): không có dải, giữ kệ "Mua lại" cũ', async ({ page, api }) => {
      mockHome(api, [bought(1), bought(2, { stock: 0, inStock: false })]);
      await page.addInitScript(() => localStorage.setItem('tubu_web_session', '1'));
      await page.goto('/');
      await expect(page.getByRole('region', { name: 'Mua lại', exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(strip(page)).toHaveCount(0);
    });
  });
}
