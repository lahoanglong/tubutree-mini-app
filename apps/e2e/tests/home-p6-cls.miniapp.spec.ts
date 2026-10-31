import type { Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { PURCHASED_PAGE } from './support/buy-flow-mocks';
import { CATALOG, mockDiscovery } from './support/discovery-mocks';

/**
 * Zalo Mini App E2E — độ ổn định bố cục Trang chủ (gói P6). Dự án Mini chạy WebKit (iPhone 12), không có PerformanceObserver 'layout-shift',
 * nên spec này ép Chromium để đo CLS thật. API mock toàn bộ; không dùng waitForTimeout.
 */
test.use({ browserName: 'chromium' });

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

async function trackLayoutShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { hadRecentInput: boolean; value: number }[]) if (!e.hadRecentInput) w.__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

test.describe('Trang chủ Mini — CLS', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('khách cũ đã nhớ loại khách, Giờ vàng và số món Mua lại: dữ liệu về sau khung chờ không đẩy khối nào (CLS ≤ 0,02)', async ({ page, api }) => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    mockDiscovery(api, { returning: true });
    mockFlash(api, hold);
    api.get('/me/purchased-items', async () => {
      await hold;
      return PURCHASED_PAGE;
    });
    await trackLayoutShift(page);
    await page.addInitScript(() => {
      localStorage.setItem('tubu_home_kind', JSON.stringify({ userId: 'user-4b', kind: 'returning' }));
      localStorage.setItem('tubu_home_flash', '1');
      localStorage.setItem('tubu_home_purchased', 'one');
    });
    await page.goto('/');
    await expect(page.getByTestId('flash-sale-loading')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('purchased-rail-loading')).toBeVisible();
    release();
    await expect(page.getByRole('region', { name: 'Giờ vàng', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Gợi ý hôm nay' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('flash-sale-loading')).toHaveCount(0);
    await expect(page.getByTestId('purchased-rail-loading')).toHaveCount(0);
    await expect(page.getByTestId('catalog-grid-skeleton')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, `CLS ${cls.toFixed(4)}`).toBeLessThanOrEqual(0.02);
  });
});
