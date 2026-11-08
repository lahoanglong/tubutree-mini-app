import type { Locator, Page } from '@playwright/test';
import type { PurchasedItem } from '../../miniapp/src/services/shop-api';
import { test, expect, reply, type MockApi } from './support/mock-api';
import { mockBuyFlowSession, PURCHASED, THUMB } from './support/buy-flow-mocks';

/**
 * W43A, Mini App: dải "Mua lại món quen" ở Trang chủ. API mock toàn bộ; khách cũ đã được nhớ là "returning" (khối chỉ có chỗ khi đó).
 * Khách có 5 món đã mua trong đó 1 món hết hàng, nên dải còn 4 thẻ. Không đặt đơn thật.
 */
const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
  { width: 393, height: 852 },
] as const;

const bought = (n: number, over: Partial<PurchasedItem> = {}): PurchasedItem => ({
  ...PURCHASED,
  variationId: `var-q${n}`,
  productId: `prod-q${n}`,
  slug: `san-pham-q${n}`,
  productName: `Món quen ${n}`,
  variationName: '',
  thumbnail: THUMB,
  price: 40_000 + n * 10_000,
  timesBought: n === 1 ? 5 : 1,
  ...over,
});
const ITEMS = [bought(1), bought(2), bought(3, { stock: 0, inStock: false }), bought(4), bought(5)];
const IN_STOCK = ITEMS.filter((i) => i.inStock !== false);
const PURCHASED_PAGE = { items: ITEMS, nextCursor: null };
const EMPTY_CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200_000, itemCount: 0 };

const strip = (page: Page) => page.getByTestId('quick-reorder');
const cards = (page: Page) => page.getByTestId('quick-reorder-card');
const adds = (page: Page) => page.getByTestId('quick-reorder-add');
const addAll = (page: Page) => page.getByRole('button', { name: /^Thêm lại tất cả \d+ món vào giỏ/ });
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function expectTouchTarget44(t: Locator): Promise<void> {
  const b = (await t.boundingBox())!;
  expect(b.width, 'chiều rộng vùng chạm').toBeGreaterThanOrEqual(44);
  expect(b.height, 'chiều cao vùng chạm').toBeGreaterThanOrEqual(44);
}

async function seedReturning(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('tubu_home_kind', JSON.stringify({ userId: 'user-4a', kind: 'returning' }));
  });
}

function mockHome(api: MockApi, purchased: { items: PurchasedItem[]; nextCursor: null } = PURCHASED_PAGE): void {
  mockBuyFlowSession(api, { purchased });
  api.post('/cart/items/batch', { ...EMPTY_CART, itemCount: IN_STOCK.length });
}

async function openHome(page: Page): Promise<void> {
  await seedReturning(page);
  await page.goto('/');
  await expect(strip(page)).toBeVisible({ timeout: 20_000 });
  await expect(cards(page).first()).toBeVisible();
}

