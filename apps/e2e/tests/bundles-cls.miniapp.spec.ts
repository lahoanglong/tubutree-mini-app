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

test.describe('Trang sản phẩm Mini: bộ tắt khi khách đang ở trang', () => {
  test.beforeEach(({ api }) => mockDiscovery(api));

  test('hai khối ở nguyên chỗ, ghi "Đã kết thúc", mờ; khung khối không đổi kích thước nên phần bên dưới không xê dịch', async ({ page, api }) => {
    const bundles = { combos: [pdpCombo()], addons: [pdpAddon()] };
    mockPdpBundles(api, bundles);
    await page.clock.install(); // đẩy giờ qua hạn "tươi" 30 giây của truy vấn, không phải chờ thật
    await page.goto(`/product/${PDP_SLUG}`);
    await expect(page.getByRole('heading', { level: 1, name: NRC.name })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('pdp-combos')).toBeVisible();
    await expect(page.getByTestId('pdp-addons')).toBeVisible();
    const slots = page.getByTestId('pdp-bundle-slots');
    await page.waitForLoadState('networkidle');
    // Chiều cao khối và khoảng từ đáy khối tới phần tử kế bên dưới: hai số này đổi thì phần dưới đã xê dịch (vị trí tuyệt đối còn phụ thuộc phần trên trang).
    const measure = () =>
      slots.evaluate((el) => {
        const next = el.nextElementSibling;
        const box = el.getBoundingClientRect();
        return { height: box.height, gapBelow: next ? next.getBoundingClientRect().top - box.bottom : null };
      });
    const before = await measure();
    expect(before.gapBelow, 'có phần tử bên dưới để so').not.toBeNull();

    // Khách ra Trang chủ rồi quay lại sau hơn 30 giây (dữ liệu cũ đã "ôi"): trang vẽ ngay từ bộ nhớ đệm, lần tải lại ngầm thì bộ đã tắt.
    await page.evaluate(() => {
      history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByTestId('pdp-bundle-slots')).toHaveCount(0);
    await page.clock.fastForward(60_000);
    bundles.combos = [];
    bundles.addons = []; // bộ vừa tắt: lần tải lại sau đây không còn trả bộ nào
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: NRC.name })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('pdp-combos')).toHaveAttribute('aria-label', 'Combo ưu đãi · Đã kết thúc');
    await expect(page.getByTestId('pdp-addons')).toHaveAttribute('aria-label', 'Mua kèm deal sốc · Đã kết thúc');
    expect(api.callsTo('GET', '/products/:slug/bundles').length).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('bundle-ended')).toHaveCount(2);

    await page.waitForLoadState('networkidle');
    expect(await measure()).toEqual(before);
    // Nội dung vẫn hiện (mờ) nhưng ẩn khỏi cây truy cập và không bấm được, nên chỉ tìm được khi tính cả phần tử ẩn.
    await expect(page.getByRole('button', { name: /^Thêm cả combo/, includeHidden: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Thêm cả combo/ })).toHaveCount(0);
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
