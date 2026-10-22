import { test } from './support/mock-api';
import { seedTourPublicData } from './support/tour-db';
import { tourEntries } from './support/tour';
import { mockTourWorld, tourUser } from './support/tour-world';
import { captureVisual } from './support/visual';

/**
 * Tham quan web khổ điện thoại: cùng dữ liệu với bản Mini App (visual-tour.miniapp.spec.ts), chụp theo cùng khoá cặp.
 * Dữ liệu render phía máy chủ (SSR) lấy từ DB e2e đã seed. Chỉ chạy khi có VISUAL_DIR.
 */
test.beforeAll(async () => {
  await seedTourPublicData();
});

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
    await page.goto(entry.web);
    await captureVisual(page, 'web', entry.key, entry.name);
  });
}
