import { test, expect, reply } from './support/mock-api';
import { BRAND_SLUG, COMBO_TITLE, EMPTY_CART, SHOP_SLUG, SHOP_TITLE, mockBrandPage, mockShopPage } from './support/shop-page-mocks';
import type { Page } from '@playwright/test';

/**
 * Trang shop (gian hàng CTV `/s/:slug`, thương hiệu `/brand/:slug`) ở Mini App, 375px: đầu shop, hàng số liệu, tab Shop | Sản phẩm | Danh mục,
 * khối vẽ theo `layout`, tab Sản phẩm sắp xếp + "Xem thêm", tên shop trên thanh đầu khi cuộn, "Thêm cả combo" tất cả hoặc không.
 * Toàn bộ API được mock (không cần API/DB); trang chỉ đọc, nên mọi lời gọi không phải GET chỉ là analytics đã cho phép.
 */
test.use({ viewport: { width: 375, height: 812 } });

const tiles = (page: Page) => page.locator('[data-ds="product-tile"]');
const firstTileName = (page: Page) => tiles(page).first().getByRole('button').first();

test.describe('Trang gian hàng CTV (Mini App)', () => {
  test.beforeEach(({ api }) => mockShopPage(api));

  test('màn đầu: tên shop (h1), hàng số liệu, tab, và ba khối vẽ đúng layout', async ({ page }) => {
    await page.goto(`/s/${SHOP_SLUG}`);
    await expect(page.getByRole('heading', { level: 1, name: SHOP_TITLE })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('group', { name: '45 sản phẩm' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Shop', selected: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Sản phẩm (45)' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Danh mục' })).toBeVisible();

    await expect(page.getByTestId('shop-rail').locator('[data-ds="product-tile"]')).toHaveCount(10);
    await expect(page.getByTestId('shop-grid').locator('[data-ds="product-tile"]')).toHaveCount(6);
    await expect(page.getByTestId('shop-combo')).toBeVisible();
    // Bậc thấp nhất không khoe cho khách (publicBadge=false).
    await expect(page.getByText('Tân binh')).toHaveCount(0);
    // Ghi chú của chủ shop nằm trong thẻ, không có hộp xanh ngoài thẻ.
    await expect(page.getByTestId('shop-rail').getByText('Mình dùng mỗi ngày')).toBeVisible();
  });

  test('kệ ngang sát mép như Trang chủ và web: thẻ đầu kệ cách mép trái 12px (đệm của kệ), không thụt thêm 16px của lề trang', async ({ page }) => {
    await page.goto(`/s/${SHOP_SLUG}`);
    const first = page.getByTestId('shop-rail').locator('[data-ds="product-tile"]').first();
    await expect(first).toBeVisible({ timeout: 15_000 });
    const title = (await page.getByRole('heading', { level: 2, name: 'Bếp xanh' }).boundingBox())!;
    const tile = (await first.boundingBox())!;
    expect(tile.x).toBeGreaterThanOrEqual(11);
    expect(tile.x).toBeLessThanOrEqual(13);
    expect(title.x).toBeGreaterThanOrEqual(15);
    expect(title.x).toBeLessThanOrEqual(17);
  });

  test('tab Sản phẩm: 20 thẻ, "Xem thêm" lên 40, sắp xếp "Mới" đổi thẻ đầu', async ({ page }) => {
    await page.goto(`/s/${SHOP_SLUG}`);
    await page.getByRole('tab', { name: 'Sản phẩm (45)' }).click();
    await expect(tiles(page)).toHaveCount(20);
    await expect(firstTileName(page)).toHaveAccessibleName(/Sản phẩm 01/);
    await page.getByRole('button', { name: 'Xem thêm', exact: true }).click();
    await expect(tiles(page)).toHaveCount(40);
    await page.getByRole('button', { name: 'Mới' }).click();
    await expect(tiles(page)).toHaveCount(20);
    await expect(firstTileName(page)).toHaveAccessibleName(/Sản phẩm 45/);
  });

  test('"Tất cả (20)" của kệ chuyển sang tab Sản phẩm lọc theo bộ đó; chip gỡ lọc', async ({ page }) => {
    await page.goto(`/s/${SHOP_SLUG}`);
    await page.getByRole('button', { name: 'Xem tất cả 20 sản phẩm trong Bếp xanh' }).click();
    await expect(page.getByRole('tab', { name: /^Sản phẩm/, selected: true })).toBeVisible();
    await expect(tiles(page)).toHaveCount(20);
    await page.getByRole('button', { name: 'Bếp xanh, bỏ lọc' }).click();
    await page.getByRole('button', { name: 'Xem thêm', exact: true }).click();
    await expect(tiles(page)).toHaveCount(40);
  });

  test('cuộn qua bìa thì thanh đầu hiện tên shop', async ({ page }) => {
    await page.goto(`/s/${SHOP_SLUG}`);
    const bar = page.getByTestId('shop-top-bar');
    await expect(page.getByRole('heading', { level: 1, name: SHOP_TITLE })).toBeVisible({ timeout: 15_000 });
    await expect(bar).toHaveAttribute('aria-hidden', 'true');
    // Mobile WebKit không có mouse.wheel; Mini App cuộn ở `.zaui-page` (không phải window).
    await page.evaluate(() => {
      const scroller = document.querySelector('.zaui-page');
      if (scroller) scroller.scrollTop = 500;
      else window.scrollTo(0, 500);
    });
    await expect(bar).toHaveAttribute('aria-hidden', 'false');
    await expect(bar).toHaveText(SHOP_TITLE);
    // Chữ phải nhìn thấy được, không bị nền đặc của nút lùi che (thanh tên shop không bắt chạm nên elementFromPoint bỏ qua nó): thanh phải nằm trên nền đó.
    const z = await page.evaluate(() => ({
      title: Number(getComputedStyle(document.querySelector('[data-testid="shop-top-bar"]')!).zIndex),
      back: Number(getComputedStyle(document.querySelector('[data-back-bar]')!).zIndex),
    }));
    expect(z.title).toBeGreaterThan(z.back);
  });

  test('"Thêm cả combo" bị từ chối cả lô: báo lỗi, giỏ không bị tải lại hay thay đổi', async ({ page, api }) => {
    api.post('/cart/items/batch', reply(400, { code: 'CART_BATCH_REJECTED', message: 'Sản phẩm Sản phẩm 44 đã hết hàng.' }));
    await page.goto(`/s/${SHOP_SLUG}`);
    const add = page.getByRole('button', { name: new RegExp(`^Thêm cả combo ${COMBO_TITLE}`) });
    await expect(add).toBeVisible({ timeout: 15_000 });
    const cartReadsBefore = api.callsTo('GET', '/cart').length;
    await add.click();
    await expect(page.getByText('Sản phẩm Sản phẩm 44 đã hết hàng.').first()).toBeVisible();
    expect(api.callsTo('POST', '/cart/items/batch')).toHaveLength(1);
    expect(api.callsTo('GET', '/cart')).toHaveLength(cartReadsBefore);
    await expect(add).toBeEnabled();
  });

  test('"Thêm cả combo" thành công: một lệnh với ba món, báo đã thêm', async ({ page, api }) => {
    api.post('/cart/items/batch', { ...EMPTY_CART, itemCount: 3 });
    await page.goto(`/s/${SHOP_SLUG}`);
    await page.getByRole('button', { name: new RegExp(`^Thêm cả combo ${COMBO_TITLE}`) }).click();
    await expect(page.getByText('Đã thêm cả combo vào giỏ').first()).toBeVisible();
    const calls = api.callsTo('POST', '/cart/items/batch');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ items: [{ variationId: 'v43', quantity: 1 }, { variationId: 'v44', quantity: 1 }, { variationId: 'v45', quantity: 1 }] });
  });

  test('chỉ đọc: không có lời gọi ghi nào ngoài analytics', async ({ page, api }) => {
    await page.goto(`/s/${SHOP_SLUG}`);
    await expect(page.getByRole('heading', { level: 1, name: SHOP_TITLE })).toBeVisible({ timeout: 15_000 });
    const writes = api.calls.filter((c) => c.method !== 'GET' && !['/events', '/affiliate/touch', '/auth/guest', '/auth/zalo-mini-app', '/auth/refresh'].includes(c.path));
    expect(writes).toEqual([]);
  });
});

test.describe('Trang thương hiệu (Mini App)', () => {
  test.beforeEach(({ api }) => mockBrandPage(api));

  test('kệ "Sản phẩm nổi bật" sát mép như web: thẻ đầu kệ cách mép trái 12px, không thụt thêm 16px', async ({ page }) => {
    await page.goto(`/brand/${BRAND_SLUG}`);
    const first = page.getByTestId('brand-featured-rail').locator('[data-ds="product-tile"]').first();
    await expect(first).toBeVisible({ timeout: 15_000 });
    const tile = (await first.boundingBox())!;
    expect(tile.x).toBeGreaterThanOrEqual(11);
    expect(tile.x).toBeLessThanOrEqual(13);
  });

  test('đầu shop có Theo dõi và số liệu; tab "Sản phẩm (45)" gọi trang 1 rồi trang 2 của API thương hiệu', async ({ page, api }) => {
    await page.goto(`/brand/${BRAND_SLUG}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Fuwa' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Theo dõi' })).toBeVisible();
    await expect(page.getByRole('group', { name: '1.200 người theo dõi' })).toBeVisible();
    await page.getByRole('tab', { name: 'Sản phẩm (45)' }).click();
    await expect(tiles(page)).toHaveCount(20);
    expect(api.callsTo('GET', '/brand/public/:slug/products')[0]!.query.get('page')).toBe('1');
    await page.getByRole('button', { name: 'Xem thêm', exact: true }).click();
    await expect(tiles(page)).toHaveCount(40);
    await expect.poll(() => api.callsTo('GET', '/brand/public/:slug/products').some((c) => c.query.get('page') === '2')).toBe(true);
    await page.getByRole('button', { name: 'Xem thêm', exact: true }).click();
    await expect(tiles(page)).toHaveCount(45);
    await expect(page.getByRole('button', { name: 'Xem thêm', exact: true })).toHaveCount(0);
  });
});
