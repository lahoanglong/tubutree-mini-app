import { test, expect } from './support/mock-api';
import { SHOP_SLUG, SHOP_TITLE, mockShopPage } from './support/shop-page-mocks';

/**
 * Màn dựng gian hàng của CTV (`/storefront`) ở Mini App, 375px, và dải tab dính của trang gian hàng công khai mà màn dựng xem trước.
 * Toàn bộ API được mock (không cần API/DB).
 */
test.use({ viewport: { width: 375, height: 812 } });

test.describe('Dải tab của trang gian hàng dính ngay dưới thanh nút lùi', () => {
  test.beforeEach(({ api }) => mockShopPage(api));

  const measure = async (page: import('@playwright/test').Page, safeTop: number) => {
    await page.goto(`/s/${SHOP_SLUG}`);
    await expect(page.getByRole('heading', { level: 1, name: SHOP_TITLE })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('tab', { name: 'Shop', selected: true })).toBeVisible();
    // Tai thỏ giả lập: `--safe-top` là biến của chính Mini App, thanh nút lùi và dải tab đều đọc nó.
    await page.evaluate((top) => {
      document.documentElement.style.setProperty('--safe-top', `${top}px`);
      // Mini App cuộn ở `.zaui-page`, không phải window; WebKit di động không có mouse.wheel.
      const scroller = document.querySelector('.zaui-page');
      if (scroller) scroller.scrollTop = 600;
    }, safeTop);
    const gap = await page.evaluate(() => {
      const bar = document.querySelector('[data-back-bar]') as HTMLElement | null;
      const tabs = document.querySelector('[role="tablist"]')?.parentElement as HTMLElement | null;
      if (!bar || !tabs) return null;
      return { barBottom: bar.getBoundingClientRect().bottom, tabsTop: tabs.getBoundingClientRect().top };
    });
    expect(gap, 'thấy thanh nút lùi và dải tab').not.toBeNull();
    return { ...gap!, delta: gap!.tabsTop - gap!.barBottom };
  };

  for (const safeTop of [0, 44]) {
    test(`cuộn xuống 600px, vùng an toàn ${safeTop}px: dải tab sát mép dưới thanh nút lùi, không hở`, async ({ page }) => {
      const m = await measure(page, safeTop);
      expect(m.delta, `dải tab cách thanh nút lùi ${m.delta}px (barBottom ${m.barBottom}, tabsTop ${m.tabsTop})`).toBeGreaterThanOrEqual(0);
      expect(m.delta).toBeLessThanOrEqual(2);
    });

    test(`tab Sản phẩm, vùng an toàn ${safeTop}px: thanh sắp xếp dính ngay dưới dải tab (chui dưới 8px đệm đáy của dải, không che chữ)`, async ({ page }) => {
      await page.goto(`/s/${SHOP_SLUG}`);
      await page.getByRole('tab', { name: 'Sản phẩm (45)' }).click();
      await expect(page.getByRole('button', { name: 'Mới' })).toBeVisible({ timeout: 15_000 });
      await page.evaluate((top) => {
        document.documentElement.style.setProperty('--safe-top', `${top}px`);
        const scroller = document.querySelector('.zaui-page');
        if (scroller) scroller.scrollTop = 1400;
      }, safeTop);
      const m = await page.evaluate(() => {
        const tabs = document.querySelector('[role="tablist"]')?.parentElement as HTMLElement | null;
        const sort = document.querySelector('button[aria-pressed]')?.closest('[role="group"]')?.parentElement as HTMLElement | null;
        if (!tabs || !sort) return null;
        return { tabsBottom: tabs.getBoundingClientRect().bottom, sortTop: sort.getBoundingClientRect().top };
      });
      expect(m, 'thấy dải tab và thanh sắp xếp').not.toBeNull();
      const overlap = m!.tabsBottom - m!.sortTop;
      expect(overlap, `thanh sắp xếp chồng lên dải tab ${overlap}px (tabsBottom ${m!.tabsBottom}, sortTop ${m!.sortTop})`).toBeGreaterThanOrEqual(6);
      expect(overlap).toBeLessThanOrEqual(10);
    });
  }
});
