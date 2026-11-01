import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { NRC, mockDiscovery } from './support/discovery-mocks';
import { PDP_SLUG, homeCombos, mockPdpBundles, pdpAddon, pdpCombo } from './support/bundle-mocks';
import { HOME_PUBLIC, mockMergedHome } from './support/home-merged';
import type { MockApi } from './support/mock-api';

/**
 * Zalo Mini App E2E — Combo ưu đãi, Mua kèm (trang sản phẩm) và Combo tiết kiệm (Trang chủ) không làm trang xê dịch (gói P15). Dự án Mini chạy WebKit,
 * không có PerformanceObserver 'layout-shift', nên spec này ép Chromium để đo CLS thật. API mock toàn bộ; không dùng waitForTimeout.
 */
test.use({ browserName: 'chromium', viewport: { width: 375, height: 812 } });

async function trackLayoutShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { hadRecentInput: boolean; value: number }[]) if (!e.hadRecentInput) w.__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
}
const readCls = async (page: Page): Promise<number> => {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
};

test.describe('Trang sản phẩm Mini: CLS', () => {
  test.beforeEach(({ api }) => mockDiscovery(api));

  test('không có bộ nào: không có khối, CLS 0 (nền để so)', async ({ page }) => {
    await trackLayoutShift(page);
    await page.goto(`/product/${PDP_SLUG}`);
    await expect(page.getByRole('heading', { level: 1, name: NRC.name })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('pdp-bundle-slots')).toHaveCount(0);
    const cls = await readCls(page);
    expect(cls, `CLS ${cls.toFixed(4)}`).toBeLessThanOrEqual(0.02);
  });

  test('bộ về chậm hơn sản phẩm một chút (50ms, trong hạn chờ): khung chờ giữ tới khi bộ về, khối vào cùng lần vẽ đầu (CLS ≤ 0,02)', async ({ page, api }) => {
    mockPdpBundles(api, { combos: [pdpCombo()], addons: [pdpAddon()], delayMs: 50 });
    await trackLayoutShift(page);
    await page.goto(`/product/${PDP_SLUG}`);
    await expect(page.getByRole('heading', { level: 1, name: NRC.name })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('pdp-combos')).toBeVisible();
    await expect(page.getByTestId('pdp-addons')).toBeVisible();
    const cls = await readCls(page);
    expect(cls, `CLS ${cls.toFixed(4)}`).toBeLessThanOrEqual(0.02);
  });
});

/** Mở Trang chủ bằng request gộp `/home` (đường chạy thật), đo CLS; có combo hay không là biến duy nhất giữa hai ca. */
function mockMergedHomeWith(api: MockApi, combos: unknown[]): void {
  mockDiscovery(api, { returning: true });
  mockMergedHome(api);
  api.get('/home', { ...HOME_PUBLIC, combos });
}

test.describe('Trang chủ Mini: CLS của kệ Combo tiết kiệm', () => {
  test.describe.configure({ mode: 'serial' });
  let baseline = 0;

  test('request gộp không có combo: đo CLS nền', async ({ page, api }) => {
    mockMergedHomeWith(api, []);
    await trackLayoutShift(page);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Danh mục', exact: true }).getByText('Danh mục gộp')).toBeVisible({ timeout: 15_000 });
    baseline = await readCls(page);
    expect(baseline, `CLS nền ${baseline.toFixed(4)}`).toBeLessThanOrEqual(0.1);
  });

  test('request gộp có 2 combo: kệ hiện từ chính request gộp (không gọi /bundles/combos) và CLS không tăng quá 0,01 so với nền', async ({ page, api }) => {
    mockMergedHomeWith(api, homeCombos());
    await trackLayoutShift(page);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Combo tiết kiệm', exact: true })).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    expect(api.callsTo('GET', '/bundles/combos')).toHaveLength(0);
    const cls = await readCls(page);
    expect(cls, `CLS ${cls.toFixed(4)} so với nền ${baseline.toFixed(4)}`).toBeLessThanOrEqual(baseline + 0.01);
  });
});
