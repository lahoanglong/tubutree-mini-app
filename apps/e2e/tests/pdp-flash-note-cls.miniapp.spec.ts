import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { mockPilotProduct, PILOT_PRODUCT, PILOT_PRODUCT_NAME, PILOT_SLUG } from './support/pilot-mocks';

/**
 * Mini App, trang sản phẩm ngoài bảng chọn: GET /flash-sales/me/allowance về muộn (1–3 s) thì ghi chú "Bạn không còn suất Giờ vàng…" hiện ra mà không đẩy phần bên dưới.
 * Dự án Mini chạy WebKit, không có PerformanceObserver 'layout-shift', nên spec này ép Chromium để đo CLS thật. API mock toàn bộ.
 */
test.use({ browserName: 'chromium', viewport: { width: 375, height: 812 } });

const HOUR = 3_600_000;
const SPENT = 'Bạn không còn suất Giờ vàng của sản phẩm này nên tính giá thường.';
const VARIATIONS = [{ id: 'var-1', sku: 'KU-80', name: 'Gói 80 tờ', attributes: {}, retailPrice: 35_000, salePrice: null, stock: 245 }];

function mockFlashPage(api: Parameters<typeof mockPilotProduct>[0], opts: { flash: boolean; delayMs?: number; perUserLeft?: number }) {
  mockPilotProduct(api);
  api.get('/products/:slug', { ...PILOT_PRODUCT, variations: VARIATIONS });
  api.get('/flash-sales/active', () => {
    if (!opts.flash) return [];
    const now = Date.now();
    return [
      {
        itemId: 'fi-1', variationId: 'var-1', productSlug: PILOT_SLUG, productName: PILOT_PRODUCT_NAME, variationName: 'Gói 80 tờ', thumbnail: null,
        flashPrice: 26_000, retailPrice: 35_000, salePrice: null, soldCount: 10, quota: 100, perUserLimit: 3,
        endAt: new Date(now + 3 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
      },
    ];
  });
  api.get('/flash-sales/me/allowance', async () => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    const left = opts.perUserLeft ?? 0;
    return { items: { 'fi-1': { perUserLeft: left, allowance: left } } };
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
const readCls = (page: Page) => page.evaluate(() => new Promise<number>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve((window as unknown as { __cls: number }).__cls)))));

test.describe('Mini App PDP: ghi chú hết suất Giờ vàng về muộn không làm trang xê dịch', () => {
  for (const delayMs of [1_000, 3_000]) {
    test(`allowance về sau ${delayMs}ms: phần bên dưới giữ nguyên chỗ, CLS do ghi chú bằng 0`, async ({ page, api }) => {
      mockFlashPage(api, { flash: true, delayMs, perUserLeft: 0 });
      await trackLayoutShift(page);
      await page.goto(`/product/${PILOT_SLUG}`);
      await expect(page.getByTestId('flash-price-bar')).toBeVisible({ timeout: 15_000 });
      const slot = page.locator('[data-section="pdp-flash-limit"]');
      await expect(slot).toBeVisible();
      const before = (await slot.boundingBox())!;
      const clsBefore = await readCls(page);
      await expect(slot).toHaveText(SPENT, { timeout: delayMs + 10_000 });
      const after = (await slot.boundingBox())!;
      expect(Math.abs(after.y - before.y), 'vùng ghi chú dịch chỗ').toBeLessThanOrEqual(1);
      expect(Math.abs(after.height - before.height), 'vùng ghi chú đổi chiều cao').toBeLessThanOrEqual(1);
      const cls = (await readCls(page)) - clsBefore;
      expect(cls, `CLS khi ghi chú hiện ${cls.toFixed(4)}`).toBe(0);
    });
  }

  test('sản phẩm không có Giờ vàng: không giữ dải trống (vùng ghi chú cao 0)', async ({ page, api }) => {
    mockFlashPage(api, { flash: false });
    await page.goto(`/product/${PILOT_SLUG}`);
    await expect(page.getByRole('heading', { level: 1, name: PILOT_PRODUCT_NAME })).toBeVisible({ timeout: 15_000 });
    const box = await page.locator('[data-section="pdp-flash-limit"]').boundingBox();
    expect(box?.height ?? 0).toBe(0);
  });
});
