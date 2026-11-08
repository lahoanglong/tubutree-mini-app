import type { Locator, Page } from '@playwright/test';
import type { ProductCard } from '../../miniapp/src/services/shop-api';
import { test, expect, reply, type MockApi } from './support/mock-api';
import { mockPilotProduct, PILOT_PRODUCT, PILOT_SLUG } from './support/pilot-mocks';
import { THUMB } from './support/buy-flow-mocks';

/**
 * W43A, Mini App: khối "Gợi ý mua kèm hợp vị" ở trang chi tiết. API mock toàn bộ. Món đang xem 65.000đ (phân loại `var-1`), "Khách thường mua cùng"
 * trả 5 món: hai món đầu vào khối (Bơ 50.000đ giảm còn 40.000đ, Dâu 30.000đ), ba món sau ở lại dải bên dưới. Không đặt đơn thật.
 */
const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
  { width: 393, height: 852 },
] as const;

const card = (n: number, name: string, basePrice: number, salePrice: number | null = null): ProductCard => ({
  id: `prod-b${n}`,
  slug: `mon-b${n}`,
  brand: 'Tubu',
  name,
  thumbnail: THUMB,
  basePrice,
  salePrice,
  isFeatured: false,
  inStock: true,
  repVariationId: `var-b${n}`,
});
const TOGETHER = [card(1, 'Bơ sáp', 50_000, 40_000), card(2, 'Dâu tây', 30_000), card(3, 'Mận hậu', 35_000), card(4, 'Ổi lê', 25_000), card(5, 'Xoài cát', 45_000)];
const EMPTY_CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200_000, itemCount: 0 };

const fbt = (page: Page) => page.getByTestId('fbt');
const rows = (page: Page) => page.getByTestId('fbt-row');
const addButton = (page: Page) => page.getByTestId('fbt-add');
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function expectTouchTarget44(t: Locator): Promise<void> {
  const b = (await t.boundingBox())!;
  expect(b.width, 'chiều rộng vùng chạm').toBeGreaterThanOrEqual(44);
  expect(b.height, 'chiều cao vùng chạm').toBeGreaterThanOrEqual(44);
}

function mockPdp(api: MockApi, opts: { stock?: number } = {}): void {
  mockPilotProduct(api);
  api.get('/products/:slug', { ...PILOT_PRODUCT, variations: [{ ...PILOT_PRODUCT.variations[0]!, stock: opts.stock ?? 50 }] });
  api.get('/products/:slug/bought-together', TOGETHER);
  api.get('/cart', EMPTY_CART);
  api.post('/cart/items/batch', { ...EMPTY_CART, itemCount: 3 });
}

async function openPdp(page: Page): Promise<void> {
  await page.goto(`/product/${PILOT_SLUG}`);
  await expect(fbt(page)).toBeVisible({ timeout: 20_000 });
  await expect(rows(page).first()).toBeVisible();
}

