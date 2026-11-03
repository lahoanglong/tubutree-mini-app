import { test, expect } from './support/mock-api';
import { anchorBelow, gate, readCls, trackLayoutShift } from './support/pdp-cls';
import { mockPilotProduct, PILOT_PRODUCT, PILOT_PRODUCT_NAME, PILOT_SLUG } from './support/pilot-mocks';

/**
 * Mini App, trang sản phẩm ngoài bảng chọn: GET /flash-sales/me/allowance về muộn (1–3 s) thì ghi chú "Bạn không còn suất Giờ vàng…" hiện ra mà không đẩy phần bên dưới.
 * Dự án Mini chạy WebKit, không có PerformanceObserver 'layout-shift', nên spec này ép Chromium để đo CLS thật. API mock toàn bộ.
 */
test.use({ browserName: 'chromium', viewport: { width: 375, height: 812 } });

const HOUR = 3_600_000;
const SPENT = 'Bạn không còn suất Giờ vàng của sản phẩm này nên tính giá thường.';
const VARIATIONS = [{ id: 'var-1', sku: 'KU-80', name: 'Gói 80 tờ', attributes: {}, retailPrice: 35_000, salePrice: null, stock: 245 }];

function mockFlashPage(api: Parameters<typeof mockPilotProduct>[0], opts: { flash: boolean; hold?: Promise<void>; perUserLeft?: number }) {
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
    await opts.hold;
    const left = opts.perUserLeft ?? 0;
    return { items: { 'fi-1': { perUserLeft: left, allowance: left } } };
  });
}

test.describe('Mini App PDP: ghi chú hết suất Giờ vàng về muộn không làm trang xê dịch', () => {
  for (const perUserLeft of [0, 3]) {
    test(`allowance còn treo rồi mới về (perUserLeft ${perUserLeft}): khối bên dưới giữ nguyên chỗ, CLS do ghi chú bằng 0`, async ({ page, api }) => {
      const g = gate();
      mockFlashPage(api, { flash: true, hold: g.wait, perUserLeft });
      await trackLayoutShift(page);
      await page.goto(`/product/${PILOT_SLUG}`);
      await expect(page.getByTestId('flash-price-bar')).toBeVisible({ timeout: 15_000 });
      const slot = page.locator('[data-section="pdp-flash-limit"]');
      const anchor = await anchorBelow(slot);
      await expect(slot).toHaveText('');
      const before = (await anchor.boundingBox())!;
      const clsBefore = await readCls(page);
      g.release();
      if (perUserLeft === 0) await expect(slot).toHaveText(SPENT, { timeout: 10_000 });
      await page.waitForTimeout(500);
      const after = (await anchor.boundingBox())!;
      expect(Math.abs(after.y - before.y), `khối bên dưới dịch ${after.y - before.y}px`).toBeLessThanOrEqual(1);
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
