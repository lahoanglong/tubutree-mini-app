import { expect, test } from './support/mock-api';
import { NOISE, mockImages, runLcp } from './support/lcp-measure';

/**
 * Web 375×812, Trang chủ: ảnh ưu tiên (fetchpriority=high) chỉ nằm trong màn đầu, ảnh LCP là một `<img>` không `loading=lazy`, và không có preload ảnh cho phần
 * tử đang ẩn ở khổ này. Ảnh sản phẩm/banner đi qua `{api}/img` (host Pancake), nên spec chặn `/api/img` và trả một PNG nhiễu: không phụ thuộc mạng, và đủ
 * "entropy" (Chrome không tính ảnh dưới ~0,05 bit/điểm ảnh vào LCP, ảnh 1×1 làm LCP rơi về một đoạn chữ).
 * Ngưỡng ảnh high: tối đa 3 (banner slide 0 + 2 thẻ Giờ vàng đầu; dấu logo Trang chủ chỉ eager, không ưu tiên).
 * Ca /san-pham cần ghi ảnh vào DB nên nằm ở lcp-priority-db.web.spec.ts, chạy ở project riêng sau các project web khách.
 */
test.use({ viewport: { width: 375, height: 812 } });

test('LCP Trang chủ 375×812: ảnh high trong màn đầu, LCP không lazy', async ({ page, api }) => {
  await runLcp(page, api, { name: 'Trang chủ', path: '/', ready: '[data-ds="product-tile"]', maxHigh: 3 });
});

// Bề rộng ảnh banner Ưu đãi = sizes, và bản trình duyệt chọn (currentSrc) là bản đổi cỡ đủ nét: phải là `{api}/img?w=<bề rộng>`, không bao giờ là ảnh gốc của host nguồn.
const BANNER_CASES = [
  { name: 'điện thoại 375@2', vw: 375, vh: 812, dpr: 2, slot: 375 - 32, picks: 960 },
  { name: 'điện thoại 412@2.625', vw: 412, vh: 915, dpr: 2.625, slot: 412 - 32, picks: 1280 },
  { name: 'điện thoại 390@3', vw: 390, vh: 844, dpr: 3, slot: 390 - 32, picks: 1280 },
  { name: 'laptop 1024@1', vw: 1024, vh: 800, dpr: 1, slot: Math.min(1024 - 48, 1152), picks: 1280 },
  { name: 'laptop 1280@1', vw: 1280, vh: 800, dpr: 1, slot: Math.min(1280 - 48, 1152), picks: 1280 },
  { name: 'laptop 1280@2', vw: 1280, vh: 800, dpr: 2, slot: Math.min(1280 - 48, 1152), picks: 1920 },
  { name: 'màn rộng 1440@1', vw: 1440, vh: 900, dpr: 1, slot: Math.min(1440 - 48, 1152), picks: 1280 },
];

test.describe('banner Ưu đãi: sizes khớp bề rộng thật và chọn bản đổi cỡ', () => {
  for (const c of BANNER_CASES) {
    test.describe(c.name, () => {
      test.use({ viewport: { width: c.vw, height: c.vh }, deviceScaleFactor: c.dpr });
      test('bề rộng ảnh = sizes; currentSrc là /img?w= đúng bậc, không phải ảnh gốc', async ({ page, api }) => {
        mockImages(api);
        await page.route('**/api/img?**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: NOISE }));
        await page.route('https://res.cloudinary.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: NOISE }));
        await page.goto('/uu-dai');
        const img = page.locator('[data-offers-banner] img').first();
        await expect(img).toBeVisible({ timeout: 20_000 });
        const box = await img.boundingBox();
        expect(Math.abs(box!.width - c.slot), `bề rộng ảnh ${box!.width} so với sizes ${c.slot}`).toBeLessThanOrEqual(1);
        await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.currentSrc)).not.toBe('');
        const current = await img.evaluate((el: HTMLImageElement) => el.currentSrc);
        expect(current, `currentSrc ${current}`).toMatch(new RegExp(`/img\\?w=${c.picks}&u=`));
        expect(current.startsWith('https://res.cloudinary.com/'), 'không được chọn ảnh gốc của host nguồn').toBe(false);
      });
    });
  }
});
