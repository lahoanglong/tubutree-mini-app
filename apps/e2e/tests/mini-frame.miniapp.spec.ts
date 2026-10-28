import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { mockDiscovery } from './support/discovery-mocks';
import { mockPilotProduct, PILOT_SLUG } from './support/pilot-mocks';

/**
 * Mini App ở khổ rộng: khung 480px căn giữa (thanh đáy và nút dính đáy cũng vậy); điện thoại giữ nguyên bề ngang.
 * API mock toàn bộ.
 */

const FRAME = 480;

const widthOf = async (page: Page, selector: string) => {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, selector).not.toBeNull();
  return box!;
};

test.describe('Mini App — khung theo khổ màn hình', () => {
  test('1280px: khung app và thanh đáy rộng 480px, căn giữa, không tràn ngang', async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    mockDiscovery(api, { returning: true });
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    await expect(nav).toBeVisible({ timeout: 15_000 });

    const app = await widthOf(page, '#app');
    expect(app.width).toBe(FRAME);
    expect(app.x).toBe((1280 - FRAME) / 2);
    const bar = (await nav.boundingBox())!;
    expect(bar.width).toBe(FRAME);
    expect(bar.x).toBe((1280 - FRAME) / 2);
    expect(bar.y + bar.height).toBe(800);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('1280px: thanh nút dính đáy của trang sản phẩm cũng rộng 480px, căn giữa, sát đáy', async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    mockPilotProduct(api);
    await page.goto(`/product/${PILOT_SLUG}`);
    const sticky = page.getByTestId('sticky-bar');
    await expect(sticky).toBeVisible({ timeout: 15_000 });
    const box = (await sticky.boundingBox())!;
    expect(box.width).toBe(FRAME);
    expect(box.x).toBe((1280 - FRAME) / 2);
    expect(box.y + box.height).toBe(800);
  });

  for (const width of [375, 390, 480]) {
    test(`${width}px (điện thoại): khung phủ trọn bề ngang như trước, không biến đổi`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 812 });
      mockDiscovery(api, { returning: true });
      await page.goto('/');
      const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
      await expect(nav).toBeVisible({ timeout: 15_000 });
      expect((await widthOf(page, '#app')).width).toBe(width);
      const bar = (await nav.boundingBox())!;
      expect(bar.x).toBe(0);
      expect(bar.width).toBe(width);
      expect(await page.locator('#app').evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    });
  }
});