for (const vp of VIEWPORTS) {
  test.describe(`Mini App ${vp.width}px: dải Mua lại món quen`, () => {
    test.use({ viewport: vp });

    test('dải thế chỗ kệ Mua lại (trên Danh mục), chỉ món còn hàng, mọi nút từ 44px, không tràn ngang', async ({ page, api }) => {
      mockHome(api);
      await openHome(page);

      await expect(page.getByRole('heading', { level: 2, name: 'Mua lại món quen' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Mua lại', exact: true })).toHaveCount(0);
      expect(await cards(page).count()).toBe(IN_STOCK.length);
      await expect(cards(page).filter({ hasText: 'Món quen 3' })).toHaveCount(0);
      await expect(cards(page).first()).toContainText('Món quen 1');
      await expect(cards(page).first()).toContainText('Đã mua 5 lần');

      const box = (await strip(page).boundingBox())!;
      const categories = (await page.getByRole('region', { name: 'Danh mục', exact: true }).boundingBox())!;
      const search = (await page.getByRole('button', { name: 'Bạn tìm gì hôm nay?' }).boundingBox())!;
      expect(box.y).toBeGreaterThan(search.y);
      expect(box.y + box.height).toBeLessThanOrEqual(categories.y + 1);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width);

      await expectTouchTarget44(addAll(page));
      const n = await adds(page).count();
      for (let i = 0; i < n; i += 1) {
        await adds(page).nth(i).scrollIntoViewIfNeeded();
        await expectTouchTarget44(adds(page).nth(i));
        await expectTouchTarget44(cards(page).nth(i).locator('button.tubu-quick-open'));
      }
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  });
}

test.describe('Mini App 375px: dải Mua lại món quen, thao tác', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('khung chờ cao đúng dải thật (292px) nên dữ liệu về không đẩy Danh mục', async ({ page, api }) => {
    mockHome(api);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    api.get('/me/purchased-items', async () => {
      await gate;
      return PURCHASED_PAGE;
    });
    await page.addInitScript(() => {
      localStorage.setItem('tubu_home_purchased', 'many');
    });
    await seedReturning(page);
    await page.goto('/');

    const skeleton = page.getByTestId('purchased-rail-loading');
    await expect(skeleton).toBeVisible({ timeout: 15_000 });
    const skeletonBox = (await skeleton.boundingBox())!;
    const belowBefore = (await page.getByRole('region', { name: 'Danh mục', exact: true }).boundingBox())!;
    release();

    await expect(strip(page)).toBeVisible({ timeout: 15_000 });
    await expect(skeleton).toHaveCount(0);
    const stripBox = (await strip(page).boundingBox())!;
    const belowAfter = (await page.getByRole('region', { name: 'Danh mục', exact: true }).boundingBox())!;

    // Số đo thật của dải, để báo lại cho người duyệt.
    console.log(`W43A strip height ${stripBox.height}px, skeleton ${skeletonBox.height}px`);
    expect(Math.abs(skeletonBox.height - stripBox.height), `khung chờ ${skeletonBox.height}px vs dải ${stripBox.height}px`).toBeLessThanOrEqual(2);
    expect(Math.abs(belowAfter.y - belowBefore.y), 'Danh mục bị đẩy khi dải về').toBeLessThanOrEqual(2);
  });

  test('"+ Thêm" một chạm: đúng một lệnh POST /cart/items cho đúng phân loại, ở lại Trang chủ, nút mở lại', async ({ page, api }) => {
    mockHome(api);
    await openHome(page);

    const added = api.waitForCall('POST', '/cart/items');
    await adds(page).nth(1).click();
    const call = await added;
    expect(call.body).toEqual({ variationId: 'var-q2', quantity: 1, addSource: 'repurchase' });
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
    expect(calls[0]!.body).toEqual({
      items: IN_STOCK.map((i) => ({ variationId: i.variationId, quantity: 1 })),
      addSource: 'ctv_sheet',
    });
    expect(api.callsTo('POST', '/cart/items')).toHaveLength(0);
    await expect(page).toHaveURL(/\/$/);
    await expect(addAll(page)).toBeEnabled();
  });

  test('"Thêm lại tất cả" bị từ chối (một món hết hàng): đọc lời của máy chủ, không báo đã thêm, dải còn nguyên', async ({ page, api }) => {
    mockHome(api);
    api.post('/cart/items/batch', reply(400, { code: 'CART_BATCH_REJECTED', message: 'Sản phẩm Món quen 4 đã hết hàng.' }));
    await openHome(page);

    await addAll(page).click();
    await expect(page.getByText('Sản phẩm Món quen 4 đã hết hàng.').first()).toBeVisible();
    await expect(page.getByText(/Đã thêm \d+ món vào giỏ/)).toHaveCount(0);
    expect(await cards(page).count()).toBe(IN_STOCK.length);
    await expect(addAll(page)).toBeEnabled();
  });

  test('chạm thân thẻ mở chi tiết món đúng phân loại đã mua', async ({ page, api }) => {
    mockHome(api);
    await openHome(page);
    await cards(page).nth(2).locator('button.tubu-quick-open').click();
    await expect(page).toHaveURL(/\/product\/san-pham-q4$/, { timeout: 10_000 });
  });

  test('khách chỉ có một món đã mua: không có dải, vẫn là dòng "Mua lại" một món', async ({ page, api }) => {
    mockHome(api, { items: [bought(1)], nextCursor: null });
    await seedReturning(page);
    await page.goto('/');
    await expect(page.getByTestId('rebuy-line')).toBeVisible({ timeout: 15_000 });
    await expect(strip(page)).toHaveCount(0);
  });

  test('hai món đã mua nhưng chỉ một còn hàng (dưới 2 món): không có dải, giữ kệ "Mua lại" cũ', async ({ page, api }) => {
    mockHome(api, { items: [bought(1), bought(2, { stock: 0, inStock: false })], nextCursor: null });
    await seedReturning(page);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Mua lại', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(strip(page)).toHaveCount(0);
  });
});