for (const vp of VIEWPORTS) {
  test.describe(`Mini App ${vp.width}px: Gợi ý mua kèm hợp vị`, () => {
    test.use({ viewport: vp });

    test('món đang xem + 2 món bổ trợ, chọn hết; mọi dòng và nút từ 44px; dải bên dưới không lặp lại 2 món đó; không tràn ngang', async ({ page, api }) => {
      mockPdp(api);
      await openPdp(page);

      await expect(page.getByRole('heading', { level: 2, name: 'Gợi ý mua kèm hợp vị' })).toBeVisible();
      await expect(rows(page)).toHaveCount(3);
      await expect(rows(page).nth(0)).toHaveAttribute('data-variation-id', 'var-1');
      await expect(rows(page).nth(0)).toContainText('Món đang xem');
      await expect(rows(page).nth(1)).toContainText('Bơ sáp');
      await expect(rows(page).nth(2)).toContainText('Dâu tây');
      for (let i = 0; i < 3; i += 1) await expect(rows(page).nth(i)).toHaveAttribute('aria-checked', 'true');
      await expect(addButton(page)).toHaveText('Thêm 3 món vào giỏ · 135.000đ');
      await expect(page.getByTestId('fbt-save')).toHaveText('Tiết kiệm 10.000đ');

      const box = (await fbt(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
      for (let i = 0; i < 3; i += 1) {
        await rows(page).nth(i).scrollIntoViewIfNeeded();
        await expectTouchTarget44(rows(page).nth(i));
      }
      await addButton(page).scrollIntoViewIfNeeded();
      await expectTouchTarget44(addButton(page));

      const title = (await page.getByRole('heading', { level: 1 }).first().boundingBox())!;
      expect(box.y, 'khối nằm dưới thông tin chính').toBeGreaterThan(title.y);

      const rail = page.getByRole('region', { name: 'Khách thường mua cùng' });
      await expect(rail).toBeAttached();
      await expect(rail).toContainText('Mận hậu');
      await expect(rail).toContainText('Xoài cát');
      await expect(rail).not.toContainText('Bơ sáp');
      await expect(rail).not.toContainText('Dâu tây');
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  });
}

test.describe('Mini App 375px: Gợi ý mua kèm hợp vị, thao tác', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('bỏ tick / tick lại: số món, tổng và dòng tiết kiệm đổi theo, nút không nhảy chỗ; bỏ hết thì nút khoá', async ({ page, api }) => {
    mockPdp(api);
    await openPdp(page);
    await addButton(page).scrollIntoViewIfNeeded();
    const before = (await addButton(page).boundingBox())!;

    await rows(page).nth(1).click();
    await expect(rows(page).nth(1)).toHaveAttribute('aria-checked', 'false');
    await expect(addButton(page)).toHaveText('Thêm 2 món vào giỏ · 95.000đ');
    await expect(page.getByTestId('fbt-save')).toHaveText('');
    const after = (await addButton(page).boundingBox())!;
    expect(Math.abs(after.y - before.y), 'nút bị đẩy khi dòng tiết kiệm đổi').toBeLessThanOrEqual(1);

    await rows(page).nth(1).click();
    await expect(addButton(page)).toHaveText('Thêm 3 món vào giỏ · 135.000đ');
    await expect(page.getByTestId('fbt-save')).toHaveText('Tiết kiệm 10.000đ');

    for (let i = 0; i < 3; i += 1) await rows(page).nth(i).click();
    await expect(addButton(page)).toBeDisabled();
    await expect(addButton(page)).toHaveText('Chọn món muốn thêm');
    expect(api.callsTo('POST', '/cart/items/batch')).toHaveLength(0);
  });

  test('bàn phím: Space trên dòng đổi tick', async ({ page, api }) => {
    mockPdp(api);
    await openPdp(page);
    await rows(page).nth(2).focus();
    await page.keyboard.press('Space');
    await expect(rows(page).nth(2)).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Enter');
    await expect(rows(page).nth(2)).toHaveAttribute('aria-checked', 'true');
  });

  test('"Thêm 3 món vào giỏ": một lệnh POST /cart/items/batch cho đúng 3 phân loại (mỗi món 1), báo đã thêm, ở lại trang', async ({ page, api }) => {
    mockPdp(api);
    await openPdp(page);

    await addButton(page).click();
    await expect(page.getByText('Đã thêm 3 món vào giỏ').first()).toBeVisible();
    const calls = api.callsTo('POST', '/cart/items/batch');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({
      items: [
        { variationId: 'var-1', quantity: 1 },
        { variationId: 'var-b1', quantity: 1 },
        { variationId: 'var-b2', quantity: 1 },
      ],
      addSource: 'ctv_sheet',
    });
    expect(api.callsTo('POST', '/cart/items')).toHaveLength(0);
    await expect(page).toHaveURL(new RegExp(`/product/${PILOT_SLUG}$`));
    await expect(addButton(page)).toBeEnabled();
  });

  test('bỏ tick một món rồi thêm: lệnh chỉ có các món còn tick', async ({ page, api }) => {
    mockPdp(api);
    await openPdp(page);

    await rows(page).nth(1).click();
    await addButton(page).click();
    await expect(page.getByText('Đã thêm 2 món vào giỏ').first()).toBeVisible();
    const calls = api.callsTo('POST', '/cart/items/batch');
    expect(calls).toHaveLength(1);
    expect((calls[0]!.body as { items: unknown[] }).items).toEqual([
      { variationId: 'var-1', quantity: 1 },
      { variationId: 'var-b2', quantity: 1 },
    ]);
  });

  test('bị từ chối (một món hết hàng): đọc lời của máy chủ, không báo đã thêm, lựa chọn của khách còn nguyên', async ({ page, api }) => {
    mockPdp(api);
    api.post('/cart/items/batch', reply(400, { code: 'CART_BATCH_REJECTED', message: 'Sản phẩm Dâu tây đã hết hàng.' }));
    await openPdp(page);

    await rows(page).nth(1).click();
    await addButton(page).click();
    await expect(page.getByText('Sản phẩm Dâu tây đã hết hàng.').first()).toBeVisible();
    await expect(page.getByText(/Đã thêm \d+ món vào giỏ/)).toHaveCount(0);
    await expect(rows(page).nth(1)).toHaveAttribute('aria-checked', 'false');
    await expect(addButton(page)).toBeEnabled();
  });

  test('món đang xem hết hàng: không có khối, dải "Khách thường mua cùng" giữ đủ món', async ({ page, api }) => {
    mockPdp(api, { stock: 0 });
    await page.goto(`/product/${PILOT_SLUG}`);
    const rail = page.getByRole('region', { name: 'Khách thường mua cùng' });
    await expect(rail).toBeAttached({ timeout: 20_000 });
    await expect(rail).toContainText('Bơ sáp');
    await expect(fbt(page)).toHaveCount(0);
  });
});
