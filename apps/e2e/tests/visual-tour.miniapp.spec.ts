import { expect, test, mockSession } from './support/mock-api';
import { tourEntries } from './support/tour';
import { mockTourWorld, tourUser } from './support/tour-world';
import { captureVisual } from './support/visual';

/**
 * Tham quan Mini App: vào thẳng từng route trong route-map.json với dữ liệu đủ nội dung rồi chụp theo khoá cặp.
 * Chỉ chạy khi có VISUAL_DIR (playwright.config.ts bỏ qua file này khi không có biến).
 */
for (const entry of tourEntries()) {
  test(`tham quan ${entry.key}`, async ({ page, api }) => {
    const user = tourUser(entry.role);
    mockSession(api, user);
    mockTourWorld(api, user);
    entry.setup?.(api);
    await page.goto(entry.miniapp);
    // Phiên khôi phục bất đồng bộ: chụp trước khi đăng nhập xong sẽ ra màn của khách chưa đăng nhập.
    await expect
      .poll(() => api.callsTo('POST', '/auth/guest').length + api.callsTo('POST', '/auth/zalo-mini-app').length + api.callsTo('POST', '/auth/refresh').length, { timeout: 8000 })
      .toBeGreaterThan(0)
      .catch(() => {});
    await captureVisual(page, 'miniapp', entry.key, entry.name);
  });
}
