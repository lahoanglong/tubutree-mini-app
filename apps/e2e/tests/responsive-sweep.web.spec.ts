import { expect, type Page } from '@playwright/test';
import { test } from './support/mock-api';
import { assertSeededOnCi } from './support/a11y-db';
import { solidPng } from './support/noise-png';
import { CLASSIC_SCROLLBAR_CSS, FRAME_MAX, SWEEP_DIR, SWEEP_SIZES, probeResponsive, recordSweep, sweepShotPath, tileHoverChanges } from './support/responsive-probe';
import { seedTourPublicData } from './support/tour-db';
import { tourEntries } from './support/tour';
import { mockTourWorld, tourUser } from './support/tour-world';
import { shootJpeg } from './support/w182-audit';

/**
 * tubu-w3-04: quét chuyển khổ web 1440 → 1024 → 768 → 390 → 360px trên mười màn khách (Trang chủ, Danh mục cả hub lẫn danh sách, chi tiết
 * sản phẩm, Giỏ, Thanh toán, Ưu đãi, Vườn Xanh, Đổi rác, Kho quà, Tài khoản), cùng dữ liệu tham quan với W182 (khách đã đăng nhập, giỏ có hàng).
 * Điện thoại chạy với cảm ứng + isMobile (lớp `pointer: coarse` đổi cỡ chữ ô nhập), máy tính chạy với thanh cuộn cổ điển chiếm chỗ (như Windows).
 * Có RESP_SWEEP_DIR thì ghi thêm số đo + ảnh (bảng trước/sau của wave) rồi vẫn khẳng định:
 * - không trang nào cuộn ngang;
 * - lưới thẻ sản phẩm: 2 cột ở điện thoại, 2–3 cột ở 768, từ 4 cột ở máy tính; thẻ cùng hàng cao bằng nhau, dòng giá và nút thêm nhanh thẳng hàng;
 * - máy tính: khung trang không rộng quá `max-w-frame` và nằm giữa; không có danh sách thẻ một cột kéo dài quá 760px; thẻ sản phẩm đổi dáng khi rê chuột;
 *   Giỏ và Thanh toán có khối tóm tắt dính ở cột phải;
 * - mọi khổ: thanh cố định/dính không chồng nhau, thanh đáy không che nội dung hay chân trang khi cuộn hết trang.
 */
const ROUTES: { key: string; tour: string; web?: string }[] = [
  { key: '/', tour: '/' },
  { key: '/san-pham', tour: '/browse' },
  { key: '/san-pham?all=1', tour: '/browse', web: '/san-pham?all=1' },
  { key: '/san-pham/[slug]', tour: '/product/:slug' },
  { key: '/gio-hang', tour: '/cart' },
  { key: '/thanh-toan', tour: '/checkout' },
  { key: '/uu-dai', tour: '/offers' },
  { key: '/vuon-xanh', tour: '/game' },
  { key: '/doi-rac', tour: '/recycle' },
  { key: '/kho-qua', tour: '/rewards' },
  { key: '/tai-khoan', tour: '/profile' },
];

/** Màn có khối tóm tắt dính bên phải từ lg (DESIGN.md, Khuôn trang web máy tính); ở md hai màn này là một cột hẹp ở giữa (`md:max-w-[45rem]`). */
const RIGHT_SUMMARY = new Set(['/gio-hang', '/thanh-toan']);

/** Khung tóm tắt Giỏ (từ md là một thẻ): khối đầu tiên nhìn thấy không được mở đầu bằng vạch kẻ hay khoảng trống thừa. */
async function cartSummaryLead(page: Page): Promise<{ border: number; gap: number } | null> {
  return page.evaluate(() => {
    const box = document.querySelector('[data-testid="cart-summary"]');
    if (!box || getComputedStyle(box).display === 'contents') return null;
    const first = Array.from(box.children).find((c) => getComputedStyle(c).display !== 'none' && c.getBoundingClientRect().height > 0);
    if (!first) return null;
    const cs = getComputedStyle(first);
    const gap = first.getBoundingClientRect().top - box.getBoundingClientRect().top - parseFloat(getComputedStyle(box).paddingTop) - parseFloat(getComputedStyle(box).borderTopWidth);
    return { border: parseFloat(cs.borderTopWidth), gap: Math.round(gap * 10) / 10 };
  });
}

test.beforeAll(async () => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      assertSeededOnCi(await seedTourPublicData());
      return;
    } catch (e) {
      if (attempt >= 4 || !/40P01|deadlock/i.test(String(e))) throw e;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
});

const IMAGE_PNG = solidPng(150, 60, [47, 107, 79]);
const isServedImage = (url: URL) => url.pathname === '/api/img' || url.pathname.startsWith('/api/public-image/');

