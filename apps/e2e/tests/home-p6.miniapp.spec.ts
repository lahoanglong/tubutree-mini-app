import type { Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { CATALOG, mockDiscovery } from './support/discovery-mocks';

/**
 * Zalo Mini App E2E — Trang chủ theo thiết kế mới (gói P6): màn đầu 375×812 có Giờ vàng khi chưa có banner, Bán chạy nhất có hạng cho cả hai loại khách,
 * dòng Mua lại không tràn ngang, Giờ vàng một đồng hồ. API mock toàn bộ; không dùng waitForTimeout. CLS ở home-p6-cls.miniapp.spec.ts.
 */

const HOUR = 3_600_000;

/** Ba suất Giờ vàng đang chạy (đủ mức tối thiểu của khối); lấy SP từ danh mục giả, tránh món Mua lại mặc định để kệ nào cũng còn đủ món. */
function mockFlash(api: MockApi, hold?: Promise<void>): void {
  api.get('/flash-sales/active', async () => {
    await hold;
    const now = Date.now();
    return CATALOG.slice(4, 7).map((p, i) => ({
      itemId: `fi-${p.id}`, variationId: `v-${p.id}`, productSlug: p.slug, productName: p.name, variationName: null, thumbnail: p.thumbnail,
      flashPrice: 59_000 + i * 1_000, retailPrice: p.basePrice, salePrice: p.salePrice, soldCount: 10 + i, quota: 50,
      endAt: new Date(now + 3 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
    }));
  });
}

async function visibleBlocks(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-home-block]'))
      .filter((el) => el.getBoundingClientRect().height > 0)
      .map((el) => el.dataset.homeBlock!),
  );
}

test.describe('Trang chủ Mini — màn đầu và độ ổn định bố cục', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('khách cũ, chưa có banner: Giờ vàng nằm trọn trong màn đầu 375×812', async ({ page, api }) => {
    mockDiscovery(api, { returning: true });
    mockFlash(api);
    await page.goto('/');
    const flash = page.getByRole('region', { name: 'Giờ vàng', exact: true });
    await expect(flash).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
    expect(await visibleBlocks(page)).not.toContain('banner');
    const box = (await flash.boundingBox())!;
    expect(box.y + box.height, `Giờ vàng kết thúc ở ${Math.round(box.y + box.height)}px`).toBeLessThanOrEqual(812);
  });

  test('khách mới: Bán chạy nhất có hạng #1, #2, #3 theo lượt bán 30 ngày, đứng sau Danh mục', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/');
    const best = page.getByRole('region', { name: 'Bán chạy nhất', exact: true });
    await expect(best).toBeVisible({ timeout: 15_000 });
    for (const rank of ['#1', '#2', '#3']) await expect(best.getByText(rank, { exact: true })).toBeVisible();
    await expect(best.getByText('Theo lượt bán 30 ngày qua')).toBeVisible();
    await expect.poll(() => visibleBlocks(page), { timeout: 15_000 }).toEqual(expect.arrayContaining(['categories', 'bestSellers']));
    const blocks = await visibleBlocks(page);
    expect(blocks.indexOf('categories')).toBeLessThan(blocks.indexOf('bestSellers'));
    expect(blocks).not.toContain('banner');
  });

  test('Mua lại một món: nút "Mua lại" nằm cùng hàng với tên trong dòng cao 88px, trang không tràn ngang', async ({ page, api }) => {
    mockDiscovery(api, { returning: true });
    await page.goto('/');
    const line = page.getByTestId('rebuy-line');
    await expect(line).toBeVisible({ timeout: 15_000 });
    const lineBox = (await line.boundingBox())!;
    expect(lineBox.height).toBe(88);
    const button = (await line.getByRole('button', { name: 'Mua lại' }).boundingBox())!;
    expect(button.y, 'nút lệch khỏi dòng').toBeGreaterThanOrEqual(lineBox.y);
    expect(button.y + button.height, 'nút lệch khỏi dòng').toBeLessThanOrEqual(lineBox.y + lineBox.height);
    expect(button.x + button.width, 'nút tràn phải').toBeLessThanOrEqual(375);
    const overflow = await page.evaluate(() => {
      const scroller = document.querySelector('.zaui-page') as HTMLElement | null;
      return scroller ? scroller.scrollWidth - scroller.clientWidth : 0;
    });
    expect(overflow, 'Trang chủ tràn ngang').toBeLessThanOrEqual(0);
  });

  test('Giờ vàng chỉ có một đồng hồ, ở đầu khối', async ({ page, api }) => {
    mockDiscovery(api, { returning: true });
    mockFlash(api);
    await page.goto('/');
    const flash = page.getByRole('region', { name: 'Giờ vàng', exact: true });
    await expect(flash).toBeVisible({ timeout: 15_000 });
    await expect(flash.getByRole('timer')).toHaveCount(1);
    const clock = (await flash.getByRole('timer').boundingBox())!;
    const first = (await flash.locator('[data-ds="product-tile"]').first().boundingBox())!;
    expect(clock.y, 'đồng hồ nằm trên hàng thẻ').toBeLessThan(first.y);
  });
});
