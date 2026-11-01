import type { Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { mockDiscovery, BINH_SUA, NRC } from './support/discovery-mocks';

/**
 * Mini App 375px — gói G5 (P2 #2, #6): danh mục quá một màn có "Xem tất cả" ở tiêu đề và cột thứ 6 ló nửa cột; thẻ không in lại thương hiệu
 * khi tên đã chứa nó mà vẫn giữ khe nên tên và giá thẳng hàng với thẻ bên cạnh. API mock toàn bộ, đo bằng trình duyệt thật (WebKit).
 */
const root = (i: number) => ({ id: `r${i}`, parentId: null, name: `Gốc ${i}`, slug: `r${i}`, image: null, sortOrder: i, productCount: 5, children: [] });
const roots = (n: number) => Array.from({ length: n }, (_, i) => root(i + 1));

function mockRoots(api: MockApi, n: number): void {
  mockDiscovery(api, { returning: true });
  api.get('/categories', roots(n));
}

const homeCategories = (page: Page) => page.getByRole('region', { name: 'Danh mục', exact: true }).first();

test.describe('Danh mục quá một màn', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('Trang chủ 10 gốc: tiêu đề có "Xem tất cả Danh mục" mở hub, ô "Tất cả danh mục" ló nửa cột ở mép phải', async ({ page, api }) => {
    mockRoots(api, 10);
    await page.goto('/');
    const cats = homeCategories(page);
    await expect(cats.getByRole('button', { name: 'Gốc 1', exact: true })).toBeVisible({ timeout: 30_000 });
    const all = cats.getByRole('button', { name: 'Tất cả danh mục', exact: true });
    const box = (await all.boundingBox())!;
    expect(box.x, 'cột 6 bắt đầu trong 300–360px').toBeGreaterThanOrEqual(300);
    expect(box.x).toBeLessThanOrEqual(360);
    expect(box.x + box.width, 'cột 6 tràn qua mép phải màn').toBeGreaterThan(375);
    await cats.getByRole('button', { name: 'Xem tất cả Danh mục', exact: true }).click();
    await expect(page).toHaveURL(/\/browse$/, { timeout: 15_000 });
  });

  test('Trang chủ 9 gốc (10 ô vừa một màn): không có "Xem tất cả" ở tiêu đề, "Tất cả danh mục" nằm gọn trong màn', async ({ page, api }) => {
    mockRoots(api, 9);
    await page.goto('/');
    const cats = homeCategories(page);
    await expect(cats.getByRole('button', { name: 'Gốc 9', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(cats.getByRole('button', { name: 'Xem tất cả Danh mục', exact: true })).toHaveCount(0);
    const box = (await cats.getByRole('button', { name: 'Tất cả danh mục', exact: true }).boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  });

  test('hub 10 gốc: hiện 8 ô + "Tất cả", tiêu đề có "Xem tất cả Danh mục" dẫn tới danh sách không lọc', async ({ page, api }) => {
    mockRoots(api, 10);
    await page.goto('/browse');
    const cats = page.getByRole('region', { name: 'Danh mục', exact: true });
    await expect(cats.getByRole('button', { name: 'Gốc 8', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(cats.getByRole('button', { name: 'Gốc 9', exact: true })).toHaveCount(0);
    await cats.getByRole('button', { name: 'Xem tất cả Danh mục', exact: true }).click();
    await expect(page).toHaveURL(/\/browse\?all=1$/, { timeout: 15_000 });
  });

  test('hub 8 gốc: không có "Xem tất cả" ở tiêu đề (ô "Tất cả" cuối lưới đủ)', async ({ page, api }) => {
    mockRoots(api, 8);
    await page.goto('/browse');
    const cats = page.getByRole('region', { name: 'Danh mục', exact: true });
    await expect(cats.getByRole('button', { name: 'Gốc 8', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(cats.getByRole('button', { name: 'Xem tất cả Danh mục', exact: true })).toHaveCount(0);
    await expect(cats.getByRole('button', { name: 'Tất cả', exact: true })).toBeVisible();
  });
});

test.describe('Thẻ không lặp thương hiệu', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('lưới: tên chứa thương hiệu ("… Tubu …") không in dòng thương hiệu nhưng tên và đáy giá thẳng hàng với thẻ cùng hàng có thương hiệu', async ({ page, api }) => {
    mockDiscovery(api, { returning: true });
    await page.goto('/browse?all=1');
    const grid = page.getByTestId('catalog-grid');
    const tileOf = (name: string) => grid.locator('[data-ds="product-tile"]').filter({ has: page.getByRole('button', { name, exact: true }) });
    const withBrand = tileOf(BINH_SUA.name);
    const withoutLine = tileOf(NRC.name);
    await expect(withBrand).toBeVisible({ timeout: 30_000 });
    await expect(withoutLine).toBeVisible();
    await expect(withBrand.locator('[data-ds-part="brand"]')).toHaveText(BINH_SUA.brand);
    await expect(withoutLine.locator('[data-ds-part="brand"]')).toHaveText('');

    const metrics = (tile: typeof withBrand) =>
      tile.evaluate((el) => ({
        tileTop: Math.round(el.getBoundingClientRect().top),
        nameTop: Math.round(el.querySelector<HTMLElement>('[data-ds-part="body"] button[aria-label] > span')!.getBoundingClientRect().top),
        priceBottom: Math.round(el.querySelector<HTMLElement>('[data-ds-part="price"]')!.getBoundingClientRect().bottom),
        brandHeight: Math.round(el.querySelector<HTMLElement>('[data-ds-part="brand"]')!.getBoundingClientRect().height),
      }));
    const [a, b] = [await metrics(withBrand), await metrics(withoutLine)];
    expect(b.tileTop, 'hai thẻ cùng hàng').toBe(a.tileTop);
    expect(b.brandHeight, 'khe thương hiệu vẫn cao bằng thẻ có thương hiệu').toBe(a.brandHeight);
    expect(Math.abs(a.nameTop - b.nameTop), 'tên cùng một dòng đầu').toBeLessThanOrEqual(1);
    expect(Math.abs(a.priceBottom - b.priceBottom), 'đáy giá thẳng hàng').toBeLessThanOrEqual(1);
  });
});