for (const size of SWEEP_SIZES) {
  test.describe(`quét chuyển khổ web ${size.width}px`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.kind !== 'desktop', isMobile: size.kind === 'phone' });

    for (const route of ROUTES) {
      test(`${route.key} ${size.width}px`, async ({ page, api }, testInfo) => {
        test.skip(testInfo.project.name !== 'Web Customer', 'tự đặt khổ từng ca, chỉ chạy ở một project');
        const entry = tourEntries().find((e) => e.key === route.tour);
        expect(entry, `route-map thiếu ${route.tour}`).toBeTruthy();
        await page.addInitScript(() => {
          try {
            localStorage.setItem('tubu_web_session', '1');
            localStorage.setItem('tubu_garden_hint_seen', '1');
          } catch {
            // không có localStorage: màn vẫn dựng
          }
        });
        if (route.key === '/') await page.context().addCookies([{ name: 'tubu_web_session', value: '1', domain: 'localhost', path: '/' }]);
        mockTourWorld(api, tourUser(entry!.role));
        entry!.setup?.(api);
        api.allowUnmocked('GET /auth/me', 'GET /waste/requests', 'POST /cart/coupon');
        await page.route(isServedImage, (r) => r.fulfill({ contentType: 'image/png', body: IMAGE_PNG }));
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(route.web ?? entry!.web);
        if (size.kind === 'desktop') await page.addStyleTag({ content: CLASSIC_SCROLLBAR_CSS });
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {});
        await page.waitForTimeout(900);

        const f = await probeResponsive(page);
        const hover = size.kind === 'desktop' ? await tileHoverChanges(page) : null;
        const summaryLead = route.key === '/gio-hang' && size.kind !== 'phone' ? await cartSummaryLead(page) : null;

        if (SWEEP_DIR) {
          await shootJpeg(page, sweepShotPath('web', route.key, size), true, 3200);
          recordSweep('web', route.key, size, { ...f, hover, summaryLead });
        }

        expect.soft(f.overflowX, `cuộn ngang ${JSON.stringify(f.overflow)}`).toBeLessThanOrEqual(0);
        expect.soft(f.overflow, 'phần tử ra ngoài khung').toEqual([]);
        for (const g of f.grids) {
          if (size.kind === 'phone') expect.soft(g.cols, `${g.label}: số cột ở điện thoại`).toBe(2);
          if (size.kind === 'tablet') expect.soft([2, 3], `${g.label}: số cột ở 768`).toContain(g.cols);
          if (size.kind === 'desktop' && g.tiles >= 4) expect.soft(g.cols, `${g.label}: số cột ở máy tính`).toBeGreaterThanOrEqual(4);
          expect.soft(g.heightSpread, `${g.label}: thẻ cùng hàng lệch chiều cao`).toBeLessThanOrEqual(1);
          expect.soft(g.priceSpread, `${g.label}: dòng giá cùng hàng lệch`).toBeLessThanOrEqual(1);
          if (g.ctaSpread !== null) expect.soft(g.ctaSpread, `${g.label}: nút thêm nhanh cùng hàng lệch`).toBeLessThanOrEqual(1);
        }
        // Từ md khung trang thẳng mép với hàng logo của header (cùng PAGE_WIDE), trừ Giỏ/Thanh toán ở md (cột hẹp ở giữa là chủ ý).
        if (size.kind !== 'phone' && !(RIGHT_SUMMARY.has(route.key) && size.kind === 'tablet')) {
          expect.soft(f.frame && f.headerFrame ? Math.abs(f.frame.left - f.headerFrame.left) : -1, `khung trang lệch mép trái header ${JSON.stringify([f.frame, f.headerFrame])}`).toBeLessThanOrEqual(1);
          expect.soft(f.frame && f.headerFrame ? Math.abs(f.frame.right - f.headerFrame.right) : -1, 'khung trang lệch mép phải header').toBeLessThanOrEqual(1);
        }
        if (summaryLead) {
          expect.soft(summaryLead.border, 'khung tóm tắt Giỏ mở đầu bằng vạch kẻ').toBe(0);
          expect.soft(summaryLead.gap, 'khung tóm tắt Giỏ mở đầu bằng khoảng trống').toBeLessThanOrEqual(1);
        }
        if (size.kind === 'desktop') {
          expect.soft(f.frame, 'có <main>').not.toBeNull();
          if (f.frame) {
            expect.soft(f.frame.width, 'khung trang rộng quá max-w-frame').toBeLessThanOrEqual(FRAME_MAX);
            expect.soft(Math.abs(f.frame.left - (f.vw - f.frame.right)), 'khung trang lệch tâm').toBeLessThanOrEqual(1);
          }
          expect.soft(f.stretched, 'danh sách thẻ một cột kéo giãn trên máy tính').toEqual([]);
          if (f.grids.length > 0) expect.soft(hover, 'thẻ sản phẩm không đổi dáng khi rê chuột').toBe(true);
          if (RIGHT_SUMMARY.has(route.key)) {
            const right = f.sticky.find((s) => s.left >= f.vw / 2 && s.cssTop !== null);
            expect.soft(right, `khối tóm tắt dính cột phải ${JSON.stringify(f.sticky)}`).toBeTruthy();
          }
        }
        expect.soft(f.fixedOverlap, 'thanh cố định/dính chồng nhau').toEqual([]);
        if (f.bottomClearance !== null) expect.soft(f.bottomClearance, `thanh đáy ${f.bottomBars.join(', ')} che nội dung cuối trang`).toBeGreaterThanOrEqual(0);
        expect.soft(f.bottomCovered, 'phần nhô của thanh đáy che nội dung cuối trang').toEqual([]);
      });
    }
  });
}
