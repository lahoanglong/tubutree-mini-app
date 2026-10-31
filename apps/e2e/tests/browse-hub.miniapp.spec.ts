import type { Locator, Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { mockDiscovery } from './support/discovery-mocks';

/**
 * Zalo Mini App E2E — hub của Danh mục (gốc /browse). API mock toàn bộ; chạy trên WebKit (iPhone 12) nên vùng chạm, cuộn của
 * `.zaui-page` và vị trí thẻ đầu tiên được đo bằng trình duyệt thật. Ca "cây rỗng" và "API cũ" bảo đảm hub không cụt khi PROD chưa có
 * cây danh mục hoặc chưa có `best_seller_30d`.
 */

const hubTiles = (page: Page): Locator => page.getByRole('region', { name: 'Danh mục', exact: true });
const scrollerOf = (page: Page): Locator => page.locator('.zaui-page').first();
const productCalls = (api: MockApi) => api.callsTo('GET', '/products').map((c) => [c.query.get('sort'), c.query.get('limit')]);

test.describe('Danh mục — hub', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('gốc, danh mục phẳng: ô cho từng danh mục có hàng + "Tất cả", nút "Xem tất cả sản phẩm", không có lưới; /products chỉ gọi đúng kệ Bán chạy nhất', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse');
    const cats = hubTiles(page);
    await expect(cats.getByRole('button', { name: 'Tẩy rửa sinh học' })).toBeVisible({ timeout: 15_000 });
    await expect(cats.getByRole('button', { name: 'Cho bé' })).toBeVisible();
    await expect(cats.getByRole('button', { name: 'Cà phê & Đồ uống' })).toHaveCount(0); // productCount 0
    await expect(cats.getByRole('button', { name: 'Tất cả' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Xem tất cả sản phẩm' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Bán chạy nhất' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('catalog-grid')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Sắp xếp' })).toHaveCount(0);
    expect(productCalls(api)).toEqual([['best_seller_30d', '10']]);
  });

  test('cây danh mục thật: hub chỉ có gốc; chạm gốc có con → danh sách có hàng chip con và thẻ đầu nằm trong 200px đầu màn hình', async ({ page, api }) => {
    mockDiscovery(api, { tree: true });
    await page.goto('/browse');
    const cats = hubTiles(page);
    await expect(cats.getByRole('button', { name: 'Chăm sóc da' })).toBeVisible({ timeout: 15_000 });
    await expect(cats.getByRole('button', { name: 'Chống nắng' })).toHaveCount(0); // con không có ô ở hub
    await cats.getByRole('button', { name: 'Chăm sóc da' }).click();
    await expect(page).toHaveURL(/\/browse\?category=cat-skin$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 2, name: 'Chăm sóc da' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('2 sản phẩm', { timeout: 15_000 });
    const chips = page.getByRole('group', { name: 'Danh mục con' });
    await expect(chips.getByRole('button')).toHaveText(['Tất cả', 'Chăm sóc cá nhân', 'Chống nắng']);
    await expect(chips.getByRole('button', { name: 'Tất cả' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Bỏ lọc Chăm sóc da' })).toHaveCount(0);

    // Đo vỏ thẻ (ảnh nằm trên nút tên): ô tìm + sắp xếp + tiêu đề + chip con phải chừa thẻ đầu trong 200px đầu màn hình.
    const first = page.getByTestId('catalog-grid').locator('[data-ds="product-tile"]').first();
    await expect(first).toBeVisible();
    expect((await first.boundingBox())!.y).toBeLessThanOrEqual(200);

    await chips.getByRole('button', { name: 'Chống nắng' }).click();
    await expect(page).toHaveURL(/\/browse\?category=cat-skincare$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 2, name: 'Chống nắng' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('1 sản phẩm', { timeout: 15_000 });
  });

  test('cây rỗng ([]): hub vẫn có 4 phân khúc + "Tất cả", không có thông báo lỗi', async ({ page, api }) => {
    mockDiscovery(api, { emptyCategories: true });
    await page.goto('/browse');
    const cats = hubTiles(page);
    await expect(cats.getByRole('button', { name: 'Cho mẹ & bé' })).toBeVisible({ timeout: 15_000 });
    await expect(cats.getByRole('button')).toHaveCount(5);
    await expect(page.getByRole('button', { name: 'Xem tất cả sản phẩm' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await cats.getByRole('button', { name: 'Sống xanh' }).click();
    await expect(page).toHaveURL(/\/browse\?segment=eco$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 2, name: 'Sống xanh' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('26 sản phẩm', { timeout: 15_000 });
  });

  test('API cũ (/categories thiếu productCount, best_seller_30d bị 400): hub vẫn có 4 phân khúc và kệ Bán chạy nhất nhờ lùi về best_seller', async ({ page, api }) => {
    mockDiscovery(api, { legacy: true });
    await page.goto('/browse');
    await expect(hubTiles(page).getByRole('button')).toHaveCount(5, { timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Bán chạy nhất' })).toBeVisible({ timeout: 15_000 });
    expect(productCalls(api)).toEqual([['best_seller_30d', '10'], ['best_seller', '10']]);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Xem tất cả sản phẩm' })).toBeVisible();
  });

  test('kệ Bán chạy nhất: 10 thẻ có hạng #1…#10; "Xem tất cả" mở danh sách xếp theo bán chạy', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse');
    const shelf = page.getByRole('region', { name: 'Bán chạy nhất' });
    await expect(shelf).toBeVisible({ timeout: 15_000 });
    await expect(shelf.locator('[data-ds-part="rank"]')).toHaveText(Array.from({ length: 10 }, (_, i) => `#${i + 1}`));
    await page.getByRole('button', { name: 'Xem tất cả Bán chạy nhất' }).click();
    await expect(page).toHaveURL(/\/browse\?sort=best_seller$/, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Bán chạy', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('hub → danh sách → Back: về hub (không tải danh sách ở hub) và khôi phục vị trí cuộn của hub', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 520 });
    mockDiscovery(api);
    await page.goto('/browse');
    await expect(page.getByRole('region', { name: 'Bán chạy nhất' })).toBeVisible({ timeout: 15_000 });
    const seeAll = page.getByRole('button', { name: 'Xem tất cả sản phẩm' });
    await seeAll.scrollIntoViewIfNeeded();
    const y = await scrollerOf(page).evaluate((el) => el.scrollTop);
    expect(y, 'hub phải đủ dài để cuộn được').toBeGreaterThan(40);
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('tubu_scroll:')), { timeout: 5_000 }).toBe(String(Math.round(y)));

    await seeAll.click();
    await expect(page).toHaveURL(/\/browse\?all=1$/, { timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('30 sản phẩm', { timeout: 15_000 });
    expect(await scrollerOf(page).evaluate((el) => el.scrollTop), 'danh sách mới bắt đầu từ đầu trang').toBe(0);

    await page.goBack();
    await expect(page).toHaveURL(/\/browse$/, { timeout: 15_000 });
    await expect(hubTiles(page)).toBeVisible();
    await expect.poll(async () => Math.abs((await scrollerOf(page).evaluate((el) => el.scrollTop)) - y), { timeout: 10_000 }).toBeLessThanOrEqual(4);
  });

  test('vùng chạm: ô danh mục cao ≥ 102 (cùng khung chờ) và rộng ≥ 44; nút "Xem tất cả sản phẩm" cao ≥ 44; không tràn ngang', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse');
    const cats = hubTiles(page);
    await expect(cats.getByRole('button', { name: 'Tất cả' })).toBeVisible({ timeout: 15_000 });
    for (const tile of await cats.getByRole('button').all()) {
      const box = (await tile.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(102); // đặt chỗ cho nhãn 2 dòng: bằng khung chờ, hàng không nhảy khi dữ liệu về
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole('button', { name: 'Xem tất cả sản phẩm' }).scrollIntoViewIfNeeded();
    expect((await page.getByRole('button', { name: 'Xem tất cả sản phẩm' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => {
      const scroller = document.querySelector('.zaui-page') as HTMLElement;
      return { doc: document.documentElement.scrollWidth - window.innerWidth, page: scroller.scrollWidth - scroller.clientWidth };
    });
    expect(overflow.doc).toBeLessThanOrEqual(0);
    expect(overflow.page).toBeLessThanOrEqual(0);
  });
});
