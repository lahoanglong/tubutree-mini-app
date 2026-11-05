import { test } from './support/mock-api';
import { assertSeededOnCi } from './support/a11y-db';
import { seedTourPublicData } from './support/tour-db';
import { solidPng } from './support/noise-png';
import { tourEntries } from './support/tour';
import { mockTourWorld, tourUser } from './support/tour-world';
import { captureVisual } from './support/visual';

/**
 * Tham quan web khổ điện thoại: cùng dữ liệu với bản Mini App (visual-tour.miniapp.spec.ts), chụp theo cùng khoá cặp.
 * Dữ liệu render phía máy chủ (SSR) lấy từ DB e2e đã seed. Chỉ chạy khi có VISUAL_DIR.
 */
test.beforeAll(async () => {
  assertSeededOnCi(await seedTourPublicData());
});

// Ảnh đi qua `/api/img` (bản đổi cỡ) và `/api/public-image/` (ảnh gốc khi bản đổi cỡ hỏng): mock-api chỉ trả JSON nên cả hai là 404 và banner chiến dịch thành khung ảnh vỡ.
const IMAGE_PNG = solidPng(150, 60, [47, 107, 79]);
const isServedImage = (url: URL) => url.pathname === '/api/img' || url.pathname.startsWith('/api/public-image/');

for (const entry of tourEntries()) {
  test(`tham quan ${entry.key}`, async ({ page, api }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: màn vẫn dựng, chỉ không có phiên khôi phục
      }
    });
    mockTourWorld(api, tourUser(entry.role));
    entry.setup?.(api);
    await page.route(isServedImage, (route) => route.fulfill({ contentType: 'image/png', body: IMAGE_PNG }));
    await page.goto(entry.web);
    await captureVisual(page, 'web', entry.key, entry.name);
  });
}
