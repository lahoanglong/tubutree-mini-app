import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { mockDiscovery } from './support/discovery-mocks';
import { mockMergedHome } from './support/home-merged';

const scrollerOf = (page: Page) => page.locator('.zaui-page').first();
const scrollTop = (page: Page) => scrollerOf(page).evaluate((el) => Math.round(el.scrollTop));

/** Mini App Trang chủ khách cũ: cuộn sâu, chạm một món trong Gợi ý, Back thì scrollTop về lại; mở lại bằng thanh đáy (PUSH) thì về đầu trang (KHAMPHA-01). */
test.describe('Mini App: Trang chủ — Back giữ vị trí cuộn', () => {
  test.beforeEach(async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockDiscovery(api, { returning: true });
    mockMergedHome(api);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Gợi ý hôm nay' })).toBeVisible({ timeout: 20_000 });
  });

  async function scrollDeep(page: Page): Promise<number> {
    // Cuộn từng bước để các khối nạp lười (home-below) vẽ ra, tới khi đủ sâu hoặc hết trang.
    for (let i = 0; i < 12; i++) {
      await scrollerOf(page).evaluate((el) => el.scrollBy(0, 700));
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(500);
    return scrollTop(page);
  }

  test('cuộn sâu, chạm món, Back: scrollTop về trong 2px sau 1,2s', async ({ page }) => {
    await scrollDeep(page);
    // Về giữa trang, không phải đáy: trình duyệt kẹp scrollTop ở đáy nên lỗi khôi phục kéo xuống đáy sẽ lọt.
    await scrollerOf(page).evaluate((el) => { el.scrollTop = el.scrollHeight - el.clientHeight - 800; });
    await page.waitForTimeout(500);
    const before = await scrollTop(page);
    test.info().annotations.push({ type: 'before', description: `scrollTop=${before}` });
    expect(before).toBeGreaterThan(1500);

    // Món Gợi ý cuối cùng đang nằm trọn trong màn ở độ sâu hiện tại: không cuộn thêm, để vị trí lúc chạm vẫn là vị trí sâu.
    const tiles = page.getByRole('region', { name: 'Gợi ý hôm nay' }).locator('button.tubu-tile-link');
    let tile = tiles.first();
    let found = false;
    for (let i = (await tiles.count()) - 1; i >= 0; i--) {
      const box = await tiles.nth(i).boundingBox();
      if (box && box.y > 80 && box.y + box.height < 700) { tile = tiles.nth(i); found = true; break; }
    }
    expect(found, 'phải có món Gợi ý nằm trọn trong màn ở độ sâu hiện tại').toBe(true);
    const y = await scrollTop(page);
    expect(y).toBeGreaterThan(1500);
    await page.waitForTimeout(400);
    await tile.click();
    await expect(page).toHaveURL(/\/product\//, { timeout: 15_000 });
    // Trang '/' còn trượt ra trong 400ms của AnimationRoutes; Back lúc đó nhận lại DOM cũ và scrollTop còn nguyên dù không có hook.
    await expect(page.locator('.zaui-page')).toHaveCount(1, { timeout: 5_000 });
    await page.goBack();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Gợi ý hôm nay' })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1200);
    const after = await scrollTop(page);
    test.info().annotations.push({ type: 'after', description: `scrollTop=${after} (trước khi chạm ${y})` });
    expect(Math.abs(after - y)).toBeLessThanOrEqual(2);
  });

  test('mở Trang chủ bằng thanh đáy (PUSH) sau khi đã cuộn sâu: về đầu trang', async ({ page }) => {
    const before = await scrollDeep(page);
    expect(before).toBeGreaterThan(1500);
    await page.getByRole('navigation').getByRole('button', { name: /^Danh mục/ }).click();
    await expect(page).toHaveURL(/\/(browse|categories)/, { timeout: 15_000 });
    await expect(page.locator('.zaui-page')).toHaveCount(1, { timeout: 5_000 });
    await page.getByRole('navigation').getByRole('button', { name: /^Trang chủ/ }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Gợi ý hôm nay' })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1200);
    expect(await scrollTop(page)).toBe(0);
  });
});
