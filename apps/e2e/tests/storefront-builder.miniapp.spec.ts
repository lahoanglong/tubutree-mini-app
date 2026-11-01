import { test, expect } from './support/mock-api';
import { SHOP_SLUG, SHOP_TITLE, mockShopPage } from './support/shop-page-mocks';
import { mockBuilder } from './support/builder-mocks';
import type { Page } from '@playwright/test';

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

const openSection = async (page: Page, title: string) => {
  await page.locator('[data-testid="section-card"] button').filter({ hasText: title }).first().click();
  await expect(page.getByTestId('section-detail')).toBeVisible();
};

test.describe('Mini App: màn dựng gian hàng 375px', () => {
  test.beforeEach(({ api }) => mockBuilder(api));

  test('màn chính: ba thẻ khối, không ô tên ở cuối, không "Đưa lên", không tràn ngang, dải Hành trình 54–60px, một nút chính', async ({ page }) => {
    await page.goto('/storefront');
    await expect(page.getByTestId('section-card')).toHaveCount(3, { timeout: 15_000 });
    await expect(page.getByLabel('Tên bộ sưu tập')).toHaveCount(0);
    await expect(page.getByText('Đưa lên')).toHaveCount(0);
    await expect(page.getByText('Đưa xuống')).toHaveCount(0);

    const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.body.scrollWidth, document.querySelector('.zaui-page')?.scrollWidth ?? 0]);
    for (const w of widths) expect(w).toBeLessThanOrEqual(375);

    const strip = (await page.locator('button[data-reward]').boundingBox())!;
    expect(strip.height).toBeGreaterThanOrEqual(54);
    expect(strip.height).toBeLessThanOrEqual(60);

    // Chỉ một nút chính trên màn: nút đăng ở thanh dính. Thêm khối, Sửa hồ sơ, Cài đặt, Xem trước đều là nút phụ.
    await expect(page.getByRole('button', { name: 'Đăng lại' })).toBeVisible();
    await expect(page.locator('button.zaui-btn-primary:visible')).toHaveCount(1);
  });

  test('chế độ Sắp xếp: mọi nút ↑↓ cao và rộng >= 44px; ↑ của món đầu là aria-disabled, vẫn giữ focus và không gọi API', async ({ page, api }) => {
    await page.goto('/storefront');
    await openSection(page, 'Bếp xanh');
    await page.getByRole('button', { name: 'Sắp xếp', exact: true }).click();
    const arrows = page.locator('button[data-move-id]');
    await expect(arrows).toHaveCount(24);
    for (const box of await Promise.all((await arrows.all()).map((b) => b.boundingBox()))) {
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const first = page.getByRole('button', { name: 'Đưa Món 01 lên' });
    await expect(first).toHaveAttribute('aria-disabled', 'true');
    await first.focus();
    await page.keyboard.press('Enter');
    await expect(first).toBeFocused();
    await expect(page.getByTestId('notify-status')).toHaveText('Món 01 đã ở đầu danh sách');
    expect(api.callsTo('POST', '/storefront/me/collections/:id/items/reorder')).toHaveLength(0);
  });

  test('khối Lưới: chọn "Danh sách" chỉ gửi {layout:"STACK"}, xem trước đổi từ lưới sang hàng dòng', async ({ page, api }) => {
    await page.goto('/storefront');
    await openSection(page, 'Bếp xanh');
    const frame = page.getByTestId('shop-section-preview');
    await expect(frame.getByTestId('shop-grid')).toBeVisible();
    await page.getByRole('radio', { name: /^Danh sách/ }).click();
    await expect(frame.getByTestId('shop-line')).toBeVisible();
    await expect(frame.getByTestId('shop-grid')).toHaveCount(0);
    const patch = api.callsTo('PATCH', '/storefront/me/collections/:id');
    expect(patch).toHaveLength(1);
    expect(patch[0]!.path).toBe('/storefront/me/collections/c-grid');
    expect(patch[0]!.body).toEqual({ layout: 'STACK' });
  });

  test('khối Kệ ngang: xem trước thẳng hàng như tab Shop thật (thẻ đầu cách mép khung 12px, tiêu đề 16px)', async ({ page }) => {
    await page.goto('/storefront');
    await openSection(page, 'Chăm sóc nhà cửa');
    const frame = page.getByTestId('shop-section-preview');
    const f = (await frame.boundingBox())!;
    const tile = (await frame.locator('[data-ds="product-tile"]').first().boundingBox())!;
    const title = (await frame.locator('h2').first().boundingBox())!;
    expect(Math.abs(tile.x - f.x - 12)).toBeLessThanOrEqual(1);
    expect(Math.abs(title.x - f.x - 16)).toBeLessThanOrEqual(1);
  });

  test('thêm khối Combo 15%: POST gửi kind COMBO và comboDiscountPct 15', async ({ page, api }) => {
    await page.goto('/storefront');
    await page.getByRole('button', { name: 'Thêm khối', exact: true }).click();
    await page.getByRole('radio', { name: /^Combo/ }).click();
    await page.getByLabel('Giảm khi mua cả bộ').fill('15');
    await page.getByRole('button', { name: 'Tạo và thêm món' }).click();
    await expect(page.getByTestId('section-detail')).toBeVisible();
    const post = api.callsTo('POST', '/storefront/me/collections');
    expect(post).toHaveLength(1);
    expect(post[0]!.body).toMatchObject({ kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: 15 });
  });
});
