import type { Locator, Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { mockMergedHome } from './support/home-merged';

const card = (n: number) => ({
  id: `bj-${n}`, slug: `bj-sp-${n}`, brand: 'Tubu', name: `Món nhãn ${n}`, thumbnail: null, basePrice: 100_000 + n, salePrice: null, isFeatured: false, inStock: true,
  ratingAvg: 4.6, reviewCount: 9, sold: 120 + n,
});

/** Tiêu đề nhãn dừng đúng mép `scroll-padding-top` của html (ngay dưới thanh đầu dính, globals.css), không thấp hơn vì cộng thêm khoảng chừa riêng. */
async function expectAtScrollPadding(page: Page, target: Locator) {
  const pad = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop));
  const top = Math.round((await target.boundingBox())!.y);
  expect(Math.abs(top - pad), `tiêu đề nhãn ở y=${top}, scroll-padding-top ${pad}px`).toBeLessThanOrEqual(2);
}

function mockHome(api: MockApi) {
  api.get('/me/subscriptions', []);
  api.get('/me/wishlist/ids', []);
  api.get('/flash-sales/upcoming', []);
  mockMergedHome(api);
  api.get('/products', ({ call }) => {
    const limit = Number(call.query.get('limit') ?? '20');
    return { data: Array.from({ length: limit }, (_, i) => card(i + 1)), meta: { page: 1, limit, total: limit }, filtersIgnored: false };
  });
}

/**
 * Web 375px và 1280px, hàng chip Thương hiệu (w34-02): chạm chip của nhãn cuối thì trang dừng đúng tiêu đề nhãn đó dù các nhãn phía trên chưa tải lúc chạm.
 * Nhãn chưa tới gần khung nhìn giữ chỗ cao đúng lưới thật (2 cột điện thoại, 4 cột từ lg) nên khi chúng tải trong lúc cuộn, đích không bị đẩy xuống.
 */
for (const width of [375, 1280]) {
  test(`${width}px: chỗ giữ của nhãn chưa tải cao đúng lưới thật; chạm chip "Visante" dừng tiêu đề nhãn ở đầu khung nhìn`, async ({ page, api }) => {
    await page.setViewportSize({ width, height: 812 });
    mockHome(api);
    await page.goto('/');
    const chip = page.getByTestId('home-brand-bar').getByRole('button', { name: 'Visante', exact: true });
    await expect(chip).toBeVisible({ timeout: 20_000 });
    const target = page.locator('#home-brand-visante');
    const reserve = target.getByTestId('catalog-grid-reserve');
    await expect(reserve).toHaveCount(1, { timeout: 15_000 });
    const reserved = (await reserve.boundingBox())!.height;

    await chip.click();
    await expect(target.getByTestId('catalog-grid').locator('[data-ds="product-tile"]')).toHaveCount(4, { timeout: 15_000 });
    const grid = (await target.getByTestId('catalog-grid').boundingBox())!.height;
    expect(Math.abs(grid - reserved), `lưới thật ${grid}px, chỗ giữ ${reserved}px`).toBeLessThanOrEqual(1);
    await page.waitForTimeout(1_000);
    await expectAtScrollPadding(page, target);
  });
}

/**
 * Khung nhìn thấp (240px) để khối "Khám phá theo Thương hiệu" còn là khung giữ chỗ của `DeferUntilNear` lúc chạm chip: chip vẫn cuộn tới nhãn trên chính
 * Trang chủ (khối dựng rồi cuộn tiếp), không đổi sang trang nhãn.
 */
test('375px: chạm chip khi khối thương hiệu còn hoãn dưới màn đầu thì vẫn ở Trang chủ và dừng ở tiêu đề nhãn', async ({ page, api }) => {
  await page.setViewportSize({ width: 375, height: 240 });
  mockHome(api);
  await page.goto('/');
  const chip = page.getByTestId('home-brand-bar').getByRole('button', { name: 'Visante', exact: true });
  await expect(chip).toBeAttached({ timeout: 20_000 });
  await expect(page.locator('[data-home-block="suggest"] [data-testid="home-defer"]')).toHaveCount(1);
  await expect(page.locator('#home-brand-visante')).toHaveCount(0);

  await chip.click();
  const target = page.locator('#home-brand-visante');
  await expect(target.getByTestId('catalog-grid').locator('[data-ds="product-tile"]')).toHaveCount(4, { timeout: 15_000 });
  await page.waitForTimeout(1_000);
  expect(new URL(page.url()).pathname).toBe('/');
  await expectAtScrollPadding(page, target);
});
