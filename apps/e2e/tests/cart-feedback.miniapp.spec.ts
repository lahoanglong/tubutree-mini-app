import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { PILOT_CART, PILOT_SLUG, mockPilotProduct } from './support/pilot-mocks';

/**
 * W42B, Mini App: thêm vào giỏ ở trang sản phẩm thì huy hiệu giỏ nảy một nhịp 220ms (`.cart-badge-bump`) và một chấm bay từ nút "Thêm vào giỏ" tới
 * biểu tượng giỏ (`[data-cart-fly]`, 420ms). Khách bật giảm chuyển động thì không có chấm bay và huy hiệu không chạy hoạt ảnh.
 * Toàn bộ API được mock; giỏ có sẵn hàng để huy hiệu luôn hiện.
 */
async function watchFly(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __flySeen: number }).__flySeen = 0;
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of Array.from(r.addedNodes)) if (n instanceof HTMLElement && n.hasAttribute('data-cart-fly')) (window as unknown as { __flySeen: number }).__flySeen += 1;
      }
    }).observe(document, { childList: true, subtree: true });
  });
}
const flySeen = (page: Page) => page.evaluate(() => (window as unknown as { __flySeen: number }).__flySeen);

test.describe('Zalo Mini App: phản hồi khi thêm vào giỏ', () => {
  test.beforeEach(async ({ page, api }) => {
    mockPilotProduct(api);
    api.get('/cart', PILOT_CART);
    await watchFly(page);
    await page.setViewportSize({ width: 375, height: 700 });
  });

  test('chấm bay một lần rồi tự dọn, huy hiệu nảy 220ms theo đường cong drawer', async ({ page, api }) => {
    await page.goto(`/product/${PILOT_SLUG}`);
    const add = page.getByRole('button', { name: 'Thêm vào giỏ' });
    await expect(add).toBeEnabled({ timeout: 15_000 });
    expect(await flySeen(page)).toBe(0);
    await expect(page.locator('.cart-badge-bump')).toHaveCount(0);

    const posted = api.waitForCall('POST', '/cart/items');
    await add.click();
    await posted;
    await expect.poll(() => flySeen(page), { timeout: 5_000 }).toBe(1);
    await expect(page.locator('[data-cart-fly]')).toHaveCount(0, { timeout: 3_000 });

    const bump = page.locator('.cart-badge-bump').first();
    await expect(bump).toBeVisible();
    const style = await bump.evaluate((el) => {
      const s = getComputedStyle(el);
      return { name: s.animationName, duration: s.animationDuration };
    });
    expect(style).toEqual({ name: 'cart-badge-bump', duration: '0.22s' });
  });

  test('giảm chuyển động: không có chấm bay, huy hiệu không chạy hoạt ảnh', async ({ page, api }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/product/${PILOT_SLUG}`);
    const add = page.getByRole('button', { name: 'Thêm vào giỏ' });
    await expect(add).toBeEnabled({ timeout: 15_000 });
    const posted = api.waitForCall('POST', '/cart/items');
    await add.click();
    await posted;
    await expect(page.locator('.cart-badge-bump').first()).toBeVisible();
    await page.waitForTimeout(700);
    expect(await flySeen(page)).toBe(0);
    expect(await page.locator('.cart-badge-bump').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  });
});
