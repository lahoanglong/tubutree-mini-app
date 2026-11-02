import { mkdirSync } from 'node:fs';
import { expect, test } from './support/mock-api';
import { mockDiscovery } from './support/discovery-mocks';
import { MAX_BASELINE_DRIFT_PX, tabLabelBottoms } from './support/nav-baseline';

/** Web 375x812: nhãn của cả 5 tab cùng đường chân chữ, lệch tối đa 0,5 px, như Mini App. Đặt SHOT_DIR để chụp ảnh. */
test.describe('Web khổ 375: thanh đáy, đường chân chữ nhãn tab', () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== 'Web Customer Mobile', 'chỉ đo ở khổ điện thoại');
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy
      }
    });
  });

  test('cả 5 nhãn có đáy chữ lệch tối đa 0,5 px (có badge đơn đang xử lý)', async ({ page, api }) => {
    mockDiscovery(api, { returning: true, shipping: true });
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Thanh điều hướng dưới' });
    await expect(nav).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    const dir = process.env.SHOT_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: `${dir}/web375-trang-chu.png` });
      await nav.screenshot({ path: `${dir}/web375-thanh-day.png` });
    }
    const bottoms = await tabLabelBottoms(nav);
    console.log(`NAV_BASELINE_WEB ${JSON.stringify(bottoms)}`);
    expect(bottoms.map((b) => b.text)).toEqual(['Trang chủ', 'Danh mục', 'Vườn Xanh', 'Ưu đãi', 'Cá nhân']);
    const values = bottoms.map((b) => b.bottom);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(MAX_BASELINE_DRIFT_PX);
  });
});
