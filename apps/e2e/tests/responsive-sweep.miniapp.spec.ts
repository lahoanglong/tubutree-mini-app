import { expect, mockSession, test } from './support/mock-api';
import { SWEEP_DIR, SWEEP_SIZES, probeResponsive, recordSweep, sweepShotPath } from './support/responsive-probe';
import { tourEntries } from './support/tour';
import { mockTourWorld, tourUser } from './support/tour-world';
import { installVisualMode, settle } from './support/visual';
import { shootJpeg } from './support/w182-audit';

/**
 * tubu-w3-04: Mini App chỉ chạy trong Zalo trên điện thoại nên chỉ quét 390 và 360px, cùng mười màn và cùng dữ liệu tham quan với bản web
 * (responsive-sweep.web.spec.ts). Có RESP_SWEEP_DIR thì ghi thêm số đo + ảnh; luôn khẳng định: không cuộn ngang, lưới thẻ 2 cột với thẻ
 * cùng hàng cao bằng nhau và dòng giá/nút thêm nhanh thẳng hàng, thanh cố định không chồng nhau, thanh đáy không che nội dung cuối trang.
 */
const ROUTES: { key: string; tour: string; query?: string }[] = [
  { key: '/', tour: '/' },
  { key: '/browse', tour: '/browse' },
  { key: '/browse?all=1', tour: '/browse', query: '?all=1' },
  { key: '/product/:slug', tour: '/product/:slug' },
  { key: '/cart', tour: '/cart' },
  { key: '/checkout', tour: '/checkout' },
  { key: '/offers', tour: '/offers' },
  { key: '/game', tour: '/game' },
  { key: '/recycle', tour: '/recycle' },
  { key: '/rewards', tour: '/rewards' },
  { key: '/profile', tour: '/profile' },
];

for (const size of SWEEP_SIZES.filter((s) => s.kind === 'phone')) {
  test.describe(`quét chuyển khổ Mini App ${size.width}px`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: true, isMobile: true });

    for (const route of ROUTES) {
      test(`${route.key} ${size.width}px`, async ({ page, api }) => {
        const entry = tourEntries().find((e) => e.key === route.tour);
        expect(entry, `route-map thiếu ${route.tour}`).toBeTruthy();
        const user = tourUser(entry!.role);
        mockSession(api, user);
        mockTourWorld(api, user);
        entry!.setup?.(api);
        api.allowUnmocked('GET /auth/me', 'GET /waste/requests', 'POST /cart/coupon');
        await page.addInitScript(() => {
          try {
            window.localStorage.setItem('tubu_garden_hint_seen', '1');
          } catch {
            // không có localStorage: màn vẫn dựng
          }
        });
        await installVisualMode(page);
        await page.goto(`${entry!.miniapp}${route.query ?? ''}`);
        await expect
          .poll(() => api.callsTo('POST', '/auth/guest').length + api.callsTo('POST', '/auth/zalo-mini-app').length + api.callsTo('POST', '/auth/refresh').length, { timeout: 8000 })
          .toBeGreaterThan(0)
          .catch(() => {});
        await settle(page);
        await page.waitForTimeout(600);

        const f = await probeResponsive(page);
        if (SWEEP_DIR) {
          await shootJpeg(page, sweepShotPath('miniapp', route.key, size), false);
          recordSweep('miniapp', route.key, size, f);
        }
        expect.soft(f.overflowX, `cuộn ngang ${JSON.stringify(f.overflow)}`).toBeLessThanOrEqual(0);
        for (const g of f.grids) {
          expect.soft(g.cols, `${g.label}: số cột`).toBe(2);
          expect.soft(g.heightSpread, `${g.label}: thẻ cùng hàng lệch chiều cao`).toBeLessThanOrEqual(1);
          expect.soft(g.priceSpread, `${g.label}: dòng giá cùng hàng lệch`).toBeLessThanOrEqual(1);
          if (g.ctaSpread !== null) expect.soft(g.ctaSpread, `${g.label}: nút thêm nhanh cùng hàng lệch`).toBeLessThanOrEqual(1);
        }
        expect.soft(f.fixedOverlap, 'thanh cố định/dính chồng nhau').toEqual([]);
        if (f.bottomClearance !== null) expect.soft(f.bottomClearance, `thanh đáy ${f.bottomBars.join(', ')} che nội dung cuối trang`).toBeGreaterThanOrEqual(0);
        expect.soft(f.bottomCovered, 'phần nhô của thanh đáy che nội dung cuối trang').toEqual([]);
      });
    }
  });
}
