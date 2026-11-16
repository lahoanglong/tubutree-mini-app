import type { Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { CATALOG, mockDiscovery } from './support/discovery-mocks';
import { homeHierarchyProblems } from './support/home-hierarchy';
import { shortcutLabelProblems } from './support/shortcut-labels';

/**
 * Zalo Mini App E2E — Trang chủ (gói P6, bố cục gọn): màn đầu 375×812 có thẻ sản phẩm đầu tiên (kệ Bán chạy nhất) và thứ tự khối đúng (Giờ vàng là ô khuyến mãi
 * đứng trên lưới Gợi ý, dưới màn đầu), Bán chạy nhất có hạng cho cả hai loại khách, dòng Mua lại không tràn ngang, Giờ vàng một đồng hồ. API mock toàn bộ;
 * không dùng waitForTimeout. CLS ở home-p6-cls.miniapp.spec.ts.
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

/** Thẻ sản phẩm đầu tiên đang hiện trong các khối Trang chủ: đỉnh thẻ và đỉnh thanh đáy (mép dưới của khung nhìn đầu). */
async function firstCardAndNavTop(page: Page): Promise<{ cardTop: number | null; navTop: number }> {
  return page.evaluate(() => {
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const card = Array.from(document.querySelectorAll('[data-home-block] [data-ds="product-tile"]')).find(shown);
    const nav = Array.from(document.querySelectorAll('nav, [role="navigation"]')).find(
      (n) => getComputedStyle(n).position === 'fixed' && n.getBoundingClientRect().bottom >= window.innerHeight - 1 && shown(n),
    );
    return { cardTop: card ? Math.round(card.getBoundingClientRect().top) : null, navTop: Math.round(nav ? nav.getBoundingClientRect().top : window.innerHeight) };
  });
}

/** Thẻ sản phẩm đầu tiên lộ trong màn đầu: còn thấy ít nhất chừng này px phía trên thanh đáy. */
const CARD_VISIBLE_MIN = 48;

test.describe('Trang chủ Mini — màn đầu và độ ổn định bố cục', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('khách cũ, có Giờ vàng: thẻ sản phẩm đầu tiên lộ trong màn đầu 375×812 và thứ tự khối đúng (Giờ vàng dưới lối tắt, trên Gợi ý)', async ({ page, api }) => {
    mockDiscovery(api, { returning: true });
    mockFlash(api);
    await page.goto('/');
    const flash = page.getByRole('region', { name: 'Giờ vàng', exact: true });
    await expect(flash).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Gợi ý hôm nay' })).toBeVisible({ timeout: 15_000 });
    const blocks = await visibleBlocks(page);
    // Ô khuyến mãi chỉ có MỘT khối: Giờ vàng đang chạy thì không banner, không combo.
    expect(blocks).not.toContain('banner');
    expect(blocks).not.toContain('combos');
    const order = ['search', 'member', 'categories', 'bestSellers', 'purchased', 'shortcuts', 'flash', 'suggest'];
    expect(blocks.filter((b) => order.includes(b))).toEqual(order);
    const { cardTop, navTop } = await firstCardAndNavTop(page);
    expect(cardTop, 'có thẻ sản phẩm').not.toBeNull();
    expect(cardTop!, `thẻ sản phẩm đầu tiên ở ${cardTop}px, thanh đáy ở ${navTop}px`).toBeLessThanOrEqual(navTop - CARD_VISIBLE_MIN);
    // Giờ vàng nằm dưới thẻ sản phẩm đầu tiên (không còn là khối của màn đầu).
    const box = (await flash.boundingBox())!;
    expect(box.y, 'Giờ vàng đứng dưới thẻ sản phẩm đầu tiên').toBeGreaterThan(cardTop!);
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

  test('khách mới có Quà khách mới và Giờ vàng: dải ngữ cảnh ngay dưới ô tìm, thẻ sản phẩm đầu tiên lộ trong màn đầu 375×812, Giờ vàng dưới lối tắt', async ({ page, api }) => {
    mockDiscovery(api);
    api.get('/me/new-customer-offer', { isNewCustomer: true, welcomeVoucher: null });
    mockFlash(api);
    await page.goto('/');
    const welcome = page.getByRole('region', { name: 'Quà khách mới' });
    const flash = page.getByRole('region', { name: 'Giờ vàng', exact: true });
    await expect(welcome).toBeVisible({ timeout: 15_000 });
    await expect(flash).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Gợi ý hôm nay' })).toBeVisible({ timeout: 15_000 });
    const blocks = await visibleBlocks(page);
    expect(blocks).not.toContain('member');
    expect(blocks).not.toContain('purchased');
    const order = ['search', 'welcome', 'categories', 'bestSellers', 'shortcuts', 'flash', 'suggest'];
    expect(blocks.filter((b) => order.includes(b))).toEqual(order);
    const { cardTop, navTop } = await firstCardAndNavTop(page);
    expect(cardTop, 'có thẻ sản phẩm').not.toBeNull();
    expect(cardTop!, `thẻ sản phẩm đầu tiên ở ${cardTop}px khi có dải Quà khách mới, thanh đáy ở ${navTop}px`).toBeLessThanOrEqual(navTop - CARD_VISIBLE_MIN);
    const box = (await flash.boundingBox())!;
    expect(box.y, 'Giờ vàng đứng dưới thẻ sản phẩm đầu tiên').toBeGreaterThan(cardTop!);
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

  for (const width of [375, 360, 320]) {
    test(`${width}px: có Giờ vàng thì 2 thẻ chính + 4 ô phụ + lối tắt nhanh đọc đủ nhãn, vùng chạm ≥44px, không tràn ngang`, async ({ page, api }) => {
      mockDiscovery(api, { returning: true });
      // Thẻ "Mua lẻ · Giờ vàng" chỉ hiện khi có suất Giờ vàng đang chạy hay sắp tới: không mock thì khối lối tắt chỉ còn 5 lối vào.
      mockFlash(api);
      await page.setViewportSize({ width, height: 812 });
      await page.goto('/');
      const grid = page.getByTestId('shortcut-grid');
      await expect(grid.locator('[data-pillar]')).toHaveCount(6, { timeout: 15_000 });
      await expect(grid.getByRole('button', { name: /Mã giảm giá/ })).toBeVisible({ timeout: 15_000 });
      expect(await shortcutLabelProblems(page)).toEqual([]);
      expect(await homeHierarchyProblems(page)).toEqual([]);
      // 6 lối vào + Mã giảm giá + Cộng đồng + Thêm: Giờ vàng chỉ còn ở thẻ chính, không lặp ở hàng lối tắt.
      const goldenHour = grid.getByRole('button', { name: /Giờ vàng/ });
      await expect(goldenHour).toHaveCount(1);
      await expect(goldenHour).toHaveAttribute('data-pillar', 'retail');
      const heights = await grid.getByRole('button').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
      expect(heights).toHaveLength(9);
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
      const overflow = await page.evaluate(() => {
        const scroller = document.querySelector('.zaui-page') as HTMLElement | null;
        return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, scroller ? scroller.scrollWidth - scroller.clientWidth : 0);
      });
      expect(overflow, `Trang chủ tràn ngang ở ${width}px`).toBeLessThanOrEqual(0);
    });
  }

  test('375px: không có Giờ vàng (đang chạy lẫn sắp tới) thì khối lối vào còn 5 lối, không thẻ "Giờ vàng", vùng chạm ≥44px', async ({ page, api }) => {
    mockDiscovery(api, { returning: true });
    await page.goto('/');
    const grid = page.getByTestId('shortcut-grid');
    await expect(grid.locator('[data-pillar]')).toHaveCount(5, { timeout: 15_000 });
    await expect(grid.locator('[data-pillar="retail"]')).toHaveCount(0);
    await expect(grid.getByRole('button', { name: /Giờ vàng/ })).toHaveCount(0);
    expect(await shortcutLabelProblems(page)).toEqual([]);
    const heights = await grid.getByRole('button').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
  });
});
